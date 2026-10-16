# Armazém · Controle de estoque

Aplicação para cadastrar produtos, acompanhar quantidades e registrar entradas e saídas com data e hora. Os dados ficam salvos em `estoque.db`, no computador que executa o servidor.

## Como iniciar

Requer Python 3.9 ou mais recente. Não precisa instalar pacotes.

```powershell
python app.py
```

No computador servidor, abra `http://127.0.0.1:8000`. Ao iniciar, o terminal também mostra o endereço de rede, por exemplo `http://192.168.1.25:8000`. Em outros computadores conectados à mesma rede, abra esse endereço usando o IPv4 mostrado no terminal ou pelo comando `ipconfig`.

Se o Windows bloquear a conexão, abra o PowerShell como Administrador no computador servidor e libere a porta apenas no perfil de rede privada:

```powershell
New-NetFirewallRule -DisplayName "Armazem estoque (8000)" -Direction Inbound -Protocol TCP -LocalPort 8000 -Action Allow -Profile Private
```

O servidor não tem autenticação nem HTTPS. Use apenas em uma rede confiável; não encaminhe a porta do roteador nem exponha o app diretamente à internet.

Para encerrar o servidor, use `Ctrl+C` no terminal.

## Recursos

- Cadastro de produtos, código, categoria, saldo inicial e nível mínimo.
- Registro de entradas e saídas com data/hora e observação.
- Bloqueio de saída acima do saldo disponível.
- Alertas no painel para produtos no nível mínimo ou zerados.
- Histórico recente de movimentações e busca por produto/código.
- Na primeira execução, importa os produtos de exemplo de `dados_exemplo.json` se o catálogo estiver vazio. O arquivo pode ser editado antes de iniciar o app.