// Substituto, para o deploy no Vercel, dos armazenamentos em memória que o server.js usa
// localmente (pendingResponses/activeStatuses/chatCosts/requestLogs/lastJsonError/
// lastHtmlError). Funções serverless não compartilham memória entre invocações, então
// esse estado precisa morar em algum lugar persistente — aqui, no Supabase (tabelas
// criadas por supabase_setup_vercel.sql). Usado só pelas funções em /api (Vercel);
// o server.js local continua com as versões em memória, mais simples pra desenvolvimento.
const { supabaseAdmin } = require('./supabaseClient');

// --- Mensagens assíncronas (fila consume-on-read, equivalente a pendingResponses) ---

async function queueMessage(chatId, responseMsg) {
    const { error } = await supabaseAdmin.from('sandbox_messages').insert({
        chat_id: chatId,
        message_id: responseMsg.message_id,
        reply: responseMsg.reply,
        status: responseMsg.status,
        next_action: responseMsg.next_action,
        raw_payload: responseMsg.raw_payload
    });
    if (error) throw new Error(`Falha ao enfileirar mensagem: ${error.message}`);

    // Uma resposta nova sempre substitui qualquer legenda de status anterior — mesma
    // regra do server.js local (`delete activeStatuses[chat_id]` em /api/callback).
    await clearStatus(chatId);
}

async function consumeMessages(chatId) {
    const { data, error } = await supabaseAdmin
        .from('sandbox_messages')
        .select('id,message_id,reply,status,next_action,raw_payload,created_at')
        .eq('chat_id', chatId)
        .eq('consumed', false)
        .order('created_at', { ascending: true });
    if (error) throw new Error(`Falha ao ler mensagens: ${error.message}`);
    if (!data || data.length === 0) return [];

    const ids = data.map(row => row.id);
    const { error: updateErr } = await supabaseAdmin.from('sandbox_messages').update({ consumed: true }).in('id', ids);
    if (updateErr) throw new Error(`Falha ao marcar mensagens como lidas: ${updateErr.message}`);

    return data.map(row => ({
        message_id: row.message_id,
        reply: row.reply,
        status: row.status,
        timestamp: row.created_at,
        next_action: row.next_action,
        raw_payload: row.raw_payload
    }));
}

// --- Estado atual (status/custo) por chat — 1 linha por chat_id, sempre sobrescrita ---

async function getChatState(chatId) {
    const { data, error } = await supabaseAdmin
        .from('sandbox_chat_state')
        .select('status_text,status_progress,cost_total,cost_currency')
        .eq('chat_id', chatId)
        .maybeSingle();
    if (error) throw new Error(`Falha ao ler estado do chat: ${error.message}`);
    return {
        status: { text: data?.status_text ?? null, progress: data?.status_progress ?? null },
        cost: { total: data?.cost_total ?? 0, currency: data?.cost_currency ?? 'BRL' }
    };
}

async function setStatus(chatId, text, progress) {
    const { error } = await supabaseAdmin
        .from('sandbox_chat_state')
        .upsert({ chat_id: chatId, status_text: text, status_progress: progress, updated_at: new Date().toISOString() }, { onConflict: 'chat_id' });
    if (error) throw new Error(`Falha ao salvar status: ${error.message}`);
}

async function clearStatus(chatId) {
    await setStatus(chatId, null, null);
}

async function setCost(chatId, total, currency) {
    // "currency" é opcional na chamada — se não vier, mantém a moeda já salva (ou BRL se
    // não houver nenhuma ainda). Mesma regra do server.js local.
    let resolvedCurrency = currency;
    if (!resolvedCurrency) {
        const { data } = await supabaseAdmin.from('sandbox_chat_state').select('cost_currency').eq('chat_id', chatId).maybeSingle();
        resolvedCurrency = data?.cost_currency || 'BRL';
    }
    const { error } = await supabaseAdmin
        .from('sandbox_chat_state')
        .upsert({ chat_id: chatId, cost_total: total, cost_currency: resolvedCurrency, updated_at: new Date().toISOString() }, { onConflict: 'chat_id' });
    if (error) throw new Error(`Falha ao salvar custo: ${error.message}`);
    return { total, currency: resolvedCurrency };
}

// --- Últimos erros de workflow (JSON estruturado ou HTML cru) ---

async function setJsonError(payload) {
    const { error } = await supabaseAdmin.from('sandbox_errors').insert({ kind: 'json', payload });
    if (error) throw new Error(`Falha ao salvar erro: ${error.message}`);
}

async function setHtmlError(html) {
    const { error } = await supabaseAdmin.from('sandbox_errors').insert({ kind: 'html', html });
    if (error) throw new Error(`Falha ao salvar erro: ${error.message}`);
}

async function getLastError() {
    const { data, error } = await supabaseAdmin
        .from('sandbox_errors')
        .select('kind,payload,html,created_at')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
    if (error) throw new Error(`Falha ao buscar último erro: ${error.message}`);
    return data || null;
}

// --- Log de requisições in/out (tela /logs) ---

async function pushLog(entry) {
    const { error } = await supabaseAdmin.from('sandbox_logs').insert({
        direction: entry.direction,
        endpoint: entry.endpoint,
        chat_id: entry.chat_id || null,
        status_code: entry.statusCode,
        request: entry.request,
        response: entry.response
    });
    if (error) console.error('[sandboxStore] Falha ao salvar log (não bloqueia a resposta):', error.message);
}

async function getLogs({ chatIdFilter, limit = 300 } = {}) {
    let query = supabaseAdmin
        .from('sandbox_logs')
        .select('id,direction,endpoint,chat_id,status_code,request,response,created_at')
        .order('created_at', { ascending: false })
        .limit(limit);
    if (chatIdFilter) query = query.ilike('chat_id', `%${chatIdFilter}%`);

    const { data, error } = await query;
    if (error) throw new Error(`Falha ao buscar logs: ${error.message}`);
    return (data || []).map(row => ({
        id: row.id,
        timestamp: row.created_at,
        direction: row.direction,
        endpoint: row.endpoint,
        chat_id: row.chat_id,
        statusCode: row.status_code,
        request: row.request,
        response: row.response
    }));
}

async function clearLogs() {
    const { error } = await supabaseAdmin.from('sandbox_logs').delete().gte('created_at', '1900-01-01');
    if (error) throw new Error(`Falha ao limpar logs: ${error.message}`);
}

module.exports = {
    queueMessage,
    consumeMessages,
    getChatState,
    setStatus,
    clearStatus,
    setCost,
    setJsonError,
    setHtmlError,
    getLastError,
    pushLog,
    getLogs,
    clearLogs
};
