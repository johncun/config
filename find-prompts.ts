import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { spawn } from "node:child_process";

interface TextContent {
  type: string;
  text?: string;
}

interface Message {
  role: string;
  content: string | TextContent[];
  timestamp?: number;
}

interface SessionEntry {
  type?: string;
  timestamp?: string | number;
  message?: Message;
}

interface PromptRecord {
  timestamp: number;
  dateStr: string;
  text: string;
}

const DELIMITER = " ↵ ";

async function getJsonlFiles(dirPath: string): Promise<string[]> {
  let results: string[] = [];
  try {
    const entries = await readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dirPath, entry.name);
      if (entry.isDirectory()) {
        const subFiles = await getJsonlFiles(fullPath);
        results = results.concat(subFiles);
      } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        results.push(fullPath);
      }
    }
  } catch {
    // Ignore unreadable or missing directories
  }
  return results;
}

async function extractPromptsFromFile(filePath: string): Promise<PromptRecord[]> {
  const prompts: PromptRecord[] = [];
  try {
    const content = await readFile(filePath, "utf-8");
    const lines = content.split("\n");

    for (const line of lines) {
      if (!line.trim()) continue;

      try {
        const entry: SessionEntry = JSON.parse(line);
        if (entry.message && entry.message.role === "user") {
          let promptText = "";

          if (typeof entry.message.content === "string") {
            promptText = entry.message.content;
          } else if (Array.isArray(entry.message.content)) {
            promptText = entry.message.content
              .filter((item) => item.type === "text" && item.text)
              .map((item) => item.text)
              .join("\n");
          }

          if (!promptText.trim()) continue;

          const tsRaw = entry.message.timestamp || entry.timestamp || 0;
          const ts = typeof tsRaw === "string" ? new Date(tsRaw).getTime() : tsRaw;

          prompts.push({
            timestamp: ts,
            dateStr: ts ? new Date(ts).toLocaleString() : "Unknown Date",
            text: promptText,
          });
        }
      } catch {
        // Skip malformed JSON lines
      }
    }
  } catch {
    // Skip unreadable files
  }
  return prompts;
}

/**
 * Spawns fzf with interactive single-line mapping and multi-line preview,
 * then pipes the restored selection to xclip.
 */
function runFzfAndCopy(prompts: PromptRecord[]): Promise<void> {
  return new Promise((resolve, reject) => {
    if (prompts.length === 0) {
      console.log("No prompts found.");
      return resolve();
    }

    // Format each prompt into a single line for fzf, replacing newlines with the delimiter
    const formattedLines = prompts.map((item) => {
      const sanitizedText = item.text.replace(/\r?\n/g, DELIMITER);
      return `[${item.dateStr}] ${sanitizedText}`;
    });

    // Configure fzf with a multi-line preview box restoring original newlines
    const fzf = spawn(
      "fzf",
      [
        "--preview",
        `echo {} | sed "s/${DELIMITER.trim()}/\\n/g"`,
        "--preview-window=down:50%:wrap",
        "--prompt=Select Prompt > ",
      ],
      {
        stdio: ["pipe", "pipe", "inherit"],
      }
    );

    let selectedLine = "";

    fzf.stdout.on("data", (chunk: Buffer) => {
      selectedLine += chunk.toString();
    });

    fzf.on("close", (code) => {
      if (code !== 0 || !selectedLine.trim()) {
        console.log("No selection made.");
        return resolve();
      }

      // Strip out the leading date header "[Date] "
      const rawPayload = selectedLine.trim().replace(/^\[.*?\]\s*/, "");
      
      // Restore actual multiline line breaks
      const fullText = rawPayload.replace(new RegExp(DELIMITER.trim(), "g"), "\n");

      // Pipe restored text straight to /usr/local/bin/xclip -> OSC 52 -> Herd / local OS clipboard
      const xclip = spawn("/usr/local/bin/xclip", [], {
        stdio: ["pipe", "inherit", "inherit"],
      });

      xclip.stdin.write(fullText);
      xclip.stdin.end();

      xclip.on("close", (clipCode) => {
        if (clipCode === 0) {
          console.log("\x1b[32m✔ Prompt copied to clipboard!\x1b[0m");
        } else {
          console.error("Failed to write to clipboard via xclip.");
        }
        resolve();
      });
    });

    fzf.on("error", (err) => {
      reject(new Error(`Failed to start fzf: ${err.message}`));
    });

    // Send formatted options to fzf stdin
    fzf.stdin.write(formattedLines.join("\n"));
    fzf.stdin.end();
  });
}

async function main(): Promise<void> {
  const sessionsDir = join(homedir(), ".pi", "agent", "sessions");
  const files = await getJsonlFiles(sessionsDir);
  const filePromises = files.map((file) => extractPromptsFromFile(file));
  const results = await Promise.all(filePromises);

  const allPrompts = results
    .flat()
    .sort((a, b) => b.timestamp - a.timestamp);

  await runFzfAndCopy(allPrompts);
}

main().catch(console.error);
