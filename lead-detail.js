// --- Lara Leads - Detalhe de um lead em cadência ---
// Consome GET/POST /api/leads-cadencia/<id>/... (server.js + leadDetailApi.js).

const THEME_KEY = 'lara_leads_theme';

function updateThemeUI() {
    const btnToggleTheme = document.getElementById('btn-toggle-theme');
    const theme = localStorage.getItem(THEME_KEY) || 'light';
    if (theme === 'dark') {
        document.body.setAttribute('data-theme', 'dark');
        btnToggleTheme.innerHTML = '<i data-lucide="sun"></i>';
    } else {
        document.body.removeAttribute('data-theme');
        btnToggleTheme.innerHTML = '<i data-lucide="moon"></i>';
    }
    lucide.createIcons();
}

document.getElementById('btn-toggle-theme').addEventListener('click', () => {
    const current = localStorage.getItem(THEME_KEY) || 'light';
    localStorage.setItem(THEME_KEY, current === 'dark' ? 'light' : 'dark');
    updateThemeUI();
});

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text == null ? '' : String(text);
    return div.innerHTML;
}

function formatDate(isoString) {
    if (!isoString) return '—';
    return new Date(isoString).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

const STATUS_LABELS = {
    concluida: { label: 'Concluída', icon: 'check' },
    atual: { label: 'Em andamento', icon: 'circle-dot' },
    pendente: { label: 'Pendente', icon: 'circle' },
    nao_alcancada: { label: 'Não alcançada', icon: 'circle-slash' }
};

function getLeadId() {
    const params = new URLSearchParams(window.location.search);
    return params.get('id');
}

// Cadência já encerrada (de um jeito ou de outro) — não faz mais sentido oferecer
// nenhuma ação de status a partir daqui.
const TERMINAL_STATUSES = ['finalizado', 'cancelado'];

function renderHeaderActions(status) {
    const buttons = [];
    if (!TERMINAL_STATUSES.includes(status.raw)) {
        buttons.push(`<button type="button" class="btn-lead-action danger" id="btn-parar-cadencia">Parar Cadência</button>`);
        buttons.push(`<button type="button" class="btn-lead-action success" id="btn-concluir-cadencia">Concluir Cadência</button>`);
    }
    if (buttons.length === 0) return '';
    return `<div class="lead-header-actions">${buttons.join('')}</div>`;
}

function renderHeader(detail) {
    const { lead, decisor, cadencia } = detail;
    document.getElementById('breadcrumb-lead-name').textContent = lead.lead_name || '—';

    return `
        <div class="lead-header-card">
            <div class="lead-header-main">
                <div class="lead-header-title-row">
                    <h2>${escapeHtml(lead.lead_name)}</h2>
                    <span class="status-badge ${lead.status.tone}">${escapeHtml(lead.status.label)}</span>
                </div>
                <div class="lead-header-sub">${escapeHtml(decisor?.title || '')}${decisor?.company ? ' · ' + escapeHtml(decisor.company) : ''}</div>
            </div>
            <div class="lead-header-meta">
                <div class="lead-header-meta-item">
                    <span class="lead-header-meta-label">Cadência</span>
                    <span class="lead-header-meta-value">${escapeHtml(cadencia?.nome || '—')}</span>
                </div>
                <div class="lead-header-meta-item">
                    <span class="lead-header-meta-label">Responsável</span>
                    <span class="lead-header-meta-value">${escapeHtml(lead.responsavel)}</span>
                </div>
                <div class="lead-header-meta-item">
                    <span class="lead-header-meta-label">Iniciado em</span>
                    <span class="lead-header-meta-value">${formatDate(lead.iniciado_em)}</span>
                </div>
                <div class="lead-header-meta-item">
                    <span class="lead-header-meta-label">Próximo envio</span>
                    <span class="lead-header-meta-value">${formatDate(lead.proxima_data_envio)}</span>
                </div>
            </div>
            ${renderHeaderActions(lead.status)}
        </div>
    `;
}

function renderPeers(peers) {
    if (!peers || peers.length === 0) return '';
    return `
        <div class="peers-card">
            <h3>Outros contatos da mesma empresa</h3>
            <div class="peers-list">
                ${peers.map(p => `
                    <div class="peer-row ${p.lead_cadencia_id ? 'linked' : ''}" ${p.lead_cadencia_id ? `data-id="${escapeHtml(p.lead_cadencia_id)}"` : ''}>
                        <div class="peer-info">
                            <span class="peer-name">${escapeHtml(p.name)}</span>
                            <span class="peer-title">${escapeHtml(p.title || '')}</span>
                        </div>
                        <span class="peer-stage">${escapeHtml(p.etapa_atual_texto)}</span>
                    </div>
                `).join('')}
            </div>
        </div>
    `;
}

// Botão "Tarefa Manual Concluída" só aparece na etapa atual, quando ela exige uma
// ação manual (hoje só ligação/LIGACAO) e o n8n já sinalizou isso via status:"manual"
// no lead_cadencias — nunca a partir só do canal, pra não adiantar o sinal do workflow.
function requiresManualAction(stage, leadStatusRaw) {
    return stage.status === 'atual' && leadStatusRaw === 'manual' && (stage.canais_aplicaveis || []).includes('LIGACAO');
}

function renderTimelineItem(stage, leadId, leadStatusRaw) {
    const statusInfo = STATUS_LABELS[stage.status] || STATUS_LABELS.pendente;
    const acao = stage.notes?.acao || stage.touchpoint?.mensagem || '';
    const feedback = stage.notes?.feedback || '';
    const channels = (stage.canais_aplicaveis || []).join(', ');
    const manualAction = requiresManualAction(stage, leadStatusRaw);

    return `
        <div class="timeline-item ${stage.status}" data-etapa="${stage.etapa_cadencia}">
            <div class="timeline-marker"><i data-lucide="${statusInfo.icon}"></i></div>
            <div class="timeline-head">
                <h4>Dia ${stage.dia_referencia} · ${escapeHtml(stage.nome_interacao)}</h4>
                <span class="status-badge ${stage.status === 'concluida' ? 'success' : stage.status === 'atual' ? 'info' : 'neutral'}">${statusInfo.label}</span>
            </div>
            <p class="timeline-objetivo">${escapeHtml(stage.objetivo || '')}</p>
            ${channels ? `<div class="timeline-channels"><span class="timeline-channel-tag">${escapeHtml(channels)}</span></div>` : ''}
            ${manualAction ? `
                <div class="manual-action-banner">
                    <i data-lucide="phone-call" class="icon-small"></i>
                    <span>Essa etapa exige uma ligação manual. Marque como concluída depois de fazê-la.</span>
                    <button type="button" class="btn-lead-action warning" id="btn-manual-concluida">Tarefa Manual Concluída</button>
                </div>
            ` : ''}
            <div class="timeline-fields">
                <div class="timeline-field">
                    <label>Ação</label>
                    <textarea class="field-acao" placeholder="O que foi (ou será) feito nesta etapa...">${escapeHtml(acao)}</textarea>
                </div>
                <div class="timeline-field">
                    <label>Feedback</label>
                    <textarea class="field-feedback" placeholder="Como foi a resposta do lead...">${escapeHtml(feedback)}</textarea>
                </div>
            </div>
            <div class="timeline-actions">
                <span class="timeline-save-hint" style="display:none;">Salvo!</span>
                <button type="button" class="btn-timeline-cancel">Cancelar</button>
                <button type="button" class="btn-timeline-save">Salvar</button>
            </div>
        </div>
    `;
}

function renderTimeline(timeline, leadId, leadStatusRaw) {
    return `
        <div class="timeline-card">
            <h3>Progresso da Cadência</h3>
            <div class="timeline" id="timeline-list">
                ${timeline.map(stage => renderTimelineItem(stage, leadId, leadStatusRaw)).join('')}
            </div>
        </div>
    `;
}

function bindTimelineActions(leadId) {
    document.querySelectorAll('.timeline-item').forEach(item => {
        const etapa = item.dataset.etapa;
        const acaoEl = item.querySelector('.field-acao');
        const feedbackEl = item.querySelector('.field-feedback');
        const savedAcao = acaoEl.value;
        const savedFeedback = feedbackEl.value;
        const btnCancel = item.querySelector('.btn-timeline-cancel');
        const btnSave = item.querySelector('.btn-timeline-save');
        const hint = item.querySelector('.timeline-save-hint');

        btnCancel.addEventListener('click', () => {
            acaoEl.value = savedAcao;
            feedbackEl.value = savedFeedback;
        });

        btnSave.addEventListener('click', async () => {
            btnSave.disabled = true;
            hint.style.display = 'none';
            try {
                const res = await fetch(`/api/leads-cadencia/${encodeURIComponent(leadId)}/etapas/${etapa}/notes`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ acao: acaoEl.value, feedback: feedbackEl.value })
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data.message || 'Falha ao salvar');
                hint.textContent = 'Salvo!';
                hint.style.display = 'inline';
                setTimeout(() => { hint.style.display = 'none'; }, 2000);
            } catch (err) {
                hint.textContent = err.message;
                hint.style.display = 'inline';
                hint.style.color = 'var(--danger)';
            } finally {
                btnSave.disabled = false;
            }
        });
    });
}

const STATUS_ACTION_CONFIRM = {
    parar: 'Tem certeza que deseja parar esta cadência? Ela não volta a rodar automaticamente depois disso.',
    concluir: 'Marcar esta cadência como concluída?',
    manual_concluida: 'Confirmar que a tarefa manual (ligação) foi concluída? A cadência volta a rodar automaticamente.'
};

async function updateLeadStatus(leadId, action, button) {
    const confirmMsg = STATUS_ACTION_CONFIRM[action];
    if (confirmMsg && !window.confirm(confirmMsg)) return;

    button.disabled = true;
    try {
        const res = await fetch(`/api/leads-cadencia/${encodeURIComponent(leadId)}/status`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || 'Falha ao atualizar status');
        await loadDetail();
    } catch (err) {
        alert(`Erro ao atualizar status: ${err.message}`);
        button.disabled = false;
    }
}

function bindStatusActions(leadId) {
    const btnParar = document.getElementById('btn-parar-cadencia');
    const btnConcluir = document.getElementById('btn-concluir-cadencia');
    const btnManual = document.getElementById('btn-manual-concluida');

    if (btnParar) btnParar.addEventListener('click', () => updateLeadStatus(leadId, 'parar', btnParar));
    if (btnConcluir) btnConcluir.addEventListener('click', () => updateLeadStatus(leadId, 'concluir', btnConcluir));
    if (btnManual) btnManual.addEventListener('click', () => updateLeadStatus(leadId, 'manual_concluida', btnManual));
}

function bindPeerNavigation() {
    document.querySelectorAll('.peer-row.linked').forEach(row => {
        row.addEventListener('click', () => {
            window.location.href = `lead-detail.html?id=${encodeURIComponent(row.dataset.id)}`;
        });
    });
}

async function loadDetail() {
    const leadId = getLeadId();
    const content = document.getElementById('detail-content');

    if (!leadId) {
        content.innerHTML = `<div class="table-empty">Nenhum lead selecionado. <a href="leads.html">Voltar para a lista</a>.</div>`;
        return;
    }

    try {
        const res = await fetch(`/api/leads-cadencia/${encodeURIComponent(leadId)}/detail`);
        const detail = await res.json();
        if (!res.ok) throw new Error(detail.message || 'Falha ao carregar o lead');

        content.innerHTML = renderHeader(detail) + renderPeers(detail.outros_contatos) + renderTimeline(detail.timeline, leadId, detail.lead.status.raw);
        lucide.createIcons();
        bindTimelineActions(leadId);
        bindStatusActions(leadId);
        bindPeerNavigation();
    } catch (err) {
        content.innerHTML = `<div class="table-empty">Erro ao carregar lead: ${escapeHtml(err.message)}</div>`;
    }
}

document.addEventListener('DOMContentLoaded', () => {
    updateThemeUI();
    lucide.createIcons();
    loadDetail();
});
