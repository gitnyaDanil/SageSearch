/* ─────────────────────────────────────────────────────────────────────────
   DocSearch — Frontend Application Logic
   Handles: chat flow, API calls, file card rendering, sidebar state
───────────────────────────────────────────────────────────────────────── */

const API = 'http://localhost:3001/api';

// Recent searches (persisted to localStorage)
const RECENT_KEY = 'sagesearch_recent';
const MAX_RECENT  = 20;

// ─── Lucide Icon Map per file category ───────────────────────────────────

const CATEGORY_ICON = {
  document: 'file-text',
  image:    'image',
  video:    'film',
  audio:    'music',
  other:    'file',
};

// ─── DOM References ───────────────────────────────────────────────────────

const messagesEl   = document.getElementById('messages');
const welcomeEl    = document.getElementById('welcome');
const searchInput  = document.getElementById('search-input');
const sendBtn      = document.getElementById('send-btn');
const recentList   = document.getElementById('recent-list');
const folderList   = document.getElementById('folder-list');
const addLocationBtn = document.getElementById('add-location-btn');
const statusPill   = document.getElementById('status-pill');
const statusDot    = document.getElementById('status-dot');
const statusLabel  = document.getElementById('status-label');
const settingsBtn = document.getElementById('settings-btn');
const settingsDialog = document.getElementById('settings-dialog');
const settingsForm = document.getElementById('settings-form');
const localSettings = document.getElementById('local-settings');
const lmEndpoint = document.getElementById('lm-endpoint');
const lmModel = document.getElementById('lm-model');
const settingsError = document.getElementById('settings-error');

// Agent Mode DOM References
const modeSearchBtn   = document.getElementById('mode-search-btn');
const modeAgentBtn    = document.getElementById('mode-agent-btn');
const searchView      = document.getElementById('search-view');
const agentView       = document.getElementById('agent-view');
const agentWelcome    = document.getElementById('agent-welcome');
const agentWorkflow   = document.getElementById('agent-workflow');
const inputHint       = document.getElementById('input-hint');

let currentMode = 'search';
let activeAgentTaskId = null;

// ─── Initialization ───────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  lucide.createIcons();
  checkLMStudioHealth();
  loadFolders();
  renderRecentSearches();
  bindEvents();
  searchInput.focus();
});

// ─── Event Bindings ───────────────────────────────────────────────────────

function bindEvents() {
  // Mode switcher tabs
  if (modeSearchBtn && modeAgentBtn) {
    modeSearchBtn.addEventListener('click', () => switchMode('search'));
    modeAgentBtn.addEventListener('click', () => switchMode('agent'));
  }

  // Send on Enter (but Shift+Enter = newline if we ever add textarea)
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  sendBtn.addEventListener('click', sendMessage);
  addLocationBtn.addEventListener('click', addLocation);
  settingsBtn.addEventListener('click', openSettings);
  document.getElementById('settings-close-btn').addEventListener('click', () => settingsDialog.close());
  document.getElementById('settings-cancel-btn').addEventListener('click', () => settingsDialog.close());
  settingsForm.addEventListener('submit', saveSettings);
  settingsForm.querySelectorAll('input[name="provider-mode"]').forEach((input) => input.addEventListener('change', updateLocalSettingsVisibility));

  // Search Example chips
  document.querySelectorAll('.chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      const query = chip.dataset.query;
      if (query) {
        searchInput.value = query;
        sendMessage();
      }
    });
  });

  // Agent Recipe cards
  document.querySelectorAll('.recipe-card').forEach((card) => {
    card.addEventListener('click', () => {
      const goal = card.dataset.agentGoal;
      if (goal) {
        switchMode('agent');
        searchInput.value = goal;
        startAgentGoal(goal);
      }
    });
  });
}

function switchMode(mode) {
  currentMode = mode;
  if (mode === 'search') {
    modeSearchBtn.classList.add('active');
    modeAgentBtn.classList.remove('active');
    searchView.hidden = false;
    searchView.classList.add('active');
    agentView.hidden = true;
    agentView.classList.remove('active');
    searchInput.placeholder = "Describe what you're looking for…";
    if (inputHint) inputHint.innerHTML = "SageSearch starts a new search each time you press <kbd>Enter</kbd> &middot; File metadata stays on your device";
  } else {
    modeAgentBtn.classList.add('active');
    modeSearchBtn.classList.remove('active');
    agentView.hidden = false;
    agentView.classList.add('active');
    searchView.hidden = true;
    searchView.classList.remove('active');
    searchInput.placeholder = "Describe an autonomous goal (e.g. Find receipts and create expense CSV)…";
    if (inputHint) inputHint.innerHTML = "Taskmaster Agent plans & executes multi-step file workflows with Google Gemini";
  }
  searchInput.focus();
}

function updateLocalSettingsVisibility() {
  localSettings.hidden = settingsForm.elements['provider-mode'].value !== 'local';
}

async function openSettings() {
  settingsError.textContent = '';
  try {
    const settings = await fetch(`${API}/settings`).then((response) => response.json());
    settingsForm.elements['provider-mode'].value = settings.provider.mode;
    lmEndpoint.value = settings.provider.local.endpoint || 'http://localhost:1234';
    lmModel.value = settings.provider.local.model || '';
    updateLocalSettingsVisibility();
    settingsDialog.showModal();
  } catch {
    settingsError.textContent = 'Cannot load settings while the backend is offline.';
    settingsDialog.showModal();
  }
}

async function saveSettings(event) {
  event.preventDefault();
  settingsError.textContent = '';
  const mode = settingsForm.elements['provider-mode'].value;
  const response = await fetch(`${API}/settings/provider`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode, local: { endpoint: lmEndpoint.value, model: lmModel.value } }),
  });
  if (!response.ok) {
    settingsError.textContent = (await response.json().catch(() => ({}))).error || 'Could not save settings.';
    return;
  }
  settingsDialog.close();
  checkLMStudioHealth();
}

// ─── LM Studio Health Check ───────────────────────────────────────────────

async function checkLMStudioHealth() {
  try {
    const res  = await fetch(`${API}/health`);
    const data = await res.json();
    updateIndexingNotice(data.index);
    if (data.connected) {
      const indexing = data.index?.indexing ? ' · Indexing…' : '';
      const provider = data.provider || 'AI';
      const model = data.model && data.model !== provider ? ` · ${data.model}` : '';
      setStatus('connected', `${provider}${model}${indexing}`);
      removeOfflineBanner();
    } else {
      setStatus('error', `${data.provider || 'AI'} unavailable`);
      showOfflineBanner(data.troubleshoot);
    }
  } catch {
    setStatus('error', 'Backend offline — run: node server.js');
    showOfflineBanner(null);
  }
}

function showOfflineBanner(steps) {
  // Only show once
  if (document.getElementById('offline-banner')) return;

  const banner = document.createElement('div');
  banner.id = 'offline-banner';
  banner.className = 'offline-banner glass';
  banner.innerHTML = `
    <div class="offline-header">
      <i data-lucide="wifi-off"></i>
      <strong>Search interpretation is unavailable</strong>
    </div>
    <ol class="offline-steps">
      <li>Open <strong>LM Studio</strong></li>
      <li>Click the <strong>&lt;/&gt; Developer</strong> icon in the left sidebar</li>
      <li>Toggle <strong>"Enable Local Server"</strong> to ON</li>
      <li>Make sure a model is loaded (Chat tab)</li>
      <li>Come back here — it reconnects automatically every 15 seconds</li>
    </ol>
    <p class="offline-note">
      <i data-lucide="info"></i>
      Default port: <code>1234</code>. Change in <code>backend/config.json</code> if different.
    </p>
  `;

  if (steps?.message) {
    const legacySteps = banner.querySelector('.offline-steps');
    if (legacySteps) {
      const message = document.createElement('p');
      message.className = 'offline-note';
      message.textContent = steps.message;
      legacySteps.replaceWith(message);
    }
  }

  // Insert at top of messages, before welcome
  messagesEl.insertBefore(banner, messagesEl.firstChild);
  lucide.createIcons({ nodes: [banner] });
}

function removeOfflineBanner() {
  const el = document.getElementById('offline-banner');
  if (el) el.remove();
}

function updateIndexingNotice(index) {
  const existing = document.getElementById('indexing-notice');
  if (!index?.indexing) {
    if (existing) existing.remove();
    return;
  }
  if (existing) return;

  const notice = document.createElement('div');
  notice.id = 'indexing-notice';
  notice.className = 'offline-banner glass indexing-banner';
  notice.innerHTML = `
    <div class="offline-header"><i data-lucide="loader-circle"></i><strong>Indexing your search locations...</strong></div>
    <p class="offline-note">First-time scans can briefly slow the local server. Searches use files already indexed and become more complete as indexing finishes.</p>
  `;
  messagesEl.insertBefore(notice, messagesEl.firstChild);
  lucide.createIcons({ nodes: [notice] });
}

function setStatus(state, label) {
  statusPill.className = `status-pill status-${state}`;
  statusLabel.textContent = label;
}

// ─── Load Search Folders into Sidebar ────────────────────────────────────

async function loadFolders() {
  try {
    const res     = await fetch(`${API}/folders`);
    const folders = await res.json();

    folderList.innerHTML = '';
    folders.forEach(({ id, name, path, status, exists, file_count, indexed_at }) => {
      const li = document.createElement('li');
      const locationStatus = !exists || status === 'disconnected' ? 'disconnected' : status;
      li.className = `folder-item location-${locationStatus}`;
      const statusText = locationStatus === 'indexing'
        ? 'Indexing…'
        : locationStatus === 'disconnected'
          ? 'Disconnected'
          : `${file_count || 0} indexed`;
      li.innerHTML = `
        <i data-lucide="${locationStatus === 'disconnected' ? 'hard-drive-off' : 'folder'}"></i>
        <span class="location-name" title="${escHtml(path)}">${escHtml(name)}</span>
        <span class="location-status" title="${indexed_at ? `Last indexed ${indexed_at}` : statusText}">${statusText}</span>
        <button class="location-action reindex-location" type="button" title="Reindex this location" aria-label="Reindex ${escHtml(name)}">
          <i data-lucide="refresh-cw"></i>
        </button>
        <button class="location-action remove-location" type="button" title="Remove this location" aria-label="Remove ${escHtml(name)}">
          <i data-lucide="x"></i>
        </button>
      `;
      li.querySelector('.reindex-location').addEventListener('click', () => reindexLocation(id));
      li.querySelector('.remove-location').addEventListener('click', () => removeLocation(id, name));
      folderList.appendChild(li);
    });

    lucide.createIcons();
  } catch {
    folderList.innerHTML = '<li class="recent-empty">Could not load folders</li>';
  }
}

async function addLocation() {
  const folderPath = window.prompt('Folder or removable-drive path to index (for example E:\\ or C:\\Projects):');
  if (!folderPath || !folderPath.trim()) return;
  const suggestedName = folderPath.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || folderPath;
  const name = window.prompt('Name this search location:', suggestedName);
  try {
    const res = await fetch(`${API}/locations`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: folderPath.trim(), name: name || suggestedName }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not add location.');
    loadFolders();
  } catch (error) {
    appendErrorMessage(error.message);
  }
}

async function removeLocation(id, name) {
  if (!window.confirm(`Remove “${name}” and its indexed records from SageSearch?`)) return;
  try {
    const res = await fetch(`${API}/locations/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Could not remove location.');
    loadFolders();
  } catch (error) {
    appendErrorMessage(error.message);
  }
}

async function reindexLocation(id) {
  try {
    const res = await fetch(`${API}/locations/${id}/reindex`, { method: 'POST' });
    if (!res.ok) throw new Error('Could not start indexing.');
    loadFolders();
  } catch (error) {
    appendErrorMessage(error.message);
  }
}

// ─── Recent Searches ──────────────────────────────────────────────────────

function getRecentSearches() {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
  } catch {
    return [];
  }
}

function addRecentSearch(query) {
  const recents = getRecentSearches().filter(r => r.query !== query);
  recents.unshift({ query, timestamp: Date.now() });
  localStorage.setItem(RECENT_KEY, JSON.stringify(recents.slice(0, MAX_RECENT)));
  renderRecentSearches();
}

function renderRecentSearches() {
  const recents = getRecentSearches();
  recentList.innerHTML = '';

  if (recents.length === 0) {
    recentList.innerHTML = '<li class="recent-empty">No searches yet</li>';
    return;
  }

  recents.forEach(({ query, timestamp }) => {
    const li = document.createElement('li');
    li.className = 'recent-item';
    li.title = query;

    const age = formatRelativeTime(timestamp);
    li.innerHTML = `
      <i data-lucide="clock-3"></i>
      <span class="recent-item-text">${escHtml(query)}</span>
      <span class="recent-item-time">${age}</span>
    `;
    li.addEventListener('click', () => {
      searchInput.value = query;
      sendMessage();
    });
    recentList.appendChild(li);
  });

  lucide.createIcons();
}

function formatRelativeTime(ts) {
  const diff = Date.now() - ts;
  const mins  = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days  = Math.floor(diff / 86400000);

  if (mins  < 1)  return 'just now';
  if (mins  < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
}

// ─── Main Send / Chat Flow ────────────────────────────────────────────────

async function sendMessage() {
  const query = searchInput.value.trim();
  if (!query) return;

  if (currentMode === 'agent') {
    searchInput.value = '';
    await startAgentGoal(query);
    return;
  }

  // Hide welcome screen on first message
  if (welcomeEl) welcomeEl.style.display = 'none';

  // Append user message to UI
  appendUserMessage(query);

  // Save only the local recent-search list; each interpretation is standalone.
  addRecentSearch(query);

  // Clear input & disable while waiting
  searchInput.value = '';
  setInputDisabled(true);

  // Show typing indicator
  const typingId = appendTypingIndicator();

  try {
    const res  = await fetch(`${API}/chat`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ messages: [{ role: 'user', content: query }] }),
    });

    removeTypingIndicator(typingId);

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Unknown error' }));
      appendErrorMessage(err.error || `Server error ${res.status}`);
      return;
    }

    const data = await res.json();
    updateIndexingNotice(data.index);

    // Render AI text message
    if (data.content) {
      appendAIMessage(data.content);
    }

    // Render file result cards
    if (data.files && data.files.length > 0) {
      appendFileResults(data.files, data.moreResults);
    }

  } catch (err) {
    removeTypingIndicator(typingId);
    appendErrorMessage('Cannot reach the DocSearch backend. Is the server running?');
  } finally {
    setInputDisabled(false);
    searchInput.focus();
    scrollToBottom();
  }
}

// ─── DOM Rendering Helpers ────────────────────────────────────────────────

function appendUserMessage(text) {
  const row = document.createElement('div');
  row.className = 'message-row user-row';
  row.innerHTML = `
    <div class="avatar avatar-user"><i data-lucide="user"></i></div>
    <div class="message-bubble user-bubble">${escHtml(text)}</div>
  `;
  messagesEl.appendChild(row);
  lucide.createIcons({ nodes: [row] });
  scrollToBottom();
}

function appendAIMessage(text) {
  const row = document.createElement('div');
  row.className = 'message-row';
  row.innerHTML = `
    <div class="avatar avatar-ai"><i data-lucide="search"></i></div>
    <div class="message-bubble ai-bubble">${escHtml(text)}</div>
  `;
  messagesEl.appendChild(row);
  lucide.createIcons({ nodes: [row] });
  scrollToBottom();
}

function appendErrorMessage(msg) {
  const el = document.createElement('div');
  el.className = 'error-banner';
  el.innerHTML = `
    <i data-lucide="alert-circle"></i>
    <span>${escHtml(msg)}</span>
  `;
  messagesEl.appendChild(el);
  lucide.createIcons({ nodes: [el] });
  scrollToBottom();
}

// Typing animation while AI is working
function appendTypingIndicator() {
  const id  = `typing-${Date.now()}`;
  const row = document.createElement('div');
  row.className = 'message-row';
  row.id = id;
  row.innerHTML = `
    <div class="avatar avatar-ai"><i data-lucide="search"></i></div>
    <div class="message-bubble ai-bubble">
      <div class="typing-indicator">
        <div class="typing-dot"></div>
        <div class="typing-dot"></div>
        <div class="typing-dot"></div>
      </div>
    </div>
  `;
  messagesEl.appendChild(row);
  lucide.createIcons({ nodes: [row] });
  scrollToBottom();
  return id;
}

function removeTypingIndicator(id) {
  const el = document.getElementById(id);
  if (el) el.remove();
}

// ─── File Results Rendering ───────────────────────────────────────────────

function appendFileResults(files, moreResults = null) {
  const section = document.createElement('div');
  section.className = 'results-section';

  const header = document.createElement('div');
  header.className = 'results-header';
  header.innerHTML = `
    <i data-lucide="folder-open"></i>
    Search Results
    <span class="results-count">${files.length} file${files.length !== 1 ? 's' : ''} found</span>
  `;
  section.appendChild(header);

  files.forEach((file, index) => {
    const card = buildFileCard(file, index);
    section.appendChild(card);
  });

  if (moreResults?.interpretation) {
    const actions = document.createElement('div');
    actions.className = 'results-actions';
    const showAllButton = document.createElement('button');
    showAllButton.type = 'button';
    showAllButton.className = 'show-all-results-btn';
    showAllButton.innerHTML = '<i data-lucide="list"></i> Show all matches';
    showAllButton.addEventListener('click', () => showAllMatches({
      button: showAllButton,
      section,
      header,
      previewCount: files.length,
      interpretation: moreResults.interpretation,
    }));
    actions.appendChild(showAllButton);
    section.appendChild(actions);
  }

  messagesEl.appendChild(section);
  lucide.createIcons({ nodes: [section] });
  scrollToBottom();
}

async function showAllMatches({ button, section, header, previewCount, interpretation }) {
  button.disabled = true;
  button.innerHTML = '<i data-lucide="loader-circle"></i> Loading matches…';
  lucide.createIcons({ nodes: [button] });

  try {
    const response = await fetch(`${API}/results`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ interpretation }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not load the remaining matches.');

    data.files.slice(previewCount).forEach((file, index) => {
      section.insertBefore(buildFileCard(file, previewCount + index), button.parentElement);
    });
    const count = data.files.length;
    header.querySelector('.results-count').textContent = data.mayHaveMore
      ? `${count} newest files shown — refine to see more`
      : `${count} file${count !== 1 ? 's' : ''} found`;
    button.parentElement.remove();
    lucide.createIcons({ nodes: [section] });
    scrollToBottom();
  } catch (error) {
    button.disabled = false;
    button.innerHTML = '<i data-lucide="refresh-cw"></i> Try showing all again';
    lucide.createIcons({ nodes: [button] });
    appendErrorMessage(error.message);
  }
}

function buildFileCard(file, index) {
  const cat     = file.category || 'other';
  const icon    = CATEGORY_ICON[cat] || 'file';
  const ext     = (file.extension || '').replace('.', '').toUpperCase() || 'FILE';
  const cardId  = `file-card-${index}-${Date.now()}`;

  const card = document.createElement('div');
  card.className = `file-card${file.available === false ? ' file-unavailable' : ''}`;
  card.id = cardId;

  card.innerHTML = `
    <div class="file-icon cat-${cat}">
      <i data-lucide="${icon}"></i>
    </div>

    <div class="file-info">
      <div class="file-name" title="${escHtml(file.name)}">
        ${escHtml(file.name)}
      </div>
      <div class="file-path" title="${escHtml(file.folder)}">
        ${escHtml(file.folder)}
      </div>
      <div class="file-meta">
        <span class="file-meta-item">
          <i data-lucide="calendar"></i>
          ${escHtml(file.modified_readable)}
        </span>
        <span class="file-meta-item">
          <i data-lucide="hard-drive"></i>
          ${escHtml(file.size_readable)}
        </span>
        <span class="ext-badge cat-${cat}">${escHtml(ext)}</span>
        ${file.available === false ? '<span class="availability-badge"><i data-lucide="hard-drive-off"></i> Unavailable</span>' : ''}
      </div>
    </div>

    <div class="file-actions">
      <button class="btn-icon copy-path-btn" title="Copy path" data-path="${escHtml(file.path)}">
        <i data-lucide="copy"></i>
      </button>
      <button class="btn-open open-explorer-btn" data-path="${escHtml(file.path)}" ${file.available === false ? 'disabled title="Reconnect the source drive to open this file"' : ''}>
        <i data-lucide="folder-open"></i>
        Show in Explorer
      </button>
    </div>
  `;

  // Copy path button
  card.querySelector('.copy-path-btn').addEventListener('click', async (e) => {
    e.stopPropagation();
    await navigator.clipboard.writeText(file.path);
    const btn = e.currentTarget;
    btn.innerHTML = '<i data-lucide="check"></i>';
    lucide.createIcons({ nodes: [btn] });
    setTimeout(() => {
      btn.innerHTML = '<i data-lucide="copy"></i>';
      lucide.createIcons({ nodes: [btn] });
    }, 1500);
  });

  // Open in Explorer button
  card.querySelector('.open-explorer-btn').addEventListener('click', async (e) => {
    e.stopPropagation();
    if (file.available === false) return;
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.innerHTML = '<i data-lucide="loader"></i> Opening…';
    lucide.createIcons({ nodes: [btn] });

    try {
      const res  = await fetch(`${API}/open`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ path: file.path }),
      });
      const data = await res.json();

      if (data.success) {
        btn.innerHTML = '<i data-lucide="check"></i> Opened';
        lucide.createIcons({ nodes: [btn] });
        setTimeout(() => {
          btn.innerHTML = '<i data-lucide="folder-open"></i> Show in Explorer';
          btn.disabled = false;
          lucide.createIcons({ nodes: [btn] });
        }, 2000);
      } else {
        btn.innerHTML = '<i data-lucide="alert-circle"></i> Error';
        lucide.createIcons({ nodes: [btn] });
        setTimeout(() => {
          btn.innerHTML = '<i data-lucide="folder-open"></i> Show in Explorer';
          btn.disabled = false;
          lucide.createIcons({ nodes: [btn] });
        }, 2000);
      }
    } catch {
      btn.disabled = false;
      btn.innerHTML = '<i data-lucide="folder-open"></i> Show in Explorer';
      lucide.createIcons({ nodes: [btn] });
    }
  });

  return card;
}

// ─── Utility ──────────────────────────────────────────────────────────────

function setInputDisabled(disabled) {
  searchInput.disabled = disabled;
  sendBtn.disabled     = disabled;
}

function scrollToBottom() {
  requestAnimationFrame(() => {
    messagesEl.scrollTo({ top: messagesEl.scrollHeight, behavior: 'smooth' });
  });
}

// Safe HTML escaping — prevents XSS from filenames/paths
function escHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ─── Agent Mode Controller ───────────────────────────────────────────────

async function startAgentGoal(goalText) {
  if (!goalText || !goalText.trim()) return;

  if (agentWelcome) agentWelcome.hidden = true;
  if (agentWorkflow) {
    agentWorkflow.hidden = false;
    agentWorkflow.innerHTML = `
      <div class="agent-goal-banner">
        <i data-lucide="bot"></i>
        <div>
          <div class="goal-text">${escHtml(goalText)}</div>
          <div class="goal-sub">Orchestrating multi-step workflow with Google Gemini</div>
        </div>
      </div>

      <div class="agent-timeline" id="agent-timeline">
        <div class="timeline-header">
          <span class="timeline-title">Plan & Progress</span>
        </div>
        <div id="steps-container">
          <div class="step-item in_progress">
            <div class="step-icon"><i data-lucide="loader"></i></div>
            <div class="step-content">
              <div class="step-title">Formulating autonomous execution plan...</div>
            </div>
          </div>
        </div>
      </div>

      <div id="agent-approval-container"></div>
      <div id="agent-artifact-container"></div>
    `;
    lucide.createIcons();
  }

  try {
    const res = await fetch(`${API}/agent/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ goal: goalText, autoApprove: false }),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(err || 'Failed to start agent task');
    }
    const task = await res.json();
    renderAgentTaskState(task);
  } catch (err) {
    const container = document.getElementById('agent-approval-container');
    if (container) {
      container.innerHTML = `
        <div class="error-banner" style="margin-top: 14px;">
          <i data-lucide="alert-circle"></i>
          <span>Agent execution error: ${escHtml(err.message)}</span>
        </div>
      `;
      lucide.createIcons();
    }
  }
}

function renderAgentTaskState(task) {
  activeAgentTaskId = task.task_id;
  const stepsContainer = document.getElementById('steps-container');
  if (stepsContainer && task.steps && task.steps.length) {
    stepsContainer.innerHTML = '';
    task.steps.forEach((step) => {
      const isDone = step.status === 'completed';
      const div = document.createElement('div');
      div.className = `step-item ${step.status}`;
      div.innerHTML = `
        <div class="step-icon">
          <i data-lucide="${isDone ? 'check' : 'loader'}"></i>
        </div>
        <div class="step-content">
          <div class="step-title">Step ${step.step_index}: ${escHtml(step.title)}</div>
          ${step.tool_name ? `<span class="step-tool-badge"><i data-lucide="wrench"></i> ${escHtml(step.tool_name)}</span>` : ''}
        </div>
      `;
      stepsContainer.appendChild(div);
    });
    lucide.createIcons({ nodes: [stepsContainer] });
  }

  // Render Preview & Approval
  const approvalContainer = document.getElementById('agent-approval-container');
  if (approvalContainer) {
    if (task.status === 'waiting_approval' && task.preview_data) {
      const { columns = [], rows = [], summary = {} } = task.preview_data;
      approvalContainer.innerHTML = `
        <div class="preview-card">
          <div class="preview-header">
            <h3><i data-lucide="table"></i> Extracted Data Preview</h3>
            <div class="metric-pills">
              <span class="pill"><i data-lucide="file-check"></i> ${summary.total_receipts || rows.length} Items</span>
              <span class="pill highlight"><i data-lucide="dollar-sign"></i> Total: ${summary.total_expense || '$0.00'}</span>
            </div>
          </div>

          <div class="preview-table-container">
            <table class="preview-table">
              <thead>
                <tr>${columns.map(c => `<th>${escHtml(c)}</th>`).join('')}</tr>
              </thead>
              <tbody>
                ${rows.map(row => `<tr>${row.map(cell => `<td>${escHtml(String(cell))}</td>`).join('')}</tr>`).join('')}
              </tbody>
            </table>
          </div>

          <div class="approval-prompt-box">
            <div class="approval-prompt-text">${escHtml(task.approval_prompt || 'Found matching records. Proceed to generate output CSV?')}</div>
            <div class="approval-btn-group">
              <button class="btn-approve" id="approve-task-btn" type="button">
                <i data-lucide="check"></i> Approve & Generate CSV
              </button>
              <button class="btn-cancel" id="cancel-task-btn" type="button">
                <i data-lucide="x"></i> Cancel Task
              </button>
            </div>
          </div>
        </div>
      `;
      lucide.createIcons({ nodes: [approvalContainer] });

      document.getElementById('approve-task-btn')?.addEventListener('click', () => handleTaskApproval(task.task_id, true));
      document.getElementById('cancel-task-btn')?.addEventListener('click', () => handleTaskApproval(task.task_id, false));
    } else if (task.status === 'completed' || task.status === 'canceled') {
      approvalContainer.innerHTML = '';
    }
  }

  // Render Artifact if completed
  const artifactContainer = document.getElementById('agent-artifact-container');
  if (artifactContainer && task.status === 'completed') {
    const artifact = task.artifacts && task.artifacts[0] ? task.artifacts[0] : null;
    artifactContainer.innerHTML = `
      <div class="artifact-success-card">
        <div class="artifact-success-header">
          <i data-lucide="check-circle-2"></i>
          <span>Task Completed Successfully</span>
        </div>
        <p>${escHtml(task.final_summary || 'Successfully generated artifact.')}</p>
        ${artifact ? `
          <button class="artifact-action-btn" id="open-artifact-btn" type="button">
            <i data-lucide="file-spreadsheet"></i>
            <span>${escHtml(artifact.filename)} (${artifact.byte_count} bytes) &middot; Show in Explorer</span>
          </button>
        ` : ''}
      </div>
    `;
    lucide.createIcons({ nodes: [artifactContainer] });

    if (artifact && artifact.saved_path) {
      document.getElementById('open-artifact-btn')?.addEventListener('click', async () => {
        try {
          await fetch(`${API}/open`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: artifact.saved_path, mode: 'explorer' })
          });
        } catch (e) {
          console.error('Error opening artifact:', e);
        }
      });
    }
  }
}

async function handleTaskApproval(taskId, approved) {
  const btnGroup = document.querySelector('.approval-btn-group');
  if (btnGroup) {
    btnGroup.innerHTML = '<span style="color: var(--text-secondary); display: inline-flex; align-items: center; gap: 6px;"><i data-lucide="loader"></i> Finalizing task...</span>';
    lucide.createIcons();
  }

  try {
    const res = await fetch(`${API}/agent/respond`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId, approved }),
    });
    if (!res.ok) {
      throw new Error(await res.text());
    }
    const data = await res.json();
    renderAgentTaskState(data);
  } catch (err) {
    alert(`Approval error: ${err.message}`);
  }
}

// ─── Periodic health recheck (every 30s) ─────────────────────────────────
setInterval(() => {
  checkLMStudioHealth();
  loadFolders();
}, 30_000);
