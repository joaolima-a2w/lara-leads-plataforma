# Lara Leads - Chat Sandbox

Interface de chat Single-Page Application (SPA) responsiva no estilo ChatGPT para testar e validar o envio de webhooks e payloads estruturados do Lara Leads para os seus workflows (ex.: n8n ou endpoints customizados).

---

## 🚀 Como Rodar Localmente (Facilitado)

Criamos um executor automático para facilitar a inicialização.

1. Navegue até a pasta do projeto.
2. Dê um clique duplo no arquivo **`iniciar.bat`**.
3. O executor fará a detecção automática do runtime no seu Windows:
   - Se encontrar **Node.js**, iniciará o servidor Node (`server.js`, zero dependências) e abrirá o browser.
   - Se **não** estiver instalado, abrirá o arquivo `index.html` diretamente no navegador em modo **Simulador Local** (onde tudo é simulado client-side, sem necessidade de servidor).

---

## ☁️ Publicando no Vercel (URL pública em vez de ngrok)

Pra deixar o webhook de callback (`/api/callback`, `/api/status`, `/api/cost`, `/api/error`)
numa URL pública estável — sem precisar de túnel do ngrok — veja o passo a passo em
[DEPLOY_VERCEL.md](DEPLOY_VERCEL.md).

---

## ⚙️ Conectando com seus Workflows Reais (ex.: n8n)

Por padrão, a aplicação já vem configurada para enviar requisições reais para o seu webhook do n8n:
`https://a2w.app.n8n.cloud/webhook-test/dd8d25e1-3382-49b6-8d22-6621d57633b8`

### 1. Envio de Mensagens (Chat -> n8n)
Toda vez que você digitar uma mensagem no chat, o SPA disparará um `POST` com um **JSON envelopado em Array** contendo a estrutura de dados e os metadados solicitados:

```json
[
  {
    "tenant_id": "A2W",
    "tenant_name": "A2W Tecnologia",
    "user_id": "USR-0001-Q7XK",
    "chat_id": "b52028c091f142f48964022c32438444",
    "message_id": "MSG-0001",
    "channel": "web_chat",
    "timestamp": "2026-06-09T11:53:30.280-03:00",
    "message": "Quero as empresas que tenham até 10 funcionários",
    "meta": {
      "ip": "200.100.50.1",
      "user_agent": "Mozilla/5.0",
      "page": "/app/minerador",
      "session_id": "SESS-123"
    }
  }
]
```

#### Parâmetros de Entrada:
- **`user_id`**: Identificador sequencial de teste (`USR-0001-Q7XK`).
- **`chat_id`**: Um UUID de 32 caracteres gerado sem traços, único para cada chat.
- **`message_id`**: ID sequencial por conversa (`MSG-0001`, `MSG-0002` etc.).
- **`timestamp`**: Data e hora local no fuso horário do usuário com offset de fuso (ex.: `-03:00`).

Você pode customizar todos esses campos abrindo a aba **Parâmetros** no topo da interface.

---

### 2. Retorno de Respostas (n8n -> Chat)
Você possui duas formas de retornar as respostas do n8n para a tela do chat:

#### Método A: Retorno Síncrono (Resposta da Requisição HTTP)
Seu workflow do n8n recebe o payload e responde imediatamente na resposta da requisição POST do Webhook com o seguinte JSON:
```json
{
  "reply": "Sua resposta de texto aqui...",
  "status": "ok",
  "next_action": null
}
```
O chat capturará essa resposta e a exibirá instantaneamente na bolha e na aba de logs de resposta.

#### Método B: Retorno Assíncrono (Callback URL - Recomendado para fluxos demorados)
Se o seu workflow faz processamentos assíncronos e responde mais tarde, você pode fazer uma chamada HTTP `POST` para o servidor do Chat Sandbox contendo a resposta. O chat recebe essas atualizações via polling (`GET /api/poll`) — ver [POLLING.md](POLLING.md).

- **URL de Callback:** `POST http://localhost:3000/api/callback` (ou através da URL pública do seu túnel ngrok)
- **Payload do Callback (a ser enviado pelo n8n):**
```json
{
  "chat_id": "b52028c091f142f48964022c32438444",
  "reply": "Entendi! Encontrei 5 empresas com o perfil desejado no Agronegócio.",
  "status": "ok"
}
```

#### ⏳ Mantendo o Indicador de Carregamento Ativo (Typing / Loading)
Para manter o símbolo animado de "digitando..." (typing indicator) ativo na tela enquanto os sub-workflows são executados em segundo plano, você pode enviar mensagens de status intermediárias definindo o campo `"status"` como `"processing"`:
```json
{
  "chat_id": "b52028c091f142f48964022c32438444",
  "reply": "🔍 Pesquisando empresas com até 10 funcionários...",
  "status": "processing"
}
```
O chat exibirá a mensagem na tela e manterá os três pontinhos piscando logo abaixo. Para sumir com a animação de carregamento e dar o fluxo como encerrado, basta enviar a última resposta com `"status": "ok"`.

Ao fazer essa chamada, o servidor Sandbox colocará a mensagem na fila do `chat_id` correspondente, e a tela do chat exibirá a resposta automaticamente sem que a página precise ser recarregada.

#### 🔒 Encerrando a Conversa Definitivamente
Se o seu workflow chegou ao fim de vez (o chat não deve mais aceitar nem receber nenhuma mensagem), envie `"status": "finalizado"` — seja no `/api/callback` (junto de um `reply` final) ou no `/api/status` (seção 2C). O chat trava o campo de digitação e os cards permanentemente; só um chat novo destrava.

### 2C. Status de Progresso "leve" (sem virar mensagem no chat)
Além do `status` dentro do `/api/callback` (que sempre vem acompanhado de um `reply` visível), você pode enviar só uma legenda de progresso — sem criar uma bolha de mensagem — via:

- **URL:** `POST http://localhost:3000/api/status`
- **Payload:**
```json
{ "chat_id": "b52028c091f142f48964022c32438444", "status": "Consultando CRM..." }
```
O texto aparece ao lado do spinner enquanto o chat está aguardando resposta. Enviar `"status": "finalizado"` aqui também encerra a conversa permanentemente (mesmo efeito descrito acima), mesmo que o chat já esteja ocioso no momento.

**Barra de progresso (opcional):** inclua também `"progress"` (número de 0 a 100) pra mostrar uma barrinha animada embaixo do texto, além do `X%`:
```json
{ "chat_id": "b52028c091f142f48964022c32438444", "status": "Enriquecendo leads com Clay...", "progress": 62 }
```
Sem `progress`, o status aparece só como texto (comportamento de sempre). Cada chamada substitui o valor anterior — a barra anima suavemente até o novo número.

**Atenção:** `"ok"`, `"processing"` e `"finalizado"` são palavras-chave reservadas nesses dois endpoints — não as use como texto de status "normal".

---

### 2D. Custo em Tempo Real (n8n -> Chat)
Se o seu workflow quer mostrar quanto já foi gasto durante o processamento (some as categorias que quiser do seu lado — IA, enriquecimento de dados, etc.), envie o **valor total já acumulado** para o servidor local do Chat Sandbox. Cada chamada **substitui** o total anterior — envie sempre a soma completa até aquele momento, não um incremento.

- **URL:** `POST http://localhost:3000/api/cost`
- **Payload:**
```json
{
  "chat_id": "b52028c091f142f48964022c32438444",
  "total": 0.0133,
  "currency": "BRL"
}
```
- **`total`** é o único valor exibido — o sandbox não soma nem quebra em categorias, só mostra o número que você mandou.
- **`currency`** é opcional. Todo chat novo já começa com **BRL** como padrão; só envie se quiser usar outra moeda.

O chat exibe o valor em um badge de carteira 💰 ao lado do `chat_id` no cabeçalho, atualizado em tempo real pelo mesmo canal SSE que já entrega respostas e status.

### 3. Cards de Seleção (Quick Reply Options)
Seu workflow pode retornar, dentro do `reply`, HTML com cards clicáveis para o usuário escolher uma opção (ex.: "escolha uma destas empresas"). Basta usar a classe `quick-reply-option` em cada card:

```html
<div class="quick-reply-list">
  <button class="quick-reply-option" data-label="Empresa Acme" data-id="lead_42">
    <span class="quick-reply-icon">🏢</span>
    <span>
      <span class="quick-reply-title">Empresa Acme</span>
      <span class="quick-reply-subtitle">São Paulo, SP</span>
    </span>
  </button>
</div>
```

- **`data-label`** (obrigatório): o nome exibido na bolha do chat quando o card é clicado — é só o nome, nunca o id.
- **`data-id`** (opcional): o id do registro (lead/empresa/etc.). Quando presente, o campo `message` enviado ao n8n **não** é mais apenas o nome — vira `"<id> (<nome>)"`, ex.: `"lead_42 (Empresa Acme)"`. Sem `data-id`, o comportamento é o de sempre: `message` = nome.
- **`data-extra`** (opcional, JSON): dados estruturados adicionais mesclados em `meta.extra` do payload (não aparecem no `message`).

Ou seja: a bolha do chat sempre mostra só o nome — quem vê o id "de verdade" é o n8n, através do campo `message` do payload.

### 4. Cards de Seleção Múltipla (marcar vários e confirmar)
Quando o usuário precisa escolher **um ou mais** itens de uma lista (em vez de um único clique que já envia), use o padrão `quick-reply-multi-select`: cada linha só marca/desmarca, e um botão no rodapé envia uma única mensagem com todos os nomes marcados, separados por vírgula.

```html
<div class="quick-reply-multi-select">
  <div class="quick-reply-list">
    <div class="quick-reply-multi-option" data-label="Empresa Acme" data-id="lead_42">
      <span class="quick-reply-checkbox"></span>
      <span class="quick-reply-title">Empresa Acme</span>
    </div>
    <div class="quick-reply-multi-option" data-label="Empresa Beta" data-id="lead_57">
      <span class="quick-reply-checkbox"></span>
      <span class="quick-reply-title">Empresa Beta</span>
    </div>
  </div>
  <button type="button" class="quick-reply-confirm-btn" disabled>Selecione ao menos uma empresa</button>
</div>
```

- **`data-label`** (obrigatório em cada `.quick-reply-multi-option`): nome exibido e usado na mensagem final.
- O botão `.quick-reply-confirm-btn` deve começar com o atributo `disabled` — o JS do sandbox habilita/atualiza o texto dele automaticamente (`"Confirmar seleção (N)"`) conforme o usuário marca/desmarca linhas.
- Ao confirmar, é enviada **uma única mensagem**. A bolha do chat sempre mostra só os nomes selecionados juntados por `", "` (ex.: `"Empresa Acme, Empresa Beta"`), e a lista inteira fica desabilitada pra evitar reenvio.
- **`data-id`** (opcional, por item): se **todos** os itens selecionados tiverem `data-id`, o campo `message` enviado ao n8n vira `"<id> (<nome>), <id> (<nome>)"` (ex.: `"lead_42 (Empresa Acme), lead_57 (Empresa Beta)"`) em vez dos nomes puros. Se **algum** item selecionado não tiver `data-id`, cai de volta para só os nomes — então inclua `data-id` em todos os itens marcáveis se quiser IDs garantidos no payload.
- Pra marcar um item como **não selecionável** (ex.: empresa ainda não enriquecida), adicione a classe `unavailable` ao `.quick-reply-multi-option` — a linha fica com opacidade reduzida, não responde a clique e nunca entra na seleção. Você pode incluir um `.quick-reply-subtitle` dentro do item explicando o motivo:
```html
<div class="quick-reply-multi-option unavailable">
  <span class="quick-reply-checkbox"></span>
  <span>
    <span class="quick-reply-title">Empresa Sem Dados</span>
    <span class="quick-reply-subtitle">Não enriquecida — faltam dados (LinkedIn ou e-mail) para prosseguir.</span>
  </span>
</div>
```

### 5. Botão "Nova Busca" (saída quando não há o que selecionar)
Quando não há nenhum item selecionável (zero resultados, ou todos `unavailable`), o botão de confirmar fica travado pra sempre — um beco sem saída pro usuário. Nesses casos, inclua um botão com a classe `quick-reply-new-chat-btn` em vez de (ou junto com) o `.quick-reply-multi-select`: ele **não envia nada pro webhook**, apenas cria um novo chat no sandbox (o mesmo que o botão "+ Novo chat" da sidebar faz), pra pessoa recomeçar com uma nova busca.

```html
<button type="button" class="quick-reply-new-chat-btn">Fazer nova busca</button>
```

---

## 🛠️ Onde está o Código do Payload?

O arquivo [app.js](app.js) realiza a montagem do JSON dentro da função `sendMessageText` (por volta da linha 741):
- A geração do UUID de 32 caracteres sem traços fica em `generateUUID()`.
- O cálculo do fuso horário local e formatação do timestamp offset fica em `getLocalISOTimestamp()`.
- A geração sequencial de IDs de mensagens fica em `messageId = "MSG-" + String(seq).padStart(4, "0")`.
