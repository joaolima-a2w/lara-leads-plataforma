// --- Lara Leads Chat Sandbox - Application Logic ---

// Helper for generating UUIDs (32 chars, no dashes)
function generateUUID() {
    return 'xxxxxxxxxxxx4xxxyxxxxxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

// Helper for local ISO timezone-aware timestamp
function getLocalISOTimestamp() {
    const tzoffset = (new Date()).getTimezoneOffset() * 60000;
    const localISOTime = (new Date(Date.now() - tzoffset)).toISOString().slice(0, -1);
    const offsetMinutes = new Date().getTimezoneOffset();
    const absOffset = Math.abs(offsetMinutes);
    const hours = Math.floor(absOffset / 60);
    const minutes = absOffset % 60;
    const sign = offsetMinutes <= 0 ? '+' : '-';
    return localISOTime + `${sign}${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

// Helper for formatting date/time
function formatTime(isoString) {
    if (!isoString) return '';
    const date = new Date(isoString);
    const now = new Date();

    // If today, show hours:minutes
    if (date.toDateString() === now.toDateString()) {
        return date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    }

    // Otherwise show day/month
    return date.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }).replace('.', '');
}

// Initial settings
const defaultSettings = {
    apiMode: 'custom-webhook',
    webhookUrl: 'https://a2w.app.n8n.cloud/webhook-test/dd8d25e1-3382-49b6-8d22-6621d57633b8',
    tenant_id: 'A2W',
    tenant_name: 'A2W Tecnologia',
    user_id: 'andre_moura_a2w',
    session_id: 'SESS-123',
    ip: '200.100.50.1',
    page: '/app/minerador',
    user_agent: 'Mozilla/5.0',
    theme: 'light'
};

// Application State
let state = {
    chats: [],
    activeChatId: null,
    settings: { ...defaultSettings }
};

// LocalStorage Persistence
function loadState() {
    try {
        const savedState = localStorage.getItem('lara_leads_sandbox_state');
        if (savedState) {
            const parsed = JSON.parse(savedState);
            // Merge settings to handle structure updates
            state.chats = (parsed.chats || []).map(c => ({ pinned: false, ...c }));
            state.activeChatId = parsed.activeChatId || null;
            state.settings = { ...defaultSettings, ...(parsed.settings || {}) };
        }
    } catch (e) {
        console.error('Error loading state from localStorage:', e);
    }
}

function saveState() {
    try {
        localStorage.setItem('lara_leads_sandbox_state', JSON.stringify(state));
    } catch (e) {
        console.error('Error saving state to localStorage:', e);
    }
}

// DOM Elements
const sidebar = document.getElementById('sidebar');
const chatListContainer = document.getElementById('chat-list');
const chatListPinnedContainer = document.getElementById('chat-list-pinned');
const chatGroupPinned = document.getElementById('chat-group-pinned');
const sidebarSearchInput = document.getElementById('sidebar-search-input');
const btnCollapseSidebar = document.getElementById('btn-collapse-sidebar');
const railBtnChat = document.getElementById('rail-btn-chat');
const messagesContainer = document.getElementById('messages-container');
const welcomeContainer = document.getElementById('welcome-container');
const chatInput = document.getElementById('chat-input');
const inputWorkflowHint = document.getElementById('input-workflow-hint');
const btnSend = document.getElementById('btn-send');
const btnNewChat = document.getElementById('btn-new-chat');
const btnToggleSettings = document.getElementById('btn-toggle-settings');
const btnToggleJson = document.getElementById('btn-toggle-json');
const btnOpenLogs = document.getElementById('btn-open-logs');
const btnToggleTheme = document.getElementById('btn-toggle-theme');
const activeChatTitleInput = document.getElementById('active-chat-title-input');
const chatIdBadge = document.getElementById('chat-id-badge');
const chatIdText = document.getElementById('chat-id-text');
const btnCopyId = document.getElementById('btn-copy-id');
const chatCostBadge = document.getElementById('chat-cost-badge');
const chatCostText = document.getElementById('chat-cost-text');
const settingsPanel = document.getElementById('settings-panel');
const detailsPanel = document.getElementById('details-panel');
const detailsOverlay = document.getElementById('details-overlay');
const btnCloseDetails = document.getElementById('btn-close-details');
const apiStatusText = document.getElementById('api-status-text');
const btnDemoStatus = document.getElementById('btn-demo-status');
const btnDemoError = document.getElementById('btn-demo-error');
const chatStatusPill = document.getElementById('chat-status-pill');

// Sidebar search state (client-side filter over chat titles)
let sidebarSearchQuery = '';

// Form Settings Inputs
const settingApiMode = document.getElementById('setting-api-mode');
const settingWebhookUrl = document.getElementById('setting-webhook-url');
const customWebhookUrlGroup = document.getElementById('custom-webhook-url-group');
const settingTenantId = document.getElementById('setting-tenant-id');
const settingTenantName = document.getElementById('setting-tenant-name');
const settingUserId = document.getElementById('setting-user-id');
const settingSessionId = document.getElementById('setting-session-id');
const settingIp = document.getElementById('setting-ip');
const settingPage = document.getElementById('setting-page');
const settingUserAgent = document.getElementById('setting-user-agent');
const btnResetTenantUser = document.getElementById('btn-reset-tenant-user');

// Code Panels
const jsonRequestCode = document.getElementById('json-request');
const jsonResponseCode = document.getElementById('json-response');
const tabRequest = document.getElementById('tab-request');
const tabResponse = document.getElementById('tab-response');
const btnCopyReq = document.getElementById('btn-copy-req');
const btnCopyRes = document.getElementById('btn-copy-res');

// --- JSON Syntax Highlighting ---
function syntaxHighlight(json) {
    if (typeof json !== 'string') {
        json = JSON.stringify(json, undefined, 2);
    }
    json = json.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return json.replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+-]?\d+)?)/g, function (match) {
        var cls = 'number';
        if (/^"/.test(match)) {
            if (/:$/.test(match)) {
                cls = 'key';
            } else {
                cls = 'string';
            }
        } else if (/true|false/.test(match)) {
            cls = 'boolean';
        } else if (/null/.test(match)) {
            cls = 'null';
        }
        return '<span class="json-' + cls + '">' + match + '</span>';
    });
}

function setHtmlWithScripts(element, html) {
  element.innerHTML = html;
  element.querySelectorAll("script").forEach(oldScript => {
    const newScript = document.createElement("script");
    newScript.textContent = oldScript.textContent;
    oldScript.replaceWith(newScript);
  });
}

// Strip tags and collapse whitespace for safe, short previews (sidebar list) —
// a Lara message can be raw HTML/JS (interactive cards), which must never be
// injected as-is into a preview context.
function toPreviewText(text, maxLen = 60) {
    if (!text) return '';
    const plain = text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    if (!plain) return '(conteúdo interativo)';
    return plain.length > maxLen ? plain.slice(0, maxLen) + '…' : plain;
}

// Escape text for safe innerHTML insertion (used for previews/labels built from
// arbitrary chat text, as opposed to trusted markup we build ourselves).
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text == null ? '' : String(text);
    return div.innerHTML;
}

// Any HTML reply (a card, a rich preview, whatever custom markup the workflow renders) is,
// by definition, something for the user to look at and act on — never a "still working in
// the background" caption. So it always unlocks the chat, regardless of whatever "status"
// (ok/processing/etc.) the workflow happened to send alongside it. Matches the exact same
// "is this HTML" check renderMessages() already uses to decide how to display the text.
// Workflows that want a locked, spinner-style progress caption should use POST /api/status
// (plain text, optionally with "progress") instead of embedding HTML in /api/callback's reply.
function isHtmlReply(text) {
    return typeof text === 'string' && text.trim().startsWith('<');
}

// --- App Navigation & Render ---

// Get active chat object
function getActiveChat() {
    return state.chats.find(c => c.id === state.activeChatId);
}

// A chat's composer/cards are enabled only in "idle" — sending/waiting/closed all lock it.
function isLocked(chatObj) {
    return !chatObj || chatObj.workflowState !== 'idle';
}

// Applies a workflow's reported status to a chat, no matter which channel it arrived
// through (sync HTTP response, or async /api/callback / /api/status — both picked up via
// polling, see startPolling()). "finalizado" always wins and is sticky: once a chat is closed, no later
// message can reopen it — e.g. n8n commonly fires /api/status "finalizado" and THEN
// /api/callback with the final reply, and that reply's own status defaults to "ok", which
// must not undo the closure. Even an HTML reply (a card, a preview, any rendered UI), which
// would otherwise unlock the chat as "waiting on the user", stays locked once closed.
function applyWorkflowStatus(chatObj, status, replyText) {
    const normalizedStatus = String(status || 'ok').trim().toLowerCase();
    const wasAlreadyClosed = chatObj.workflowState === 'closed';
    if (normalizedStatus === 'finalizado' || wasAlreadyClosed) {
        chatObj.workflowState = 'closed';
        chatObj.currentStatusText = null;
        chatObj.currentStatusProgress = null;
        if (!wasAlreadyClosed) {
            chatObj.messages.push({
                message_id: generateUUID(),
                sender: 'system',
                text: 'Conversa finalizada pelo workflow. Este chat não pode mais enviar ou receber mensagens.',
                timestamp: new Date().toISOString()
            });
        }
        return true;
    }
    if (normalizedStatus === 'processing' && !isHtmlReply(replyText)) {
        chatObj.workflowState = 'waiting';
    } else {
        chatObj.workflowState = 'idle';
        chatObj.currentStatusText = null;
        chatObj.currentStatusProgress = null;
    }
    return false;
}

// Shared theme key read/written by every page of the platform (chat, leads, etc.) so
// switching the theme in one place is reflected everywhere else — see leads.js.
const SHARED_THEME_KEY = 'lara_leads_theme';

// Set visual theme
function updateThemeUI() {
    const sharedTheme = localStorage.getItem(SHARED_THEME_KEY);
    if (sharedTheme) state.settings.theme = sharedTheme;

    if (state.settings.theme === 'dark') {
        document.body.setAttribute('data-theme', 'dark');
        btnToggleTheme.innerHTML = '<i data-lucide="sun"></i>';
    } else {
        document.body.removeAttribute('data-theme');
        btnToggleTheme.innerHTML = '<i data-lucide="moon"></i>';
    }
    lucide.createIcons();
}

// Toggle settings panels
function initPanels() {
    // API Status visual update
    updateStatusIndicator();

    btnToggleSettings.addEventListener('click', () => {
        settingsPanel.classList.toggle('collapsed');
        btnToggleSettings.classList.toggle('active', !settingsPanel.classList.contains('collapsed'));
    });

    btnToggleJson.addEventListener('click', () => {
        if (detailsPanel.classList.contains('open')) {
            closeDetailsPanel();
        } else {
            openDetailsPanel();
        }
    });

    if (btnOpenLogs) {
        btnOpenLogs.addEventListener('click', () => {
            window.open('logs.html', '_blank');
        });
    }

    // Sidebar search filter (client-side, over chat titles)
    if (sidebarSearchInput) {
        sidebarSearchInput.addEventListener('input', () => {
            sidebarSearchQuery = sidebarSearchInput.value;
            renderSidebar();
        });
    }

    // Collapse/expand the "Conversas" panel — the icon rail stays visible either way.
    // Clicking the rail's chat icon re-opens it if it was collapsed.
    if (btnCollapseSidebar) {
        btnCollapseSidebar.addEventListener('click', () => {
            sidebar.classList.add('collapsed');
        });
    }
    if (railBtnChat) {
        railBtnChat.addEventListener('click', () => {
            sidebar.classList.remove('collapsed');
        });
    }

    if (detailsOverlay) {
        detailsOverlay.addEventListener('click', () => closeDetailsPanel());
    }

    if (btnCloseDetails) {
        btnCloseDetails.addEventListener('click', () => closeDetailsPanel());
    }

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeDetailsPanel();
    });

    // Theme toggle click
    btnToggleTheme.addEventListener('click', () => {
        state.settings.theme = state.settings.theme === 'dark' ? 'light' : 'dark';
        localStorage.setItem(SHARED_THEME_KEY, state.settings.theme);
        saveState();
        updateThemeUI();
    });

    // Details tab switching
    [tabRequest, tabResponse].forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

            btn.classList.add('active');
            const targetId = btn.getAttribute('data-tab');
            document.getElementById(targetId).classList.add('active');
        });
    });
}

// The Request/Response JSON panel is a slide-over drawer, closed by default.
function openDetailsPanel() {
    detailsPanel.classList.add('open');
    btnToggleJson.classList.add('active');
    if (detailsOverlay) detailsOverlay.classList.add('visible');
}

function closeDetailsPanel() {
    detailsPanel.classList.remove('open');
    btnToggleJson.classList.remove('active');
    if (detailsOverlay) detailsOverlay.classList.remove('visible');
}

// Update settings UI values from state
function loadSettingsToUI() {
    settingApiMode.value = state.settings.apiMode;
    settingWebhookUrl.value = state.settings.webhookUrl;
    settingTenantId.value = state.settings.tenant_id;
    settingTenantName.value = state.settings.tenant_name;
    settingUserId.value = state.settings.user_id;
    settingSessionId.value = state.settings.session_id;
    settingIp.value = state.settings.ip;
    settingPage.value = state.settings.page;
    settingUserAgent.value = state.settings.user_agent;

    toggleWebhookInput();
}

function toggleWebhookInput() {
    if (settingApiMode.value === 'custom-webhook') {
        customWebhookUrlGroup.style.display = 'flex';
    } else {
        customWebhookUrlGroup.style.display = 'none';
    }
}

// Update state settings from UI inputs
function saveSettingsFromUI() {
    state.settings.apiMode = settingApiMode.value;
    state.settings.webhookUrl = settingWebhookUrl.value;
    state.settings.tenant_id = settingTenantId.value;
    state.settings.tenant_name = settingTenantName.value;
    state.settings.user_id = settingUserId.value;
    state.settings.session_id = settingSessionId.value;
    state.settings.ip = settingIp.value;
    state.settings.page = settingPage.value;
    state.settings.user_agent = settingUserAgent.value;

    updateStatusIndicator();
    saveState();
}

function updateStatusIndicator() {
    const dot = apiStatusText.previousElementSibling;
    if (state.settings.apiMode === 'mock-browser') {
        apiStatusText.innerText = 'Simulação Ativa';
        dot.className = 'status-dot online';
    } else if (state.settings.apiMode === 'mock-server') {
        apiStatusText.innerText = 'Servidor Local';
        dot.className = 'status-dot online';
    } else {
        apiStatusText.innerText = 'Webhook Real';
        dot.className = 'status-dot online';
    }
}

// Bind Settings Input Events
function bindSettingsEvents() {
    const inputs = [
        settingApiMode, settingWebhookUrl, settingTenantId,
        settingTenantName, settingUserId, settingSessionId,
        settingIp, settingPage, settingUserAgent
    ];

    inputs.forEach(input => {
        input.addEventListener('change', () => {
            toggleWebhookInput();
            saveSettingsFromUI();
        });
        input.addEventListener('input', saveSettingsFromUI);
    });

    // Atalho pra corrigir o caso recorrente de o localStorage já ter tenant_id/user_id
    // de outro teste (ex.: teste_multisetup_001) — restaura pro usuário de teste padrão
    // (André Moura / tenant A2W) sem precisar editar os 3 campos um por um.
    btnResetTenantUser.addEventListener('click', () => {
        state.settings.tenant_id = defaultSettings.tenant_id;
        state.settings.tenant_name = defaultSettings.tenant_name;
        state.settings.user_id = defaultSettings.user_id;
        loadSettingsToUI();
        saveState();
    });
}

// Create new chat
function createNewChat(title = "Novo chat") {
    const id = generateUUID();
    const newChatObj = {
        id: id,
        title: title,
        createdAt: new Date().toISOString(),
        lastActive: new Date().toISOString(),
        messages: [
            {
                message_id: generateUUID(),
                sender: 'system',
                text: 'Chat inicializado. Pronto para testar payloads.',
                timestamp: new Date().toISOString()
            }
        ],
        lastRequestJson: null,
        lastResponseJson: null,
        costTotal: 0,
        costCurrency: 'BRL',
        workflowState: 'idle',
        currentStatusText: null,
        currentStatusProgress: null,
        pinned: false
    };

    state.chats.unshift(newChatObj);
    state.activeChatId = id;

    saveState();
    renderSidebar();
    selectChat(id);
}

// Delete a chat
function deleteChat(id, event) {
    if (event) event.stopPropagation();

    state.chats = state.chats.filter(c => c.id !== id);

    if (state.activeChatId === id) {
        state.activeChatId = state.chats.length > 0 ? state.chats[0].id : null;
    }

    saveState();
    renderSidebar();

    if (state.activeChatId) {
        selectChat(state.activeChatId);
    } else {
        renderWelcomeScreen();
    }
}

// Toggle whether a chat is pinned to the top "Fixado" group in the sidebar
function togglePinChat(id, event) {
    if (event) event.stopPropagation();
    const chatObj = state.chats.find(c => c.id === id);
    if (!chatObj) return;
    chatObj.pinned = !chatObj.pinned;
    saveState();
    renderSidebar();
}

// Rename active chat
function renameActiveChat(newTitle) {
    const chatObj = getActiveChat();
    if (chatObj && newTitle.trim() !== "") {
        chatObj.title = newTitle.trim();
        saveState();
        renderSidebar();
    }
}

// Format a cost value according to its currency (BRL gets "R$ 0,0187" pt-BR formatting)
function formatCost(total, currency) {
    if (currency === 'BRL') {
        return new Intl.NumberFormat('pt-BR', {
            style: 'currency',
            currency: 'BRL',
            minimumFractionDigits: 2,
            maximumFractionDigits: 4
        }).format(total);
    }
    return `${total.toFixed(6)} ${currency}`;
}

// Reflect a chat's workflowState as the small pill next to the header title
// ("Pronto"/"Enviando..."/"Processando..."/"Finalizado"), matching the target design's
// "Já pronto" badge. With no active chat (welcome/hero screen), defaults to idle/"Pronto".
function updateHeaderStatusPill(chatObj) {
    if (!chatStatusPill) return;
    const STATUS_MAP = {
        idle: { cls: 'idle', text: 'Pronto' },
        sending: { cls: 'busy', text: 'Enviando...' },
        waiting: { cls: 'busy', text: 'Processando...' },
        closed: { cls: 'closed', text: 'Finalizado' }
    };
    const info = STATUS_MAP[chatObj ? chatObj.workflowState : 'idle'] || STATUS_MAP.idle;
    chatStatusPill.className = `status-pill ${info.cls}`;
    chatStatusPill.querySelector('.status-pill-text').textContent = info.text;
}

// Render the real-time cost badge in the chat header — a single accumulated total
// (in whatever currency the workflow reports, BRL by default) sent as-is by n8n.
function renderCostBadge(chatObj, highlight = false) {
    if (!chatObj) {
        chatCostBadge.style.display = 'none';
        return;
    }
    const total = chatObj.costTotal || 0;
    const currency = chatObj.costCurrency || 'BRL';

    chatCostText.innerText = formatCost(total, currency);
    chatCostBadge.title = 'Custo acumulado em tempo real deste chat';
    chatCostBadge.style.display = 'flex';

    if (highlight) {
        chatCostBadge.classList.add('cost-updated');
        setTimeout(() => chatCostBadge.classList.remove('cost-updated'), 800);
    }
}

// Select active chat
function selectChat(id) {
    state.activeChatId = id;
    saveState();

    // Update active class in sidebar UI
    document.querySelectorAll('.chat-item').forEach(item => {
        item.classList.toggle('active', item.getAttribute('data-id') === id);
    });

    const chatObj = getActiveChat();
    if (!chatObj) {
        renderWelcomeScreen();
        return;
    }

    // Hide welcome, show main details
    welcomeContainer.style.display = 'none';
    chatIdBadge.style.display = 'flex';
    chatIdText.innerText = chatObj.id;
    activeChatTitleInput.value = chatObj.title;
    activeChatTitleInput.disabled = false;

    renderMessages();
    renderJsonPanel();
    renderCostBadge(chatObj);
    startPolling();
}

// Show welcome view
function renderWelcomeScreen() {
    stopPolling();
    welcomeContainer.style.display = 'flex';
    chatIdBadge.style.display = 'none';
    chatCostBadge.style.display = 'none';
    activeChatTitleInput.value = 'Lara Leads';
    activeChatTitleInput.disabled = true;
    // The composer stays enabled here on purpose: typing/sending directly from the hero
    // screen (or clicking a suggestion card) creates a new chat on the fly — see
    // handleSendMessage() and the hero-suggestion-card click handler below.
    chatInput.disabled = false;
    btnSend.disabled = false;
    updateHeaderStatusPill(null);

    // Clear message feed and details panel views
    messagesContainer.innerHTML = '';
    messagesContainer.appendChild(welcomeContainer);

    jsonRequestCode.innerHTML = syntaxHighlight({ status: "Aguardando chat ativo..." });
    jsonResponseCode.innerHTML = syntaxHighlight({ status: "Aguardando chat ativo..." });
}

// Build one chat list item's DOM node (used for both the "Fixado" and "Recentes" groups)
function buildChatItemEl(chat) {
    const chatItem = document.createElement('div');
    chatItem.className = `chat-item ${chat.id === state.activeChatId ? 'active' : ''}`;
    chatItem.setAttribute('data-id', chat.id);

    // Find last real user/lara message preview — always plain text, truncated,
    // never the raw HTML/script a Lara card message might contain.
    const lastMsg = chat.messages.slice().reverse().find(m => m.sender !== 'system');
    const previewText = lastMsg ? toPreviewText(lastMsg.text) : 'Sem mensagens';
    const timestampText = lastMsg ? formatTime(lastMsg.timestamp) : formatTime(chat.createdAt);

    chatItem.innerHTML = `
        <div class="chat-item-content">
            <div class="chat-item-header">
                <span class="chat-item-title">${escapeHtml(chat.title)}</span>
                <span class="chat-item-time">${timestampText}</span>
            </div>
            <div class="chat-item-preview">${escapeHtml(previewText)}</div>
        </div>
        <div class="chat-item-actions">
            <button class="btn-pin-chat ${chat.pinned ? 'pinned' : ''}" title="${chat.pinned ? 'Desafixar' : 'Fixar'} conversa">
                <i data-lucide="pin" class="icon-small"></i>
            </button>
            <button class="btn-delete-chat" title="Excluir Chat">
                <i data-lucide="trash-2" class="icon-small"></i>
            </button>
        </div>
    `;

    // Click to select
    chatItem.addEventListener('click', () => selectChat(chat.id));

    // Pin/unpin button click handler
    const btnPin = chatItem.querySelector('.btn-pin-chat');
    btnPin.addEventListener('click', (e) => togglePinChat(chat.id, e));

    // Delete button click handler
    const btnDelete = chatItem.querySelector('.btn-delete-chat');
    btnDelete.addEventListener('click', (e) => deleteChat(chat.id, e));

    return chatItem;
}

// Render the sidebar chat list, split into "Fixado" (pinned) and "Recentes" groups,
// filtered by whatever the user typed into the sidebar search box.
function renderSidebar() {
    chatListContainer.innerHTML = '';
    chatListPinnedContainer.innerHTML = '';

    const query = sidebarSearchQuery.trim().toLowerCase();
    const filtered = query
        ? state.chats.filter(c => c.title.toLowerCase().includes(query))
        : state.chats;

    const pinned = filtered.filter(c => c.pinned);
    const recent = filtered.filter(c => !c.pinned);

    chatGroupPinned.style.display = pinned.length > 0 ? 'block' : 'none';
    pinned.forEach(chat => chatListPinnedContainer.appendChild(buildChatItemEl(chat)));

    if (filtered.length === 0) {
        chatListContainer.innerHTML = `
            <div class="sidebar-empty">${state.chats.length === 0 ? 'Nenhuma conversa criada' : 'Nenhuma conversa encontrada'}</div>
        `;
    } else {
        recent.forEach(chat => chatListContainer.appendChild(buildChatItemEl(chat)));
    }

    lucide.createIcons();
}

// Render message list for active chat
function renderMessages() {
    const chatObj = getActiveChat();
    if (!chatObj) return;

    // Lock the composer while this chat is waiting on a workflow response,
    // like a standard AI chat UI (ChatGPT/Claude) — unlocks once the reply lands.
    // "closed" is permanent (set when the workflow sends status "finalizado") and never unlocks.
    const locked = isLocked(chatObj);
    chatInput.disabled = locked;
    btnSend.disabled = locked;
    updateHeaderStatusPill(chatObj);

    messagesContainer.innerHTML = '';

    chatObj.messages.forEach(msg => {
        const row = document.createElement('div');
        row.className = `message-row ${msg.sender}`;

        if (msg.sender === 'system') {
            row.innerHTML = `
                <div class="system-bubble">
                    <i data-lucide="info" class="icon-small"></i>
                    <span>${msg.text}</span>
                </div>
            `;
        } else {
            const timeStr = new Date(msg.timestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
            const senderLabel = msg.sender === 'user' ? 'Você' : 'Lara Leads';

            // Format text (detect and format workflow errors beautifully inside the chat bubble)
            let formattedText = msg.text;

            if (msg.text.includes('❌ *Erro no Workflow*') || msg.text.includes('Erro no Workflow')) {
                const wfMatch = msg.text.match(/\*Workflow:\*\s*([^\n<]+)/i) || msg.text.match(/Workflow:\s*([^\n<]+)/i);
                const nodeMatch = msg.text.match(/\*Nó:\*\s*([^\n<]+)/i) || msg.text.match(/Nó:\s*([^\n<]+)/i) || msg.text.match(/\*Node:\*\s*([^\n<]+)/i);
                const errMatch = msg.text.match(/\*Erro:\*\s*([\s\S]+)/i) || msg.text.match(/Erro:\s*([\s\S]+)/i) || msg.text.match(/\*Error:\*\s*([\s\S]+)/i);

                const workflowName = wfMatch ? wfMatch[1].trim() : "Workflow Desconhecido";
                const nodeName = nodeMatch ? nodeMatch[1].trim() : "Nó Desconhecido";
                let errorMessage = errMatch ? errMatch[1].trim() : msg.text;

                // Clean stars
                errorMessage = errorMessage.replace(/\*(.*?)\*/g, '$1');

                formattedText = `
                    <div class="chat-error-card">
                        <div class="chat-error-accent"></div>
                        <div class="chat-error-head">
                            <div class="chat-error-icon">
                                <i data-lucide="alert-triangle"></i>
                            </div>
                            <div>
                                <span class="chat-error-badge">Falha no Workflow</span>
                                <h4>Erro de Execução</h4>
                            </div>
                        </div>
                        <div class="chat-error-grid">
                            <div class="chat-error-field">
                                <div class="chat-error-field-label">Workflow</div>
                                <div class="chat-error-field-value">${escapeHtml(workflowName)}</div>
                            </div>
                            <div class="chat-error-field">
                                <div class="chat-error-field-label">Nó de Falha</div>
                                <div class="chat-error-field-value">${escapeHtml(nodeName)}</div>
                            </div>
                        </div>
                        <div class="chat-error-message">
                            <div class="chat-error-message-label">Mensagem de Erro</div>
                            <pre>${escapeHtml(errorMessage)}</pre>
                        </div>
                    </div>
                `;
            } else if (msg.sender === 'user') {
                // Mensagens do usuário NUNCA viram HTML/script executável, mesmo que o
                // texto comece com "<" — isso é reservado pras respostas da Lara (cards
                // do workflow). Sem isso, digitar "<script>...</script>" na caixa de
                // mensagem executava o script direto na tela (e de novo a cada reabertura
                // do chat, já que a mensagem fica salva no localStorage).
                formattedText = escapeHtml(msg.text).replace(/\n/g, '<br/>');
            } else {
                formattedText = msg.text.trim().startsWith('<')
                    ? msg.text
                    : msg.text.replace(/\n/g, '<br/>');
            }

            row.innerHTML = `
                <div class="message-bubble">
                    <div class="message-content"></div>
                    <div class="message-meta">
                        <span class="message-sender">${senderLabel}</span>
                        <span>•</span>
                        <span class="message-time">${timeStr}</span>
                    </div>
                </div>
            `;
            const contentEl = row.querySelector('.message-content');
            setHtmlWithScripts(contentEl, formattedText);
        }

        messagesContainer.appendChild(row);
    });

    // Keep typing indicator or status log visible at the end while sending/waiting on a workflow
    if (chatObj.workflowState === 'sending' || chatObj.workflowState === 'waiting') {
        const row = document.createElement('div');
        if (chatObj.currentStatusText) {
            row.className = 'message-row lara status-row';
            const hasProgress = typeof chatObj.currentStatusProgress === 'number' && !Number.isNaN(chatObj.currentStatusProgress);
            const pct = hasProgress ? Math.max(0, Math.min(100, chatObj.currentStatusProgress)) : null;
            row.innerHTML = `
                <div class="message-bubble">
                    <div class="status-row-top">
                        <i data-lucide="loader-2" class="icon-spin"></i>
                        <span class="status-label">Status:</span>
                        <span class="status-text">${escapeHtml(chatObj.currentStatusText)}</span>
                        ${hasProgress ? `<span class="status-percent">${Math.round(pct)}%</span>` : ''}
                    </div>
                    ${hasProgress ? `
                    <div class="status-progress-track">
                        <div class="status-progress-fill" style="width: ${pct}%"></div>
                    </div>` : ''}
                </div>
            `;
        } else {
            row.className = 'message-row lara typing-row';
            row.innerHTML = `
                <div class="message-bubble">
                    <div class="typing-indicator">
                        <span class="typing-dot"></span>
                        <span class="typing-dot"></span>
                        <span class="typing-dot"></span>
                    </div>
                </div>
            `;
        }
        messagesContainer.appendChild(row);
    }

    lucide.createIcons();
    scrollChatToBottom();
}

function scrollChatToBottom() {
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// Render active chat details panel JSON view
function renderJsonPanel() {
    const chatObj = getActiveChat();
    if (!chatObj) return;

    if (chatObj.lastRequestJson) {
        jsonRequestCode.innerHTML = syntaxHighlight(chatObj.lastRequestJson);
    } else {
        jsonRequestCode.innerHTML = syntaxHighlight({ status: "Ainda nenhuma mensagem enviada neste chat." });
    }

    if (chatObj.lastResponseJson) {
        jsonResponseCode.innerHTML = syntaxHighlight(chatObj.lastResponseJson);
    } else {
        jsonResponseCode.innerHTML = syntaxHighlight({ status: "Aguardando primeira resposta do workflow..." });
    }
}

// --- API & Simulators Logic ---

// Send user message (from the textarea). If no chat is active yet (the hero/welcome
// screen), typing directly and sending creates a new chat on the fly first — same
// entry point used by the hero-suggestion-card clicks below.
async function handleSendMessage() {
    const text = chatInput.value.trim();
    if (text === '') return;

    let chatObj = getActiveChat();
    if (!chatObj) {
        createNewChat();
        chatObj = getActiveChat();
    }
    if (!chatObj || isLocked(chatObj)) return;

    const workflowHint = inputWorkflowHint.value.trim();

    // Clear message input
    chatInput.value = '';
    inputWorkflowHint.value = '';

    // Auto-adjust height
    chatInput.style.height = '24px';

    await sendMessageText(text, { workflowHint });
}

// Core send routine, shared by the textarea (handleSendMessage) and by
// clickable option cards rendered inside a Lara message (handleQuickReplyClick).
// extra: { workflowHint?: string, meta?: object, payloadMessage?: string } — `meta` is
// merged into meta.extra alongside workflow_hint, so a card click can carry structured
// data (ids, urls, etc.) to the webhook without depending on parsing the visible label
// text. `payloadMessage`, when given, overrides what's sent as the top-level "message"
// field to n8n while `text` still drives the chat bubble/title — this is how a
// quick-reply-option selection can show just the name in the UI while the webhook
// receives the id(s).
async function sendMessageText(text, extra = {}) {
    const chatObj = getActiveChat();
    if (!chatObj || !text || isLocked(chatObj)) return;

    const workflowHint = extra.workflowHint || '';
    const payloadMessage = extra.payloadMessage || text;

    // 1. Append User Message
    const userMsgSeq = chatObj.messages.filter(m => m.sender === 'user').length + 1;
    const messageId = `MSG-${String(userMsgSeq).padStart(4, '0')}`;
    const userMsg = {
        message_id: messageId,
        sender: 'user',
        text: text,
        timestamp: new Date().toISOString()
    };
    chatObj.messages.push(userMsg);
    chatObj.lastActive = new Date().toISOString();

    // Rename as soon as the first message is sent — don't wait for a reply that
    // (in async mode) might take a while, or might arrive out of order.
    if (chatObj.title === "Novo chat") {
        const summarizedTitle = text.slice(0, 20) + (text.length > 20 ? '...' : '');
        renameActiveChat(`Chat - ${summarizedTitle}`);
    }

    renderMessages();
    renderSidebar();

    // 2. Generate Workflow Payload JSON (wrapped in array as required by A2W Leads format)
    const requestPayload = [
        {
            tenant_id: state.settings.tenant_id,
            tenant_name: state.settings.tenant_name,
            user_id: state.settings.user_id,
            chat_id: chatObj.id,
            message_id: messageId,
            channel: "web_chat",
            timestamp: getLocalISOTimestamp(),
            message: payloadMessage,
            meta: {
                ip: state.settings.ip,
                user_agent: state.settings.user_agent,
                page: state.settings.page,
                session_id: state.settings.session_id
            }
        }
    ];

    if (workflowHint || extra.meta) {
        requestPayload[0].meta.extra = Object.assign(
            workflowHint ? { workflow_hint: workflowHint } : {},
            extra.meta || {}
        );
    }

    chatObj.lastRequestJson = requestPayload;
    renderJsonPanel();
    saveState();

    // Focus Request Tab
    tabRequest.click();

    // 3. Trigger API Call
    chatObj.workflowState = 'sending';
    chatObj.currentStatusText = null;
    chatObj.currentStatusProgress = null;
    // A poll from the previous wait cycle may still be in flight (e.g. the user
    // clicked a card's confirm button right as a slow /api/poll was returning) — bump
    // the generation so its (now stale) result gets dropped instead of clobbering the
    // fresh state we just set above.
    pollGeneration++;
    renderMessages();

    // In custom-webhook mode, the workflow may answer synchronously (the HTTP response
    // already carries the final reply) or asynchronously (this response is just an ACK,
    // with the real answer arriving later via /api/callback or /api/status, picked up by polling).
    // The sync response's own "status" field tells us which: "processing" means more is
    // coming, anything else (including no status at all) means this reply is already final.
    const isAsyncMode = (state.settings.apiMode === 'custom-webhook');

    try {
        const responseData = await executeWorkflowCall(requestPayload);

        // 4. Save API Response & Render Lara Message
        chatObj.lastResponseJson = responseData;

        if (isAsyncMode) {
            // If the sync response already contains a reply, show it as a Lara message first,
            // then apply its status. "finalizado" always locks the chat afterwards — even for
            // an HTML reply (card, preview, etc.) that would otherwise mean "waiting on the
            // user". Anything else: an HTML reply unlocks immediately regardless of status; a
            // plain "processing" reply keeps waiting for the real answer, which will still
            // arrive later via /api/callback (picked up by polling).
            if (responseData.reply) {
                chatObj.messages.push({
                    message_id: generateUUID(),
                    sender: 'lara',
                    text: responseData.reply,
                    timestamp: new Date().toISOString()
                });
            }

            const finalized = applyWorkflowStatus(chatObj, responseData.status, responseData.reply);
            if (!finalized && isHtmlReply(responseData.reply)) {
                chatObj.workflowState = 'idle';
            }
        } else {
            // SYNC/MOCK MODE: response IS the final answer.
            chatObj.messages.push({
                message_id: generateUUID(),
                sender: 'lara',
                text: responseData.reply || 'Erro na resposta simulada do workflow.',
                timestamp: new Date().toISOString()
            });
            applyWorkflowStatus(chatObj, responseData.status, responseData.reply);
        }

        saveState();
        renderMessages();
        renderJsonPanel();

        // Switch to Response Tab to see feedback
        tabResponse.click();

    } catch (err) {
        chatObj.workflowState = 'idle';
        console.error(err);

        const errorMsg = {
            message_id: generateUUID(),
            sender: 'system',
            text: `Erro ao integrar com o workflow: ${err.message}`,
            timestamp: new Date().toISOString()
        };
        chatObj.messages.push(errorMsg);

        chatObj.lastResponseJson = {
            error: true,
            message: err.message,
            timestamp: new Date().toISOString()
        };

        saveState();
        renderMessages();
        renderJsonPanel();
        tabResponse.click();
    }
}

// Executes HTTP request or frontend mock depending on settings
async function executeWorkflowCall(payload) {
    const mode = state.settings.apiMode;

    if (mode === 'mock-browser') {
        // Front-end Simulation Mode
        return new Promise((resolve) => {
            setTimeout(() => {
                const payloadObj = Array.isArray(payload) ? payload[0] : payload;
                // Generate a custom contextual mock response based on words in the user's message
                let reply = `Entendi sua mensagem sobre "${payloadObj.message.slice(0, 35)}...". (Resposta simulada no Navegador para o chat: ${payloadObj.chat_id.slice(0, 8)})`;

                // Add conditional hints response for extra realism!
                if (payloadObj.meta && payloadObj.meta.extra && payloadObj.meta.extra.workflow_hint) {
                    reply += `\n\n📌 Roteamento ativado pelo hint: "${payloadObj.meta.extra.workflow_hint}"`;
                }

                resolve({
                    reply: reply,
                    status: "ok",
                    next_action: (payloadObj.meta && payloadObj.meta.extra && payloadObj.meta.extra.workflow_hint) ? `dispatch_to_${payloadObj.meta.extra.workflow_hint}` : null,
                    mocked_at: new Date().toISOString()
                });
            }, 1000); // 1s simulation delay
        });
    }

    let url = '/api/mock-workflow'; // relative for local server mode
    let options = {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload)
    };

    if (mode === 'custom-webhook') {
        const targetWebhook = state.settings.webhookUrl;
        if (!targetWebhook) {
            throw new Error('A URL do webhook real está vazia. Configure-a no painel superior.');
        }

        // If hosted by local server, proxy request to bypass CORS
        if (window.location.protocol !== 'file:') {
            url = '/api/proxy-webhook';
            options.body = JSON.stringify({
                target_url: targetWebhook,
                payload: payload
            });
        } else {
            // file:// protocol: try using local server proxy first
            try {
                const proxyResponse = await fetch('http://localhost:3000/api/proxy-webhook', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        target_url: targetWebhook,
                        payload: payload
                    })
                });
                if (proxyResponse.ok) {
                    return await proxyResponse.json();
                }
            } catch (proxyErr) {
                // If local server is not running, fallback to direct fetch
                url = targetWebhook;
            }
        }
    } else {
        if (window.location.protocol === 'file:') {
            url = 'http://localhost:3000/api/mock-workflow';
        }
    }

    // Only fetch if we didn't return via the proxy check above
    const response = await fetch(url, options);
    if (!response.ok) {
        throw new Error(`Servidor respondeu com status ${response.status}: ${response.statusText}`);
    }

    return await response.json();
}

// --- Polling for Async n8n responses (replaces the old SSE /api/stream) ---
// SSE needs a persistent connection between the browser and the server process —
// that doesn't survive moving the backend to Vercel serverless functions (no shared
// memory or open connection between invocations). Polling GET /api/poll every couple
// seconds works identically whether the backend is the local server.js (in-memory) or
// the Vercel functions (Supabase-backed) — see POLLING.md.
const POLL_INTERVAL_MS = 2000;
let chatPollTimer = null;

// Bumped whenever the "current cycle" for the active chat is invalidated by a more
// recent action (sending a new message resets the wait) — a poll that was already
// in flight when that happens must not apply its (now stale) result on top of the
// fresh state. SSE never had this problem (strict push order); polling can have
// two requests in flight at once (a slow one from before + the next 2s tick), and
// nothing guarantees the older one's response arrives first.
let pollGeneration = 0;

function stopPolling() {
    if (chatPollTimer) {
        clearInterval(chatPollTimer);
        chatPollTimer = null;
    }
}

async function pollOnce(chatId, generation) {
    let url = `/api/poll?chat_id=${chatId}`;
    if (window.location.protocol === 'file:') {
        url = `http://localhost:3000/api/poll?chat_id=${chatId}`;
    }

    let data;
    try {
        const res = await fetch(url);
        data = await res.json();
    } catch (err) {
        console.error('Erro ao consultar /api/poll:', err);
        return;
    }

    // A newer action (new message sent, chat switched) superseded this request
    // while it was in flight — its result is stale, drop it.
    if (generation !== pollGeneration) return;

    // The active chat may have changed (or the chat list may have been cleared)
    // while this request was in flight — never apply a stale poll's result.
    const activeChatObj = getActiveChat();
    if (!activeChatObj || activeChatObj.id !== chatId) return;

    // 1) New async replies (equivalent to the old SSE "message" event)
    let messagesChanged = false;
    (data.messages || []).forEach(msg => {
        if (activeChatObj.messages.some(m => m.message_id === msg.message_id)) return;

        activeChatObj.messages.push({
            message_id: msg.message_id || generateUUID(),
            sender: 'lara',
            text: msg.reply,
            timestamp: msg.timestamp || new Date().toISOString()
        });
        activeChatObj.lastResponseJson = msg.raw_payload || msg;

        // Drive workflowState from the callback's status field — "finalizado" always locks
        // the chat, even for an HTML reply (a card, a preview, any rendered UI) that would
        // otherwise unlock it as "waiting on the user".
        const status = msg.status || (msg.raw_payload && msg.raw_payload.status) || 'ok';
        applyWorkflowStatus(activeChatObj, status, msg.reply);
        messagesChanged = true;
    });

    // 2) Real-time accumulated cost of this chat (not mock-browser) — old SSE "cost" event
    let costChanged = false;
    if (state.settings.apiMode !== 'mock-browser' && data.cost && data.cost.total !== undefined) {
        const changed = data.cost.total !== activeChatObj.costTotal || data.cost.currency !== activeChatObj.costCurrency;
        if (changed) {
            activeChatObj.costTotal = data.cost.total || 0;
            activeChatObj.costCurrency = data.cost.currency || 'BRL';
            costChanged = true;
        }
    }

    // 3) Progress caption + the permanent "finalizado" signal — old SSE "status" event
    let statusChanged = false;
    if (state.settings.apiMode !== 'mock-browser' && activeChatObj.workflowState !== 'closed' &&
        data.status && data.status.status !== undefined && data.status.status !== null) {
        const normalizedStatus = String(data.status.status).trim().toLowerCase();
        const incomingProgress = (data.status.progress !== undefined && data.status.progress !== null && !Number.isNaN(Number(data.status.progress)))
            ? Number(data.status.progress)
            : null;

        if (normalizedStatus === 'finalizado') {
            activeChatObj.workflowState = 'closed';
            activeChatObj.currentStatusText = null;
            activeChatObj.currentStatusProgress = null;
            activeChatObj.messages.push({
                message_id: generateUUID(),
                sender: 'system',
                text: 'Conversa finalizada pelo workflow. Este chat não pode mais enviar ou receber mensagens.',
                timestamp: new Date().toISOString()
            });
            statusChanged = true;
        } else {
            // A status ping is proof the workflow is still working, even if the initial
            // sync ACK didn't say "processing" (e.g. it only sent a generic ack before
            // continuing async) — re-lock the chat so the caption below has somewhere to render.
            const stateChanged = activeChatObj.workflowState !== 'waiting';
            const captionChanged = activeChatObj.currentStatusText !== data.status.status || activeChatObj.currentStatusProgress !== incomingProgress;
            if (stateChanged || captionChanged) {
                activeChatObj.workflowState = 'waiting';
                activeChatObj.currentStatusText = data.status.status;
                activeChatObj.currentStatusProgress = incomingProgress;
                statusChanged = true;
            }
        }
    }

    if (messagesChanged || statusChanged) {
        saveState();
        renderMessages();
        if (messagesChanged) renderJsonPanel();
    }
    if (costChanged) {
        saveState();
        renderCostBadge(activeChatObj, true);
    }

    // Once closed, nothing else can ever arrive for this chat — stop polling it.
    if (activeChatObj.workflowState === 'closed') stopPolling();
}

function startPolling() {
    stopPolling();

    const chatObj = getActiveChat();
    if (!chatObj || chatObj.workflowState === 'closed') return;

    pollGeneration++; // Invalidate any poll still in flight from before this (re)start.
    const chatId = chatObj.id;
    // Read pollGeneration fresh on every call (not captured once) — a later action
    // (sendMessageText bumping it) must only invalidate polls already in flight at
    // that moment, not every future tick of this same interval.
    pollOnce(chatId, pollGeneration); // Read immediately instead of waiting out the first interval.
    chatPollTimer = setInterval(() => pollOnce(chatId, pollGeneration), POLL_INTERVAL_MS);
}

// --- Copy Controls ---
function bindCopyControl(button, codeElement) {
    button.addEventListener('click', () => {
        const text = codeElement.innerText;
        navigator.clipboard.writeText(text).then(() => {
            const originalHTML = button.innerHTML;
            button.innerHTML = '<i data-lucide="check" class="icon-small"></i><span>Copiado!</span>';
            lucide.createIcons();
            setTimeout(() => {
                button.innerHTML = originalHTML;
                lucide.createIcons();
            }, 1500);
        }).catch(err => {
            console.error('Failed to copy text: ', err);
        });
    });
}

// Copy Chat ID Badge
btnCopyId.addEventListener('click', () => {
    const text = chatIdText.innerText;
    navigator.clipboard.writeText(text).then(() => {
        const originalHTML = btnCopyId.innerHTML;
        btnCopyId.innerHTML = '<i data-lucide="check" class="icon-small"></i>';
        lucide.createIcons();
        setTimeout(() => {
            btnCopyId.innerHTML = originalHTML;
            lucide.createIcons();
        }, 1500);
    });
});

// --- Textarea Autogrow and Keyboard binds ---
chatInput.addEventListener('input', function() {
    this.style.height = '24px';
    this.style.height = (this.scrollHeight - 6) + 'px';
});

chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSendMessage();
    }
});

btnSend.addEventListener('click', handleSendMessage);
btnNewChat.addEventListener('click', () => createNewChat());

// --- Hero suggestion cards (welcome screen "objetivo comercial" shortcuts) ---
// Clicking one fills the composer with its prompt and sends it immediately, creating a
// new chat on the fly (same path as typing directly into the hero screen and hitting Enter).
document.querySelectorAll('.hero-suggestion-card').forEach(card => {
    card.addEventListener('click', () => {
        const text = card.dataset.text;
        if (!text) return;
        chatInput.value = text;
        handleSendMessage();
    });
});

// --- Clickable option cards inside a Lara message (e.g. "choose one of these companies") ---
// Contract: any element with class "quick-reply-option" and a "data-label" attribute
// becomes clickable. Clicking it shows data-label as the chat bubble text, exactly like
// typing it and hitting Enter. Optional "data-id" makes the *actual* webhook "message"
// field become "<id> (<label>)" instead of the plain label — so n8n gets the id to match
// on reliably while the UI still shows only the human-readable name. Optional "data-extra"
// (a JSON string) is additionally merged into meta.extra for any other structured data
// (urls, flags, etc.).
messagesContainer.addEventListener('click', (e) => {
    const card = e.target.closest('.quick-reply-option');
    if (!card || card.classList.contains('disabled')) return;

    const chatObj = getActiveChat();
    if (isLocked(chatObj)) return;

    const label = card.dataset.label;
    if (!label) return;

    let extraMeta = null;
    if (card.dataset.extra) {
        try {
            extraMeta = JSON.parse(card.dataset.extra);
        } catch (err) {
            console.warn('quick-reply-option: data-extra não é JSON válido', err);
        }
    }

    const id = card.dataset.id;
    const sendOpts = {};
    if (extraMeta) sendOpts.meta = extraMeta;
    if (id) sendOpts.payloadMessage = `${id} (${label})`;

    sendMessageText(label, sendOpts);
});

// --- Multi-select option cards inside a Lara message (pick one or more, then confirm) ---
// Contract: wrap a list of ".quick-reply-multi-option" rows (each with a "data-label") plus
// a ".quick-reply-confirm-btn" button inside a ".quick-reply-multi-select" container.
// Clicking a row just toggles its "selected" state (no send). Clicking the confirm button
// sends a single message: the chat bubble always shows just the selected data-label names
// joined with ", ". If every selected row also has a "data-id", the webhook "message" field
// instead becomes "<id> (<label>), <id> (<label>), ..." so n8n gets the id(s) to match on
// reliably — if any selected row is missing data-id, it falls back to names only. Then the
// whole group is disabled so it can't be submitted twice. A row can also carry an
// "unavailable" class (e.g. an item that isn't eligible yet) — it's inert and never
// toggles/selects.
function updateMultiSelectConfirmButton(group) {
    const btn = group.querySelector('.quick-reply-confirm-btn');
    if (!btn) return;
    const count = group.querySelectorAll('.quick-reply-multi-option.selected').length;
    btn.disabled = count === 0;
    btn.textContent = count > 0 ? `Confirmar seleção (${count})` : 'Selecione ao menos uma empresa';
}

messagesContainer.addEventListener('click', (e) => {
    const row = e.target.closest('.quick-reply-multi-option');
    if (row) {
        if (row.classList.contains('unavailable')) return;
        const group = row.closest('.quick-reply-multi-select');
        if (!group || group.classList.contains('disabled')) return;
        row.classList.toggle('selected');
        updateMultiSelectConfirmButton(group);
        return;
    }

    const confirmBtn = e.target.closest('.quick-reply-confirm-btn');
    if (confirmBtn) {
        if (confirmBtn.disabled) return;
        const group = confirmBtn.closest('.quick-reply-multi-select');
        if (!group || group.classList.contains('disabled')) return;

        const chatObj = getActiveChat();
        if (isLocked(chatObj)) return;

        const selected = Array.from(group.querySelectorAll('.quick-reply-multi-option.selected'));
        if (selected.length === 0) return;

        const names = selected.map(c => c.dataset.label).join(', ');
        const hasIds = selected.every(c => c.dataset.id);
        const payloadMessage = hasIds
            ? selected.map(c => `${c.dataset.id} (${c.dataset.label})`).join(', ')
            : names;

        group.classList.add('disabled');
        sendMessageText(names, hasIds ? { payloadMessage } : {});
    }
});

// --- "New chat" action button inside a Lara message (e.g. "no results, start a new search") ---
// Contract: any element with class "quick-reply-new-chat-btn" starts a brand new chat when
// clicked (same as the sidebar's "+ Novo chat" button) — it does NOT send anything to the
// webhook, it just gives the user an escape hatch when the current thread hit a dead end.
messagesContainer.addEventListener('click', (e) => {
    const btn = e.target.closest('.quick-reply-new-chat-btn');
    if (!btn) return;
    createNewChat();
});

// --- Status Simulation Flow ---
async function triggerStatusSimulation() {
    const chatObj = getActiveChat();
    if (!chatObj) {
        alert("Por favor, crie ou selecione uma conversa primeiro.");
        return;
    }

    // Add simulated user message
    const userMsgSeq = chatObj.messages.filter(m => m.sender === 'user').length + 1;
    const messageId = `MSG-${String(userMsgSeq).padStart(4, '0')}`;
    const userMsg = {
        message_id: messageId,
        sender: 'user',
        text: "Simular processamento de leads com logs de status",
        timestamp: new Date().toISOString()
    };
    chatObj.messages.push(userMsg);
    chatObj.lastActive = new Date().toISOString();

    renderMessages();
    renderSidebar();

    chatObj.workflowState = 'waiting';
    chatObj.currentStatusText = "Iniciando fluxo...";
    chatObj.currentStatusProgress = 0;
    renderMessages();

    // Prepare request payload for display in JSON panel
    const requestPayload = [
        {
            tenant_id: state.settings.tenant_id,
            tenant_name: state.settings.tenant_name,
            user_id: state.settings.user_id,
            chat_id: chatObj.id,
            message_id: messageId,
            channel: "web_chat",
            timestamp: getLocalISOTimestamp(),
            message: userMsg.text,
            meta: {
                ip: state.settings.ip,
                user_agent: state.settings.user_agent,
                page: state.settings.page,
                session_id: state.settings.session_id,
                extra: { workflow_hint: "simulacao_status" }
            }
        }
    ];
    chatObj.lastRequestJson = requestPayload;
    renderJsonPanel();

    // Focus Request Tab
    tabRequest.click();

    const mode = state.settings.apiMode;

    if (mode === 'mock-browser') {
        // Browser only simulation
        setTimeout(() => {
            if (state.activeChatId !== chatObj.id) return;
            chatObj.currentStatusText = "1/3 - Conectando à base de dados do CRM...";
            chatObj.currentStatusProgress = 33;
            renderMessages();
        }, 1500);

        setTimeout(() => {
            if (state.activeChatId !== chatObj.id) return;
            chatObj.currentStatusText = "2/3 - Extraindo leads da campanha...";
            chatObj.currentStatusProgress = 66;
            renderMessages();
        }, 3500);

        setTimeout(() => {
            if (state.activeChatId !== chatObj.id) return;
            chatObj.currentStatusText = "3/3 - Filtrando contatos válidos e gerando relatório...";
            chatObj.currentStatusProgress = 100;
            renderMessages();
        }, 5500);

        setTimeout(() => {
            if (state.activeChatId !== chatObj.id) return;
            chatObj.workflowState = 'idle';
            chatObj.currentStatusText = null;
            chatObj.currentStatusProgress = null;

            const responseData = {
                reply: "Processamento concluído com sucesso! (Navegador) Encontrei 42 leads qualificados para a sua campanha e eles já foram sincronizados com seu CRM.",
                status: "ok",
                timestamp: new Date().toISOString()
            };

            chatObj.lastResponseJson = responseData;
            chatObj.messages.push({
                message_id: generateUUID(),
                sender: 'lara',
                text: responseData.reply,
                timestamp: new Date().toISOString()
            });

            saveState();
            renderMessages();
            renderJsonPanel();
            tabResponse.click();
        }, 7500);
    } else {
        // Server-side Simulation
        let url = '/api/simulate-async-status';
        if (window.location.protocol === 'file:') {
            url = 'http://localhost:3000/api/simulate-async-status';
        }

        try {
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ chat_id: chatObj.id })
            });

            if (res.ok) {
                const data = await res.json();
                chatObj.lastResponseJson = data;
                renderJsonPanel();
                tabResponse.click();
            } else {
                throw new Error("Erro ao iniciar simulação no servidor.");
            }
        } catch (err) {
            chatObj.workflowState = 'idle';
            chatObj.currentStatusText = null;
            chatObj.currentStatusProgress = null;
            chatObj.messages.push({
                message_id: generateUUID(),
                sender: 'system',
                text: `Erro ao conectar com o servidor local: ${err.message}`,
                timestamp: new Date().toISOString()
            });
            renderMessages();
        }
    }
}

if (btnDemoStatus) {
    btnDemoStatus.addEventListener('click', () => {
        // Collapse settings panel when starting simulation to show chat
        settingsPanel.classList.add('collapsed');
        btnToggleSettings.classList.remove('active');
        triggerStatusSimulation();
    });
}

if (btnDemoError) {
    btnDemoError.addEventListener('click', () => {
        // Collapse settings panel
        settingsPanel.classList.add('collapsed');
        btnToggleSettings.classList.remove('active');

        // Simulating the exact payload structure of the user's workflow error node
        const payload = {
            mensagem: `❌ *Erro no Workflow*

*Workflow:* Roteamento Inteligente de Leads
*Nó:* Enviar para CRM ActiveCampaign
*Erro:* 403 Forbidden - Api key invalid or expired`
        };

        // Post error to the backend
        fetch('/api/error', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify(payload)
        })
        .then(res => {
            // Open the error screen in a new tab
            window.open('/error', '_blank');
        })
        .catch(err => {
            console.error('Failed to post error payload to server, loading client fallback', err);
            // Fallback for mock-browser (no active backend): open directly via query string!
            const queryParams = new URLSearchParams({
                mensagem: payload.mensagem
            });
            window.open(`error.html?${queryParams.toString()}`, '_blank');
        });
    });
}

// Rename chat title input event listeners
activeChatTitleInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        activeChatTitleInput.blur();
    }
});

activeChatTitleInput.addEventListener('blur', () => {
    renameActiveChat(activeChatTitleInput.value);
});

// --- Initializer ---
document.addEventListener('DOMContentLoaded', () => {
    loadState();
    updateThemeUI();
    initPanels();
    loadSettingsToUI();
    bindSettingsEvents();
    renderSidebar();

    if (state.activeChatId) {
        selectChat(state.activeChatId);
    } else {
        renderWelcomeScreen();
    }

    // Bind JSON panel copy buttons
    bindCopyControl(btnCopyReq, jsonRequestCode);
    bindCopyControl(btnCopyRes, jsonResponseCode);
});
