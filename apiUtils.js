// Helpers compartilhados pelas funções serverless em /api (deploy no Vercel). Fica na
// raiz do projeto (não dentro de /api) de propósito — qualquer arquivo dentro de /api
// vira uma rota própria no Vercel, então código compartilhado precisa morar fora dali.

function applyCors(res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    // Sem isso, o Vercel Edge pode devolver 304 (Not Modified) pra uma resposta JSON
    // dinâmica — o fetch() do front quebra ao tentar dar .json() num corpo vazio
    // quando o navegador não tem o 200 original em cache local pra reaproveitar.
    res.setHeader('Cache-Control', 'no-store');
}

// Aplica CORS e resolve o preflight OPTIONS. Retorna true se a requisição já foi
// totalmente respondida (o handler deve dar `return` imediatamente nesse caso).
function handleCors(req, res) {
    applyCors(res);
    if (req.method === 'OPTIONS') {
        res.status(204).end();
        return true;
    }
    return false;
}

// O runtime Node do Vercel já faz o parse de JSON em req.body pra Content-Type
// application/json — mas cai pra string/Buffer/undefined em outros casos (ou se o
// header vier ausente/errado). Normaliza tudo isso pra um objeto plano.
function getJsonBody(req) {
    if (req.body == null) return {};
    if (typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
    try {
        return JSON.parse(req.body.toString());
    } catch (e) {
        return {};
    }
}

// Query string via WHATWG URL API — mesma técnica usada em server.js (local) e mais
// confiável, nesse projeto, do que depender de req.query populado pelo runtime.
function getSearchParams(req) {
    return new URL(req.url, `http://${req.headers.host || 'localhost'}`).searchParams;
}

// Path sem a query string (pra rotas dinâmicas, tipo api/leads-cadencia/[id]/detail.js,
// que precisam extrair o :id da URL) — mesma cautela: não confia em req.query.id.
function getPathname(req) {
    return new URL(req.url, `http://${req.headers.host || 'localhost'}`).pathname;
}

module.exports = { applyCors, handleCors, getJsonBody, getSearchParams, getPathname };
