// Recebe erros de workflow (POST) e serve a página de erro formatada (GET). Fica fora
// do catch-all api/[...path].js porque também precisa responder em "/error" (sem o
// prefixo /api) — vercel.json reescreve esse caminho pra esta mesma função.
const fs = require('fs');
const path = require('path');
const sandboxStore = require('../sandboxStore');
const { handleCors } = require('../apiUtils');

function escapeHtml(text) {
    if (!text) return '';
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function renderErrorHtml(jsonError) {
    try {
        const templatePath = path.join(__dirname, '..', 'error.html');
        let html = fs.existsSync(templatePath)
            ? fs.readFileSync(templatePath, 'utf8')
            : `<!DOCTYPE html><html><head><title>Erro no Workflow</title></head>
               <body style="font-family:sans-serif;background:#0f172a;color:#f8fafc;padding:2rem;">
               <h1 style="color:#ef4444;">Erro no Workflow</h1>
               <p><strong>Workflow:</strong> {{WORKFLOW_NAME}}</p>
               <p><strong>Nó:</strong> {{NODE_NAME}}</p>
               <p><strong>Erro:</strong> {{ERROR_MESSAGE}}</p></body></html>`;

        if (!jsonError) {
            return html
                .replace(/{{WORKFLOW_NAME}}/g, '-')
                .replace(/{{NODE_NAME}}/g, '-')
                .replace(/{{TIMESTAMP}}/g, '-')
                .replace(/{{ERROR_MESSAGE}}/g, 'Nenhum erro registrado ainda. Experimente simular um erro!')
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

module.exports = async (req, res) => {
    if (handleCors(req, res)) return;

    if (req.method === 'GET') {
        const last = await sandboxStore.getLastError();
        if (last && last.kind === 'html') {
            res.setHeader('Content-Type', 'text/html; charset=UTF-8');
            return res.status(200).send(last.html);
        }
        res.setHeader('Content-Type', 'text/html; charset=UTF-8');
        return res.status(200).send(renderErrorHtml(last && last.kind === 'json' ? last.payload : null));
    }

    if (req.method === 'POST') {
        // Vercel's Node runtime hands back a string for text/plain, a Buffer for anything
        // else it doesn't recognize (e.g. raw text/html from n8n), or an already-parsed
        // object for application/json — normalize all three into one plain string.
        let body = req.body;
        if (Buffer.isBuffer(body)) body = body.toString('utf8');
        else if (typeof body !== 'string') body = JSON.stringify(body ?? '');
        const contentType = req.headers['content-type'] || '';
        const acceptHeader = req.headers['accept'] || '';
        const isHtml = body.trim().startsWith('<') || contentType.includes('text/html');

        if (isHtml) {
            await sandboxStore.setHtmlError(body);
            if (acceptHeader.includes('application/json')) {
                return res.status(200).json({ success: true, type: 'html' });
            }
            res.setHeader('Content-Type', 'text/html; charset=UTF-8');
            return res.status(200).send(body);
        }

        try {
            let payload;
            try {
                payload = JSON.parse(body);
            } catch (e) {
                payload = { mensagem: body };
            }

            let workflowName = 'Workflow Desconhecido';
            let nodeName = 'Nó Desconhecido';
            let errorMessage = '';
            const msg = payload.mensagem || payload.message;

            if (msg && typeof msg === 'string') {
                const wfMatch = msg.match(/\*Workflow:\*\s*([^\n]+)/i);
                const nodeMatch = msg.match(/\*Nó:\*\s*([^\n]+)/i) || msg.match(/\*Node:\*\s*([^\n]+)/i);
                const errMatch = msg.match(/\*Erro:\*\s*([\s\S]+)/i) || msg.match(/\*Error:\*\s*([\s\S]+)/i);
                if (wfMatch) workflowName = wfMatch[1].trim();
                if (nodeMatch) nodeName = nodeMatch[1].trim();
                errorMessage = errMatch ? errMatch[1].trim() : msg;
            } else if (payload.workflow || payload.execution) {
                if (payload.workflow?.name) workflowName = payload.workflow.name;
                if (payload.execution?.lastNodeExecuted) nodeName = payload.execution.lastNodeExecuted;
                if (payload.execution?.error?.message) errorMessage = payload.execution.error.message;
            } else {
                if (payload.workflowName) workflowName = payload.workflowName;
                if (payload.nodeName) nodeName = payload.nodeName;
                if (payload.errorMessage) errorMessage = payload.errorMessage;
                if (!payload.workflowName && !payload.nodeName && !payload.errorMessage) errorMessage = JSON.stringify(payload);
            }

            const jsonError = { workflowName, nodeName, errorMessage, timestamp: new Date().toISOString(), raw: payload };
            await sandboxStore.setJsonError(jsonError);

            if (acceptHeader.includes('application/json')) {
                return res.status(200).json({ success: true, error: jsonError });
            }
            res.setHeader('Content-Type', 'text/html; charset=UTF-8');
            return res.status(200).send(renderErrorHtml(jsonError));
        } catch (err) {
            return res.status(400).json({ error: true, message: 'Invalid payload or format: ' + err.message });
        }
    }

    return res.status(405).json({ error: true, message: 'Método não suportado.' });
};
