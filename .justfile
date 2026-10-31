
default:
    echo 'Hello, world!'

[no-cd]
serve:
    python3 -m http.server 4000

ports port:
    lsof -ti :{{port}}

[no-cd]
sbx-template container-name template-name:
    sbx template save {{container-name}} {{template-name}}

[no-cd]
sbx_ container-name:
    sbx exec -it {{container-name}} zsh 

[no-cd]
sbxx:
    sbx exec -it latest zsh 

[no-cd]
sbx-new name template-name="dev:v4":
    sbx run --name {{name}} --template docker.io/library/{{template-name}} shell .

[no-cd]
pull-config name target
    curl https://raw.githubusercontent.com/johncun/config/refs/heads/master/{{name}} > {{target}}

