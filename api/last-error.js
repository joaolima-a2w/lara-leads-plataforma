// GET /api/last-error
const sandboxStore = require('../sandboxStore');
const { handleCors } = require('../apiUtils');

module.exports = async (req, res) => {
    if (handleCors(req, res)) return;
    if (req.method !== 'GET') return res.status(405).json({ error: true, message: 'Método não suportado.' });

    try {
        const last = await sandboxStore.getLastError();
        if (last && last.kind === 'json') return res.status(200).json(last.payload);
        return res.status(200).json({ status: 'idle', message: 'Nenhum erro registrado' });
    } catch (err) {
        console.error('[api/last-error] Erro inesperado:', err);
        return res.status(500).json({ error: true, message: err.message });
    }
};
