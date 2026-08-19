// Conexão com o banco Postgres da plataforma. Lê as credenciais do .env
// (nunca comitado — veja .env.example) e nunca deve logar a connection string
// crua (contém a senha).
require('dotenv').config();
const { Pool } = require('pg');

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
    console.warn('[db] DATABASE_URL não configurada no .env — endpoints que dependem do banco vão falhar até você configurar (veja .env.example).');
}

const pool = connectionString
    ? new Pool({
        connectionString,
        ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false }
    })
    : null;

if (pool) {
    pool.on('error', (err) => {
        console.error('[db] Erro inesperado numa conexão ociosa do pool:', err.message);
    });
}

// Helper padrão para queries parametrizadas ($1, $2, ...) — nunca faça interpolação de
// string em SQL, sempre passe os valores em `params` para evitar SQL injection.
async function query(text, params) {
    if (!pool) {
        throw new Error('Banco não configurado: defina DATABASE_URL no arquivo .env (veja .env.example).');
    }
    return pool.query(text, params);
}

async function checkConnection() {
    const result = await query('SELECT NOW() AS now, current_database() AS database');
    return result.rows[0];
}

module.exports = { pool, query, checkConnection };
