// GET /api/personalizacao?user_id= — tela "Configuração de Setup".
const personalizacaoApi = require('../personalizacaoApi');
const { handleCors, getSearchParams } = require('../apiUtils');

module.exports = async (req, res) => {
    if (handleCors(req, res)) return;
    if (req.method !== 'GET') return res.status(405).json({ error: true, message: 'Método não suportado.' });

    try {
        const userId = getSearchParams(req).get('user_id');
        if (!userId) return res.status(400).json({ error: true, message: 'O parametro user_id e obrigatorio.' });
        const result = await personalizacaoApi.getPersonalizacoes(userId);
        return res.status(200).json(result);
    } catch (err) {
        console.error('[api/personalizacao] Erro inesperado:', err);
        return res.status(500).json({ error: true, message: err.message });
    }
};
