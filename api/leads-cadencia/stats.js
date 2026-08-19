// GET /api/leads-cadencia/stats
const leadsCadenciaApi = require('../../leadsCadenciaApi');
const { handleCors } = require('../../apiUtils');

module.exports = async (req, res) => {
    if (handleCors(req, res)) return;
    if (req.method !== 'GET') return res.status(405).json({ error: true, message: 'Método não suportado.' });

    try {
        const stats = await leadsCadenciaApi.getLeadsCadenciaStats();
        return res.status(200).json(stats);
    } catch (err) {
        console.error('[api/leads-cadencia/stats] Erro inesperado:', err);
        return res.status(500).json({ error: true, message: err.message });
    }
};
