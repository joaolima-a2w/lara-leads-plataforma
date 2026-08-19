// POST /api/cost — custo acumulado em tempo real.
// GET  /api/cost?chat_id= — leitura do custo acumulado.
const sandboxStore = require('../sandboxStore');
const { handleCors, getJsonBody, getSearchParams } = require('../apiUtils');

module.exports = async (req, res) => {
    if (handleCors(req, res)) return;

    try {
        if (req.method === 'POST') {
            const payload = getJsonBody(req);
            const chat_id = payload.chat_id;
            if (!chat_id) {
                const errResponse = { error: true, message: 'O campo chat_id e obrigatorio.' };
                await sandboxStore.pushLog({ direction: 'in', endpoint: '/api/cost', chat_id: null, statusCode: 400, request: payload, response: errResponse });
                return res.status(400).json(errResponse);
            }

            const numericTotal = Number(payload.total);
            const hasTotal = payload.total !== undefined && payload.total !== null && !Number.isNaN(numericTotal);
            if (!hasTotal) {
                const current = await sandboxStore.getChatState(chat_id);
                const skippedResponse = { success: true, skipped: true, chat_id, total: current.cost.total, currency: current.cost.currency };
                await sandboxStore.pushLog({ direction: 'in', endpoint: '/api/cost', chat_id, statusCode: 200, request: payload, response: skippedResponse });
                return res.status(200).json(skippedResponse);
            }

            const saved = await sandboxStore.setCost(chat_id, numericTotal, payload.currency);
            const okResponse = { success: true, chat_id, total: saved.total, currency: saved.currency };
            await sandboxStore.pushLog({ direction: 'in', endpoint: '/api/cost', chat_id, statusCode: 200, request: payload, response: okResponse });
            return res.status(200).json(okResponse);
        }

        if (req.method === 'GET') {
            const chat_id = getSearchParams(req).get('chat_id');
            if (!chat_id) return res.status(400).json({ error: true, message: 'O parametro chat_id e obrigatorio.' });

            const state = await sandboxStore.getChatState(chat_id);
            return res.status(200).json({ chat_id, total: state.cost.total, currency: state.cost.currency });
        }

        return res.status(405).json({ error: true, message: 'Método não suportado.' });
    } catch (err) {
        console.error('[api/cost] Erro inesperado:', err);
        return res.status(500).json({ error: true, message: err.message });
    }
};
