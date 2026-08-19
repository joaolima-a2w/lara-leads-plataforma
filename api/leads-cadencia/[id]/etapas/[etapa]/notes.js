// POST /api/leads-cadencia/<id>/etapas/<etapa>/notes — anotação (ação/feedback) de uma etapa.
const leadDetailApi = require('../../../../../leadDetailApi');
const { handleCors, getJsonBody, getPathname } = require('../../../../../apiUtils');

module.exports = async (req, res) => {
    if (handleCors(req, res)) return;
    if (req.method !== 'POST') return res.status(405).json({ error: true, message: 'Método não suportado.' });

    const match = getPathname(req).match(/^\/api\/leads-cadencia\/([^/]+)\/etapas\/(\d+)\/notes$/);
    if (!match) return res.status(400).json({ error: true, message: 'URL inválida.' });

    try {
        const payload = getJsonBody(req);
        const saved = await leadDetailApi.saveStageNote(decodeURIComponent(match[1]), parseInt(match[2], 10), payload);
        return res.status(200).json({ success: true, note: saved });
    } catch (err) {
        console.error('[api/leads-cadencia/[id]/etapas/[etapa]/notes] Erro inesperado:', err);
        return res.status(500).json({ error: true, message: err.message });
    }
};
