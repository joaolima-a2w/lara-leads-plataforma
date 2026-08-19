// GET /api/decisores?page=&pageSize=&search= — tela "Contatos".
const decisoresApi = require('../../decisoresApi');
const { handleCors, getSearchParams } = require('../../apiUtils');

module.exports = async (req, res) => {
    if (handleCors(req, res)) return;
    if (req.method !== 'GET') return res.status(405).json({ error: true, message: 'Método não suportado.' });

    try {
        const params = getSearchParams(req);
        const page = parseInt(params.get('page'), 10) || 1;
        const pageSize = parseInt(params.get('pageSize'), 10) || 20;
        const result = await decisoresApi.getDecisores({ page, pageSize, search: params.get('search') || '' });
        return res.status(200).json(result);
    } catch (err) {
        console.error('[api/decisores] Erro inesperado:', err);
        return res.status(500).json({ error: true, message: err.message });
    }
};
