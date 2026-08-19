// GET /api/leads-cadencia/<id>/detail — linha do tempo + outros contatos do lead.
const leadDetailApi = require('../../../leadDetailApi');
const { handleCors, getPathname } = require('../../../apiUtils');

module.exports = async (req, res) => {
    if (handleCors(req, res)) return;
    if (req.method !== 'GET') return res.status(405).json({ error: true, message: 'Método não suportado.' });

    // Extrai o :id manualmente da URL em vez de confiar em req.query.id — o parâmetro
    // de nome de arquivo [id] não veio populado de forma confiável neste projeto.
    const match = getPathname(req).match(/^\/api\/leads-cadencia\/([^/]+)\/detail$/);
    if (!match) return res.status(400).json({ error: true, message: 'URL inválida.' });

    try {
        const detail = await leadDetailApi.getLeadDetail(decodeURIComponent(match[1]));
        if (!detail) return res.status(404).json({ error: true, message: 'Lead não encontrado.' });
        return res.status(200).json(detail);
    } catch (err) {
        console.error('[api/leads-cadencia/[id]/detail] Erro inesperado:', err);
        return res.status(500).json({ error: true, message: err.message });
    }
};
