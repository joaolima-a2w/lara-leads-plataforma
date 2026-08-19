# Lara Leads Chat Sandbox — Spec para Reescrita

Este documento consolida **todas as regras** que o sandbox precisa seguir, levantadas a partir do código atual (`server.js`, `app.js`, `index.html`, `README.md`) e de tudo que investigamos/corrigimos nesta conversa. É a base para a reescrita — revise, ajuste o que quiser, e só depois eu implemento.

---

## 1. Objetivo

SPA de chat (estilo ChatGPT) pra testar e validar, manualmente ou via n8n, o envio/recebimento de payloads estruturados do Lara Leads. Roda sem instalar nada (Node puro, sem dependências) e tem fallback client-side (`mock-browser`) quando não há servidor.

---

## 2. Modelo de Dados por Chat

Cada chat no `state.chats` guarda:

```js
{
  id: "uuid-32-chars-sem-tracos",
  title: "Novo chat" | "Chat - <resumo>",
  createdAt: ISOString,
  lastActive: ISOString,
  messages: [ { message_id, sender: "user"|"lara"|"system", text, timestamp } ],
  lastRequestJson: object | null,   // último payload enviado (pro painel JSON)
  lastResponseJson: object | null,  // última resposta recebida (pro painel JSON)
  costTotal: number,          // valor total já acumulado, enviado pronto pelo workflow (não somado aqui)
  costCurrency: "BRL" | ...,  // padrão de todo chat novo é BRL

  // NOVO: substituir os 3 campos soltos (isProcessing, currentStatus, isClosed)
  // por uma única máquina de estados — ver seção 3.
  workflowState: "idle" | "sending" | "waiting" | "closed",
  currentStatusText: string | null,     // legenda opcional mostrada durante "waiting"
  currentStatusProgress: number | null  // 0-100 opcional, renderiza barra animada junto da legenda
}
```

**Por que mudar `isProcessing`/`currentStatus`/`isClosed` (3 booleans/campos soltos) pra um único `workflowState`:** foi exatamente a causa dos bugs recorrentes de "trava como se estivesse digitando" que caçamos nesta conversa — múltiplos pontos do código (polling de callback, polling de status, envio de mensagem, simulação) escreviam nesses campos de forma independente, e bastava um caminho esquecer de resetar um deles pra travar o chat. Uma máquina de estados única, com transições explícitas, elimina essa classe de bug por construção.

---

## 3. Máquina de Estados do Workflow (`workflowState`)

```
idle ──(usuário envia msg / clica card)──▶ sending
sending ──(resposta síncrona do webhook, modo sync/mock)──▶ idle
sending ──(erro na chamada)──▶ idle (+ mensagem de erro no chat)
sending ──(modo custom-webhook, resposta síncrona SEM status:"processing")──▶ idle (a resposta já é a final)
sending ──(modo custom-webhook, resposta síncrona COM status:"processing")──▶ waiting (mais coisa vem depois via /api/callback)
waiting ──(/api/callback chega com status:"processing")──▶ waiting (adiciona mensagem, mantém travado)
waiting ──(/api/callback chega com status:"ok")──▶ idle (adiciona mensagem, libera o chat)
waiting ──(/api/status ou /api/callback sinaliza status:"finalizado")──▶ closed
idle ──(/api/status sinaliza status:"finalizado", a qualquer momento)──▶ closed
closed ──(nada leva de volta — só um chat novo)
```

**Exceção que sempre vence:** se o `reply` é HTML (começa com `<` depois de `trim()` — mesmo teste que `renderMessages()` já usa pra decidir como exibir o texto), o chat vai pra `idle` **mesmo que o `status` mandado seja `"processing"`**. Não importa se é um dos cards com contrato documentado (seção 5) ou um card 100% customizado do workflow — qualquer HTML é, por definição, algo pra o usuário ver/interagir, nunca uma legenda de "workflow ainda trabalhando". Um workflow que precisa manter o spinner travado enquanto mostra uma legenda de progresso deve usar `/api/status` (texto puro, com `progress` opcional) em vez de mandar HTML dentro do `reply` do `/api/callback`.

(Versão anterior dessa regra checava só 3 nomes de classe específicos — `quick-reply-option`/`quick-reply-multi-select`/`quick-reply-new-chat-btn` — e não pegava cards 100% customizados sem essas classes, como um card de "prévia de cadência" com design próprio. A checagem por "é HTML" cobre qualquer card, custom ou não.)

Regras de UI derivadas do estado:
| Estado | Input/botão enviar | Cards clicáveis | O que aparece embaixo da última mensagem |
|---|---|---|---|
| `idle` | habilitado | habilitado | nada |
| `sending` | desabilitado | desabilitado | "..." (digitando) |
| `waiting` | desabilitado | desabilitado | "..." (digitando) ou legenda de status (`currentStatusText`) |
| `closed` | **desabilitado pra sempre** | **desabilitado pra sempre** | nada (mensagem de sistema já registra o encerramento) |

---

## 4. Contrato de API (servidor local, `server.js`)

Todos os endpoints continuam prefixados por `http://localhost:3000` (ou pela URL pública do ngrok apontando pro mesmo servidor).

### 4.1 `POST /api/callback` — resposta assíncrona final ou intermediária do n8n
```json
{ "chat_id": "...", "reply": "texto ou HTML", "status": "ok" | "processing" | "finalizado", "message_id"?: "...", "next_action"?: "..." }
```
- **Obrigatórios:** `chat_id`, `reply`.
- `status` ausente → default `"ok"`.
- `status: "processing"` → mensagem aparece no chat, `workflowState` continua `waiting` (typing indicator).
- `status: "ok"` → mensagem aparece, `workflowState` volta pra `idle`.
- `status: "finalizado"` → mensagem aparece, `workflowState` vai pra `closed` (permanente).
- Enfileira em `pendingResponses[chat_id]`, lido pelo front via polling (`GET /api/poll?chat_id=`) — ver [POLLING.md](POLLING.md). `GET /api/pending-responses` continua existindo mas não é mais consumido pelo front.

### 4.2 `POST /api/status` — legenda de progresso (não é a resposta final)
```json
{ "chat_id": "...", "status": "texto livre" | "finalizado", "progress"?: 0-100 }
```
- **Obrigatório:** `chat_id`.
- Qualquer texto vira a legenda mostrada ao lado do spinner enquanto `workflowState === "waiting"`.
- `status: "finalizado"` (case-insensitive) é uma **palavra reservada**: fecha o chat permanentemente (mesmo efeito do `/api/callback` com `status:"finalizado"`), **mesmo se o chat estiver `idle`** no momento (por isso o front precisa checar isso continuamente, não só durante `waiting`).
- **`progress`** (opcional, número 0-100): renderiza uma barra animada abaixo do texto, com o `X%` ao lado. Sem esse campo, só o texto aparece (comportamento de sempre). Guardado junto do texto em `activeStatuses[chat_id] = { text, progress }`.
- **Atenção ao seu workflow:** não use os textos `"ok"`, `"processing"` ou `"finalizado"` como legenda de progresso "normal" — são palavras-chave reservadas em ambos os endpoints.

### 4.3 `GET /api/status?chat_id=` — leitura da legenda/sinal atual
Retorna `{ chat_id, status, progress }` (os valores mais recentes setados via 4.2, ou `null`/`null`). Hoje só usado pra leitura pontual — o front recebe as atualizações via polling (`GET /api/poll?chat_id=`, ver [POLLING.md](POLLING.md)).

### 4.4 `POST /api/cost` — custo acumulado em tempo real (só o valor final, sem categorias)
```json
{ "chat_id": "...", "total": 0.0133, "currency"?: "BRL" }
```
- **Obrigatório:** `chat_id`. `total` é opcional — se não vier (ou não for numérico), o servidor responde `200 { success:true, skipped:true, ... }` sem erro (é só um ping de contabilização, nunca deve derrubar o workflow do n8n por validação).
- `total` é o valor **já acumulado e pronto para exibir** — cada chamada **substitui** o total anterior (não soma/incrementa). Some as categorias que quiser (Gemini, Clay, Apollo, ...) do seu lado antes de mandar; o sandbox só exibe o número final.
- `currency`, se enviada, atualiza a moeda do chat. **Padrão de todo chat novo: BRL** (não precisa mandar se for BRL).

### 4.5 `GET /api/cost?chat_id=` — leitura do custo acumulado
Retorna `{ chat_id, total, currency }`. Badge 💰 é atualizado em tempo real via SSE, não por polling nesse endpoint.

### 4.6 `GET /api/pending-responses?chat_id=` — fila de respostas assíncronas
Retorna `{ messages: [...] }` e **limpa a fila daquele chat_id** no mesmo request (consume-on-read). Mantido pra compatibilidade/depuração; o front consome as respostas via SSE (seção 4.12).

### 4.12 `GET /api/poll?chat_id=` — leitura combinada de mensagens/status/custo
Numa única chamada, devolve `{ messages, status, cost }`: mensagens novas (consume-on-read, como `GET /api/pending-responses`), a legenda de status atual e o custo acumulado atual. O front chama isso a cada ~2s enquanto um chat está aberto. Detalhes completos (motivação, por que não é mais SSE, trade-offs) em [POLLING.md](POLLING.md).

### 4.7 `POST /api/proxy-webhook` — bypass de CORS pro webhook real
```json
{ "target_url": "https://...", "payload": {...} }
```
Repassa a chamada e devolve a resposta crua do n8n pro front (assim o browser não precisa chamar o n8n direto e esbarrar em CORS).

### 4.8 `POST /api/mock-workflow` — simulador de workflow no modo "Servidor Local"
Gera uma resposta contextual (baseada em palavras-chave da mensagem) sem depender de n8n de verdade.

### 4.9 `POST /api/simulate-async-status` — demo do fluxo de status progressivo
Dispara uma sequência de `activeStatuses` (1500ms → 7500ms) e no final empurra uma resposta final pra fila, só pra demonstrar o indicador de status em ação (botão "Demo Status" na UI).

### 4.10 Erros de workflow — `/api/error` (POST), `/error` (GET), `/api/last-error` (GET)
Recebe erro (JSON estruturado do n8n ou HTML cru), guarda em memória, e serve uma página de erro formatada (`error.html` com placeholders `{{WORKFLOW_NAME}}` etc.).

### 4.11 Servidor de arquivos estáticos
Serve `index.html`/`app.js`/`style.css`/etc. da própria pasta do projeto, com proteção básica contra directory traversal.

**Decisão confirmada:** rodando localmente (`node server.js`), todo estado do servidor (`pendingResponses`, `activeStatuses`, `chatCosts`, `lastJsonError`) continua **só em memória** — reiniciar o processo Node zera tudo. Mantido assim de propósito (é só um sandbox de teste). **No deploy do Vercel** esse mesmo estado é persistido no Supabase em vez de memória (funções serverless não compartilham memória entre invocações) — ver [DEPLOY_VERCEL.md](DEPLOY_VERCEL.md) e `sandboxStore.js`.

---

## 5. Contratos de Cards (dentro do `reply` do `/api/callback`)

Sem mudanças de comportamento — só consolidando o que já está documentado no README:

- **`.quick-reply-option`** (single-select, envia ao clicar): `data-label` (obrigatório, texto mostrado + enviado), `data-id` (opcional, vira `"<id> (<label>)"` no campo `message`), `data-extra` (JSON opcional, mesclado em `meta.extra`).
- **`.quick-reply-multi-select`** (marca vários + botão confirmar): itens `.quick-reply-multi-option` com `data-label`/`data-id` opcional; botão `.quick-reply-confirm-btn` começa `disabled`; classe `unavailable` marca item não clicável.
- **`.quick-reply-new-chat-btn`**: cria um chat novo, não envia nada ao webhook — saída pra quando não há opção selecionável.

**Card HTML totalmente customizado (não usando essas classes):** funciona (o script dentro do `reply` é executado via `setHtmlWithScripts`), mas fica por sua conta garantir que o JS do card chama `window.sendMessageText(text, extra)` corretamente — não há proteção do sandbox contra erros de JS dentro de HTML customizado. **Recomendação:** preferir os contratos acima sempre que possível; eles já lidam com o estado do chat (`workflowState`) automaticamente.

---

## 6. Regras de Renderização (bugs a corrigir na reescrita)

1. **Preview da sidebar deve ser texto puro e truncado.** Hoje (`renderSidebar`, `app.js:452-459`) o preview injeta `lastMsg.text` cru como `innerHTML` — se a última mensagem for um card HTML/JS (como os que testamos nesta conversa), o card inteiro (radios, botão, script) renderiza *dentro do item da sidebar*, quebrando o layout (foi o que apareceu no seu primeiro screenshot). **Fix:** stripar tags HTML e truncar (~60 chars) antes de exibir no preview.
2. **Auto-rename do chat não deve depender da resposta chegar.** Hoje o rename de "Novo chat" só acontece dentro do `try` de `sendMessageText`, após a resposta síncrona. **Fix:** renomear assim que a primeira mensagem do usuário é enviada, independente de quando/como a resposta chega — evita chats presos com título "Novo chat" para sempre em fluxos assíncronos.
3. **Mensagens de erro de workflow** (`❌ *Erro no Workflow*`) continuam recebendo o card vermelho formatado — sem mudança de regra, só preservar esse comportamento na reescrita.
4. **HTML/script customizado em `reply`** continua sendo executado via replace-and-reinsert de `<script>` (necessário pro navegador rodar o script injetado via `innerHTML`) — preservar.

---

## 7. O que NÃO muda (mantido por design)

- 3 modos de API: `mock-browser` (tudo client-side), `mock-server` (usa `/api/mock-workflow` local), `custom-webhook` (assíncrono, webhook real via proxy).
- Persistência do estado do app inteiro em `localStorage` (`lara_leads_sandbox_state`) — servidor continua só em memória (decisão confirmada, seção 4.11).
- `iniciar.bat` com auto-detecção Node → fallback `file://` (Python removido — ver seção 8).
- Envelope do payload de saída (array com `tenant_id`, `chat_id`, `message_id`, `channel`, `timestamp`, `message`, `meta`) — inalterado.
- Funcionalidades do painel de Parâmetros, painel JSON (Request/Response), tema claro/escuro, botão de copiar — todas continuam existindo, só com uma cara nova (seção 9).

---

## 8. Decisões já confirmadas

1. **Persistência do servidor:** fica como está, só em memória.
2. **`server.py`:** descontinuado nesta reescrita — `iniciar.bat` passa a depender só do Node (com fallback `file://` se Node não estiver instalado). Vou remover `server.py` do projeto.
3. **Escopo visual:** ao contrário do que eu tinha assumido, o visual **muda** — ver seção 9.

---

## 9. Redesign Visual

Pedido: uma plataforma "bem mais completa e bonita", mais moderna, **mesmas funcionalidades** (tudo das seções 1–6 continua existindo e funcionando igual — isso é só a camada visual por cima).

**Decisões confirmadas:**
- **Estética:** estilo Linear/Notion — mais "produto SaaS": bordas finas, cantos levemente arredondados, boa densidade de informação, badges/labels bem definidos, acentos de cor vibrantes sobre uma base neutra.
- **Layout:** sidebar de chats continua fixa à esquerda + conversa ocupando o centro (quase a tela inteira). O painel JSON de Request/Response **deixa de ser uma coluna fixa** e passa a ser um **drawer/painel deslizante** que abre por cima (acionado por um botão, ex. "Ver JSON"), fechado por padrão.
- **Tema:** **claro por padrão**, com toggle pra escuro continuando disponível (mesma tecla/botão de hoje).

Tudo o mais (painel de Parâmetros, badge de custo, indicador de status da API, cards de seleção, etc.) recebe a mesma cara nova, mantendo a funcionalidade das seções 1–6.

---

Spec fechado — partindo pra implementação.
