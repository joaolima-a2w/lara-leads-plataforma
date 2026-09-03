// GET  /api/leads-cadencia?page=&pageSize=&search=&status= — tela "Meus Leads em Cadência"
// GET  /api/leads-cadencia/stats
// GET  /api/leads-cadencia/<id>/detail
// POST /api/leads-cadencia/<id>/status               — parar/concluir/tarefa manual concluída
// POST /api/leads-cadencia/<id>/etapas/<etapa>/notes  — anotação de uma etapa
const leadsCadenciaApi = require('../leadsCadenciaApi');
const leadDetailApi = require('../leadDetailApi');
const { handleCors, getJsonBody, getSearchParams, getPathname } = require('../apiUtils');

module.exports = async (req, res) => {
    if (handleCors(req, res)) return;
    const routePath = getPathname(req).replace(/^\/api\/leads-cadencia/, '') || '/';

    try {
        if (routePath === '/stats' && req.method === 'GET') {
            const stats = await leadsCadenciaApi.getLeadsCadenciaStats();
            return res.status(200).json(stats);
        }

        const detailMatch = routePath.match(/^\/([^/]+)\/detail$/);
        if (detailMatch && req.method === 'GET') {
            const detail = await leadDetailApi.getLeadDetail(decodeURIComponent(detailMatch[1]));
            if (!detail) return res.status(404).json({ error: true, message: 'Lead não encontrado.' });
            return res.status(200).json(detail);
        }

        const statusMatch = routePath.match(/^\/([^/]+)\/status$/);
        if (statusMatch && req.method === 'POST') {
            const payload = getJsonBody(req);
            try {
                const result = await leadDetailApi.updateLeadCadenciaStatus(decodeURIComponent(statusMatch[1]), payload.action);
                return res.status(200).json({ success: true, ...result });
            } catch (err) {
                const status = err.message.includes('desconhecida') || err.message.includes('não encontrado') ? 400 : 500;
                return res.status(status).json({ error: true, message: err.message });
            }
        }

        const notesMatch = routePath.match(/^\/([^/]+)\/etapas\/(\d+)\/notes$/);
        if (notesMatch && req.method === 'POST') {
            const payload = getJsonBody(req);
            const saved = await leadDetailApi.saveStageNote(decodeURIComponent(notesMatch[1]), parseInt(notesMatch[2], 10), payload);
            return res.status(200).json({ success: true, note: saved });
        }

        if (routePath === '/' && req.method === 'GET') {
            const params = getSearchParams(req);
            const page = parseInt(params.get('page'), 10) || 1;
            const pageSize = parseInt(params.get('pageSize'), 10) || 20;
            const result = await leadsCadenciaApi.getLeadsCadencia({ page, pageSize, search: params.get('search') || '', status: params.get('status') || '', canalResposta: params.get('canalResposta') || '' });
            return res.status(200).json(result);
        }

        return res.status(404).json({ error: true, message: `Rota não encontrada: ${req.method} /api/leads-cadencia${routePath === '/' ? '' : routePath}` });
    } catch (err) {
        console.error('[api/leads-cadencia] Erro inesperado:', err);
        return res.status(500).json({ error: true, message: err.message });
    }
};
