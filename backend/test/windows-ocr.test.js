const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  amountFromText,
  createWindowsOcrProcessor,
  extractReceiptFields,
  receiptSignals,
} = require('../tools/windows-ocr');
const { SearchIndex } = require('../tools/search');

async function waitFor(predicate, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('Timed out waiting for the Windows OCR pipeline.');
}

test('receipt heuristics recognize Indonesian receipt evidence', () => {
  const text = `TOKO ABC
Tanggal 08/08/2026
Kopi 25.000
TOTAL RP 125.000
TUNAI RP 150.000`;
  const signals = receiptSignals(text);
  assert.equal(signals.score >= 0.45, true);
  assert.equal(signals.hasCurrency, true);
  assert.equal(signals.hasAmountLine, true);

  assert.deepEqual(extractReceiptFields(text), {
    merchantCandidate: 'TOKO ABC',
    transactionDateText: '08/08/2026',
    totalText: 'RP 125.000',
    total: 125000,
    currency: 'IDR',
  });
});

test('receipt amount parsing handles common decimal and thousands separators', () => {
  assert.equal(amountFromText('Rp 125.000'), 125000);
  assert.equal(amountFromText('$1,234.50'), 1234.5);
  assert.equal(amountFromText('50,00'), 50);
  assert.equal(amountFromText('not an amount'), null);
});

test('Windows OCR reads a generated receipt image end to end', {
  skip: process.platform !== 'win32' ? 'Windows.Media.Ocr is Windows-only' : false,
  timeout: 15_000,
}, async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sagesearch-windows-ocr-'));
  const filesPath = path.join(root, 'files');
  const imagePath = path.join(filesPath, 'receipt.png');
  fs.mkdirSync(filesPath);
  const powershell = path.join(
    process.env.SystemRoot || 'C:\\Windows',
    'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe',
  );
  let index;
  t.after(() => {
    index?.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  execFileSync(powershell, [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-File', path.join(__dirname, 'fixtures', 'create-ocr-image.ps1'),
    '-OutputPath', imagePath,
  ], { timeout: 10_000, windowsHide: true });

  index = new SearchIndex({
    databasePath: path.join(root, 'index.sqlite'),
    locations: [['Fixture', filesPath]],
    imageAnalysisProcessor: createWindowsOcrProcessor({ timeoutMs: 10_000 }),
  });
  const location = index.locations()[0];
  index.indexLocation(location.id);
  await waitFor(() => index.imageAnalysis.status().ready === 1);

  const matches = index.search({
    file_type: 'image',
    content_kinds: ['receipt'],
    ocr_terms: ['48291'],
  });
  assert.equal(matches.length, 1);
  assert.equal(matches[0].name, 'receipt.png');
  assert.equal(matches[0].image_content_kind, 'receipt');
  assert.match(matches[0].ocr_snippet, /SAGESEARCH/i);
  assert.match(matches[0].ocr_snippet, /48291/);
  assert.equal(matches[0].receipt.total, 48291);
  assert.equal(matches[0].receipt.currency, 'IDR');
});
