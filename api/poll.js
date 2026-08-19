// GET /api/poll?chat_id= — mensagens novas + status + custo, tudo numa chamada.
const sandboxStore = require('../sandboxStore');
const { handleCors, getSearchParams } = require('../apiUtils');

module.exports = async (req, res) => {
    if (handleCors(req, res)) return;
    if (req.method !== 'GET') return res.status(405).json({ error: true, message: 'Método não suportado.' });

    try {
        const chat_id = getSearchParams(req).get('chat_id');
        if (!chat_id) return res.status(400).json({ error: true, message: 'O parametro chat_id e obrigatorio.' });

        const [messages, state] = await Promise.all([
            sandboxStore.consumeMessages(chat_id),
            sandboxStore.getChatState(chat_id)
        ]);
        return res.status(200).json({ messages, status: state.status, cost: state.cost });
    } catch (err) {
        console.error('[api/poll] Erro inesperado:', err);
        return res.status(500).json({ error: true, message: err.message });
    }
};
