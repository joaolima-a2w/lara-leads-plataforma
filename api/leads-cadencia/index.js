// GET /api/leads-cadencia?page=&pageSize=&search=&status= — tela "Meus Leads em Cadência".
const leadsCadenciaApi = require('../../leadsCadenciaApi');
const { handleCors, getSearchParams } = require('../../apiUtils');

module.exports = async (req, res) => {
    if (handleCors(req, res)) return;
    if (req.method !== 'GET') return res.status(405).json({ error: true, message: 'Método não suportado.' });

    try {
        const params = getSearchParams(req);
        const page = parseInt(params.get('page'), 10) || 1;
        const pageSize = parseInt(params.get('pageSize'), 10) || 20;
        const result = await leadsCadenciaApi.getLeadsCadencia({ page, pageSize, search: params.get('search') || '', status: params.get('status') || '' });
        return res.status(200).json(result);
    } catch (err) {
        console.error('[api/leads-cadencia] Erro inesperado:', err);
        return res.status(500).json({ error: true, message: err.message });
    }
};
