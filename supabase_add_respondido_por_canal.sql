-- Rode uma vez no SQL Editor do Supabase. "Respondido" deixa de ser um valor da coluna
-- status (que fica só pra fase da cadência: ativo/pending/pausado/manual/cancelado/
-- finalizado) e vira 3 colunas próprias, uma por canal — assim dá pra saber em que
-- etapa o lead está E se ele respondeu (em qualquer canal, mesmo com a cadência
-- pausada), sem uma informação apagar a outra, e sem perder o registro de ter
-- respondido em mais de um canal ao mesmo tempo (uma coluna única sobrescreveria a
-- resposta anterior se o lead respondesse por um segundo canal depois).
alter table lead_cadencias
    add column if not exists respondido_wpp timestamptz,      -- null = não respondeu por ali; preenchida = quando respondeu
    add column if not exists respondido_email timestamptz,
    add column if not exists respondido_linkedin timestamptz;
