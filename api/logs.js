// GET  /api/logs?chat_id=&limit= — log de requisições in/out (tela /logs)
// POST /api/logs/clear
const sandboxStore = require('../sandboxStore');
const { handleCors, getSearchParams, getPathname } = require('../apiUtils');

module.exports = async (req, res) => {
    if (handleCors(req, res)) return;
    const routePath = getPathname(req).replace(/^\/api\/logs/, '') || '/';

    try {
        if (routePath === '/' && req.method === 'GET') {
            const params = getSearchParams(req);
            const limitParam = parseInt(params.get('limit'), 10);
            const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 300) : 300;
            const logs = await sandboxStore.getLogs({ chatIdFilter: params.get('chat_id'), limit });
            return res.status(200).json({ logs, total: logs.length });
        }

        if (routePath === '/clear' && req.method === 'POST') {
            await sandboxStore.clearLogs();
            return res.status(200).json({ success: true });
        }

        return res.status(404).json({ error: true, message: `Rota não encontrada: ${req.method} /api/logs${routePath === '/' ? '' : routePath}` });
    } catch (err) {
        console.error('[api/logs] Erro inesperado:', err);
        return res.status(500).json({ error: true, message: err.message });
    }
};
