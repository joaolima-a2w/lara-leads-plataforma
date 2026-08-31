// Monta os dados da tela "Meus Leads em Cadência" a partir do banco real.
//
// O schema não tem uma view/join pronta pra isso, então buscamos lead_cadencias
// paginado e resolvemos as referências (decisor, cadência, etapas, responsável)
// em memória a partir dos ids coletados — evita depender de foreign keys
// reconhecidas pelo PostgREST pra fazer embed automático.
const { supabaseAdmin } = require('./supabaseClient');

// Mapeamento dos status crus da coluna lead_cadencias.status pros badges exibidos.
// Hoje só existem "ativo" e "pending" na base — os outros nomes (pausado/cancelado/
// finalizado) são o que o resto do produto já usa em outros lugares (chats.status),
// mantidos aqui por consistência para quando existirem.
const STATUS_MAP = {
    ativo: { label: 'Em Andamento', tone: 'info' },
    pending: { label: 'Pendente', tone: 'warning' },
    pausado: { label: 'Pausado', tone: 'neutral' },
    cancelado: { label: 'Cancelado', tone: 'danger' },
    finalizado: { label: 'Concluído', tone: 'success' },
    // Setado pelo próprio workflow n8n quando a etapa atual exige uma ação manual
    // (hoje só a ligação/LIGACAO) — o usuário resolve na tela de detalhe do lead
    // com o botão "Tarefa Manual Concluída", que devolve o status pra "ativo".
    manual: { label: 'Ação Manual Pendente', tone: 'warning' },
    // O status mais importante pro usuário — setado pelo n8n quando o lead responde a
    // uma mensagem enviada. Tom próprio ("accent", a cor de marca) pra se destacar de
    // todos os outros; também prioriza a linha na lista e conta separado no dashboard
    // (ver getLeadsCadenciaStats/getLeadsCadencia).
    respondido: { label: 'Respondido', tone: 'accent' }
};

// Status que ganham prioridade no topo da lista, independente da ordenação normal por
// data — hoje só "respondido" (é o sinal mais acionável pro usuário: alguém está
// esperando um retorno).
const PRIORITY_STATUSES = new Set(['respondido']);

function mapStatus(rawStatus, finalizadoEm) {
    if (finalizadoEm) return { raw: rawStatus, label: 'Concluído', tone: 'success' };
    const known = STATUS_MAP[rawStatus];
    if (known) return { raw: rawStatus, ...known };
    return { raw: rawStatus, label: rawStatus || 'Sem status', tone: 'neutral' };
}

// Índice auxiliar: busca em lote por uma lista de ids/keys e devolve um Map id -> row.
async function fetchByIds(table, column, ids, selectCols = '*') {
    const uniqueIds = [...new Set(ids.filter(Boolean))];
    if (uniqueIds.length === 0) return new Map();
    const { data, error } = await supabaseAdmin.from(table).select(selectCols).in(column, uniqueIds);
    if (error) throw new Error(`Falha ao buscar ${table}: ${error.message}`);
    return new Map(data.map(row => [row[column], row]));
}

async function getLeadsCadencia({ page = 1, pageSize = 20, search = '', status = '' } = {}) {
    // Sem paginação no banco aqui de propósito: leads com status "respondido" precisam
    // furar a fila e aparecer primeiro, não dá pra fazer isso com um .order() simples do
    // PostgREST (não é uma coluna, é uma prioridade condicional). A tabela é pequena o
    // suficiente (poucas centenas de linhas) pra ordenar/paginar em memória sem problema.
    let query = supabaseAdmin
        .from('lead_cadencias')
        .select('*');

    if (status) query = query.eq('status', status);
    if (search) query = query.ilike('lead_name', `%${search}%`);

    const { data: allLeadCadencias, error } = await query;
    if (error) throw new Error(`Falha ao buscar lead_cadencias: ${error.message}`);

    allLeadCadencias.sort((a, b) => {
        const aPriority = PRIORITY_STATUSES.has(a.status);
        const bPriority = PRIORITY_STATUSES.has(b.status);
        if (aPriority !== bPriority) return aPriority ? -1 : 1;
        return new Date(b.iniciado_em) - new Date(a.iniciado_em);
    });

    const count = allLeadCadencias.length;
    const from = (page - 1) * pageSize;
    const leadCadencias = allLeadCadencias.slice(from, from + pageSize);

    const decisorIds = leadCadencias.map(l => l.decisor_id);
    const cadenciaIds = leadCadencias.map(l => l.cadencia_id);
    const requestingUsers = leadCadencias.map(l => l.requestingUser);

    const [decisoresMap, cadenciasMap, usersMap] = await Promise.all([
        fetchByIds('decisores', 'id', decisorIds, 'id,name,title,company,company_domain'),
        fetchByIds('cadencias', 'id', cadenciaIds, 'id,nome,descricao'),
        fetchByIds('users', 'user_id', requestingUsers, 'user_id,nome')
    ]);

    // Etapas: busca todas as etapas das cadências envolvidas de uma vez (uma cadência
    // tem só ~12 linhas) e indexa por "cadencia_id::etapa_cadencia" pra achar tanto a
    // etapa atual quanto a próxima sem uma query por linha.
    const uniqueCadenciaIds = [...new Set(cadenciaIds.filter(Boolean))];
    let stagesByKey = new Map();
    let totalStagesByCadencia = new Map();
    if (uniqueCadenciaIds.length > 0) {
        const { data: stages, error: stagesErr } = await supabaseAdmin
            .from('cadence_stages')
            .select('cadencia_id,etapa_cadencia,dia_referencia,nome_interacao,canais_aplicaveis')
            .in('cadencia_id', uniqueCadenciaIds);
        if (stagesErr) throw new Error(`Falha ao buscar cadence_stages: ${stagesErr.message}`);
        stages.forEach(s => {
            stagesByKey.set(`${s.cadencia_id}::${s.etapa_cadencia}`, s);
            totalStagesByCadencia.set(s.cadencia_id, (totalStagesByCadencia.get(s.cadencia_id) || 0) + 1);
        });
    }

    const rows = leadCadencias.map(lc => {
        const decisor = decisoresMap.get(lc.decisor_id) || null;
        const cadencia = cadenciasMap.get(lc.cadencia_id) || null;
        const responsavel = usersMap.get(lc.requestingUser);
        const etapaAtual = stagesByKey.get(`${lc.cadencia_id}::${lc.etapa_atual}`) || null;
        const proximaEtapa = stagesByKey.get(`${lc.cadencia_id}::${lc.proxima_etapa}`) || null;

        return {
            id: lc.id,
            conta: decisor?.company || '—',
            lead_name: lc.lead_name || decisor?.name || '—',
            lead_title: decisor?.title || null,
            cadencia: {
                nome: cadencia?.nome || '—',
                total_etapas: totalStagesByCadencia.get(lc.cadencia_id) || null
            },
            etapa_atual: etapaAtual
                ? { numero: lc.etapa_atual, nome: etapaAtual.nome_interacao, dia: etapaAtual.dia_referencia }
                : { numero: lc.etapa_atual, nome: null, dia: null },
            proxima_etapa: proximaEtapa
                ? { numero: lc.proxima_etapa, nome: proximaEtapa.nome_interacao, dia: proximaEtapa.dia_referencia }
                : { numero: lc.proxima_etapa, nome: null, dia: null },
            // requestingUser hoje é dado de teste ("user_teste_001") que não bate com
            // nenhum users.user_id real — cai pro texto bruto até existir de fato.
            responsavel: responsavel?.nome || lc.requestingUser || '—',
            // Sem touchpoints ainda (tabela vazia) — usa a última data de atividade que
            // realmente existe hoje. Troque para MAX(touchpoints.enviado_em) assim que
            // essa tabela começar a ser populada pelos workflows.
            atualizado_em: lc.finalizado_em || lc.proxima_data_envio || lc.iniciado_em,
            status: mapStatus(lc.status, lc.finalizado_em),
            proxima_data_envio: lc.proxima_data_envio
        };
    });

    return { rows, total: count || 0, page, pageSize };
}

// Estatísticas dos cards do topo. Só calcula o que é honestamente derivável do schema
// atual — não existe conceito de "aprovação" nas tabelas ainda, então esse card fica
// como null (o front mostra "—") em vez de inventar um número.
async function getLeadsCadenciaStats() {
    // As 5 primeiras queries são independentes entre si — rodar em paralelo custa 1
    // round-trip em vez de 5 (cada round-trip pro Supabase custa ~1-1.5s neste ambiente).
    const [
        { count: totalContatos, error: e1 },
        { count: etapasEmAndamento, error: e2 },
        { count: pendentes, error: e3 },
        // "Ações manuais até hoje" tem duas fontes que se somam:
        // 1) status:"manual" — o sinal definitivo, setado pelo próprio n8n quando ele já
        //    processou a etapa e confirmou que ela exige ação manual (ver STATUS_MAP).
        { count: manuaisConfirmados, error: e4 },
        // 2) leads ainda "ativo" cuja etapa atual usa o canal LIGACAO (o único que o
        //    schema documenta como "não automatizado por estes workflows — apoio ao
        //    SDR", ver cadence_stages.estrutura_base) e cuja próxima data de envio já
        //    chegou — heurística pra pegar quem ainda não foi processado pelo n8n mas já
        //    deveria estar aguardando ação manual. Calculado em memória porque filtrar
        //    por array de canal + data cruzando duas tabelas não é uma query trivial de
        //    PostgREST.
        { data: ativos, error: e5 },
        // O status mais importante pro usuário — card próprio, ver STATUS_MAP.
        { count: respondidos, error: e6 }
    ] = await Promise.all([
        supabaseAdmin.from('lead_cadencias').select('*', { count: 'exact', head: true }),
        supabaseAdmin.from('lead_cadencias').select('*', { count: 'exact', head: true }).eq('status', 'ativo'),
        supabaseAdmin.from('lead_cadencias').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
        supabaseAdmin.from('lead_cadencias').select('*', { count: 'exact', head: true }).eq('status', 'manual'),
        supabaseAdmin.from('lead_cadencias').select('cadencia_id,etapa_atual,proxima_data_envio').eq('status', 'ativo'),
        supabaseAdmin.from('lead_cadencias').select('*', { count: 'exact', head: true }).eq('status', 'respondido')
    ]);
    if (e1) throw new Error(e1.message);
    if (e2) throw new Error(e2.message);
    if (e3) throw new Error(e3.message);
    if (e4) throw new Error(e4.message);
    if (e5) throw new Error(e5.message);
    if (e6) throw new Error(e6.message);

    let acoesManuais = manuaisConfirmados || 0;
    if (ativos.length > 0) {
        const cadenciaIds = [...new Set(ativos.map(a => a.cadencia_id).filter(Boolean))];
        const { data: stages, error: stagesErr } = await supabaseAdmin
            .from('cadence_stages')
            .select('cadencia_id,etapa_cadencia,canais_aplicaveis')
            .in('cadencia_id', cadenciaIds);
        if (stagesErr) throw new Error(stagesErr.message);

        const manualStageKeys = new Set(
            stages
                .filter(s => Array.isArray(s.canais_aplicaveis) && s.canais_aplicaveis.includes('LIGACAO'))
                .map(s => `${s.cadencia_id}::${s.etapa_cadencia}`)
        );

        const now = new Date();
        // Soma (não substitui) — os "ativo" pendentes de virar manual são adicionais
        // aos que o n8n já confirmou como status:"manual".
        acoesManuais += ativos.filter(a =>
            manualStageKeys.has(`${a.cadencia_id}::${a.etapa_atual}`) &&
            a.proxima_data_envio &&
            new Date(a.proxima_data_envio) <= now
        ).length;
    }

    return {
        contatos_em_cadencia: totalContatos || 0,
        etapas_em_andamento: etapasEmAndamento || 0,
        acoes_manuais_hoje: acoesManuais,
        pendentes_aprovacao_hoje: pendentes || 0,
        leads_respondidos: respondidos || 0
    };
}

module.exports = { getLeadsCadencia, getLeadsCadenciaStats, mapStatus };
