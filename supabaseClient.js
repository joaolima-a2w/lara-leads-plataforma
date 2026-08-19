// Cliente Supabase do lado do servidor (chave secreta — nunca expor no navegador).
// Usa @supabase/supabase-js, que fala com o projeto Supabase via HTTPS (porta 443),
// evitando os problemas de conectividade da porta direta do Postgres (5432/6543).
//
// Antes usava @supabase/server, mas esse pacote puxa "jose" (verificação de JWT de
// sessão — funcionalidade que a gente nem usa, já que só faz .from().select() com a
// chave admin) numa versão só-ESM, que quebra com ERR_REQUIRE_ESM dentro do bundle
// CommonJS de uma função serverless do Vercel. @supabase/supabase-js é o cliente
// clássico da Supabase, sem essa dependência, e testado à exaustão em serverless.
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

let supabaseAdmin = null;
if (SUPABASE_URL && SUPABASE_SECRET_KEY) {
    supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
        auth: { autoRefreshToken: false, persistSession: false }
    });
} else {
    console.warn('[supabase] Cliente admin não configurado: defina SUPABASE_URL e SUPABASE_SECRET_KEY no .env (veja .env.example).');
}

// Checagem de conectividade que não depende de nenhuma tabela existir ainda —
// bate no endpoint de admin de usuários (Auth), só para provar que a URL e a
// chave secreta são válidas e o projeto está alcançável.
async function checkConnection() {
    if (!supabaseAdmin) {
        throw new Error('Supabase não configurado: defina SUPABASE_URL e SUPABASE_SECRET_KEY no .env (veja .env.example).');
    }
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1 });
    if (error) throw new Error(error.message);
    return { reachable: true, users_sample_count: data.users.length };
}

module.exports = { supabaseAdmin, checkConnection };
