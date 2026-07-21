const express = require('express');
const { ALLOWED_VOCABULARY, RESPONSE_JSON_SCHEMA, validateInterpretation, validateRequest } = require('./schema');

const DEEPSEEK_URL = 'https://api.deepseek.com/chat/completions';

function requiredEnvironment(name, env) {
  const value = env[name];
  if (typeof value !== 'string' || !value) throw new Error(`${name} must be configured.`);
  return value;
}

function rateLimit({ max, windowMs, now = () => Date.now() }) {
  const entries = new Map();
  return (req, res, next) => {
    const key = req.ip || req.socket.remoteAddress || 'unknown';
    const current = now();
    const entry = entries.get(key);
    if (!entry || current >= entry.resetAt) {
      entries.set(key, { count: 1, resetAt: current + windowMs });
      return next();
    }
    entry.count += 1;
    if (entry.count <= max) return next();
    res.set('Retry-After', String(Math.max(1, Math.ceil((entry.resetAt - current) / 1000))));
    return res.status(429).json({ error: 'Too many interpretation requests. Try again shortly.' });
  };
}

function interpretationPrompt(today) {
  return `Convert the user's file-search request into the required JSON object. Today is ${today}.
Use only supported local metadata filters. Sender, document contents, and file-open history are unsupported clues.
File-kind words are filters, not filename words: use extensions for presentation/slides/PowerPoint/ppt, spreadsheet/Excel, PDF, and Word requests; use fileType for photo/image, video/movie, and audio/music requests. Use filenameKeywords only when the user explicitly says named, called, filename, or means words in the actual filename. Treat an unqualified "screenshot" request as an image type, not a filename keyword.
For relative dates, calculate dates from today. Ask at most one clarifying question, only if it materially improves a search.
Allowed vocabulary: ${JSON.stringify(ALLOWED_VOCABULARY)}.
Return only an object matching this JSON Schema: ${JSON.stringify(RESPONSE_JSON_SCHEMA)}.`;
}

function parseJson(content) {
  if (typeof content === 'object' && content) return content;
  if (typeof content !== 'string') throw new Error('DeepSeek returned no JSON content.');
  try { return JSON.parse(content); } catch { throw new Error('DeepSeek returned invalid JSON.'); }
}

async function interpretWithDeepSeek({ query, today, apiKey, model, fetchImpl = fetch }) {
  const response = await fetchImpl(DEEPSEEK_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      temperature: 0,
      max_tokens: 500,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: interpretationPrompt(today) },
        { role: 'user', content: query },
      ],
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`DeepSeek returned HTTP ${response.status}.`);
  const body = await response.json();
  return validateInterpretation(parseJson(body?.choices?.[0]?.message?.content));
}

function createApp({ apiKey, model = 'deepseek-chat', rateLimitMax = 20, rateLimitWindowMs = 60_000, fetchImpl } = {}) {
  if (!apiKey) throw new Error('DEEPSEEK_API_KEY must be configured.');
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(express.json({ limit: '8kb', strict: true, type: 'application/json' }));
  app.get('/healthz', (_req, res) => res.json({ ok: true }));
  // This local per-instance guard protects bursts. Cloud Armor should provide
  // the distributed edge limit for public traffic.
  app.post('/interpret', rateLimit({ max: rateLimitMax, windowMs: rateLimitWindowMs }), async (req, res) => {
    const parsed = validateRequest(req.body);
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    try {
      const interpretation = await interpretWithDeepSeek({ ...parsed.value, apiKey, model, fetchImpl });
      return res.json(interpretation);
    } catch (error) {
      console.error('Interpretation failed:', error.message);
      return res.status(502).json({ error: 'The interpretation provider is temporarily unavailable.' });
    }
  });
  app.use((error, _req, res, _next) => {
    if (error.type === 'entity.parse.failed') return res.status(400).json({ error: 'Request body must be valid JSON.' });
    return res.status(500).json({ error: 'Unexpected proxy error.' });
  });
  return app;
}

if (require.main === module) {
  const env = process.env;
  const app = createApp({
    apiKey: requiredEnvironment('DEEPSEEK_API_KEY', env),
    model: env.DEEPSEEK_MODEL || 'deepseek-chat',
    rateLimitMax: Number(env.INTERPRET_RATE_LIMIT_MAX || 20),
    rateLimitWindowMs: Number(env.INTERPRET_RATE_LIMIT_WINDOW_MS || 60_000),
  });
  const port = Number(env.PORT || 8080);
  app.listen(port, () => console.log(`SageSearch interpret proxy listening on port ${port}`));
}

module.exports = { createApp, interpretWithDeepSeek };
