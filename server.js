const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3000;

// In-memory queue to store async webhook responses from n8n
const pendingResponses = {};
const activeStatuses = {};
const chatCosts = {};

// In-memory cache for the latest workflow errors
let lastJsonError = null;
let lastHtmlError = null;
let lastActiveChatId = null;

// In-memory log of every request the platform receives from n8n ("in") or sends
// to n8n ("out"). Newest first, capped so it can't grow unbounded across a long
// dev session. Viewable at /logs.
const requestLogs = [];
const LOG_LIMIT = 300;

function pushLog(entry) {
    requestLogs.unshift({
        id: Math.random().toString(36).substring(2, 10),
        timestamp: new Date().toISOString(),
        ...entry
    });
    if (requestLogs.length > LOG_LIMIT) requestLogs.length = LOG_LIMIT;
}

// Content types map
const MIME_TYPES = {
    '.html': 'text/html; charset=UTF-8',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml'
};

const server = http.createServer((req, res) => {
    // Add CORS headers to support requests from any origin (e.g. file://)
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // Handle CORS preflight options request
    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    // --- Endpoint 1: n8n Asynchronous Callback Response ---
    // URL: POST http://localhost:3000/api/callback
    if (req.url === '/api/callback' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => {
            body += chunk.toString();
        });
        req.on('end', () => {
            try {
                const payload = JSON.parse(body);
                const chat_id = payload.chat_id;
                const reply = payload.reply;

                if (!chat_id || !reply) {
                    const errResponse = { error: true, message: 'Os campos chat_id e reply sao obrigatorios.' };
                    pushLog({ direction: 'in', endpoint: '/api/callback', chat_id: chat_id || null, statusCode: 400, request: payload, response: errResponse });
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify(errResponse));
                    return;
                }

                if (!pendingResponses[chat_id]) {
                    pendingResponses[chat_id] = [];
                }

                const responseMsg = {
                    message_id: payload.message_id || 'MSG-RES-' + Math.random().toString(36).substring(2, 9),
                    reply: reply,
                    status: payload.status || 'ok',
                    timestamp: new Date().toISOString(),
                    next_action: payload.next_action || null,
                    raw_payload: payload
                };

                pendingResponses[chat_id].push(responseMsg);
                delete activeStatuses[chat_id]; // Clear active status log
                console.log(`\n📬 [Callback do n8n Recebido] Chat ID: ${chat_id}`);
                console.log(`💬 Resposta: "${reply}"\n`);

                const okResponse = { success: true, message: 'Resposta enfileirada com sucesso.' };
                pushLog({ direction: 'in', endpoint: '/api/callback', chat_id, statusCode: 200, request: payload, response: okResponse });
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(okResponse));
            } catch (e) {
                const errResponse = { error: true, message: 'Formato JSON invalido.' };
                pushLog({ direction: 'in', endpoint: '/api/callback', chat_id: null, statusCode: 400, request: body, response: errResponse });
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(errResponse));
            }
        });
        return;
    }

    // --- Endpoint 1B: Status Updates ---
    // URL: POST http://localhost:3000/api/status
    if (req.url === '/api/status' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => {
            body += chunk.toString();
        });
        req.on('end', () => {
            try {
                const payload = JSON.parse(body);
                const chat_id = payload.chat_id;
                const status = payload.status;

                if (!chat_id) {
                    const errResponse = { error: true, message: 'O campo chat_id e obrigatorio.' };
                    pushLog({ direction: 'in', endpoint: '/api/status', chat_id: null, statusCode: 400, request: payload, response: errResponse });
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify(errResponse));
                    return;
                }

                // "progress" e opcional: um numero de 0 a 100 exibido como barra ao lado do status.
                const numericProgress = Number(payload.progress);
                const hasProgress = payload.progress !== undefined && payload.progress !== null && !Number.isNaN(numericProgress);
                const progress = hasProgress ? Math.max(0, Math.min(100, numericProgress)) : null;

                activeStatuses[chat_id] = { text: status || null, progress };
                console.log(`⏳ [Status do Processo] Chat ID: ${chat_id} -> "${status}"${hasProgress ? ` (${progress}%)` : ''}`);

                const okResponse = { success: true };
                pushLog({ direction: 'in', endpoint: '/api/status', chat_id, statusCode: 200, request: payload, response: okResponse });
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(okResponse));
            } catch (e) {
                const errResponse = { error: true, message: 'Formato JSON invalido.' };
                pushLog({ direction: 'in', endpoint: '/api/status', chat_id: null, statusCode: 400, request: body, response: errResponse });
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(errResponse));
            }
        });
        return;
    }

    // --- Endpoint 1C: Get Status ---
    // URL: GET http://localhost:3000/api/status?chat_id=xxxx
    if (req.url.startsWith('/api/status') && req.method === 'GET') {
        try {
            const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
            const chat_id = parsedUrl.searchParams.get('chat_id');

            if (!chat_id) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: true, message: 'O parametro chat_id e obrigatorio.' }));
                return;
            }

            const entry = activeStatuses[chat_id] || { text: null, progress: null };

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ chat_id, status: entry.text, progress: entry.progress }));
        } catch (e) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: true, message: e.message }));
        }
        return;
    }

    // --- Endpoint 1D2: Real-time Cost Tracking (n8n -> Chat) ---
    // URL: POST http://localhost:3000/api/cost
    // Payload: { "chat_id": "xxxx", "total": 0.0042, "currency": "BRL" }
    // "total" e o valor JA acumulado a ser exibido - cada chamada SUBSTITUI o total anterior
    // (nao soma/incrementa). "currency" e opcional; o padrao de todo chat novo e BRL.
    if (req.url === '/api/cost' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => {
            body += chunk.toString();
        });
        req.on('end', () => {
            try {
                const payload = JSON.parse(body);
                const chat_id = payload.chat_id;

                if (!chat_id) {
                    const errResponse = { error: true, message: 'O campo chat_id e obrigatorio.' };
                    pushLog({ direction: 'in', endpoint: '/api/cost', chat_id: null, statusCode: 400, request: payload, response: errResponse });
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify(errResponse));
                    return;
                }

                const existing = chatCosts[chat_id] || { total: 0, currency: 'BRL' };

                const numericTotal = Number(payload.total);
                const hasTotal = payload.total !== undefined && payload.total !== null && !Number.isNaN(numericTotal);

                // Sem total (ex: ping so com chat_id) - nao e erro, so nao ha nada a atualizar.
                if (!hasTotal) {
                    const skippedResponse = { success: true, skipped: true, chat_id, total: existing.total, currency: existing.currency };
                    pushLog({ direction: 'in', endpoint: '/api/cost', chat_id, statusCode: 200, request: payload, response: skippedResponse });
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify(skippedResponse));
                    return;
                }

                existing.total = numericTotal;
                existing.currency = payload.currency || existing.currency || 'BRL';
                chatCosts[chat_id] = existing;

                console.log(`\n💰 [Custo Atualizado] Chat ID: ${chat_id} -> total: ${existing.total.toFixed(6)} ${existing.currency}\n`);

                const okResponse = { success: true, chat_id, total: existing.total, currency: existing.currency };
                pushLog({ direction: 'in', endpoint: '/api/cost', chat_id, statusCode: 200, request: payload, response: okResponse });
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(okResponse));
            } catch (e) {
                const errResponse = { error: true, message: 'Formato JSON invalido.' };
                pushLog({ direction: 'in', endpoint: '/api/cost', chat_id: null, statusCode: 400, request: body, response: errResponse });
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(errResponse));
            }
        });
        return;
    }

    // --- Endpoint 1D3: Get Real-time Cost ---
    // URL: GET http://localhost:3000/api/cost?chat_id=xxxx
    if (req.url.startsWith('/api/cost') && req.method === 'GET') {
        try {
            const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
            const chat_id = parsedUrl.searchParams.get('chat_id');

            if (!chat_id) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: true, message: 'O parametro chat_id e obrigatorio.' }));
                return;
            }

            const cost = chatCosts[chat_id] || { total: 0, currency: 'BRL' };

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ chat_id, total: cost.total, currency: cost.currency }));
        } catch (e) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: true, message: e.message }));
        }
        return;
    }

    // --- Endpoint 1D: Simulate Async Status Flow ---
    // URL: POST http://localhost:3000/api/simulate-async-status
    if (req.url === '/api/simulate-async-status' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => {
            body += chunk.toString();
        });
        req.on('end', () => {
            try {
                const payload = JSON.parse(body);
                const chat_id = payload.chat_id;

                if (!chat_id) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: true, message: 'O campo chat_id e obrigatorio.' }));
                    return;
                }

                const initialReply = "Iniciando processamento assíncrono. Acompanhe o log de status em tempo real abaixo:";
                activeStatuses[chat_id] = { text: "Iniciando fluxo...", progress: 0 };

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    reply: initialReply,
                    status: "processing",
                    timestamp: new Date().toISOString()
                }));

                // Start progressive status updates simulation
                setTimeout(() => {
                    activeStatuses[chat_id] = { text: "1/3 - Conectando à base de dados do CRM...", progress: 33 };
                    console.log(`⏳ Simulação Status Chat ${chat_id}: ${activeStatuses[chat_id].text} (33%)`);
                }, 1500);

                setTimeout(() => {
                    activeStatuses[chat_id] = { text: "2/3 - Extraindo leads da campanha...", progress: 66 };
                    console.log(`⏳ Simulação Status Chat ${chat_id}: ${activeStatuses[chat_id].text} (66%)`);
                }, 3500);

                setTimeout(() => {
                    activeStatuses[chat_id] = { text: "3/3 - Filtrando contatos válidos e preparando relatório...", progress: 100 };
                    console.log(`⏳ Simulação Status Chat ${chat_id}: ${activeStatuses[chat_id].text} (100%)`);
                }, 5500);

                setTimeout(() => {
                    delete activeStatuses[chat_id];
                    
                    // Push final response to pending queue
                    if (!pendingResponses[chat_id]) {
                        pendingResponses[chat_id] = [];
                    }
                    const responseMsg = {
                        message_id: 'MSG-RES-' + Math.random().toString(36).substring(2, 9),
                        reply: "Processamento concluído com sucesso! Encontrei 42 leads qualificados para a sua campanha e eles já foram sincronizados com seu CRM.",
                        status: 'ok',
                        timestamp: new Date().toISOString()
                    };
                    pendingResponses[chat_id].push(responseMsg);
                    console.log(`📬 Simulação Finalizada: Resposta adicionada na fila para Chat ${chat_id}`);
                }, 7500);

            } catch (e) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: true, message: 'Formato JSON invalido.' }));
            }
        });
        return;
    }

    // --- Endpoint 1E: Get Request/Response Logs ---
    // URL: GET http://localhost:3000/api/logs?chat_id=xxxx&limit=100
    if (req.url.startsWith('/api/logs') && req.method === 'GET') {
        try {
            const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
            const chatIdFilter = parsedUrl.searchParams.get('chat_id');
            const limitParam = parseInt(parsedUrl.searchParams.get('limit'), 10);
            const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, LOG_LIMIT) : LOG_LIMIT;

            let logs = requestLogs;
            if (chatIdFilter) {
                logs = logs.filter(l => l.chat_id && l.chat_id.includes(chatIdFilter));
            }

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ logs: logs.slice(0, limit), total: requestLogs.length }));
        } catch (e) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: true, message: e.message }));
        }
        return;
    }

    // --- Endpoint 1F: Clear Request/Response Logs ---
    // URL: POST http://localhost:3000/api/logs/clear
    if (req.url === '/api/logs/clear' && req.method === 'POST') {
        requestLogs.length = 0;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
        return;
    }

    // --- Endpoint 2: Client Polling Endpoint for Async Responses ---
    // URL: GET http://localhost:3000/api/pending-responses?chat_id=xxxx
    if (req.url.startsWith('/api/pending-responses') && req.method === 'GET') {
        try {
            const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
            const chat_id = parsedUrl.searchParams.get('chat_id');

            if (!chat_id) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: true, message: 'O parametro chat_id e obrigatorio.' }));
                return;
            }

            lastActiveChatId = chat_id;

            const messages = pendingResponses[chat_id] || [];
            pendingResponses[chat_id] = []; // Consume/clear queue on read

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ messages }));
        } catch (e) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: true, message: e.message }));
        }
        return;
    }

    // --- Endpoint 3: Proxy Request to Webhook (Bypasses Browser CORS Blocks) ---
    // URL: POST http://localhost:3000/api/proxy-webhook
    if (req.url === '/api/proxy-webhook' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => {
            body += chunk.toString();
        });
        req.on('end', () => {
            try {
                const data = JSON.parse(body);
                const targetUrl = data.target_url;
                const payload = data.payload;

                if (!targetUrl || !payload) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: true, message: 'target_url and payload are required' }));
                    return;
                }

                console.log(`[Proxy] Forwarding payload to n8n webhook: ${targetUrl}`);

                const payloadObj = Array.isArray(payload) ? payload[0] : payload;
                const chat_id = (payloadObj && payloadObj.chat_id) || null;

                const urlObj = new URL(targetUrl);
                const protocol = urlObj.protocol === 'https:' ? require('https') : require('http');
                const postData = JSON.stringify(payload);

                const proxyReq = protocol.request(targetUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Content-Length': Buffer.byteLength(postData)
                    }
                }, (proxyRes) => {
                    let resBody = '';
                    proxyRes.on('data', chunk => {
                        resBody += chunk.toString();
                    });
                    proxyRes.on('end', () => {
                        let parsedResBody;
                        try { parsedResBody = JSON.parse(resBody); } catch (e) { parsedResBody = resBody; }
                        pushLog({ direction: 'out', endpoint: targetUrl, chat_id, statusCode: proxyRes.statusCode, request: payload, response: parsedResBody });

                        res.writeHead(proxyRes.statusCode, {
                            'Content-Type': proxyRes.headers['content-type'] || 'application/json',
                            'Access-Control-Allow-Origin': '*'
                        });
                        res.end(resBody);
                    });
                });

                proxyReq.on('error', (err) => {
                    console.error('[Proxy Error]', err);
                    const errResponse = { error: true, message: `Falha ao conectar no webhook do n8n: ${err.message}` };
                    pushLog({ direction: 'out', endpoint: targetUrl, chat_id, statusCode: 502, request: payload, response: errResponse });
                    res.writeHead(502, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify(errResponse));
                });

                proxyReq.write(postData);
                proxyReq.end();

            } catch (e) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: true, message: 'Invalid JSON payload' }));
            }
        });
        return;
    }

    // --- Endpoint 4: Standard Local Mock Endpoint ---
    // URL: POST http://localhost:3000/api/mock-workflow
    if (req.url === '/api/mock-workflow' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => {
            body += chunk.toString();
        });
        
        req.on('end', () => {
            try {
                let rawPayload = JSON.parse(body);
                // Unwrap array if needed
                const payload = Array.isArray(rawPayload) ? rawPayload[0] : rawPayload;
                
                console.log(`[Workflow Request Received] Chat: ${payload.chat_id} | Message: "${payload.message}"`);

                // Generate contextual responses based on message keywords
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

                // Add workflow hint info if present
                if (payload.meta?.extra?.workflow_hint) {
                    responseJson.reply += `\n\n💡 [Workflow Hint detectado: "${payload.meta.extra.workflow_hint}" | Acao disparada: Roteamento inteligente]`;
                }

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(responseJson, null, 2));

            } catch (err) {
                console.error('[Error processing request]', err);
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: true, message: 'Invalid JSON payload' }));
            }
        });
        return;
    }

    // Helper function to escape HTML
    function escapeHtml(text) {
        if (!text) return '';
        return String(text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    // Helper function to render error HTML from template
    function renderErrorHtml(jsonError) {
        try {
            const templatePath = path.join(__dirname, 'error.html');
            let html = '';
            if (fs.existsSync(templatePath)) {
                html = fs.readFileSync(templatePath, 'utf8');
            } else {
                html = `
                <!DOCTYPE html>
                <html>
                <head><title>Erro no Workflow</title></head>
                <body style="font-family:sans-serif;background:#0f172a;color:#f8fafc;padding:2rem;">
                    <h1 style="color:#ef4444;">Erro no Workflow</h1>
                    <p><strong>Workflow:</strong> {{WORKFLOW_NAME}}</p>
                    <p><strong>Nó:</strong> {{NODE_NAME}}</p>
                    <p><strong>Erro:</strong> {{ERROR_MESSAGE}}</p>
                </body>
                </html>`;
            }
            if (!jsonError) {
                return html
                    .replace(/{{WORKFLOW_NAME}}/g, '-')
                    .replace(/{{NODE_NAME}}/g, '-')
                    .replace(/{{TIMESTAMP}}/g, '-')
                    .replace(/{{ERROR_MESSAGE}}/g, 'Nenhum erro registrado em memória neste servidor ainda. Experimente simular um erro!')
                    .replace(/{{RAW_JSON}}/g, '{"status": "idle"}');
            }
            return html
                .replace(/{{WORKFLOW_NAME}}/g, escapeHtml(jsonError.workflowName))
                .replace(/{{NODE_NAME}}/g, escapeHtml(jsonError.nodeName))
                .replace(/{{TIMESTAMP}}/g, escapeHtml(jsonError.timestamp))
                .replace(/{{ERROR_MESSAGE}}/g, escapeHtml(jsonError.errorMessage))
                .replace(/{{RAW_JSON}}/g, escapeHtml(JSON.stringify(jsonError.raw || jsonError, null, 2)));
        } catch (e) {
            return `<h1>Erro interno ao renderizar template: ${escapeHtml(e.message)}</h1>`;
        }
    }

    // --- Endpoint: Get last error JSON ---
    // URL: GET http://localhost:3000/api/last-error
    if (req.url === '/api/last-error' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(lastJsonError || { status: "idle", message: "Nenhum erro registrado" }, null, 2));
        return;
    }

    // --- Endpoint: Serve beautiful error page ---
    // URL: GET http://localhost:3000/error
    if (req.url === '/error' && req.method === 'GET') {
        if (lastHtmlError) {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=UTF-8' });
            res.end(lastHtmlError);
        } else {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=UTF-8' });
            res.end(renderErrorHtml(lastJsonError));
        }
        return;
    }

    // --- Endpoint: Receive and process error reports ---
    // URL: POST http://localhost:3000/api/error OR POST http://localhost:3000/error
    if ((req.url === '/api/error' || req.url === '/error') && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => {
            body += chunk.toString();
        });
        req.on('end', () => {
            const contentType = req.headers['content-type'] || '';
            const acceptHeader = req.headers['accept'] || '';
            
            // Check if body is raw HTML
            const isHtml = body.trim().startsWith('<') || contentType.includes('text/html');
            
            if (isHtml) {
                lastHtmlError = body;
                lastJsonError = null;
                console.log(`\n🚨 [Erro de Workflow Recebido - HTML cru]`);
                
                if (acceptHeader.includes('application/json')) {
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: true, type: 'html' }));
                } else {
                    res.writeHead(200, { 'Content-Type': 'text/html; charset=UTF-8' });
                    res.end(body);
                }
            } else {
                // Handle JSON
                try {
                    let payload;
                    try {
                        payload = JSON.parse(body);
                    } catch (e) {
                        // If parsing failed but it has key-value structure, or it's a raw string
                        payload = { mensagem: body };
                    }
                    
                    let workflowName = "Workflow Desconhecido";
                    let nodeName = "Nó Desconhecido";
                    let errorMessage = "";
                    
                    const msg = payload.mensagem || payload.message;
                    
                    if (msg && typeof msg === 'string') {
                        // Parse parameters from formatted markdown string
                        const wfMatch = msg.match(/\*Workflow:\*\s*([^\n]+)/i);
                        const nodeMatch = msg.match(/\*Nó:\*\s*([^\n]+)/i) || msg.match(/\*Node:\*\s*([^\n]+)/i);
                        const errMatch = msg.match(/\*Erro:\*\s*([\s\S]+)/i) || msg.match(/\*Error:\*\s*([\s\S]+)/i);
                        
                        if (wfMatch) workflowName = wfMatch[1].trim();
                        if (nodeMatch) nodeName = nodeMatch[1].trim();
                        if (errMatch) errorMessage = errMatch[1].trim();
                        else errorMessage = msg;
                    } else if (payload.workflow || payload.execution) {
                        // Parse from structured n8n error object
                        if (payload.workflow && payload.workflow.name) {
                            workflowName = payload.workflow.name;
                        }
                        if (payload.execution) {
                            if (payload.execution.lastNodeExecuted) {
                                nodeName = payload.execution.lastNodeExecuted;
                            }
                            if (payload.execution.error && payload.execution.error.message) {
                                errorMessage = payload.execution.error.message;
                            }
                        }
                    } else {
                        // Try direct fields
                        if (payload.workflowName) workflowName = payload.workflowName;
                        if (payload.nodeName) nodeName = payload.nodeName;
                        if (payload.errorMessage) errorMessage = payload.errorMessage;
                        if (!payload.workflowName && !payload.nodeName && !payload.errorMessage) {
                            errorMessage = JSON.stringify(payload);
                        }
                    }
                    
                    lastJsonError = {
                        workflowName,
                        nodeName,
                        errorMessage,
                        timestamp: new Date().toISOString(),
                        raw: payload
                    };
                    lastHtmlError = null;
                    
                    console.log(`\n🚨 [Erro de Workflow Recebido - JSON]`);
                    console.log(`💻 Workflow: ${workflowName}`);
                    console.log(`📍 Nó: ${nodeName}`);
                    console.log(`❌ Erro: ${errorMessage}\n`);
                    
                    if (acceptHeader.includes('application/json')) {
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: true, error: lastJsonError }));
                    } else {
                        res.writeHead(200, { 'Content-Type': 'text/html; charset=UTF-8' });
                        res.end(renderErrorHtml(lastJsonError));
                    }
                } catch (err) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: true, message: 'Invalid payload or format: ' + err.message }));
                }
            }
        });
        return;
    }

    // --- Static File Server ---
    let filePath = req.url === '/' ? '/index.html' : req.url;
    // Prevent directory traversal attacks
    filePath = path.normalize(filePath).replace(/^(\.\.[\/\\])+/, '');
    const fullPath = path.join(__dirname, filePath);

    // Check if path is within directory
    if (!fullPath.startsWith(__dirname)) {
        res.writeHead(403);
        res.end('Acesso Negado');
        return;
    }

    const ext = path.extname(fullPath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    fs.readFile(fullPath, (err, content) => {
        if (err) {
            if (err.code === 'ENOENT') {
                res.writeHead(404, { 'Content-Type': 'text/html' });
                res.end('<h1>404 Arquivo Nao Encontrado</h1>');
            } else {
                res.writeHead(500);
                res.end(`Erro no servidor: ${err.code}`);
            }
        } else {
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(content, 'utf-8');
        }
    });
});

server.listen(PORT, () => {
    console.log(`\n🚀 Lara Leads Chat Sandbox rodando com sucesso!`);
    console.log(`👉 Acesse no navegador: http://localhost:${PORT}`);
    console.log(`🔌 Webhook Teste do Workflow: http://localhost:${PORT}/api/mock-workflow`);
    console.log(`🔌 Webhook de Resposta n8n (Async Callback): http://localhost:${PORT}/api/callback`);
    console.log(`💰 Webhook de Custo em Tempo Real: http://localhost:${PORT}/api/cost\n`);
});

