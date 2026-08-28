const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const {
  parseDateRange,
  localSearchFiles,
  localReadFileContent,
  localCreateArtifact,
} = require('../agent-bridge/local-tools');
const { AgentBridgeClient } = require('../agent-bridge/client');
const { initializeSearchIndex } = require('../tools/search');

test('parseDateRange parses standard informal ranges', () => {
  const lastMonth = parseDateRange('last_month');
  assert.ok(lastMonth.date_after);
  assert.ok(lastMonth.date_before);

  const ym = parseDateRange('2026-07');
  assert.equal(ym.date_after, '2026-07-01');
  assert.equal(ym.date_before, '2026-07-31');

  const empty = parseDateRange(null);
  assert.deepEqual(empty, {});
});

test('localReadFileContent reads file safely and bounds characters', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sagesearch-test-'));
  const testFile = path.join(tempDir, 'test_receipt.txt');
  fs.writeFileSync(testFile, 'Merchant: Test Coffee Shop\nTotal: $14.50\n', 'utf8');

  // Read success
  const res = await localReadFileContent({ path: testFile, max_chars: 100 });
  assert.equal(res.status, 'success');
  assert.ok(res.content.includes('Test Coffee Shop'));
  assert.equal(res.char_count, res.content.length);

  // Missing file
  const missing = await localReadFileContent({ path: path.join(tempDir, 'nonexistent.txt') });
  assert.equal(missing.status, 'not_found');

  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('localCreateArtifact saves output file to target directory', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sagesearch-art-'));
  const filename = 'expense_report.csv';
  const csvData = 'Merchant,Amount\nTest,20.00\n';

  const res = await localCreateArtifact({
    filename,
    content_type: 'text/csv',
    data: csvData,
    target_directory: tempDir,
  });

  assert.equal(res.status, 'created');
  assert.equal(res.filename, filename);
  assert.ok(fs.existsSync(res.saved_path));
  assert.equal(fs.readFileSync(res.saved_path, 'utf8'), csvData);

  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('AgentBridgeClient handles tool_call RPC dispatching', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sagesearch-bridge-'));
  const testFile = path.join(tempDir, 'invoice.txt');
  fs.writeFileSync(testFile, 'INVOICE #101\nTotal: $500.00', 'utf8');

  const client = new AgentBridgeClient({ autoConnect: false });

  let sentMessage = null;
  client.send = (data) => {
    sentMessage = data;
  };

  // Dispatch read_file_content tool_call
  await client.handleMessage({
    type: 'tool_call',
    id: 'call-123',
    tool: 'read_file_content',
    params: { path: testFile },
  });

  assert.ok(sentMessage);
  assert.equal(sentMessage.type, 'tool_result');
  assert.equal(sentMessage.id, 'call-123');
  assert.equal(sentMessage.result.status, 'success');
  assert.ok(sentMessage.result.content.includes('INVOICE #101'));

  client.disconnect();
  fs.rmSync(tempDir, { recursive: true, force: true });
});
