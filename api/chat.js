// Todas as rotas do chat sandbox num arquivo só — o plano Hobby do Vercel limita a 12
// funções serverless por deployment, então em vez de um arquivo por rota (que estourou
// esse limite), rotas do mesmo domínio ficam juntas aqui, roteadas por pathname/método
// via parsing manual de req.url (mesma técnica já validada em produção).
//
// Rotas cobertas:
//   POST /api/callback                — resposta assíncrona final ou intermediária do n8n
//   POST/GET /api/status               — legenda de progresso / leitura da legenda atual
//   POST/GET /api/cost                 — custo acumulado em tempo real / leitura
//   GET  /api/poll                     — mensagens novas + status + custo, tudo junto
//   GET  /api/pending-responses        — mantido pra compatibilidade/depuração
//   POST /api/simulate-async-status    — demo do fluxo de status progressivo
//   GET  /api/last-error               — último erro de workflow recebido (JSON)
const sandboxStore = require('../sandboxStore');
const { handleCors, getJsonBody, getSearchParams, getPathname } = require('../apiUtils');
const { waitUntil } = require('@vercel/functions');

async function handleCallback(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: true, message: 'Método não suportado.' });
    const payload = getJsonBody(req);
    const chat_id = payload.chat_id;
    const reply = payload.reply;

    if (!chat_id || !reply) {
        const errResponse = { error: true, message: 'Os campos chat_id e reply sao obrigatorios.' };
        waitUntil(sandboxStore.pushLog({ direction: 'in', endpoint: '/api/callback', chat_id: chat_id || null, statusCode: 400, request: payload, response: errResponse }));
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
    waitUntil(sandboxStore.pushLog({ direction: 'in', endpoint: '/api/callback', chat_id, statusCode: 200, request: payload, response: okResponse }));
    return res.status(200).json(okResponse);
}

async function handleStatus(req, res) {
    if (req.method === 'POST') {
        const payload = getJsonBody(req);
        const chat_id = payload.chat_id;
        const status = payload.status;

        if (!chat_id) {
            const errResponse = { error: true, message: 'O campo chat_id e obrigatorio.' };
            waitUntil(sandboxStore.pushLog({ direction: 'in', endpoint: '/api/status', chat_id: null, statusCode: 400, request: payload, response: errResponse }));
            return res.status(400).json(errResponse);
        }

        const numericProgress = Number(payload.progress);
        const hasProgress = payload.progress !== undefined && payload.progress !== null && !Number.isNaN(numericProgress);
        // Arredondado pra inteiro — a coluna status_progress no Supabase é "integer"
        // (a barra de progresso não precisa de casas decimais mesmo).
        const progress = hasProgress ? Math.round(Math.max(0, Math.min(100, numericProgress))) : null;
        await sandboxStore.setStatus(chat_id, status || null, progress);

        const okResponse = { success: true };
        waitUntil(sandboxStore.pushLog({ direction: 'in', endpoint: '/api/status', chat_id, statusCode: 200, request: payload, response: okResponse }));
        return res.status(200).json(okResponse);
    }

    if (req.method === 'GET') {
        const chat_id = getSearchParams(req).get('chat_id');
        if (!chat_id) return res.status(400).json({ error: true, message: 'O parametro chat_id e obrigatorio.' });
        const state = await sandboxStore.getChatState(chat_id);
        return res.status(200).json({ chat_id, status: state.status.status, progress: state.status.progress });
    }

    return res.status(405).json({ error: true, message: 'Método não suportado.' });
}

async function handleCost(req, res) {
    if (req.method === 'POST') {
        const payload = getJsonBody(req);
        const chat_id = payload.chat_id;
        if (!chat_id) {
            const errResponse = { error: true, message: 'O campo chat_id e obrigatorio.' };
            waitUntil(sandboxStore.pushLog({ direction: 'in', endpoint: '/api/cost', chat_id: null, statusCode: 400, request: payload, response: errResponse }));
            return res.status(400).json(errResponse);
        }

        const numericTotal = Number(payload.total);
        const hasTotal = payload.total !== undefined && payload.total !== null && !Number.isNaN(numericTotal);
        if (!hasTotal) {
            const current = await sandboxStore.getChatState(chat_id);
            const skippedResponse = { success: true, skipped: true, chat_id, total: current.cost.total, currency: current.cost.currency };
            waitUntil(sandboxStore.pushLog({ direction: 'in', endpoint: '/api/cost', chat_id, statusCode: 200, request: payload, response: skippedResponse }));
            return res.status(200).json(skippedResponse);
        }

        const saved = await sandboxStore.setCost(chat_id, numericTotal, payload.currency);
        const okResponse = { success: true, chat_id, total: saved.total, currency: saved.currency };
        waitUntil(sandboxStore.pushLog({ direction: 'in', endpoint: '/api/cost', chat_id, statusCode: 200, request: payload, response: okResponse }));
        return res.status(200).json(okResponse);
    }

    if (req.method === 'GET') {
        const chat_id = getSearchParams(req).get('chat_id');
        if (!chat_id) return res.status(400).json({ error: true, message: 'O parametro chat_id e obrigatorio.' });
        const state = await sandboxStore.getChatState(chat_id);
        return res.status(200).json({ chat_id, total: state.cost.total, currency: state.cost.currency });
    }

    return res.status(405).json({ error: true, message: 'Método não suportado.' });
}

async function handlePoll(req, res) {
    if (req.method !== 'GET') return res.status(405).json({ error: true, message: 'Método não suportado.' });
    const chat_id = getSearchParams(req).get('chat_id');
    if (!chat_id) return res.status(400).json({ error: true, message: 'O parametro chat_id e obrigatorio.' });

    const [messages, state] = await Promise.all([
        sandboxStore.consumeMessages(chat_id),
        sandboxStore.getChatState(chat_id)
    ]);
    return res.status(200).json({ messages, status: state.status, cost: state.cost });
}

async function handlePendingResponses(req, res) {
    if (req.method !== 'GET') return res.status(405).json({ error: true, message: 'Método não suportado.' });
    const chat_id = getSearchParams(req).get('chat_id');
    if (!chat_id) return res.status(400).json({ error: true, message: 'O parametro chat_id e obrigatorio.' });
    const messages = await sandboxStore.consumeMessages(chat_id);
    return res.status(200).json({ messages });
}

async function handleSimulateAsyncStatus(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: true, message: 'Método não suportado.' });
    const payload = getJsonBody(req);
    const chat_id = payload.chat_id;
    if (!chat_id) return res.status(400).json({ error: true, message: 'O campo chat_id e obrigatorio.' });

    await sandboxStore.setStatus(chat_id, 'Iniciando fluxo...', 0);

    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
    waitUntil((async () => {
        await sleep(1500);
        await sandboxStore.setStatus(chat_id, '1/3 - Conectando à base de dados do CRM...', 33);
        await sleep(2000);
        await sandboxStore.setStatus(chat_id, '2/3 - Extraindo leads da campanha...', 66);
        await sleep(2000);
        await sandboxStore.setStatus(chat_id, '3/3 - Filtrando contatos válidos e preparando relatório...', 100);
        await sleep(2000);
        await sandboxStore.clearStatus(chat_id);
        await sandboxStore.queueMessage(chat_id, {
            message_id: 'MSG-RES-' + Math.random().toString(36).substring(2, 9),
            reply: 'Processamento concluído com sucesso! Encontrei 42 leads qualificados para a sua campanha e eles já foram sincronizados com seu CRM.',
            status: 'ok',
            next_action: null,
            raw_payload: null
        });
    })());

    return res.status(200).json({
        reply: 'Iniciando processamento assíncrono. Acompanhe o log de status em tempo real abaixo:',
        status: 'processing',
        timestamp: new Date().toISOString()
    });
}

async function handleLastError(req, res) {
    if (req.method !== 'GET') return res.status(405).json({ error: true, message: 'Método não suportado.' });
    const last = await sandboxStore.getLastError();
    if (last && last.kind === 'json') return res.status(200).json(last.payload);
    return res.status(200).json({ status: 'idle', message: 'Nenhum erro registrado' });
}

module.exports = async (req, res) => {
    if (handleCors(req, res)) return;
    const routePath = getPathname(req).replace(/^\/api/, '') || '/';

    try {
        if (routePath === '/callback') return await handleCallback(req, res);
        if (routePath === '/status') return await handleStatus(req, res);
        if (routePath === '/cost') return await handleCost(req, res);
        if (routePath === '/poll') return await handlePoll(req, res);
        if (routePath === '/pending-responses') return await handlePendingResponses(req, res);
        if (routePath === '/simulate-async-status') return await handleSimulateAsyncStatus(req, res);
        if (routePath === '/last-error') return await handleLastError(req, res);
        return res.status(404).json({ error: true, message: `Rota não encontrada: ${req.method} /api${routePath}` });
    } catch (err) {
        console.error(`[api/chat${routePath}] Erro inesperado:`, err);
        return res.status(500).json({ error: true, message: err.message });
    }
};
