// --- Lara Leads - Tela "Meus Leads em Cadência" ---
// Consome /api/leads-cadencia e /api/leads-cadencia/stats (server.js + leadsCadenciaApi.js),
// que montam os dados a partir do banco real (Supabase).

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

function formatDate(isoString) {
    if (!isoString) return '—';
    const date = new Date(isoString);
    return date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function formatDateTime(isoString) {
    if (!isoString) return '—';
    const date = new Date(isoString);
    return date.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text == null ? '' : String(text);
    return div.innerHTML;
}

// Estado local de filtros/paginação
let state = { page: 1, pageSize: 20, search: '', status: '', canalResposta: '' };
let searchDebounceTimer = null;

// Mesmas cores/ícones que leadsCadenciaApi.js usa em RESPONDED_CHANNELS pra montar o
// badge de status — precisa bater exatamente, já que é o mesmo conceito visual.
const CHANNEL_CHIP_INFO = {
    wpp: { label: 'WhatsApp', tone: 'success', icon: 'message-circle' },
    email: { label: 'E-mail', tone: 'accent', icon: 'mail' },
    linkedin: { label: 'LinkedIn', tone: 'info', icon: 'external-link' }
};

function renderRespondidosBreakdown(porCanal) {
    const chips = Object.entries(porCanal || {})
        .filter(([, count]) => count > 0)
        .map(([channel, count]) => {
            const info = CHANNEL_CHIP_INFO[channel];
            if (!info) return '';
            return `<span class="channel-chip ${info.tone}"><i data-lucide="${info.icon}"></i>${count}</span>`;
        })
        .join('');
    document.getElementById('stat-respondidos-breakdown').innerHTML = chips;
}

async function loadStats() {
    try {
        const res = await fetch('/api/leads-cadencia/stats');
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || 'Falha ao carregar estatísticas');

        document.getElementById('stat-respondidos').textContent = data.leads_respondidos.toLocaleString('pt-BR');
        renderRespondidosBreakdown(data.leads_respondidos_por_canal);
        document.getElementById('stat-contatos').textContent = data.contatos_em_cadencia.toLocaleString('pt-BR');
        document.getElementById('stat-etapas').textContent = data.etapas_em_andamento.toLocaleString('pt-BR');
        document.getElementById('stat-acoes').textContent = data.acoes_manuais_hoje.toLocaleString('pt-BR');
        document.getElementById('stat-pendentes').textContent = data.pendentes_aprovacao_hoje.toLocaleString('pt-BR');
        lucide.createIcons();
    } catch (err) {
        console.error('Erro ao carregar stats:', err);
        ['stat-respondidos', 'stat-contatos', 'stat-etapas', 'stat-acoes', 'stat-pendentes'].forEach(id => {
            document.getElementById(id).textContent = '—';
        });
        document.getElementById('stat-respondidos-breakdown').innerHTML = '';
    }
}

function renderStatusBadge(status) {
    return `<span class="status-badge ${status.tone}">${escapeHtml(status.label)}</span>`;
}

// "Respondido" não é uma fase da cadência — é um fato à parte que pode acontecer em
// qualquer status (ver leadsCadenciaApi.js), então são badges adicionais, empilhados
// junto do status normal, nunca no lugar dele. Pode ter mais de um (respondeu em mais
// de um canal).
function renderRespondidoBadges(respondido) {
    return (respondido || [])
        .map(r => `<span class="status-badge with-icon ${r.tone}"><i data-lucide="${r.icon}" class="status-badge-icon"></i>${escapeHtml(r.label)}</span>`)
        .join('');
}

// Coluna "Canais": além dos botões decorativos de ação (ligar / ação da Lara), o
// ícone do canal por onde o lead respondeu (e-mail/WhatsApp/LinkedIn) ganha destaque
// direto ali — reforço visual rápido, além do badge e da linha inteira marcada.
const CHANNEL_BUTTON_ICON = { wpp: 'message-circle', email: 'mail', linkedin: 'external-link' };

function renderChannelsCell(respondido) {
    const respondedByChannel = new Map((respondido || []).map(r => [r.channel, r]));

    function channelButton(channel, icon, defaultTitle) {
        const r = respondedByChannel.get(channel);
        if (!r) return `<button type="button" title="${defaultTitle}"><i data-lucide="${icon}"></i></button>`;
        return `<button type="button" class="channel-responded ${r.tone}" title="${escapeHtml(r.label)} · ${formatDateTime(r.em)}"><i data-lucide="${icon}"></i></button>`;
    }

    return `
        <div class="cell-channels">
            ${channelButton('email', CHANNEL_BUTTON_ICON.email, 'Enviar e-mail (em breve)')}
            <button type="button" title="Ligar (em breve)"><i data-lucide="phone"></i></button>
            ${channelButton('wpp', CHANNEL_BUTTON_ICON.wpp, 'WhatsApp (em breve)')}
            ${channelButton('linkedin', CHANNEL_BUTTON_ICON.linkedin, 'LinkedIn (em breve)')}
            <button type="button" title="Ação da Lara (em breve)"><i data-lucide="sparkles"></i></button>
        </div>
    `;
}

function renderRow(row) {
    const etapaAtualTxt = row.etapa_atual.nome
        ? `Dia ${row.etapa_atual.dia} · ${escapeHtml(row.etapa_atual.nome)}`
        : `Etapa ${row.etapa_atual.numero}`;
    const proximaEtapaTxt = row.proxima_etapa.nome
        ? `Dia ${row.proxima_etapa.dia} · ${escapeHtml(row.proxima_etapa.nome)}`
        : `Etapa ${row.proxima_etapa.numero}`;
    // O status mais importante pro usuário ganha destaque na linha inteira, não só no
    // badge — a lista já vem ordenada com esses primeiro (ver leadsCadenciaApi.js).
    const highlightClass = row.respondido && row.respondido.length > 0 ? ' row-respondido' : '';

    return `
        <tr class="clickable-row${highlightClass}" data-id="${escapeHtml(row.id)}">
            <td>
                <span class="cell-account">${escapeHtml(row.conta)}</span>
                <span class="cell-sub">${escapeHtml(row.lead_name)}${row.lead_title ? ' · ' + escapeHtml(row.lead_title) : ''}</span>
            </td>
            <td>
                ${escapeHtml(row.cadencia.nome)}
                ${row.cadencia.total_etapas ? `<span class="cell-sub">${row.cadencia.total_etapas} etapas</span>` : ''}
            </td>
            <td>${etapaAtualTxt}</td>
            <td>${proximaEtapaTxt}</td>
            <td>${escapeHtml(row.responsavel)}</td>
            <td>${renderChannelsCell(row.respondido)}</td>
            <td>${formatDate(row.atualizado_em)}</td>
            <td>
                <div class="status-cell-stack">
                    ${renderRespondidoBadges(row.respondido)}
                    ${renderStatusBadge(row.status)}
                </div>
            </td>
        </tr>
    `;
}

function renderPagination(total) {
    const totalPages = Math.max(1, Math.ceil(total / state.pageSize));
    const info = document.getElementById('leads-pagination-info');
    const pagination = document.getElementById('leads-pagination');

    if (total === 0) {
        info.textContent = 'Nenhum resultado encontrado';
        pagination.innerHTML = '';
        return;
    }

    const from = (state.page - 1) * state.pageSize + 1;
    const to = Math.min(state.page * state.pageSize, total);
    info.textContent = `Mostrando ${from}–${to} de ${total} entradas`;

    let html = `<button id="pg-prev" ${state.page <= 1 ? 'disabled' : ''}>‹</button>`;
    for (let p = 1; p <= totalPages; p++) {
        if (p === 1 || p === totalPages || Math.abs(p - state.page) <= 1) {
            html += `<button data-page="${p}" class="${p === state.page ? 'active' : ''}">${p}</button>`;
        } else if (p === 2 || p === totalPages - 1) {
            html += `<span style="padding: 0 0.3rem; color: var(--text-tertiary);">…</span>`;
        }
    }
    html += `<button id="pg-next" ${state.page >= totalPages ? 'disabled' : ''}>›</button>`;
    pagination.innerHTML = html;

    const prevBtn = document.getElementById('pg-prev');
    const nextBtn = document.getElementById('pg-next');
    if (prevBtn) prevBtn.addEventListener('click', () => goToPage(state.page - 1));
    if (nextBtn) nextBtn.addEventListener('click', () => goToPage(state.page + 1));
    pagination.querySelectorAll('button[data-page]').forEach(btn => {
        btn.addEventListener('click', () => goToPage(parseInt(btn.dataset.page, 10)));
    });
}

// Clicking a row opens the lead's detail/timeline page — except clicks on the
// (still decorative) per-channel action buttons, which shouldn't navigate away.
function bindRowNavigation() {
    document.querySelectorAll('#leads-table-body tr.clickable-row').forEach(row => {
        row.style.cursor = 'pointer';
        row.addEventListener('click', (e) => {
            if (e.target.closest('.cell-channels')) return;
            window.location.href = `lead-detail.html?id=${encodeURIComponent(row.dataset.id)}`;
        });
    });
}

function goToPage(page) {
    state.page = page;
    loadLeads();
}

async function loadLeads() {
    const tbody = document.getElementById('leads-table-body');
    tbody.innerHTML = `<tr><td colspan="8" class="table-loading">Carregando leads...</td></tr>`;

    try {
        const params = new URLSearchParams({
            page: state.page,
            pageSize: state.pageSize
        });
        if (state.search) params.set('search', state.search);
        if (state.status) params.set('status', state.status);
        if (state.canalResposta) params.set('canalResposta', state.canalResposta);

        const res = await fetch(`/api/leads-cadencia?${params.toString()}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || 'Falha ao carregar leads');

        if (data.rows.length === 0) {
            tbody.innerHTML = `<tr><td colspan="8" class="table-empty">Nenhum lead encontrado com esses filtros.</td></tr>`;
        } else {
            tbody.innerHTML = data.rows.map(renderRow).join('');
        }
        renderPagination(data.total);
        lucide.createIcons();
        bindRowNavigation();
    } catch (err) {
        console.error('Erro ao carregar leads:', err);
        tbody.innerHTML = `<tr><td colspan="8" class="table-empty">Erro ao carregar leads: ${escapeHtml(err.message)}</td></tr>`;
        document.getElementById('leads-pagination-info').textContent = '—';
        document.getElementById('leads-pagination').innerHTML = '';
    }
}

document.getElementById('leads-search-input').addEventListener('input', (e) => {
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => {
        state.search = e.target.value.trim();
        state.page = 1;
        loadLeads();
    }, 350);
});

document.getElementById('leads-status-filter').addEventListener('change', (e) => {
    state.status = e.target.value;
    state.page = 1;
    loadLeads();
});

document.getElementById('leads-canal-filter').addEventListener('change', (e) => {
    state.canalResposta = e.target.value;
    state.page = 1;
    loadLeads();
});

document.getElementById('btn-refresh-leads').addEventListener('click', () => {
    loadStats();
    loadLeads();
});

document.addEventListener('DOMContentLoaded', () => {
    updateThemeUI();
    lucide.createIcons();
    loadStats();
    loadLeads();
});
