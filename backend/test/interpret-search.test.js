const test = require('node:test');
const assert = require('node:assert/strict');
const { validateInterpretation, applyQueryDefaults } = require('../interpret-search/schema');
const { SageSearchCloudInterpretProvider } = require('../interpret-search/sage-cloud');
const { LocalAIInterpretProvider, LOCAL_ALLOWED_VOCABULARY } = require('../interpret-search/local-ai');

test('interpretation validation drops unsupported and malformed filter fields', () => {
  const interpretation = validateInterpretation({
    filters: {
      fileType: 'document',
      extensions: ['.pptx', '.exe'],
      filenameKeywords: ['budget', 4, 'budget', 'x'.repeat(81)],
      locationLabel: 'Documents',
      dateField: 'created',
      dateAfter: '2026-07-01',
      dateBefore: 'not-a-date',
      sql: 'DROP TABLE files',
    },
    unsupportedClues: ['sender Sarah', 4],
    clarifyingQuestion: 'Which project folder?',
    leakedMetadata: ['C:/private/file.docx'],
  });

  assert.deepEqual(interpretation, {
    filters: {
      fileType: 'document',
      extensions: ['.pptx'],
      filenameKeywords: ['budget'],
      contentKinds: [],
      ocrTerms: [],
      locationLabel: 'Documents',
      dateField: 'created',
      dateAfter: '2026-07-01',
      dateBefore: null,
    },
    unsupportedClues: ['sender Sarah'],
    clarifyingQuestion: 'Which project folder?',
  });
});

test('screenshot searches use the image category without assuming a filename', () => {
  const interpretation = validateInterpretation({
    filters: { filenameKeywords: ['screenshot'], fileType: 'image' },
  });
  assert.deepEqual(applyQueryDefaults('Find screenshots in Downloads this month', interpretation).filters, {
    fileType: 'image', filenameKeywords: [], locationLabel: null,
    extensions: [], contentKinds: [], ocrTerms: [],
    dateField: 'modified', dateAfter: null, dateBefore: null,
  });
  assert.deepEqual(applyQueryDefaults('Find files named screenshot', interpretation).filters.filenameKeywords, ['screenshot']);
});

test('presentation words become PowerPoint extensions instead of filename text', () => {
  const interpretation = validateInterpretation({
    filters: { fileType: 'document', filenameKeywords: ['presentation'], extensions: [] },
  });
  assert.deepEqual(applyQueryDefaults('Show presentation in SSD HP', interpretation).filters, {
    fileType: 'document',
    extensions: ['.ppt', '.pptx', '.pps', '.ppsx', '.pot', '.potx', '.odp'],
    filenameKeywords: [],
    contentKinds: [],
    ocrTerms: [],
    locationLabel: null,
    dateField: 'modified',
    dateAfter: null,
    dateBefore: null,
  });
  assert.deepEqual(applyQueryDefaults('Find a file named presentation', interpretation).filters.filenameKeywords, ['presentation']);
});

test('cloud provider sends only an interpretation request, never local metadata', async () => {
  const originalFetch = global.fetch;
  let request;
  global.fetch = async (_url, options) => {
    request = JSON.parse(options.body);
    return new Response(JSON.stringify({ filters: { filenameKeywords: ['budget'] } }), { status: 200 });
  };

  try {
    const provider = new SageSearchCloudInterpretProvider({ proxyUrl: 'https://example.test/interpret' });
    const result = await provider.interpret({ query: 'budget from last week', today: '2026-07-20' });
    assert.deepEqual(Object.keys(request).sort(), ['allowedVocabulary', 'query', 'today']);
    assert.equal(JSON.stringify(request).includes('C:\\'), false);
    assert.deepEqual(result.filters.filenameKeywords, ['budget']);
  } finally {
    global.fetch = originalFetch;
  }
});

test('cloud provider never sends user credentials or local metadata', async () => {
  const originalFetch = global.fetch;
  let headers;
  global.fetch = async (_url, options) => {
    headers = options.headers;
    return new Response(JSON.stringify({ filters: {} }), { status: 200 });
  };
  try {
    const provider = new SageSearchCloudInterpretProvider({ proxyUrl: 'https://example.test/interpret' });
    await provider.interpret({ query: 'budget', today: '2026-07-20' });
    assert.equal(headers.Authorization, undefined);
  } finally {
    global.fetch = originalFetch;
  }
});

test('local provider asks for a JSON interpretation and never exposes search tools', async () => {
  const originalFetch = global.fetch;
  const requests = [];
  global.fetch = async (url, options = {}) => {
    if (url.endsWith('/v1/models')) {
      return new Response(JSON.stringify({ data: [{ id: 'local-test-model' }] }), { status: 200 });
    }
    requests.push(JSON.parse(options.body));
    return new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ filters: { fileType: 'image', filenameKeywords: ['screenshot'] } }) } }],
    }), { status: 200 });
  };

  try {
    const provider = new LocalAIInterpretProvider({ endpoint: 'http://localhost:1234' });
    const result = await provider.interpret({ query: 'screenshots', today: '2026-07-20' });
    assert.equal(requests.length, 1);
      assert.equal('tools' in requests[0], false);
      assert.equal('tool_choice' in requests[0], false);
      assert.equal(requests[0].messages[1].content, 'screenshots');
      assert.equal(LOCAL_ALLOWED_VOCABULARY.fields.includes('contentKinds'), true);
      assert.equal(LOCAL_ALLOWED_VOCABULARY.fields.includes('ocrTerms'), true);
      assert.match(requests[0].messages[0].content, /"contentKinds"/);
      assert.match(requests[0].messages[0].content, /"ocrTerms"/);
      assert.deepEqual(result.filters, {
      fileType: 'image', filenameKeywords: ['screenshot'], locationLabel: null,
      extensions: [], contentKinds: [], ocrTerms: [],
      dateField: 'modified', dateAfter: null, dateBefore: null,
    });
  } finally {
    global.fetch = originalFetch;
  }
});

test('receipt and visible-text queries become local image-content filters', () => {
  const base = validateInterpretation({
    filters: { fileType: 'image' },
    unsupportedClues: ['image contents'],
  });
  const receipt = applyQueryDefaults('Find receipts from Toko ABC containing coffee', base);
  assert.equal(receipt.filters.fileType, 'image');
  assert.deepEqual(receipt.filters.contentKinds, ['receipt']);
  assert.deepEqual(receipt.filters.ocrTerms, ['coffee', 'Toko ABC']);
  assert.deepEqual(receipt.unsupportedClues, []);

  const visibleText = applyQueryDefaults('Pictures with visible text saying Bandung', base);
  assert.deepEqual(visibleText.filters.ocrTerms, ['Bandung']);

  const namedBase = validateInterpretation({
    filters: { filenameKeywords: ['receipt-scan'] },
  });
  const namedReceipt = applyQueryDefaults(
    'Find a receipt named receipt-scan containing coffee',
    namedBase,
  );
  assert.equal(namedReceipt.filters.fileType, 'image');
  assert.deepEqual(namedReceipt.filters.contentKinds, ['receipt']);
  assert.deepEqual(namedReceipt.filters.filenameKeywords, ['receipt-scan']);
  assert.deepEqual(namedReceipt.filters.ocrTerms, ['coffee']);
});
