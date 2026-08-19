// GET /api/supabase/health — checagem de conectividade (recomendado, via HTTPS)
// GET /api/db/health — checagem de conectividade Postgres direto (opcional)
const supabase = require('../supabaseClient');
const db = require('../db');
const { handleCors, getPathname } = require('../apiUtils');

module.exports = async (req, res) => {
    if (handleCors(req, res)) return;
    if (req.method !== 'GET') return res.status(405).json({ error: true, message: 'Método não suportado.' });
    const routePath = getPathname(req).replace(/^\/api/, '');

    if (routePath === '/supabase/health') {
        try {
            const result = await supabase.checkConnection();
            return res.status(200).json({ ok: true, ...result });
        } catch (err) {
            return res.status(500).json({ ok: false, error: err.message });
        }
    }

    if (routePath === '/db/health') {
        try {
            const row = await db.checkConnection();
            return res.status(200).json({ ok: true, database: row.database, server_time: row.now });
        } catch (err) {
            return res.status(500).json({ ok: false, error: err.message });
        }
    }

    return res.status(404).json({ error: true, message: `Rota não encontrada: GET /api${routePath}` });
};
