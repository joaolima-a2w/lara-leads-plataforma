// Lista de contatos (decisores) para a tela "Contatos". Cruza com lead_cadencias
// pra mostrar se aquele contato já está em alguma cadência (e qual), sem precisar
// de FK reconhecida pelo PostgREST.
const { supabaseAdmin } = require('./supabaseClient');
const { mapRespondido } = require('./leadsCadenciaApi');

async function getDecisoresStats() {
    // As 4 contagens são independentes entre si — rodar em paralelo custa 1 round-trip
    // em vez de 4 (cada round-trip pro Supabase custa ~1-1.5s neste ambiente).
    const [
        { count: total, error: e1 },
        { count: emailVerificado, error: e2 },
        { count: telefoneVerificado, error: e3 },
        { count: emCadencia, error: e4 }
    ] = await Promise.all([
        supabaseAdmin.from('decisores').select('*', { count: 'exact', head: true }),
        supabaseAdmin.from('decisores').select('*', { count: 'exact', head: true }).eq('email_verificado', true),
        supabaseAdmin.from('decisores').select('*', { count: 'exact', head: true }).eq('telefone_verificado', true),
        supabaseAdmin.from('lead_cadencias').select('decisor_id', { count: 'exact', head: true }).eq('status', 'ativo')
    ]);
    if (e1) throw new Error(e1.message);
    if (e2) throw new Error(e2.message);
    if (e3) throw new Error(e3.message);
    if (e4) throw new Error(e4.message);

    return {
        total_contatos: total || 0,
        email_verificado: emailVerificado || 0,
        telefone_verificado: telefoneVerificado || 0,
        em_cadencia: emCadencia || 0
    };
}

async function getDecisores({ page = 1, pageSize = 20, search = '' } = {}) {
    // "name" vem como string vazia (não NULL) pra quem ainda não tem nome
    // resolvido — o "NULLS LAST" do Postgres/PostgREST não pega esse caso, e a
    // ordenação por coluna do PostgREST não aceita expressão (tipo NULLIF).
    // Como a tabela é pequena (algumas centenas de linhas), é mais simples
    // trazer tudo que bate no filtro e ordenar/paginar aqui.
    let query = supabaseAdmin
        .from('decisores')
        .select('id,name,title,company,company_domain,url,work_email,email_verificado,phone_number,telefone_verificado', { count: 'exact' });

    if (search) query = query.or(`name.ilike.%${search}%,company.ilike.%${search}%,title.ilike.%${search}%`);

    const { data: allDecisores, error, count } = await query;
    if (error) throw new Error(`Falha ao buscar decisores: ${error.message}`);

    allDecisores.sort((a, b) => {
        const aEmpty = !a.name || !a.name.trim();
        const bEmpty = !b.name || !b.name.trim();
        if (aEmpty !== bEmpty) return aEmpty ? 1 : -1;
        if (aEmpty && bEmpty) return 0;
        return a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' });
    });

    const from = (page - 1) * pageSize;
    const decisores = allDecisores.slice(from, from + pageSize);

    const ids = decisores.map(d => d.id);
    let cadenciaByDecisor = new Map();
    if (ids.length > 0) {
        const { data: cadencias, error: cadErr } = await supabaseAdmin
            .from('lead_cadencias')
            .select('id,decisor_id,status,iniciado_em,respondido_wpp,respondido_email,respondido_linkedin')
            .in('decisor_id', ids)
            .order('iniciado_em', { ascending: false });
        if (cadErr) throw new Error(`Falha ao buscar cadências dos contatos: ${cadErr.message}`);
        (cadencias || []).forEach(c => {
            if (!cadenciaByDecisor.has(c.decisor_id)) cadenciaByDecisor.set(c.decisor_id, c);
        });
    }

    const rows = decisores.map(d => {
        const cadencia = cadenciaByDecisor.get(d.id) || null;
        return {
            id: d.id,
            name: d.name,
            title: d.title,
            company: d.company,
            company_domain: d.company_domain,
            linkedin_url: d.url,
            work_email: d.work_email,
            email_verificado: d.email_verificado,
            phone_number: d.phone_number,
            telefone_verificado: d.telefone_verificado,
            // "respondido" é independente de status — um lead pode estar "ativo" (ou
            // qualquer outra fase, mesmo pausado) e já ter respondido por um ou mais
            // canais ao mesmo tempo.
            em_cadencia: cadencia ? {
                lead_cadencia_id: cadencia.id,
                status: cadencia.status,
                respondido: mapRespondido(cadencia)
            } : null
        };
    });

    return { rows, total: count || 0, page, pageSize };
}

module.exports = { getDecisores, getDecisoresStats };
