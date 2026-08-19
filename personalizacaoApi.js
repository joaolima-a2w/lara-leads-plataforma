// Tela "Configuração de Setup" — na verdade uma visão sobre a tabela `personalizacao`:
// cada linha é um "setup" (linha de produto/ICP/cadência) configurado para um
// usuário de teste específico. Um mesmo user_id pode ter vários setups (ex.:
// andre_moura_a2w tem um setup pra A2W_PLATAFORMA e outro pra DESPEX).
const { supabaseAdmin } = require('./supabaseClient');

async function getPersonalizacoes(userId) {
    const { data: user, error: userErr } = await supabaseAdmin
        .from('users')
        .select('user_id,nome,tenant_id')
        .eq('user_id', userId)
        .maybeSingle();
    if (userErr) throw new Error(`Falha ao buscar usuário: ${userErr.message}`);
    if (!user) return { user: null, setups: [] };

    // tenant e setups não dependem um do outro (só de `user`) — rodar em paralelo
    // custa 1 round-trip em vez de 2 (cada round-trip pro Supabase custa ~1-1.5s
    // neste ambiente).
    const [
        { data: tenant, error: tenantErr },
        { data: rows, error: setupErr }
    ] = await Promise.all([
        supabaseAdmin.from('tenants').select('tenant_id,tenant_name').eq('tenant_id', user.tenant_id).maybeSingle(),
        supabaseAdmin.from('personalizacao').select('*').eq('user_id', userId).order('created_at', { ascending: true })
    ]);
    if (tenantErr) throw new Error(`Falha ao buscar tenant: ${tenantErr.message}`);
    if (setupErr) throw new Error(`Falha ao buscar setups: ${setupErr.message}`);

    const cadenciaIds = [...new Set((rows || []).map(r => r.cadencia_id).filter(Boolean))];
    let cadenciasMap = new Map();
    if (cadenciaIds.length > 0) {
        const { data: cadencias, error: cadErr } = await supabaseAdmin
            .from('cadencias')
            .select('id,nome,descricao,produto_direcionado,ativo')
            .in('id', cadenciaIds);
        if (cadErr) throw new Error(`Falha ao buscar cadências: ${cadErr.message}`);
        (cadencias || []).forEach(c => cadenciasMap.set(c.id, c));
    }

    const setups = (rows || []).map(row => ({
        id: row.id,
        status: row.status,
        produto_direcionado: row.cadence_config?.produto_direcionado || null,
        assistant_name: row.assistant_name,
        brand_name: row.brand_name,
        voice_tone: row.voice_tone,
        exec_name: row.exec_name,
        exec_role: row.exec_role,
        default_segment: row.default_segment,
        cadencia: cadenciasMap.get(row.cadencia_id) || null,
        icp: row.icp_config?.my_company_kb || null,
        channels_config: row.channels_config || {},
        scripts_config: row.scripts_config || null,
        decisores_prioritarios: row.decisores_prioritarios || [],
        created_at: row.created_at,
        updated_at: row.updated_at
    }));

    return {
        user: { user_id: user.user_id, nome: user.nome, tenant_id: user.tenant_id, tenant_name: tenant?.tenant_name || user.tenant_id },
        setups
    };
}

module.exports = { getPersonalizacoes };
