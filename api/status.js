// POST /api/status — legenda de progresso (não é a resposta final).
// GET  /api/status?chat_id= — leitura da legenda/sinal atual.
const sandboxStore = require('../sandboxStore');
const { handleCors, getJsonBody, getSearchParams } = require('../apiUtils');

module.exports = async (req, res) => {
    if (handleCors(req, res)) return;

    try {
        if (req.method === 'POST') {
            const payload = getJsonBody(req);
            const chat_id = payload.chat_id;
            const status = payload.status;

            if (!chat_id) {
                const errResponse = { error: true, message: 'O campo chat_id e obrigatorio.' };
                await sandboxStore.pushLog({ direction: 'in', endpoint: '/api/status', chat_id: null, statusCode: 400, request: payload, response: errResponse });
                return res.status(400).json(errResponse);
            }

            const numericProgress = Number(payload.progress);
            const hasProgress = payload.progress !== undefined && payload.progress !== null && !Number.isNaN(numericProgress);
            const progress = hasProgress ? Math.max(0, Math.min(100, numericProgress)) : null;
            await sandboxStore.setStatus(chat_id, status || null, progress);

            const okResponse = { success: true };
            await sandboxStore.pushLog({ direction: 'in', endpoint: '/api/status', chat_id, statusCode: 200, request: payload, response: okResponse });
            return res.status(200).json(okResponse);
        }

        if (req.method === 'GET') {
            const chat_id = getSearchParams(req).get('chat_id');
            if (!chat_id) return res.status(400).json({ error: true, message: 'O parametro chat_id e obrigatorio.' });

            const state = await sandboxStore.getChatState(chat_id);
            return res.status(200).json({ chat_id, status: state.status.text, progress: state.status.progress });
        }

        return res.status(405).json({ error: true, message: 'Método não suportado.' });
    } catch (err) {
        console.error('[api/status] Erro inesperado:', err);
        return res.status(500).json({ error: true, message: err.message });
    }
};
