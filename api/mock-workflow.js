// POST /api/mock-workflow — simulador de workflow no modo "Servidor Local".
const { handleCors, getJsonBody } = require('../apiUtils');

module.exports = async (req, res) => {
    if (handleCors(req, res)) return;
    if (req.method !== 'POST') return res.status(405).json({ error: true, message: 'Método não suportado.' });

    try {
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
    } catch (err) {
        console.error('[api/mock-workflow] Erro inesperado:', err);
        return res.status(400).json({ error: true, message: 'Invalid JSON payload' });
    }
};
