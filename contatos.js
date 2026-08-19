// --- Lara Leads - Tela "Contatos" (decisores) ---
// Consome /api/decisores e /api/decisores/stats (server.js + decisoresApi.js),
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

// Estado local de filtros/paginação
let state = { page: 1, pageSize: 20, search: '' };
let searchDebounceTimer = null;

async function loadStats() {
    try {
        const res = await fetch('/api/decisores/stats');
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || 'Falha ao carregar estatísticas');

        document.getElementById('stat-total').textContent = data.total_contatos.toLocaleString('pt-BR');
        document.getElementById('stat-email').textContent = data.email_verificado.toLocaleString('pt-BR');
        document.getElementById('stat-telefone').textContent = data.telefone_verificado.toLocaleString('pt-BR');
        document.getElementById('stat-cadencia').textContent = data.em_cadencia.toLocaleString('pt-BR');
    } catch (err) {
        console.error('Erro ao carregar stats:', err);
        ['stat-total', 'stat-email', 'stat-telefone', 'stat-cadencia'].forEach(id => {
            document.getElementById(id).textContent = '—';
        });
    }
}

function renderContactCell(value, verified) {
    if (!value) return `<span class="cell-contact-empty">—</span>`;
    const badge = verified
        ? `<span class="status-badge success">Verificado</span>`
        : `<span class="status-badge neutral">Não verificado</span>`;
    return `
        <div class="cell-contact-value">
            <span class="cell-contact-text">${escapeHtml(value)}</span>
            ${badge}
        </div>
    `;
}

function renderCadenciaCell(emCadencia) {
    if (!emCadencia) return `<span class="status-badge neutral">Sem cadência</span>`;
    const statusMap = {
        ativo: { label: 'Em Andamento', tone: 'success' },
        pending: { label: 'Pendente', tone: 'warning' },
        pausado: { label: 'Pausado', tone: 'warning' },
        manual: { label: 'Ação Manual Pendente', tone: 'warning' },
        cancelado: { label: 'Cancelado', tone: 'danger' },
        finalizado: { label: 'Concluído', tone: 'info' }
    };
    const info = statusMap[emCadencia.status] || { label: emCadencia.status, tone: 'neutral' };
    return `<span class="status-badge ${info.tone}">${escapeHtml(info.label)}</span>`;
}

function renderRow(row) {
    const linkedinCell = row.linkedin_url
        ? `<a class="cell-linkedin-btn" href="${escapeHtml(row.linkedin_url)}" target="_blank" rel="noopener noreferrer" title="Abrir perfil no LinkedIn" onclick="event.stopPropagation()"><i data-lucide="external-link"></i></a>`
        : `<span class="cell-linkedin-empty">—</span>`;

    return `
        <tr class="${row.em_cadencia ? 'clickable-row' : ''}" data-lead-cadencia-id="${row.em_cadencia ? escapeHtml(row.em_cadencia.lead_cadencia_id) : ''}">
            <td><span class="cell-name">${escapeHtml(row.name || '—')}</span></td>
            <td>${escapeHtml(row.title || '—')}</td>
            <td>
                ${escapeHtml(row.company || '—')}
                ${row.company_domain ? `<span class="cell-sub">${escapeHtml(row.company_domain)}</span>` : ''}
            </td>
            <td>${linkedinCell}</td>
            <td>${renderContactCell(row.work_email, row.email_verificado)}</td>
            <td>${renderContactCell(row.phone_number, row.telefone_verificado)}</td>
            <td>${renderCadenciaCell(row.em_cadencia)}</td>
        </tr>
    `;
}

function renderPagination(total) {
    const totalPages = Math.max(1, Math.ceil(total / state.pageSize));
    const info = document.getElementById('contatos-pagination-info');
    const pagination = document.getElementById('contatos-pagination');

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

// Contatos que já estão em alguma cadência levam pro detalhe do lead — os demais
// não têm pra onde navegar ainda (não viraram um "lead em cadência").
function bindRowNavigation() {
    document.querySelectorAll('#contatos-table-body tr.clickable-row').forEach(row => {
        row.style.cursor = 'pointer';
        row.addEventListener('click', (e) => {
            if (e.target.closest('.cell-linkedin-btn')) return;
            window.location.href = `lead-detail.html?id=${encodeURIComponent(row.dataset.leadCadenciaId)}`;
        });
    });
}

function goToPage(page) {
    state.page = page;
    loadContatos();
}

async function loadContatos() {
    const tbody = document.getElementById('contatos-table-body');
    tbody.innerHTML = `<tr><td colspan="7" class="table-loading">Carregando contatos...</td></tr>`;

    try {
        const params = new URLSearchParams({
            page: state.page,
            pageSize: state.pageSize
        });
        if (state.search) params.set('search', state.search);

        const res = await fetch(`/api/decisores?${params.toString()}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || 'Falha ao carregar contatos');

        if (data.rows.length === 0) {
            tbody.innerHTML = `<tr><td colspan="7" class="table-empty">Nenhum contato encontrado com esses filtros.</td></tr>`;
        } else {
            tbody.innerHTML = data.rows.map(renderRow).join('');
        }
        renderPagination(data.total);
        lucide.createIcons();
        bindRowNavigation();
    } catch (err) {
        console.error('Erro ao carregar contatos:', err);
        tbody.innerHTML = `<tr><td colspan="7" class="table-empty">Erro ao carregar contatos: ${escapeHtml(err.message)}</td></tr>`;
        document.getElementById('contatos-pagination-info').textContent = '—';
        document.getElementById('contatos-pagination').innerHTML = '';
    }
}

document.getElementById('contatos-search-input').addEventListener('input', (e) => {
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => {
        state.search = e.target.value.trim();
        state.page = 1;
        loadContatos();
    }, 350);
});

document.getElementById('btn-refresh-contatos').addEventListener('click', () => {
    loadStats();
    loadContatos();
});

document.addEventListener('DOMContentLoaded', () => {
    updateThemeUI();
    lucide.createIcons();
    loadStats();
    loadContatos();
});
