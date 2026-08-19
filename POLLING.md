# Comunicação em Tempo Real via Polling (substitui o SSE)

Este documento descreve a migração da atualização do chat de **SSE** (o servidor empurrava a atualização assim que ela acontecia) de volta pra **polling** (o front pergunta de novo a cada ~2s) — desta vez em definitivo, por causa do deploy no Vercel. É um registro da mudança feita em [server.js](server.js), [app.js](app.js) e nas funções em [api/](api/) — não substitui o [README.md](README.md) (contrato de payloads), o [PLATFORM_SPEC.md](PLATFORM_SPEC.md) (spec geral) nem o [DEPLOY_VERCEL.md](DEPLOY_VERCEL.md) (como publicar), que devem ser lidos junto.

---

## 1. Motivação

O projeto já tinha passado de polling pra SSE uma vez (o histórico dessa primeira migração, hoje revertida, descrevia os mesmos três endpoints `/api/pending-responses`, `/api/status`, `/api/cost` sendo substituídos por uma conexão `EventSource` aberta em `GET /api/stream?chat_id=`). SSE funcionava bem rodando localmente com `node server.js` — um processo Node de vida longa, com uma conexão HTTP mantida aberta pro browser e um objeto `sseClients` em memória ligando a conexão ao `chat_id`.

Esse desenho **não sobrevive a funções serverless do Vercel**: cada invocação de uma função é isolada, sem memória compartilhada com a próxima, e não existe "conexão mantida aberta entre o n8n chamando `/api/callback` numa invocação e o browser esperando em `/api/stream` noutra". Como o objetivo de subir pro Vercel é justamente trocar o túnel do ngrok por uma URL pública estável pro n8n chamar de volta, o SSE tinha que sair.

A escolha foi voltar pro polling — mas **combinando os três endpoints antigos numa única chamada** (`GET /api/poll?chat_id=`), em vez dos três separados de antes, pra manter o número de requisições por tick baixo tanto localmente quanto no Vercel (onde cada requisição é uma invocação de função cobrada/contabilizada).

**Importante:** o n8n **não muda em nada** — ver seção 5.

---

## 2. Arquitetura: antes x depois

**Antes (SSE, só funcionava local):**
```
n8n --POST--> /api/callback|/api/status|/api/cost --> guarda em memória
                                                              │
                                                        sendSSE(chat_id, evento, dado)
                                                              │
                                                              ▼
browser <====== conexão aberta ====== GET /api/stream?chat_id=xxxx
```

**Depois (polling, funciona local E no Vercel):**
```
n8n --POST--> /api/callback|/api/status|/api/cost --> guarda o estado
                                                        (memória local, ou Supabase no Vercel)
                                                              ▲
browser <--GET (a cada 2s)-- /api/poll?chat_id=xxxx (mensagens + status + custo, tudo junto)
```

---

## 3. O que mudou em cada arquivo

### [server.js](server.js) (local)
- `sseClients`, `addSseClient`, `removeSseClient`, `sendSSE(...)` e o endpoint `GET /api/stream` foram **removidos**.
- Novo endpoint `GET /api/poll?chat_id=xxxx`: lê `pendingResponses[chat_id]` (consumindo a fila, como o antigo `/api/pending-responses`), `activeStatuses[chat_id]` e `chatCosts[chat_id]`, e devolve os três juntos: `{ messages, status, cost }`.
- `POST /api/callback`, `POST /api/status`, `POST /api/cost` continuam gravando exatamente no mesmo lugar de sempre (`pendingResponses`/`activeStatuses`/`chatCosts` em memória) — só pararam de chamar `sendSSE(...)` depois.
- O estado continua **só em memória** localmente (decisão de sempre, ver [PLATFORM_SPEC.md](PLATFORM_SPEC.md) seção 4.11).

### [api/\[...path\].js](api/%5B...path%5D.js) e [api/error.js](api/error.js) (Vercel)
- Implementam o mesmo contrato HTTP que o `server.js` local, mas lendo/escrevendo em [sandboxStore.js](sandboxStore.js) (tabelas no Supabase) em vez de objetos em memória — necessário porque uma função serverless não tem memória compartilhada entre invocações. Ver [DEPLOY_VERCEL.md](DEPLOY_VERCEL.md).

### [app.js](app.js)
- `startStream()`/`stopStream()` (que abriam/fechavam um `EventSource`) viraram `startPolling()`/`stopPolling()`, que abrem/fecham um `setInterval` de 2s chamando `pollOnce(chatId)`.
- `pollOnce()` contém a mesma lógica que antes ficava espalhada nos três listeners do SSE (`message`/`status`/`cost`) — atualizar `chatObj.messages`, `workflowState`, `costTotal`, `currentStatusText`/`currentStatusProgress` — só que lendo os três campos de uma resposta só (`data.messages`/`data.status`/`data.cost`) em vez de três eventos separados.
- Uma vez que o chat chega em `workflowState === 'closed'`, o polling pára sozinho (nada mais pode mudar depois disso).
- `selectChat()`/`renderChatScreen()` chamam `startPolling()`; `renderWelcomeScreen()` chama `stopPolling()`.

---

## 4. Contrato do novo endpoint

### `GET /api/poll?chat_id=xxxx`
```json
{
  "messages": [
    { "message_id": "...", "reply": "...", "status": "ok", "timestamp": "...", "next_action": null, "raw_payload": {} }
  ],
  "status": { "status": "Consultando CRM...", "progress": 62 },
  "cost": { "total": 0.0133, "currency": "BRL" }
}
```
- **`messages`** → só as respostas ainda não lidas (consume-on-read, como o antigo `GET /api/pending-responses` — que continua existindo, sem mudança, pra compatibilidade/depuração manual).
- **`status`** → o que `POST /api/status` gravou por último pra esse chat (`{status:null, progress:null}` se nunca foi chamado).
- **`cost`** → o que `POST /api/cost` gravou por último (`{total:0, currency:"BRL"}` por padrão).

---

## 5. Impacto no n8n: nenhum

O n8n continua chamando exatamente os mesmos três endpoints, com o mesmo payload, do mesmo jeito de sempre — só a **URL base** muda quando o workflow aponta pro deploy do Vercel em vez do túnel do ngrok:

- `POST /api/callback` — resposta final/intermediária (seção 4.1 do [PLATFORM_SPEC.md](PLATFORM_SPEC.md))
- `POST /api/status` — legenda de progresso (seção 4.2)
- `POST /api/cost` — custo acumulado (seção 4.4)

---

## 6. Como testar

1. Local: suba o servidor (`node server.js`) e abra o chat em modo `custom-webhook`. Envie uma mensagem — o painel de rede do navegador deve mostrar `GET /api/poll?chat_id=...` repetindo a cada 2s enquanto o chat não estiver `closed`.
2. Quando o n8n (ou o botão "Demo Status") chamar `/api/callback`, `/api/status` ou `/api/cost`, a UI deve refletir a mudança no próximo tick (até ~2s de atraso — esperado, é a troca deliberada de "push instantâneo" por "compatível com serverless").
3. No Vercel: mesmo teste, apontando o workflow do n8n pra URL pública do deploy em vez do ngrok.

---

## 7. Limitações conhecidas

- **Até ~2s de atraso** pra UI refletir uma atualização — aceitável pra uma ferramenta de teste, mas é uma troca deliberada em relação ao SSE (zero atraso, mas incompatível com serverless).
- **Uma requisição a cada 2s por chat aberto**, mesmo sem nada de novo — no Vercel, cada uma é uma invocação de função (fica dentro dos limites generosos do plano gratuito pra uso de teste, mas é bom ter em mente se o uso crescer).
- **Estado local ainda é só em memória** (`server.js`) — reiniciar o processo Node zera tudo, como sempre. No Vercel o estado persiste no Supabase (ver [DEPLOY_VERCEL.md](DEPLOY_VERCEL.md)).
