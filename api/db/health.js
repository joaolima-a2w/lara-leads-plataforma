// GET /api/db/health — checagem de conectividade Postgres direto (opcional).
const db = require('../../db');
const { handleCors } = require('../../apiUtils');

module.exports = async (req, res) => {
    if (handleCors(req, res)) return;
    if (req.method !== 'GET') return res.status(405).json({ error: true, message: 'Método não suportado.' });

    try {
        const row = await db.checkConnection();
        return res.status(200).json({ ok: true, database: row.database, server_time: row.now });
    } catch (err) {
        return res.status(500).json({ ok: false, error: err.message });
    }
};
