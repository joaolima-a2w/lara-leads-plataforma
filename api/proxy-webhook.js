// POST /api/proxy-webhook — bypass de CORS pro webhook real.
const sandboxStore = require('../sandboxStore');
const { handleCors, getJsonBody } = require('../apiUtils');

module.exports = async (req, res) => {
    if (handleCors(req, res)) return;
    if (req.method !== 'POST') return res.status(405).json({ error: true, message: 'Método não suportado.' });

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
        console.error('[api/proxy-webhook] Erro inesperado:', err);
        const errResponse = { error: true, message: `Falha ao conectar no webhook do n8n: ${err.message}` };
        await sandboxStore.pushLog({ direction: 'out', endpoint: targetUrl, chat_id, statusCode: 502, request: payload, response: errResponse });
        return res.status(502).json(errResponse);
    }
};
