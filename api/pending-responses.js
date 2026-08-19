// GET /api/pending-responses?chat_id= — mantido pra compatibilidade/depuração (o
// front-end usa /api/poll, que combina isso com status/custo numa chamada só).
const sandboxStore = require('../sandboxStore');
const { handleCors, getSearchParams } = require('../apiUtils');

module.exports = async (req, res) => {
    if (handleCors(req, res)) return;
    if (req.method !== 'GET') return res.status(405).json({ error: true, message: 'Método não suportado.' });

    try {
        const chat_id = getSearchParams(req).get('chat_id');
        if (!chat_id) return res.status(400).json({ error: true, message: 'O parametro chat_id e obrigatorio.' });

        const messages = await sandboxStore.consumeMessages(chat_id);
        return res.status(200).json({ messages });
    } catch (err) {
        console.error('[api/pending-responses] Erro inesperado:', err);
        return res.status(500).json({ error: true, message: err.message });
    }
};
