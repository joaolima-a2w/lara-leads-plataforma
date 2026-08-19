// Lista de contas (empresas buscadas) para a tela "Contas". Cruza com decisores (pra
// mostrar os contatos vinculados) e com companies_searching (pra saber se a empresa
// veio de uma busca via chat — hoje é o único jeito de "origem" que os dados sustentam;
// não há trilha de "manual"/"importação"/"indicação" gravada em lugar nenhum ainda).
const { supabaseAdmin } = require('./supabaseClient');

// select() explícito sempre — companies.find_peoples é um jsonb enorme (perfis
// completos do LinkedIn) que nunca deve ir pro front, só pesaria a resposta à toa.
const COMPANY_COLUMNS = 'id,apollo_organization_id,nome,dominio,site,segmento,city,state,country,status,criado_em,atualizado_em';

async function getContasStats() {
    const { data: statusRows, error } = await supabaseAdmin.from('companies').select('status');
    if (error) throw new Error(`Falha ao buscar estatísticas de contas: ${error.message}`);

    const counts = { enriched: 0, pending: 0, 'not enriched': 0 };
    statusRows.forEach(r => { counts[r.status] = (counts[r.status] || 0) + 1; });

    return {
        total_contas: statusRows.length,
        enriquecidas: counts['enriched'] || 0,
        pendentes: counts['pending'] || 0,
        nao_enriquecidas: counts['not enriched'] || 0
    };
}

async function getContas({ page = 1, pageSize = 20, search = '', status = '' } = {}) {
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    let query = supabaseAdmin
        .from('companies')
        .select(COMPANY_COLUMNS, { count: 'exact' })
        .order('atualizado_em', { ascending: false })
        .range(from, to);

    if (search) query = query.or(`nome.ilike.%${search}%,dominio.ilike.%${search}%,segmento.ilike.%${search}%`);
    if (status) query = query.eq('status', status);

    const { data: companies, error, count } = await query;
    if (error) throw new Error(`Falha ao buscar contas: ${error.message}`);

    const orgIds = companies.map(c => c.apollo_organization_id).filter(Boolean);

    let decisoresByOrg = new Map();
    let searchingOrgIds = new Set();
    if (orgIds.length > 0) {
        const [{ data: decisores, error: decErr }, { data: searching, error: searchErr }] = await Promise.all([
            supabaseAdmin.from('decisores').select('company_id,name').in('company_id', orgIds),
            supabaseAdmin.from('companies_searching').select('apollo_organization_id').in('apollo_organization_id', orgIds)
        ]);
        if (decErr) throw new Error(`Falha ao buscar contatos vinculados: ${decErr.message}`);
        if (searchErr) throw new Error(`Falha ao buscar origem das contas: ${searchErr.message}`);

        (decisores || []).forEach(d => {
            if (!decisoresByOrg.has(d.company_id)) decisoresByOrg.set(d.company_id, []);
            if (d.name) decisoresByOrg.get(d.company_id).push(d.name);
        });
        searchingOrgIds = new Set((searching || []).map(s => s.apollo_organization_id));
    }

    const STATUS_MAP = {
        enriched: { label: 'Enriquecida', tone: 'success' },
        pending: { label: 'Pendente', tone: 'warning' },
        'not enriched': { label: 'Não enriquecida', tone: 'neutral' }
    };

    const rows = companies.map(c => {
        const contatos = decisoresByOrg.get(c.apollo_organization_id) || [];
        const statusInfo = STATUS_MAP[c.status] || { label: c.status || 'Sem status', tone: 'neutral' };
        return {
            id: c.id,
            nome: c.nome,
            segmento: c.segmento,
            regiao: [c.city, c.state, c.country].filter(Boolean).join(', ') || null,
            site: c.site || (c.dominio ? `https://${c.dominio}` : null),
            dominio: c.dominio,
            contatos_vinculados: contatos,
            // 100% das contas hoje vêm de uma busca via chat (companies_searching) — não
            // existe, ainda, nenhuma trilha de conta criada manualmente/importada.
            origem: searchingOrgIds.has(c.apollo_organization_id) ? 'Chat Lara' : 'Manual',
            atualizado_em: c.atualizado_em,
            status: statusInfo
        };
    });

    return { rows, total: count || 0, page, pageSize };
}

module.exports = { getContas, getContasStats };
