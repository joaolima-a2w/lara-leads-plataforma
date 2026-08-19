// --- Lara Leads - Tela "Configuração de Setup" ---
// Na prática, essa tela é uma visão sobre a tabela `personalizacao`: cada linha
// é um "setup" (linha de produto + ICP + cadência) configurado para um usuário
// de teste. Consome /api/personalizacao?user_id=... (server.js + personalizacaoApi.js).
//
// Sem sistema de login ainda, então a tela sempre mostra os setups do usuário de
// teste combinado com o time (hoje: andre_moura_a2w).
const TEST_USER_ID = 'andre_moura_a2w';

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

function formatDateTime(isoString) {
    if (!isoString) return '—';
    return new Date(isoString).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

const STATUS_TONE = { ativo: 'success', pausado: 'warning', inativo: 'neutral', cancelado: 'danger' };

function renderUserCard(user) {
    const nameEl = document.getElementById('setup-user-name');
    const metaEl = document.getElementById('setup-user-meta');
    if (!user) {
        nameEl.textContent = 'Usuário não encontrado';
        metaEl.textContent = `Nenhum usuário com user_id "${TEST_USER_ID}" foi encontrado na tabela users.`;
        return;
    }
    nameEl.textContent = `${user.nome} (${user.user_id})`;
    metaEl.textContent = `Tenant: ${user.tenant_name} (${user.tenant_id})`;
}

function renderStats(setups) {
    const total = setups.length;
    const ativos = setups.filter(s => s.status === 'ativo').length;
    const produtos = new Set(setups.map(s => s.produto_direcionado).filter(Boolean)).size;
    const comCanais = setups.filter(s => s.channels_config && Object.keys(s.channels_config).length > 0).length;

    document.getElementById('stat-total-setups').textContent = total.toLocaleString('pt-BR');
    document.getElementById('stat-ativos').textContent = ativos.toLocaleString('pt-BR');
    document.getElementById('stat-produtos').textContent = produtos.toLocaleString('pt-BR');
    document.getElementById('stat-canais').textContent = comCanais.toLocaleString('pt-BR');
}

function renderTagGroup(label, items, tone) {
    if (!items || items.length === 0) return '';
    const tagClass = tone ? `tag ${tone}` : 'tag';
    return `
        <div class="tag-group">
            <div class="tag-group-label">${escapeHtml(label)}</div>
            <div class="tag-list">${items.map(i => `<span class="${tagClass}">${escapeHtml(i)}</span>`).join('')}</div>
        </div>
    `;
}

function renderKv(label, value) {
    if (value === null || value === undefined || value === '') return '';
    return `<div class="kv-item"><span class="k">${escapeHtml(label)}</span><span class="v">${escapeHtml(value)}</span></div>`;
}

function renderIdentitySection(setup) {
    const kvs = [
        renderKv('Assistente', setup.assistant_name),
        renderKv('Tom de voz', setup.voice_tone),
        renderKv('Executivo', setup.exec_name && setup.exec_role ? `${setup.exec_name} (${setup.exec_role})` : setup.exec_name),
        renderKv('Marca', setup.brand_name),
        renderKv('Segmento padrão', setup.default_segment)
    ].join('');

    return `
        <div class="setup-section">
            <div class="setup-section-title"><i data-lucide="sparkles"></i>Identidade &amp; Atendimento</div>
            <div class="kv-grid">${kvs || '<span class="setup-empty-hint">Nenhum dado de identidade configurado.</span>'}</div>
        </div>
    `;
}

function renderCadenciaSection(setup) {
    const c = setup.cadencia;
    const body = c
        ? `
            <div class="kv-grid">
                ${renderKv('Cadência', c.nome)}
                ${renderKv('Produto direcionado (cadência)', c.produto_direcionado)}
            </div>
            ${c.descricao ? `<p class="setup-text-block" style="margin-top:0.6rem;">${escapeHtml(c.descricao)}</p>` : ''}
            <span class="status-badge ${c.ativo ? 'success' : 'neutral'}" style="margin-top:0.6rem;">${c.ativo ? 'Cadência ativa' : 'Cadência inativa'}</span>
        `
        : `<span class="setup-empty-hint">Nenhuma cadência vinculada a este setup.</span>`;

    return `
        <div class="setup-section">
            <div class="setup-section-title"><i data-lucide="tag"></i>Cadência Vinculada</div>
            ${body}
        </div>
    `;
}

function renderIcpSection(setup) {
    const icp = setup.icp;
    if (!icp) {
        return `
            <div class="setup-section">
                <div class="setup-section-title"><i data-lucide="target"></i>Perfil de Cliente Ideal (ICP)</div>
                <span class="setup-empty-hint">ICP não configurado ainda para este setup.</span>
            </div>
        `;
    }

    const porte = (icp.porte_minimo || icp.porte_maximo)
        ? `${icp.porte_minimo ?? '?'}–${icp.porte_maximo ?? '?'} funcionários`
        : null;

    const kvs = [
        renderKv('Empresa (ICP)', icp.company_name),
        renderKv('Porte ideal', icp.porte_ideal),
        renderKv('Faixa de porte', porte)
    ].join('');

    return `
        <div class="setup-section">
            <div class="setup-section-title"><i data-lucide="target"></i>Perfil de Cliente Ideal (ICP)</div>
            <div class="kv-grid">${kvs || '<span class="setup-empty-hint">Sem dados básicos de ICP.</span>'}</div>
            ${icp.proposta_valor ? `<p class="setup-text-block" style="margin-top:0.7rem;">${escapeHtml(icp.proposta_valor)}</p>` : ''}
            <div style="margin-top:0.8rem;">
                ${renderTagGroup('Regiões-alvo', icp.regioes_alvo)}
                ${renderTagGroup('Segmentos-alvo', icp.segmentos_alvo, 'info')}
                ${renderTagGroup('Segmentos excluídos', icp.segmentos_excluidos, 'danger')}
                ${renderTagGroup('Personas decisoras', icp.personas_decisoras)}
                ${renderTagGroup('Funções prioritárias', icp.job_functions_prioritarias)}
                ${renderTagGroup('Gatilhos positivos', icp.gatilhos_positivos, 'success')}
                ${renderTagGroup('Gatilhos negativos', icp.gatilhos_negativos, 'danger')}
            </div>
            ${icp.exemplos_clientes_ideais && icp.exemplos_clientes_ideais.length > 0 ? `
                <div class="tag-group">
                    <div class="tag-group-label">Exemplos de clientes ideais</div>
                    <ul style="margin:0; padding-left:1.1rem; display:flex; flex-direction:column; gap:0.3rem;">
                        ${icp.exemplos_clientes_ideais.map(ex => `<li class="setup-text-block">${escapeHtml(ex)}</li>`).join('')}
                    </ul>
                </div>
            ` : ''}
        </div>
    `;
}

function renderDecisoresSection(setup) {
    const items = setup.decisores_prioritarios;
    return `
        <div class="setup-section">
            <div class="setup-section-title"><i data-lucide="users"></i>Decisores Prioritários</div>
            ${items && items.length > 0 ? `<div class="tag-list">${items.map(i => `<span class="tag">${escapeHtml(i)}</span>`).join('')}</div>` : '<span class="setup-empty-hint">Nenhum decisor prioritário mapeado ainda.</span>'}
        </div>
    `;
}

function renderChannelsSection(setup) {
    const keys = Object.keys(setup.channels_config || {});
    return `
        <div class="setup-section">
            <div class="setup-section-title"><i data-lucide="radio"></i>Canais Configurados</div>
            ${keys.length > 0 ? `<div class="tag-list">${keys.map(k => `<span class="tag info">${escapeHtml(k)}</span>`).join('')}</div>` : '<span class="setup-empty-hint">Nenhum canal configurado ainda.</span>'}
        </div>
    `;
}

function renderScriptsSection(setup) {
    const scripts = setup.scripts_config;
    const keys = scripts && typeof scripts === 'object' ? Object.keys(scripts) : [];
    return `
        <div class="setup-section">
            <div class="setup-section-title"><i data-lucide="code"></i>Scripts</div>
            ${keys.length > 0 ? `<div class="tag-list">${keys.map(k => `<span class="tag">${escapeHtml(k)}</span>`).join('')}</div>` : '<span class="setup-empty-hint">Nenhum script configurado ainda.</span>'}
        </div>
    `;
}

function renderSetupCard(setup) {
    const tone = STATUS_TONE[setup.status] || 'neutral';
    const title = setup.produto_direcionado || 'Setup sem linha de produto definida';
    const subtitleParts = [];
    if (setup.icp?.company_name) subtitleParts.push(setup.icp.company_name);
    else if (setup.brand_name) subtitleParts.push(setup.brand_name);
    if (setup.default_segment) subtitleParts.push(`Segmento: ${setup.default_segment}`);

    return `
        <details class="setup-card" open>
            <summary class="setup-card-summary">
                <div class="setup-card-icon"><i data-lucide="package"></i></div>
                <div class="setup-card-heading">
                    <span class="setup-card-title">${escapeHtml(title)}</span>
                    <span class="setup-card-subtitle">${escapeHtml(subtitleParts.join(' · ') || '—')}</span>
                </div>
                <span class="status-badge ${tone}">${escapeHtml(setup.status || 'sem status')}</span>
                <i data-lucide="chevron-right" class="setup-card-chevron"></i>
            </summary>
            <div class="setup-card-body">
                ${renderIdentitySection(setup)}
                ${renderCadenciaSection(setup)}
                ${renderIcpSection(setup)}
                ${renderDecisoresSection(setup)}
                ${renderChannelsSection(setup)}
                ${renderScriptsSection(setup)}
                <div class="setup-card-footer">
                    <span>Criado em ${formatDateTime(setup.created_at)}</span>
                    <span>Atualizado em ${formatDateTime(setup.updated_at)}</span>
                </div>
            </div>
        </details>
    `;
}

async function loadSetups() {
    const container = document.getElementById('setups-container');
    container.innerHTML = `<div class="setup-loading">Carregando setups configurados...</div>`;

    try {
        const res = await fetch(`/api/personalizacao?user_id=${encodeURIComponent(TEST_USER_ID)}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || 'Falha ao carregar setups');

        renderUserCard(data.user);
        renderStats(data.setups);

        if (data.setups.length === 0) {
            container.innerHTML = `<div class="setup-empty">Nenhum setup configurado ainda para este usuário na tabela "personalizacao".</div>`;
        } else {
            container.innerHTML = `<div class="setup-list">${data.setups.map(renderSetupCard).join('')}</div>`;
        }
        lucide.createIcons();
    } catch (err) {
        console.error('Erro ao carregar setups:', err);
        container.innerHTML = `<div class="setup-empty">Erro ao carregar setups: ${escapeHtml(err.message)}</div>`;
        renderStats([]);
    }
}

document.getElementById('btn-refresh-setups').addEventListener('click', loadSetups);

document.addEventListener('DOMContentLoaded', () => {
    updateThemeUI();
    lucide.createIcons();
    loadSetups();
});
