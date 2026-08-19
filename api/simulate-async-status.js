// POST /api/simulate-async-status — demo do fluxo de status progressivo ("Demo Status").
// As atualizações atrasadas usam waitUntil (em vez de setTimeout "solto") porque uma
// função serverless pode ser congelada assim que a resposta é enviada — sem isso, os
// setTimeout nunca chegariam a rodar depois do `return` abaixo.
const sandboxStore = require('../sandboxStore');
const { handleCors, getJsonBody } = require('../apiUtils');
const { waitUntil } = require('@vercel/functions');

module.exports = async (req, res) => {
    if (handleCors(req, res)) return;
    if (req.method !== 'POST') return res.status(405).json({ error: true, message: 'Método não suportado.' });

    try {
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
    } catch (err) {
        console.error('[api/simulate-async-status] Erro inesperado:', err);
        return res.status(500).json({ error: true, message: err.message });
    }
};
