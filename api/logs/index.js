// GET /api/logs?chat_id=&limit= — log de requisições in/out (tela /logs).
const sandboxStore = require('../../sandboxStore');
const { handleCors, getSearchParams } = require('../../apiUtils');

module.exports = async (req, res) => {
    if (handleCors(req, res)) return;
    if (req.method !== 'GET') return res.status(405).json({ error: true, message: 'Método não suportado.' });

    try {
        const params = getSearchParams(req);
        const limitParam = parseInt(params.get('limit'), 10);
        const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 300) : 300;
        const logs = await sandboxStore.getLogs({ chatIdFilter: params.get('chat_id'), limit });
        return res.status(200).json({ logs, total: logs.length });
    } catch (err) {
        console.error('[api/logs] Erro inesperado:', err);
        return res.status(500).json({ error: true, message: err.message });
    }
};
