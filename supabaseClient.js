// Cliente Supabase do lado do servidor (chave secreta — nunca expor no navegador).
// Usa @supabase/server, que fala com o projeto Supabase via HTTPS (porta 443),
// evitando os problemas de conectividade da porta direta do Postgres (5432/6543).
require('dotenv').config();
const { createAdminClient } = require('@supabase/server/core');

let supabaseAdmin = null;
try {
    supabaseAdmin = createAdminClient();
} catch (err) {
    console.warn('[supabase] Cliente admin não configurado:', err.message);
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
