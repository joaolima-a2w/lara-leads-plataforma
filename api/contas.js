// GET /api/contas?page=&pageSize=&search=&status= — tela "Contas" (empresas buscadas)
// GET /api/contas/stats
const contasApi = require('../contasApi');
const { handleCors, getSearchParams, getPathname } = require('../apiUtils');

module.exports = async (req, res) => {
    if (handleCors(req, res)) return;
    if (req.method !== 'GET') return res.status(405).json({ error: true, message: 'Método não suportado.' });
    const routePath = getPathname(req).replace(/^\/api\/contas/, '') || '/';

    try {
        if (routePath === '/stats') {
            const stats = await contasApi.getContasStats();
            return res.status(200).json(stats);
        }

        if (routePath === '/') {
            const params = getSearchParams(req);
            const page = parseInt(params.get('page'), 10) || 1;
            const pageSize = parseInt(params.get('pageSize'), 10) || 20;
            const result = await contasApi.getContas({ page, pageSize, search: params.get('search') || '', status: params.get('status') || '' });
            return res.status(200).json(result);
        }

        return res.status(404).json({ error: true, message: `Rota não encontrada: GET /api/contas${routePath}` });
    } catch (err) {
        console.error('[api/contas] Erro inesperado:', err);
        return res.status(500).json({ error: true, message: err.message });
    }
};
