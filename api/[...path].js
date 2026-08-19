// Roteador único pra tudo em /api no deploy do Vercel — um catch-all em vez de um
// arquivo por rota, pra poder reaproveitar quase 1:1 a lógica que já existia em
// server.js (só trocando leitura manual de body/URL pelos helpers do runtime Node do
// Vercel, e o estado em memória pelo sandboxStore.js, que guarda tudo no Supabase).
// Exceção: POST/GET /error (também acessível sem o prefixo /api) mora em api/error.js,
// por causa do rewrite em vercel.json que expõe a mesma função em "/error".
const supabase = require('../supabaseClient');
const db = require('../db');
const leadsCadenciaApi = require('../leadsCadenciaApi');
const leadDetailApi = require('../leadDetailApi');
const decisoresApi = require('../decisoresApi');
const personalizacaoApi = require('../personalizacaoApi');
const sandboxStore = require('../sandboxStore');
const { handleCors, getJsonBody } = require('../apiUtils');
const { waitUntil } = require('@vercel/functions');

module.exports = async (req, res) => {
    if (handleCors(req, res)) return;

    const segments = Array.isArray(req.query.path) ? req.query.path : [];
    const routePath = '/' + segments.join('/');
    const method = req.method;

    try {
        // --- POST /api/callback — resposta assíncrona final ou intermediária do n8n ---
        if (routePath === '/callback' && method === 'POST') {
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
        }

        // --- POST /api/status — legenda de progresso (não é a resposta final) ---
        if (routePath === '/status' && method === 'POST') {
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

        // --- GET /api/status?chat_id= — leitura da legenda/sinal atual ---
        if (routePath === '/status' && method === 'GET') {
            const chat_id = req.query.chat_id;
            if (!chat_id) return res.status(400).json({ error: true, message: 'O parametro chat_id e obrigatorio.' });

            const state = await sandboxStore.getChatState(chat_id);
            return res.status(200).json({ chat_id, status: state.status.text, progress: state.status.progress });
        }

        // --- POST /api/cost — custo acumulado em tempo real ---
        if (routePath === '/cost' && method === 'POST') {
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

        // --- GET /api/cost?chat_id= — leitura do custo acumulado ---
        if (routePath === '/cost' && method === 'GET') {
            const chat_id = req.query.chat_id;
            if (!chat_id) return res.status(400).json({ error: true, message: 'O parametro chat_id e obrigatorio.' });

            const state = await sandboxStore.getChatState(chat_id);
            return res.status(200).json({ chat_id, total: state.cost.total, currency: state.cost.currency });
        }

        // --- GET /api/poll?chat_id= — mensagens novas + status + custo, tudo numa chamada ---
        if (routePath === '/poll' && method === 'GET') {
            const chat_id = req.query.chat_id;
            if (!chat_id) return res.status(400).json({ error: true, message: 'O parametro chat_id e obrigatorio.' });

            const [messages, state] = await Promise.all([
                sandboxStore.consumeMessages(chat_id),
                sandboxStore.getChatState(chat_id)
            ]);
            return res.status(200).json({ messages, status: state.status, cost: state.cost });
        }

        // --- GET /api/pending-responses?chat_id= — mantido pra compatibilidade/depuração ---
        if (routePath === '/pending-responses' && method === 'GET') {
            const chat_id = req.query.chat_id;
            if (!chat_id) return res.status(400).json({ error: true, message: 'O parametro chat_id e obrigatorio.' });

            const messages = await sandboxStore.consumeMessages(chat_id);
            return res.status(200).json({ messages });
        }

        // --- POST /api/simulate-async-status — demo do fluxo de status progressivo ---
        // As atualizações atrasadas usam waitUntil (em vez de setTimeout "solto") porque
        // uma função serverless pode ser congelada assim que a resposta é enviada — sem
        // isso, os setTimeout nunca chegariam a rodar depois do `return` abaixo.
        if (routePath === '/simulate-async-status' && method === 'POST') {
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

        // --- GET /api/logs?chat_id=&limit= ---
        if (routePath === '/logs' && method === 'GET') {
            const limitParam = parseInt(req.query.limit, 10);
            const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 300) : 300;
            const logs = await sandboxStore.getLogs({ chatIdFilter: req.query.chat_id, limit });
            return res.status(200).json({ logs, total: logs.length });
        }

        // --- POST /api/logs/clear ---
        if (routePath === '/logs/clear' && method === 'POST') {
            await sandboxStore.clearLogs();
            return res.status(200).json({ success: true });
        }

        // --- POST /api/proxy-webhook — bypass de CORS pro webhook real ---
        if (routePath === '/proxy-webhook' && method === 'POST') {
            const data = getJsonBody(req);
            const targetUrl = data.target_url;
            const payload = data.payload;
            if (!targetUrl || !payload) return res.status(400).json({ error: true, message: 'target_url and payload are required' });

            const payloadObj = Array.isArray(payload) ? payload[0] : payload;
            const chat_id = (payloadObj && payloadObj.chat_id) || null;

            try {
                const proxyRes = await fetch(targetUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                const resBody = await proxyRes.text();
                let parsedResBody;
                try { parsedResBody = JSON.parse(resBody); } catch (e) { parsedResBody = resBody; }

                await sandboxStore.pushLog({ direction: 'out', endpoint: targetUrl, chat_id, statusCode: proxyRes.status, request: payload, response: parsedResBody });
                res.status(proxyRes.status).setHeader('Content-Type', proxyRes.headers.get('content-type') || 'application/json');
                return res.send(resBody);
            } catch (err) {
                console.error('[Proxy Error]', err);
                const errResponse = { error: true, message: `Falha ao conectar no webhook do n8n: ${err.message}` };
                await sandboxStore.pushLog({ direction: 'out', endpoint: targetUrl, chat_id, statusCode: 502, request: payload, response: errResponse });
                return res.status(502).json(errResponse);
            }
        }

        // --- POST /api/mock-workflow — simulador de workflow no modo "Servidor Local" ---
        if (routePath === '/mock-workflow' && method === 'POST') {
            const rawPayload = getJsonBody(req);
            const payload = Array.isArray(rawPayload) ? rawPayload[0] : rawPayload;

            const messageLower = (payload.message || '').toLowerCase();
            let summary = 'sua mensagem';
            let action = null;
            if (messageLower.includes('venda') || messageLower.includes('comprar') || messageLower.includes('preço')) {
                summary = 'vendas e cotacao de leads';
                action = 'trigger_sales_routing';
            } else if (messageLower.includes('suporte') || messageLower.includes('ajuda') || messageLower.includes('erro')) {
                summary = 'suporte tecnico';
                action = 'trigger_support_escalation';
            } else if (messageLower.includes('agro') || messageLower.includes('fazenda') || messageLower.includes('campo')) {
                summary = 'agronegocio e prospeccao rural';
                action = 'route_to_agro_workflow';
            } else if (messageLower.includes('tecnologia') || messageLower.includes('dev') || messageLower.includes('api')) {
                summary = 'tecnologia e integracoes Lara Leads';
                action = 'route_to_dev_api';
            }

            const responseJson = {
                reply: `Ola! Entendi que sua mensagem e sobre ${summary}. Esta e uma resposta automatizada simulando o fluxo de retorno do Lara Leads para o Chat ID: ${payload.chat_id}.`,
                status: 'ok',
                next_action: action,
                timestamp: new Date().toISOString(),
                received_meta: {
                    tenant_id: payload.tenant_id,
                    user_id: payload.user_id,
                    workflow_hint: payload.meta?.extra?.workflow_hint || null
                }
            };
            if (payload.meta?.extra?.workflow_hint) {
                responseJson.reply += `\n\n💡 [Workflow Hint detectado: "${payload.meta.extra.workflow_hint}" | Acao disparada: Roteamento inteligente]`;
            }
            return res.status(200).json(responseJson);
        }

        // --- GET /api/leads-cadencia/stats ---
        if (routePath === '/leads-cadencia/stats' && method === 'GET') {
            const stats = await leadsCadenciaApi.getLeadsCadenciaStats();
            return res.status(200).json(stats);
        }

        // --- GET /api/leads-cadencia/<id>/detail ---
        const detailMatch = routePath.match(/^\/leads-cadencia\/([^/]+)\/detail$/);
        if (detailMatch && method === 'GET') {
            const detail = await leadDetailApi.getLeadDetail(decodeURIComponent(detailMatch[1]));
            if (!detail) return res.status(404).json({ error: true, message: 'Lead não encontrado.' });
            return res.status(200).json(detail);
        }

        // --- POST /api/leads-cadencia/<id>/etapas/<etapa>/notes ---
        const notesMatch = routePath.match(/^\/leads-cadencia\/([^/]+)\/etapas\/(\d+)\/notes$/);
        if (notesMatch && method === 'POST') {
            const leadCadenciaId = decodeURIComponent(notesMatch[1]);
            const etapaCadencia = parseInt(notesMatch[2], 10);
            const payload = getJsonBody(req);
            const saved = await leadDetailApi.saveStageNote(leadCadenciaId, etapaCadencia, payload);
            return res.status(200).json({ success: true, note: saved });
        }

        // --- POST /api/leads-cadencia/<id>/status — parar / concluir / tarefa manual concluída ---
        const statusActionMatch = routePath.match(/^\/leads-cadencia\/([^/]+)\/status$/);
        if (statusActionMatch && method === 'POST') {
            const leadCadenciaId = decodeURIComponent(statusActionMatch[1]);
            const payload = getJsonBody(req);
            try {
                const result = await leadDetailApi.updateLeadCadenciaStatus(leadCadenciaId, payload.action);
                return res.status(200).json({ success: true, ...result });
            } catch (err) {
                const status = err.message.includes('desconhecida') || err.message.includes('não encontrado') ? 400 : 500;
                return res.status(status).json({ error: true, message: err.message });
            }
        }

        // --- GET /api/leads-cadencia?page=&pageSize=&search=&status= ---
        if (routePath === '/leads-cadencia' && method === 'GET') {
            const page = parseInt(req.query.page, 10) || 1;
            const pageSize = parseInt(req.query.pageSize, 10) || 20;
            const result = await leadsCadenciaApi.getLeadsCadencia({ page, pageSize, search: req.query.search || '', status: req.query.status || '' });
            return res.status(200).json(result);
        }

        // --- GET /api/decisores/stats ---
        if (routePath === '/decisores/stats' && method === 'GET') {
            const stats = await decisoresApi.getDecisoresStats();
            return res.status(200).json(stats);
        }

        // --- GET /api/decisores?page=&pageSize=&search= ---
        if (routePath === '/decisores' && method === 'GET') {
            const page = parseInt(req.query.page, 10) || 1;
            const pageSize = parseInt(req.query.pageSize, 10) || 20;
            const result = await decisoresApi.getDecisores({ page, pageSize, search: req.query.search || '' });
            return res.status(200).json(result);
        }

        // --- GET /api/personalizacao?user_id= ---
        if (routePath === '/personalizacao' && method === 'GET') {
            const userId = req.query.user_id;
            if (!userId) return res.status(400).json({ error: true, message: 'O parametro user_id e obrigatorio.' });
            const result = await personalizacaoApi.getPersonalizacoes(userId);
            return res.status(200).json(result);
        }

        // --- GET /api/supabase/health ---
        if (routePath === '/supabase/health' && method === 'GET') {
            try {
                const result = await supabase.checkConnection();
                return res.status(200).json({ ok: true, ...result });
            } catch (err) {
                return res.status(500).json({ ok: false, error: err.message });
            }
        }

        // --- GET /api/db/health ---
        if (routePath === '/db/health' && method === 'GET') {
            try {
                const row = await db.checkConnection();
                return res.status(200).json({ ok: true, database: row.database, server_time: row.now });
            } catch (err) {
                return res.status(500).json({ ok: false, error: err.message });
            }
        }

        // --- GET /api/last-error ---
        if (routePath === '/last-error' && method === 'GET') {
            const last = await sandboxStore.getLastError();
            if (last && last.kind === 'json') {
                return res.status(200).json(last.payload);
            }
            return res.status(200).json({ status: 'idle', message: 'Nenhum erro registrado' });
        }

        return res.status(404).json({ error: true, message: `Rota não encontrada: ${method} /api${routePath}` });
    } catch (err) {
        console.error(`[api${routePath}] Erro inesperado:`, err);
        return res.status(500).json({ error: true, message: err.message });
    }
};
