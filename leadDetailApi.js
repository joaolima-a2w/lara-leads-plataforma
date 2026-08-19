// Monta a tela de detalhe de um lead em cadência: linha do tempo completa das etapas
// (concluídas/atual/pendentes), anotações de "ação"/"feedback" por etapa (tabela
// stage_notes — aditiva, não é escrita pelos workflows n8n) e outros contatos da
// mesma empresa.
const { supabaseAdmin } = require('./supabaseClient');
const { mapStatus } = require('./leadsCadenciaApi');

// Ações que o usuário pode disparar na tela de detalhe do lead — cada uma vira um
// update direto em lead_cadencias.status (e, no caso de "concluir", também marca
// finalizado_em, igual ao resto do produto já assume pra considerar um lead concluído).
const STATUS_ACTIONS = {
    parar: { status: 'cancelado' },
    concluir: { status: 'finalizado', setFinalizadoEm: true },
    // O n8n é quem seta status:"manual" quando a etapa atual exige ação manual
    // (ligação); esse botão só existe pro usuário devolver a cadência pro fluxo
    // automático depois de cumprir a tarefa.
    manual_concluida: { status: 'ativo' }
};

// PostgREST reports a table that doesn't exist yet either as a raw Postgres
// "42P01 does not exist" error (via db.js/pg) or as its own "PGRST205 — Could not
// find the table ... in the schema cache" (via supabase-js) — cover both forms.
function isMissingTableError(error) {
    const message = error.message || '';
    return error.code === '42P01' || error.code === 'PGRST205' ||
        /does not exist/i.test(message) || /could not find the table/i.test(message);
}

function stageStatus(etapaCadencia, etapaAtual, finalizadoEm) {
    if (finalizadoEm) return etapaCadencia <= etapaAtual ? 'concluida' : 'nao_alcancada';
    if (etapaCadencia < etapaAtual) return 'concluida';
    if (etapaCadencia === etapaAtual) return 'atual';
    return 'pendente';
}

// stage_notes é uma tabela nova (opcional) — se ainda não foi criada no banco,
// tratamos como "sem anotações ainda" em vez de derrubar a tela inteira.
async function fetchStageNotesSafe(leadCadenciaId) {
    const { data, error } = await supabaseAdmin
        .from('stage_notes')
        .select('etapa_cadencia,acao,feedback,updated_at')
        .eq('lead_cadencia_id', leadCadenciaId);
    if (error) {
        if (isMissingTableError(error)) return [];
        throw new Error(`Falha ao buscar stage_notes: ${error.message}`);
    }
    return data || [];
}

async function getLeadDetail(leadCadenciaId) {
    const { data: lead, error: leadErr } = await supabaseAdmin
        .from('lead_cadencias')
        .select('*')
        .eq('id', leadCadenciaId)
        .maybeSingle();
    if (leadErr) throw new Error(`Falha ao buscar lead_cadencia: ${leadErr.message}`);
    if (!lead) return null;

    const [{ data: decisor, error: decErr }, { data: cadencia, error: cadErr }] = await Promise.all([
        supabaseAdmin.from('decisores').select('*').eq('id', lead.decisor_id).maybeSingle(),
        supabaseAdmin.from('cadencias').select('*').eq('id', lead.cadencia_id).maybeSingle()
    ]);
    if (decErr) throw new Error(`Falha ao buscar decisor: ${decErr.message}`);
    if (cadErr) throw new Error(`Falha ao buscar cadencia: ${cadErr.message}`);

    const [{ data: stages, error: stagesErr }, { data: touchpoints, error: touchErr }, notes, { data: responsavel }] = await Promise.all([
        supabaseAdmin.from('cadence_stages').select('*').eq('cadencia_id', lead.cadencia_id).order('etapa_cadencia', { ascending: true }),
        supabaseAdmin.from('touchpoints').select('*').eq('lead_cadencia_id', leadCadenciaId),
        fetchStageNotesSafe(leadCadenciaId),
        supabaseAdmin.from('users').select('nome').eq('user_id', lead.requestingUser).maybeSingle()
    ]);
    if (stagesErr) throw new Error(`Falha ao buscar cadence_stages: ${stagesErr.message}`);
    if (touchErr) throw new Error(`Falha ao buscar touchpoints: ${touchErr.message}`);

    const touchpointsByStage = new Map((touchpoints || []).map(t => [t.etapa_cadencia, t]));
    const notesByStage = new Map(notes.map(n => [n.etapa_cadencia, n]));

    const timeline = (stages || []).map(stage => ({
        etapa_cadencia: stage.etapa_cadencia,
        fase: stage.fase,
        dia_referencia: stage.dia_referencia,
        nome_interacao: stage.nome_interacao,
        canais_aplicaveis: stage.canais_aplicaveis || [],
        objetivo: stage.objetivo,
        is_breakup: stage.is_breakup,
        status: stageStatus(stage.etapa_cadencia, lead.etapa_atual, lead.finalizado_em),
        touchpoint: touchpointsByStage.get(stage.etapa_cadencia) || null,
        notes: notesByStage.get(stage.etapa_cadencia) || null
    }));

    // Outros contatos da mesma empresa (mesmo domínio), com o status da cadência
    // deles caso também estejam em alguma — igual ao card "Outros contatos" do protótipo.
    let outrosContatos = [];
    if (decisor?.company_domain) {
        const { data: peers, error: peersErr } = await supabaseAdmin
            .from('decisores')
            .select('id,name,title')
            .eq('company_domain', decisor.company_domain)
            .neq('id', decisor.id)
            .limit(10);
        if (peersErr) throw new Error(`Falha ao buscar outros contatos: ${peersErr.message}`);

        if (peers && peers.length > 0) {
            const peerIds = peers.map(p => p.id);
            const { data: peerCadencias, error: peerCadErr } = await supabaseAdmin
                .from('lead_cadencias')
                .select('id,decisor_id,status,etapa_atual,cadencia_id,iniciado_em')
                .in('decisor_id', peerIds)
                .order('iniciado_em', { ascending: false });
            if (peerCadErr) throw new Error(`Falha ao buscar cadências dos contatos: ${peerCadErr.message}`);

            const latestByDecisor = new Map();
            (peerCadencias || []).forEach(pc => {
                if (!latestByDecisor.has(pc.decisor_id)) latestByDecisor.set(pc.decisor_id, pc);
            });

            outrosContatos = peers.map(p => {
                const pc = latestByDecisor.get(p.id);
                const stage = pc ? (stages || []).find(s => s.etapa_cadencia === pc.etapa_atual) : null;
                return {
                    id: p.id,
                    name: p.name,
                    title: p.title,
                    etapa_atual_texto: stage ? `Dia ${stage.dia_referencia} - ${stage.nome_interacao}` : (pc ? `Etapa ${pc.etapa_atual}` : 'Não está em cadência'),
                    status: pc ? pc.status : null,
                    lead_cadencia_id: pc ? pc.id : null
                };
            });
        }
    }

    return {
        lead: {
            id: lead.id,
            lead_name: lead.lead_name || decisor?.name,
            status: mapStatus(lead.status, lead.finalizado_em),
            etapa_atual: lead.etapa_atual,
            proxima_etapa: lead.proxima_etapa,
            proxima_data_envio: lead.proxima_data_envio,
            iniciado_em: lead.iniciado_em,
            finalizado_em: lead.finalizado_em,
            produto_direcionado: lead.produto_direcionado,
            responsavel: responsavel?.nome || lead.requestingUser || '—'
        },
        decisor,
        cadencia,
        timeline,
        outros_contatos: outrosContatos
    };
}

// Ações de "Parar Cadência" / "Concluir Cadência" / "Tarefa Manual Concluída" na
// tela de detalhe do lead — cada uma é só um update pontual em lead_cadencias.status.
async function updateLeadCadenciaStatus(leadCadenciaId, action) {
    const config = STATUS_ACTIONS[action];
    if (!config) throw new Error(`Ação de status desconhecida: "${action}".`);

    const patch = { status: config.status };
    if (config.setFinalizadoEm) patch.finalizado_em = new Date().toISOString();

    const { data, error } = await supabaseAdmin
        .from('lead_cadencias')
        .update(patch)
        .eq('id', leadCadenciaId)
        .select('id,status,finalizado_em')
        .maybeSingle();

    if (error) throw new Error(`Falha ao atualizar status: ${error.message}`);
    if (!data) throw new Error('Lead não encontrado.');
    return { id: data.id, status: mapStatus(data.status, data.finalizado_em) };
}

async function saveStageNote(leadCadenciaId, etapaCadencia, { acao, feedback }) {
    const { data, error } = await supabaseAdmin
        .from('stage_notes')
        .upsert({
            lead_cadencia_id: leadCadenciaId,
            etapa_cadencia: etapaCadencia,
            acao: acao ?? null,
            feedback: feedback ?? null,
            updated_at: new Date().toISOString()
        }, { onConflict: 'lead_cadencia_id,etapa_cadencia' })
        .select()
        .maybeSingle();

    if (error) {
        if (isMissingTableError(error)) {
            throw new Error('A tabela "stage_notes" ainda não existe no banco — rode o SQL de criação no Supabase antes de salvar anotações.');
        }
        throw new Error(`Falha ao salvar anotação: ${error.message}`);
    }
    return data;
}

module.exports = { getLeadDetail, saveStageNote, updateLeadCadenciaStatus };
