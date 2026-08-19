// --- Lara Leads - Tela "Contas" (empresas buscadas) ---
// Consome /api/contas e /api/contas/stats (server.js/api/contas.js + contasApi.js),
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

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text == null ? '' : String(text);
    return div.innerHTML;
}

function formatDate(isoString) {
    if (!isoString) return '—';
    return new Date(isoString).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

// Estado local de filtros/paginação
let state = { page: 1, pageSize: 20, search: '', status: '' };
let searchDebounceTimer = null;

async function loadStats() {
    try {
        const res = await fetch('/api/contas/stats');
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || 'Falha ao carregar estatísticas');

        document.getElementById('stat-total').textContent = data.total_contas.toLocaleString('pt-BR');
        document.getElementById('stat-enriquecidas').textContent = data.enriquecidas.toLocaleString('pt-BR');
        document.getElementById('stat-pendentes').textContent = data.pendentes.toLocaleString('pt-BR');
        document.getElementById('stat-nao-enriquecidas').textContent = data.nao_enriquecidas.toLocaleString('pt-BR');
    } catch (err) {
        console.error('Erro ao carregar stats:', err);
        ['stat-total', 'stat-enriquecidas', 'stat-pendentes', 'stat-nao-enriquecidas'].forEach(id => {
            document.getElementById(id).textContent = '—';
        });
    }
}

function renderContatosCell(contatos) {
    if (!contatos || contatos.length === 0) return `<span class="cell-empty">—</span>`;
    const visiveis = contatos.slice(0, 2);
    const resto = contatos.length - visiveis.length;
    return `
        <div class="cell-contatos-list">
            <span class="cell-contatos-names">${escapeHtml(visiveis.join(', '))}</span>
            ${resto > 0 ? `<span class="cell-contatos-more">+${resto} outro${resto > 1 ? 's' : ''}</span>` : ''}
        </div>
    `;
}

function renderRow(row) {
    const siteCell = row.site
        ? `<a class="cell-site-link" href="${escapeHtml(row.site)}" target="_blank" rel="noopener noreferrer">${escapeHtml(row.dominio || row.site)}</a>`
        : `<span class="cell-empty">—</span>`;

    return `
        <tr>
            <td><span class="cell-empresa">${escapeHtml(row.nome || '—')}</span></td>
            <td>${row.segmento ? `<span class="cell-segmento" title="${escapeHtml(row.segmento)}">${escapeHtml(row.segmento)}</span>` : `<span class="cell-empty">—</span>`}</td>
            <td>${row.regiao ? escapeHtml(row.regiao) : `<span class="cell-empty">—</span>`}</td>
            <td>${siteCell}</td>
            <td>${renderContatosCell(row.contatos_vinculados)}</td>
            <td><span class="status-badge neutral">${escapeHtml(row.origem)}</span></td>
            <td>${formatDate(row.atualizado_em)}</td>
            <td><span class="status-badge ${row.status.tone}">${escapeHtml(row.status.label)}</span></td>
        </tr>
    `;
}

function renderPagination(total) {
    const totalPages = Math.max(1, Math.ceil(total / state.pageSize));
    const info = document.getElementById('contas-pagination-info');
    const pagination = document.getElementById('contas-pagination');

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

function goToPage(page) {
    state.page = page;
    loadContas();
}

async function loadContas() {
    const tbody = document.getElementById('contas-table-body');
    tbody.innerHTML = `<tr><td colspan="8" class="table-loading">Carregando contas...</td></tr>`;

    try {
        const params = new URLSearchParams({
            page: state.page,
            pageSize: state.pageSize
        });
        if (state.search) params.set('search', state.search);
        if (state.status) params.set('status', state.status);

        const res = await fetch(`/api/contas?${params.toString()}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || 'Falha ao carregar contas');

        if (data.rows.length === 0) {
            tbody.innerHTML = `<tr><td colspan="8" class="table-empty">Nenhuma conta encontrada com esses filtros.</td></tr>`;
        } else {
            tbody.innerHTML = data.rows.map(renderRow).join('');
        }
        renderPagination(data.total);
        lucide.createIcons();
    } catch (err) {
        console.error('Erro ao carregar contas:', err);
        tbody.innerHTML = `<tr><td colspan="8" class="table-empty">Erro ao carregar contas: ${escapeHtml(err.message)}</td></tr>`;
        document.getElementById('contas-pagination-info').textContent = '—';
        document.getElementById('contas-pagination').innerHTML = '';
    }
}

document.getElementById('contas-search-input').addEventListener('input', (e) => {
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => {
        state.search = e.target.value.trim();
        state.page = 1;
        loadContas();
    }, 350);
});

document.getElementById('contas-status-filter').addEventListener('change', (e) => {
    state.status = e.target.value;
    state.page = 1;
    loadContas();
});

document.getElementById('btn-refresh-contas').addEventListener('click', () => {
    loadStats();
    loadContas();
});

document.addEventListener('DOMContentLoaded', () => {
    updateThemeUI();
    lucide.createIcons();
    loadStats();
    loadContas();
});
