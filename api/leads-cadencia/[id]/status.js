// POST /api/leads-cadencia/<id>/status — parar / concluir cadência, ou resolver uma
// tarefa manual pendente. Body: { "action": "parar" | "concluir" | "manual_concluida" }
const leadDetailApi = require('../../../leadDetailApi');
const { handleCors, getJsonBody, getPathname } = require('../../../apiUtils');

module.exports = async (req, res) => {
    if (handleCors(req, res)) return;
    if (req.method !== 'POST') return res.status(405).json({ error: true, message: 'Método não suportado.' });

    const match = getPathname(req).match(/^\/api\/leads-cadencia\/([^/]+)\/status$/);
    if (!match) return res.status(400).json({ error: true, message: 'URL inválida.' });

    try {
        const payload = getJsonBody(req);
        const result = await leadDetailApi.updateLeadCadenciaStatus(decodeURIComponent(match[1]), payload.action);
        return res.status(200).json({ success: true, ...result });
    } catch (err) {
        console.error('[api/leads-cadencia/[id]/status] Erro inesperado:', err);
        const status = err.message.includes('desconhecida') || err.message.includes('não encontrado') ? 400 : 500;
        return res.status(status).json({ error: true, message: err.message });
    }
};
