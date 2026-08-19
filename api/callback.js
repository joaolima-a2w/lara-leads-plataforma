// POST /api/callback — resposta assíncrona final ou intermediária do n8n.
const sandboxStore = require('../sandboxStore');
const { handleCors, getJsonBody } = require('../apiUtils');

module.exports = async (req, res) => {
    if (handleCors(req, res)) return;
    if (req.method !== 'POST') return res.status(405).json({ error: true, message: 'Método não suportado.' });

    try {
        const payload = getJsonBody(req);
        const chat_id = payload.chat_id;
        const reply = payload.reply;

        if (!chat_id || !reply) {
            const errResponse = { error: true, message: 'Os campos chat_id e reply sao obrigatorios.' };
            await sandboxStore.pushLog({ direction: 'in', endpoint: '/api/callback', chat_id: chat_id || null, statusCode: 400, request: payload, response: errResponse });
            return res.status(400).json(errResponse);
        }

        const responseMsg = {
            message_id: payload.message_id || 'MSG-RES-' + Math.random().toString(36).substring(2, 9),
            reply,
            status: payload.status || 'ok',
            next_action: payload.next_action || null,
            raw_payload: payload
        };
        await sandboxStore.queueMessage(chat_id, responseMsg);

        const okResponse = { success: true, message: 'Resposta enfileirada com sucesso.' };
        await sandboxStore.pushLog({ direction: 'in', endpoint: '/api/callback', chat_id, statusCode: 200, request: payload, response: okResponse });
        return res.status(200).json(okResponse);
    } catch (err) {
        console.error('[api/callback] Erro inesperado:', err);
        return res.status(500).json({ error: true, message: err.message });
    }
};
