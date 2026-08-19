-- Rode este script uma vez no SQL Editor do Supabase (dashboard do projeto) antes do
-- primeiro deploy no Vercel. Ele cria as tabelas que substituem os armazenamentos em
-- memória do server.js (pendingResponses/activeStatuses/chatCosts/requestLogs/
-- lastJsonError/lastHtmlError) — necessário porque funções serverless do Vercel não
-- compartilham memória entre uma invocação e outra. Ver lib/sandboxStore.js.

-- Fila de respostas assíncronas do n8n por chat (equivalente ao antigo pendingResponses).
create table if not exists sandbox_messages (
    id uuid primary key default gen_random_uuid(),
    chat_id text not null,
    message_id text,
    reply text not null,
    status text,
    next_action text,
    raw_payload jsonb,
    consumed boolean not null default false,
    created_at timestamptz not null default now()
);
create index if not exists idx_sandbox_messages_chat_unconsumed
    on sandbox_messages (chat_id, consumed, created_at);

-- Estado "atual" de status/custo por chat — 1 linha por chat_id, sempre sobrescrita.
-- Equivalente ao antigo activeStatuses + chatCosts em memória.
create table if not exists sandbox_chat_state (
    chat_id text primary key,
    status_text text,
    status_progress integer,
    cost_total numeric not null default 0,
    cost_currency text not null default 'BRL',
    updated_at timestamptz not null default now()
);

-- Último erro de workflow recebido (JSON estruturado do n8n ou HTML cru).
-- Equivalente ao antigo lastJsonError/lastHtmlError em memória.
create table if not exists sandbox_errors (
    id uuid primary key default gen_random_uuid(),
    kind text not null check (kind in ('json', 'html')),
    payload jsonb,
    html text,
    created_at timestamptz not null default now()
);

-- Log de requisições recebidas de/enviadas pro n8n, pra tela /logs.
-- Equivalente ao antigo requestLogs em memória (capado em 300 lá; aqui sem cap
-- rígido — dá pra podar depois com um DELETE se crescer demais).
create table if not exists sandbox_logs (
    id uuid primary key default gen_random_uuid(),
    direction text not null check (direction in ('in', 'out')),
    endpoint text,
    chat_id text,
    status_code integer,
    request jsonb,
    response jsonb,
    created_at timestamptz not null default now()
);
create index if not exists idx_sandbox_logs_created_at on sandbox_logs (created_at desc);
