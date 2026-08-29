const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const {
  initializeSearchIndex, searchDocuments, listSearchFolders, addSearchLocation,
  removeSearchLocation, reindexLocation, getSearchIndexStatus,
} = require('./tools/search');
const { openInExplorer, openFile } = require('./tools/explorer');
const { createInterpretProvider } = require('./interpret-search');
const { validateInterpretation, hasSupportedFilter, applyQueryDefaults } = require('./interpret-search/schema');
const { AgentBridgeClient } = require('./agent-bridge/client');

const configPath = path.join(__dirname, 'config.json');
const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const SERVER_PORT = Number(process.env.SAGESEARCH_PORT) || cfg.server?.port || 3001;
const MAX_RESULTS = Math.min(Math.max(cfg.search?.maxResults || 30, 1), 30);
const MAX_SHOW_ALL_RESULTS = 200;

// Electron should start this backend with SAGESEARCH_DATA_DIR set to
// app.getPath('userData'). This keeps the index independent of the install
// directory and preserves it across app upgrades. The development fallback is
// intentionally the existing backend/data location.
const dataDirectory = process.env.SAGESEARCH_DATA_DIR || path.join(__dirname, 'data');
const databasePath = process.env.SAGESEARCH_DATABASE_PATH || path.join(dataDirectory, 'sagesearch.sqlite');
const searchIndex = initializeSearchIndex({ databasePath, maxDepth: cfg.search?.maxDepth });
const indexRefreshMs = Math.max(1, cfg.search?.indexRefreshMinutes || 15) * 60_000;
setInterval(() => searchIndex.start(), indexRefreshMs).unref();

const bridgeConfig = cfg.agentBridge || {};
const agentBridge = new AgentBridgeClient({
  bridgeUrl: process.env.SAGESEARCH_BRIDGE_URL || bridgeConfig.bridgeUrl || 'ws://localhost:8080/ws/bridge',
  agentHttpUrl: process.env.SAGESEARCH_AGENT_URL || bridgeConfig.agentHttpUrl || 'http://localhost:8080',
  searchIndex,
  autoConnect: bridgeConfig.enabled !== false,
});

function resolvedProviderConfig() {
  const legacyLocalEndpoint = `http://${cfg.lmStudio?.host || 'localhost'}:${cfg.lmStudio?.port || 1234}`;
  const providerConfig = cfg.provider || { mode: 'local', local: { endpoint: legacyLocalEndpoint } };
  if (providerConfig.mode === 'local') {
    providerConfig.local = { endpoint: legacyLocalEndpoint, ...providerConfig.local };
  }
  if (providerConfig.mode === 'cloud') {
    providerConfig.cloud = {
      ...providerConfig.cloud,
      proxyUrl: process.env.SAGESEARCH_CLOUD_PROXY_URL || providerConfig.cloud?.proxyUrl,
    };
  }
  return providerConfig;
}

let providerConfig = resolvedProviderConfig();
let interpretProvider = createInterpretProvider(providerConfig);
function providerName() { return providerConfig.mode === 'cloud' ? 'SageSearch Cloud' : 'Local AI'; }

function saveConfig() {
  fs.writeFileSync(configPath, `${JSON.stringify(cfg, null, 2)}\n`, 'utf8');
}

function switchProvider(mode, local = {}) {
  if (!['cloud', 'local'].includes(mode)) throw new Error('Unsupported provider mode.');
  if (mode === 'local') {
    const endpoint = typeof local.endpoint === 'string' ? local.endpoint.trim() : '';
    if (!/^https?:\/\/[^\s]+$/i.test(endpoint)) throw new Error('LM Studio endpoint must be a valid HTTP URL.');
    cfg.provider.local = { ...cfg.provider.local, endpoint, model: typeof local.model === 'string' && local.model.trim() ? local.model.trim() : null };
  }
  cfg.provider.mode = mode;
  saveConfig();
  providerConfig = resolvedProviderConfig();
  interpretProvider = createInterpretProvider(providerConfig);
}

const app = express();
app.use(cors());
app.use(express.json({ limit: '16kb' }));
app.use(express.static(path.join(__dirname, '../frontend')));

function today() {
  return new Date().toISOString().slice(0, 10);
}

function latestUserQuery(messages) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === 'user' && typeof message.content === 'string' && message.content.trim()) {
      return message.content.trim().slice(0, 300);
    }
  }
  return null;
}

function filterSummary(filters) {
  const summary = [];
  if (filters.fileType) summary.push(filters.fileType);
  if (filters.extensions.length) summary.push(`formats: ${filters.extensions.join(', ')}`);
  if (filters.filenameKeywords.length) summary.push(`filename: ${filters.filenameKeywords.join(', ')}`);
  if (filters.locationLabel) summary.push(`in ${filters.locationLabel}`);
  if (filters.dateAfter || filters.dateBefore) {
    const range = [filters.dateAfter && `from ${filters.dateAfter}`, filters.dateBefore && `through ${filters.dateBefore}`]
      .filter(Boolean).join(' ');
    summary.push(`${filters.dateField} ${range}`);
  }
  return summary;
}

function contextualNote(interpretation) {
  const notes = [];
  if (interpretation.unsupportedClues.length) {
    notes.push(`I cannot search ${interpretation.unsupportedClues.join(', ')} because only file metadata is indexed.`);
  }
  return notes.join(' ');
}

function runLocalSearch(interpretation, rawQuery = '', limit = MAX_RESULTS + 1) {
  return searchDocuments({
    file_type: interpretation.filters.fileType,
    extensions: interpretation.filters.extensions,
    filename_keywords: interpretation.filters.filenameKeywords,
    folder: interpretation.filters.locationLabel,
    date_field: interpretation.filters.dateField,
    date_after: interpretation.filters.dateAfter,
    date_before: interpretation.filters.dateBefore,
    raw_query: rawQuery,
    // Fetch one extra record to decide whether the result set needs narrowing.
    limit,
  });
}

app.get('/api/health', async (_req, res) => {
  try {
    const provider = await interpretProvider.health();
    return res.json({
      connected: true,
      provider: providerName(),
      model: provider.model,
      endpoint: provider.endpoint,
      index: getSearchIndexStatus(),
    });
  } catch (error) {
    return res.json({
      connected: false,
      provider: providerName(),
      index: getSearchIndexStatus(),
      troubleshoot: providerConfig.mode === 'cloud'
        ? { message: 'SageSearch Cloud is not configured. Complete the Cloud setup in Settings.' }
        : { message: 'Start LM Studio, enable its local server, and load a model.' },
      detail: error.message,
    });
  }
});

app.get('/api/settings', (_req, res) => res.json({
  provider: {
    mode: providerConfig.mode,
    cloudReady: Boolean(cfg.provider?.cloud?.proxyUrl),
    local: { endpoint: cfg.provider?.local?.endpoint || '', model: cfg.provider?.local?.model || '' },
  },
}));

app.put('/api/settings/provider', (req, res) => {
  try {
    const { mode, local } = req.body || {};
    switchProvider(mode, local);
    return res.json({ provider: { mode: providerConfig.mode, name: providerName() } });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

// Providers only interpret the query. The validated interpretation is mapped
// to SQLite filters here; no provider is given file names, paths, locations,
// index rows, result counts, or document contents.
app.post('/api/chat', async (req, res) => {
  const { messages } = req.body || {};
  if (!Array.isArray(messages)) return res.status(400).json({ error: 'messages array is required.' });

  const query = latestUserQuery(messages);
  if (!query) return res.status(400).json({ error: 'A user search query is required.' });

  let interpretation;
  try {
    interpretation = applyQueryDefaults(query, await interpretProvider.interpret({ query, today: today() }));
  } catch (error) {
    return res.status(503).json({ error: `${providerName()} could not interpret this search.`, detail: error.message });
  }

  const note = contextualNote(interpretation);
  if (!hasSupportedFilter(interpretation)) {
    return res.json({
      type: 'text',
      content: [note, interpretation.clarifyingQuestion || 'What filename, file type, location, or date do you remember?'].filter(Boolean).join(' '),
      files: [],
      interpretation,
      index: getSearchIndexStatus(),
    });
  }

  const localResults = runLocalSearch(interpretation, query);
  const filterText = filterSummary(interpretation.filters).join('; ');
  if (localResults.length > MAX_RESULTS) {
    return res.json({
      type: 'results',
      content: [
        `I found more than ${MAX_RESULTS} local files matching ${filterText}. Showing the 10 newest matches.`,
        interpretation.clarifyingQuestion || 'Could you add a filename word, a location, or a narrower date?',
        note,
      ].filter(Boolean).join(' '),
      files: localResults.slice(0, 10),
      moreResults: { interpretation },
      interpretation,
      index: getSearchIndexStatus(),
    });
  }

  const count = localResults.length;
  return res.json({
    type: 'results',
    content: [
      count ? `Found ${count} local file${count === 1 ? '' : 's'} matching ${filterText}.` : `No local files matched ${filterText}.`,
      !count && interpretation.clarifyingQuestion,
      note,
    ].filter(Boolean).join(' '),
    files: localResults,
    interpretation,
    index: getSearchIndexStatus(),
  });
});

// The initial preview deliberately stays small. This endpoint reuses the
// already-validated filter object and never calls an AI provider or accepts a
// file path, so "Show all" remains a local, bounded database operation.
app.post('/api/results', (req, res) => {
  const interpretation = validateInterpretation(req.body?.interpretation);
  if (!hasSupportedFilter(interpretation)) {
    return res.status(400).json({ error: 'A valid search filter is required.' });
  }

  const results = runLocalSearch(interpretation, MAX_SHOW_ALL_RESULTS);
  return res.json({
    files: results,
    cappedAt: MAX_SHOW_ALL_RESULTS,
    // A full count is intentionally not calculated: rendering hundreds of
    // cards is not useful, and the cap protects the browser on broad queries.
    mayHaveMore: results.length === MAX_SHOW_ALL_RESULTS,
  });
});

app.post('/api/open', async (req, res) => {
  const { path: filePath, mode } = req.body;
  if (!filePath) return res.status(400).json({ error: 'path is required.' });
  const result = mode === 'file' ? await openFile(filePath) : await openInExplorer(filePath);
  res.json(result);
});

app.get('/api/folders', (_req, res) => res.json(listSearchFolders()));

app.post('/api/locations', (req, res) => {
  try {
    const payload = req.body || {};
    const location = addSearchLocation({ name: payload.name, locationPath: payload.path });
    res.status(201).json(location);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.delete('/api/locations/:id', (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || !removeSearchLocation(id)) return res.status(404).json({ error: 'Location not found.' });
  res.status(204).end();
});

app.post('/api/locations/:id/reindex', (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || !reindexLocation(id)) return res.status(404).json({ error: 'Location not found.' });
  res.status(202).json({ status: 'indexing' });
});

// Agent Mode API endpoints
app.get('/api/agent/status', (_req, res) => {
  res.json(agentBridge.getStatus());
});

app.get('/api/agent/memory', async (req, res) => {
  try {
    const memory = await agentBridge.getMemory(req.query.user_id || 'default_user');
    res.json(memory);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/agent/memory', async (req, res) => {
  try {
    const { preferences, user_id = 'default_user' } = req.body || {};
    const updated = await agentBridge.saveMemory(preferences || {}, user_id);
    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/agent/memory/clear', async (req, res) => {
  try {
    const { user_id = 'default_user' } = req.body || {};
    const cleared = await agentBridge.clearMemory(user_id);
    res.json(cleared);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/agent/start', async (req, res) => {
  try {
    const { goal, autoApprove = false } = req.body || {};
    if (!goal || typeof goal !== 'string' || !goal.trim()) {
      return res.status(400).json({ error: 'Goal is required.' });
    }
    const task = await agentBridge.startTask(goal.trim(), autoApprove);
    res.json(task);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/agent/respond', async (req, res) => {
  try {
    const { taskId, approved, feedback } = req.body || {};
    if (!taskId) {
      return res.status(400).json({ error: 'taskId is required.' });
    }
    const result = await agentBridge.respondToTask(taskId, Boolean(approved), feedback);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('*', (_req, res) => res.sendFile(path.join(__dirname, '../frontend/index.html')));

app.listen(SERVER_PORT, () => {
  console.log(`SageSearch backend listening at http://localhost:${SERVER_PORT}`);
  console.log(`Interpret provider: ${providerName()}`);
  console.log(`SQLite index: ${databasePath}`);
});
