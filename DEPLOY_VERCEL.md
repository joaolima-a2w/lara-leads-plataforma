# Deploy no Vercel

Este documento cobre o que muda pra rodar a plataforma inteira (dashboard + chat com
webhook real) no Vercel em vez de só localmente. Leia também [POLLING.md](POLLING.md)
(por que o SSE saiu) antes de mexer em `server.js`/`app.js`/`api/`.

---

## 1. O que mudou pra isso funcionar em serverless

`server.js` é um processo Node de vida longa com estado em memória
(`pendingResponses`/`activeStatuses`/`chatCosts`/`requestLogs`/erros) e uma conexão SSE
mantida aberta — nada disso sobrevive a funções serverless (cada invocação é isolada, sem
memória compartilhada com a próxima). Pra rodar no Vercel:

- **As rotas de API viraram funções em [api/](api/)** — um catch-all
  (`api/[...path].js`) reaproveitando a mesma lógica de `server.js`, mais
  `api/error.js` à parte (só porque também responde em `/error`, sem o prefixo `/api`,
  via rewrite no `vercel.json`).
- **O estado em memória virou tabelas no Supabase** — ver `sandboxStore.js` e o SQL em
  `supabase_setup_vercel.sql`.
- **SSE virou polling** (`GET /api/poll`) — ver [POLLING.md](POLLING.md).
- **`server.js` continua existindo e funcionando igual** pra desenvolvimento local
  (`node server.js`) — as duas implementações (local em memória, Vercel via Supabase)
  falam o mesmo contrato HTTP, então o front-end (`app.js`) não sabe nem precisa saber
  qual das duas está do outro lado.
- **Os arquivos estáticos** (`.html`/`.css`/`.js` na raiz) são servidos automaticamente
  pelo Vercel, sem configuração — não existe mais servidor de arquivos manual nessa parte.

---

## 2. Antes do primeiro deploy

### 2.1 Rodar o SQL de setup no Supabase
Abra o **SQL Editor** do seu projeto no [dashboard do Supabase](https://supabase.com/dashboard)
e rode o conteúdo de [supabase_setup_vercel.sql](supabase_setup_vercel.sql) (cria as
tabelas `sandbox_messages`, `sandbox_chat_state`, `sandbox_errors`, `sandbox_logs`).
Isso só precisa ser feito uma vez.

### 2.2 Ter uma conta Vercel com o projeto linkado
Isso exige login interativo — não é algo que eu (Claude) consigo fazer por você:
```bash
npm i -g vercel      # se ainda não tiver a CLI
vercel login
vercel link          # dentro da pasta do projeto — cria/associa um projeto Vercel
```

### 2.3 Configurar as variáveis de ambiente no Vercel
No dashboard do projeto no Vercel: **Settings → Environment Variables**, ou via CLI
(`vercel env add NOME_DA_VAR`). Use os mesmos valores do seu `.env` local (ver
[.env.example](.env.example)):

| Variável | Obrigatória p/ o quê |
|---|---|
| `SUPABASE_URL` | Todas as telas do dashboard (leads/contatos/setup) + chat sandbox |
| `SUPABASE_PUBLISHABLE_KEY` | — (não é usada pelo backend hoje, mas documentada no `.env.example`) |
| `SUPABASE_SECRET_KEY` | Idem, é a chave admin que `supabaseAdmin` usa |
| `SUPABASE_JWKS_URL` | — (reservada, não usada pelos endpoints atuais) |
| `DATABASE_URL` | Só `GET /api/db/health` (ver limitação na seção 4) |
| `DATABASE_SSL` | Idem |

**Nunca** commite o `.env` — ele já está no `.gitignore`. As variáveis do Vercel são
configuradas separadamente, direto no dashboard/CLI.

---

## 3. Deploy

```bash
vercel          # deploy de preview
vercel --prod   # deploy de produção
```

Depois do primeiro deploy, o Vercel te dá uma URL fixa (`https://seu-projeto.vercel.app`).
É essa URL que substitui o túnel do ngrok.

---

## 4. Depois do deploy

### 4.1 Apontar o n8n pra URL de produção
Em vez de `https://xxxx.ngrok-free.app/api/callback` (ou `http://localhost:3000/api/callback`),
os nodes do n8n que chamam de volta pro sandbox (`/api/callback`, `/api/status`,
`/api/cost`, `/api/error`) devem apontar pra `https://seu-projeto.vercel.app/api/...`.

### 4.2 Setar `webhookUrl` no chat
Na tela de chat (`index.html`), abra **Parâmetros** e confirme que `webhookUrl` aponta
pro webhook real do n8n (isso não muda com o deploy — é sempre a URL do n8n, não a do
Vercel; a URL do Vercel é só o que o n8n chama de *volta*).

### 4.3 Testar o fluxo assíncrono ponta a ponta
1. Envie uma mensagem no chat em modo `custom-webhook`.
2. Confirme no n8n que a chamada pro webhook chegou.
3. Confirme que a resposta do n8n pra `https://seu-projeto.vercel.app/api/callback`
   aparece no chat dentro de ~2s (o tempo do próximo tick do polling — ver
   [POLLING.md](POLLING.md)).

---

## 5. Limitações conhecidas nesse ambiente

- **`GET /api/db/health` (Postgres direto via `pg`) tem risco de não funcionar a partir
  do Vercel.** Ao testar a conexão direta com Postgres *deste* ambiente de
  desenvolvimento, a conexão caiu com `ECONNRESET` — pode ser uma restrição de rede só
  daqui, ou pode ser algo que também afete o Vercel (Supabase às vezes exige usar a
  connection string do **pooler** — "Transaction" ou "Session mode", em vez da conexão
  direta — em ambientes serverless/IPv4-only). Se `/api/db/health` falhar em produção
  mas `/api/supabase/health` funcionar, troque `DATABASE_URL` pela connection string do
  pooler (Project Settings → Database → Connection Pooling, no dashboard do Supabase).
  Nenhuma tela do produto depende de `db.js`/`pg` hoje — só esse endpoint de diagnóstico.
- **`POST /api/simulate-async-status`** (botão "Demo Status") usa `waitUntil` (pacote
  `@vercel/functions`) pra continuar escrevendo atualizações depois de já ter respondido
  — isso é necessário porque uma função serverless pode ser congelada assim que a
  resposta é enviada. Testado só por leitura de código, não por um deploy real — vale
  conferir uma vez em produção.
- **Cada tick do polling é uma invocação de função** no Vercel — dentro do plano
  gratuito isso não deve ser um problema pro uso de teste, mas é bom ter em mente se o
  uso crescer (ver seção 7 do [POLLING.md](POLLING.md)).
