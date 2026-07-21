const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../server');
const { ALLOWED_VOCABULARY } = require('../schema');

async function withServer(options, run) {
  const server = createApp(options).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  try { await run(`http://127.0.0.1:${server.address().port}`); } finally { await new Promise((resolve) => server.close(resolve)); }
}

test('rejects unexpected request fields before calling DeepSeek', async () => {
  let deepSeekCalls = 0;
  await withServer({ apiKey: 'deepseek-key', fetchImpl: async () => { deepSeekCalls += 1; throw new Error('not called'); } }, async (baseUrl) => {
    const invalid = await fetch(`${baseUrl}/interpret`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: 'budget', today: '2026-07-20', allowedVocabulary: ALLOWED_VOCABULARY, localPaths: ['C:/secret'] }) });
    assert.equal(invalid.status, 400);
    assert.equal(deepSeekCalls, 0);
  });
});

test('accepts the fixed vocabulary regardless of JSON object key order', async () => {
  const fetchImpl = async () => new Response(JSON.stringify({ choices: [{ message: { content: '{"filters":{}}' } }] }), { status: 200 });
  await withServer({ apiKey: 'deepseek-key', fetchImpl }, async (baseUrl) => {
    const reorderedVocabulary = { fields: ALLOWED_VOCABULARY.fields, extensions: ALLOWED_VOCABULARY.extensions, dateFields: ALLOWED_VOCABULARY.dateFields, fileTypes: ALLOWED_VOCABULARY.fileTypes };
    const response = await fetch(`${baseUrl}/interpret`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: 'budget', today: '2026-07-21', allowedVocabulary: reorderedVocabulary }) });
    assert.equal(response.status, 200);
  });
});

test('returns only a normalized structured interpretation and rate limits callers', async () => {
  const fetchImpl = async (_url, request) => {
    assert.equal(request.headers.Authorization, 'Bearer deepseek-key');
    const body = JSON.parse(request.body);
    assert.equal(body.messages[1].content, 'screenshots from yesterday');
    assert.deepEqual(body.thinking, { type: 'disabled' });
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ filters: { fileType: 'image', filenameKeywords: ['screenshots'], sql: 'DROP TABLE files' }, unsupportedClues: ['sender Ana'], clarifyingQuestion: 'Which folder?', leaked: true }) } }] }), { status: 200 });
  };
  await withServer({ apiKey: 'deepseek-key', fetchImpl, rateLimitMax: 1, rateLimitWindowMs: 60_000 }, async (baseUrl) => {
    const payload = JSON.stringify({ query: 'screenshots from yesterday', today: '2026-07-20', allowedVocabulary: ALLOWED_VOCABULARY });
    const first = await fetch(`${baseUrl}/interpret`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload });
    assert.equal(first.status, 200);
    assert.deepEqual(await first.json(), { filters: { fileType: 'image', extensions: [], filenameKeywords: ['screenshots'], locationLabel: null, dateField: 'modified', dateAfter: null, dateBefore: null }, unsupportedClues: ['sender Ana'], clarifyingQuestion: 'Which folder?' });
    const second = await fetch(`${baseUrl}/interpret`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload });
    assert.equal(second.status, 429);
  });
});
