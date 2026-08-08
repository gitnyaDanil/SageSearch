const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { SearchIndex } = require('../tools/search');
const { ImageAnalysisQueue } = require('../tools/image-analysis');

function fixture(t, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sagesearch-image-analysis-'));
  const filesPath = path.join(root, 'files');
  fs.mkdirSync(filesPath);
  const index = new SearchIndex({
    databasePath: path.join(root, 'index.sqlite'),
    locations: [['Fixture', filesPath]],
    ...options,
  });
  const location = index.locations()[0];
  t.after(() => {
    index.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  return { root, filesPath, index, location };
}

async function waitFor(predicate, timeoutMs = 1_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Timed out waiting for image analysis.');
}

test('existing metadata databases migrate without a destructive rebuild', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sagesearch-image-migration-'));
  const databasePath = path.join(root, 'legacy.sqlite');
  const legacyDb = new DatabaseSync(databasePath);
  legacyDb.exec(`
    CREATE TABLE app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    INSERT INTO app_meta (key, value) VALUES ('locations_initialized', '1');
    CREATE TABLE locations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      path TEXT NOT NULL UNIQUE,
      is_default INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'ready',
      indexed_at TEXT,
      file_count INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE files (
      id INTEGER PRIMARY KEY,
      location_id INTEGER NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      full_path TEXT NOT NULL UNIQUE,
      folder TEXT NOT NULL,
      extension TEXT NOT NULL,
      category TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      created_iso TEXT NOT NULL,
      modified_iso TEXT NOT NULL
    );
  `);
  legacyDb.close();

  const index = new SearchIndex({ databasePath, locations: [] });
  t.after(() => {
    index.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  const columns = index.db.prepare('PRAGMA table_info(files)').all().map((column) => column.name);
  assert.equal(columns.includes('content_fingerprint'), true);
  assert.equal(index.db.prepare(`
    SELECT COUNT(*) AS count FROM sqlite_master
    WHERE type = 'table' AND name IN ('image_analysis_jobs', 'image_analysis')
  `).get().count, 2);
});

test('metadata indexing queues only image files for analysis', (t) => {
  const { filesPath, index, location } = fixture(t);
  fs.writeFileSync(path.join(filesPath, 'receipt.jpg'), 'image-placeholder');
  fs.writeFileSync(path.join(filesPath, 'notes.txt'), 'not an image');

  index.indexLocation(location.id);

  assert.deepEqual(index.status().imageAnalysis, {
    processorConfigured: false,
    running: false,
    indexedImages: 1,
    pending: 1,
    analyzing: 0,
    ready: 0,
    retryableErrors: 0,
    permanentErrors: 0,
    pipelineVersion: 'unversioned',
  });
  const job = index.db.prepare(`
    SELECT j.*, f.name FROM image_analysis_jobs j JOIN files f ON f.id = j.file_id
  `).get();
  assert.equal(job.name, 'receipt.jpg');
  assert.equal(job.state, 'pending');
  const prioritized = index.prioritizeImageAnalysis(path.join(filesPath, 'receipt.jpg'));
  assert.equal(prioritized.state, 'pending');
  assert.equal(prioritized.priority, 100);
  assert.equal(index.prioritizeImageAnalysis(path.join(filesPath, 'notes.txt')), null);

  const claimed = index.imageAnalysis.claimNext();
  index.imageAnalysis.fail(claimed.file_id, new Error('Unsupported image format'), {
    retryable: false,
    code: 'unsupported_image_format',
  });
  const blocked = index.prioritizeImageAnalysis(path.join(filesPath, 'receipt.jpg'));
  assert.equal(blocked.state, 'permanent_error');
  assert.equal(blocked.error_code, 'unsupported_image_format');
  assert.equal(blocked.error_message, 'Unsupported image format');
});

test('the durable queue indexes thousands of receipts into a bounded search result', (t) => {
  const { filesPath, index, location } = fixture(t);
  const insert = index.db.prepare(`
    INSERT INTO files (
      location_id, name, full_path, folder, extension, category, size_bytes,
      created_iso, modified_iso, content_fingerprint
    ) VALUES (?, ?, ?, ?, '.jpg', 'image', 1024, ?, ?, ?)
  `);
  const timestamp = '2026-08-08T00:00:00.000Z';

  index.db.exec('BEGIN');
  try {
    for (let number = 0; number < 2_000; number += 1) {
      const name = `image-${number}.jpg`;
      insert.run(
        location.id,
        name,
        path.join(filesPath, name),
        filesPath,
        timestamp,
        timestamp,
        `1024:${number}`,
      );
    }
    index.db.exec('COMMIT');
  } catch (error) {
    index.db.exec('ROLLBACK');
    throw error;
  }

  index.syncImageAnalysisJobs(location.id);
  assert.equal(index.imageAnalysis.status().indexedImages, 2_000);
  assert.equal(index.imageAnalysis.status().pending, 2_000);
  assert.equal(index.db.prepare(`
    SELECT COUNT(DISTINCT file_id) AS count FROM image_analysis_jobs
  `).get().count, 2_000);

  let job;
  while ((job = index.imageAnalysis.claimNext())) {
    index.imageAnalysis.complete(job.file_id, job.content_fingerprint, {
      contentKind: 'receipt',
      ocr: { text: `TOKO ${job.file_id} COFFEE TOTAL RP ${job.file_id}000`, language: 'id' },
      receipt: { merchantCandidate: `TOKO ${job.file_id}`, total: job.file_id * 1_000, currency: 'IDR' },
    });
  }

  const matches = index.search({
    file_type: 'image',
    content_kinds: ['receipt'],
    ocr_terms: ['COFFEE'],
    limit: 30,
  });
  assert.equal(index.imageAnalysis.status().ready, 2_000);
  assert.equal(matches.length, 30);
  assert.equal(matches.every((match) => match.image_content_kind === 'receipt'), true);
  assert.equal(matches.every((match) => /COFFEE/.test(match.ocr_snippet)), true);
});

test('unchanged rescans preserve analysis and changed images are requeued', (t) => {
  const { filesPath, index, location } = fixture(t);
  const imagePath = path.join(filesPath, 'receipt.jpg');
  fs.writeFileSync(imagePath, 'image-placeholder');
  index.indexLocation(location.id);

  const claimed = index.imageAnalysis.claimNext();
  assert.ok(claimed);
  assert.equal(index.imageAnalysis.complete(claimed.file_id, claimed.content_fingerprint, {
    contentKind: 'receipt',
    receiptConfidence: 0.98,
    ocr: { text: 'TOKO ABC TOTAL 125000', language: 'id', confidence: 0.94 },
    receipt: { merchant: 'Toko ABC', total: 125000, currency: 'IDR' },
    modelVersions: { ocr: 'test-v1' },
  }), true);

  const originalFile = index.db.prepare('SELECT id, content_fingerprint FROM files WHERE full_path = ?').get(imagePath);
  index.indexLocation(location.id);
  const unchangedFile = index.db.prepare('SELECT id, content_fingerprint FROM files WHERE full_path = ?').get(imagePath);
  assert.deepEqual(unchangedFile, originalFile);
  assert.equal(index.imageAnalysis.status().ready, 1);
  assert.equal(index.db.prepare('SELECT COUNT(*) AS count FROM image_analysis').get().count, 1);

  fs.appendFileSync(imagePath, '-changed');
  index.indexLocation(location.id);
  const changedFile = index.db.prepare('SELECT id, content_fingerprint FROM files WHERE full_path = ?').get(imagePath);
  assert.equal(changedFile.id, originalFile.id);
  assert.notEqual(changedFile.content_fingerprint, originalFile.content_fingerprint);
  assert.equal(index.imageAnalysis.status().pending, 1);
  assert.equal(index.imageAnalysis.status().ready, 0);
  assert.equal(index.db.prepare('SELECT COUNT(*) AS count FROM image_analysis').get().count, 0);
});

test('a pipeline version change invalidates stale derived analysis', (t) => {
  const { filesPath, index, location } = fixture(t, { imageAnalysisVersion: 'receipt-v1' });
  const imagePath = path.join(filesPath, 'versioned.jpg');
  fs.writeFileSync(imagePath, 'image-placeholder');
  index.indexLocation(location.id);

  const claimed = index.imageAnalysis.claimNext();
  index.imageAnalysis.complete(claimed.file_id, claimed.content_fingerprint, {
    contentKind: 'receipt',
    ocr: { text: 'OLD OCR TEXT' },
  });
  assert.equal(index.imageAnalysis.status().ready, 1);

  index.imageAnalysisVersion = 'receipt-v2';
  index.syncImageAnalysisJobs(location.id);

  assert.equal(index.imageAnalysis.status().ready, 0);
  assert.equal(index.imageAnalysis.status().pending, 1);
  assert.equal(index.db.prepare('SELECT COUNT(*) AS count FROM image_analysis').get().count, 0);
  const job = index.db.prepare('SELECT content_fingerprint FROM image_analysis_jobs').get();
  assert.match(job.content_fingerprint, /\|analysis:receipt-v2$/);
});

test('removing an image removes its queued and derived records', (t) => {
  const { filesPath, index, location } = fixture(t);
  const imagePath = path.join(filesPath, 'receipt.png');
  fs.writeFileSync(imagePath, 'image-placeholder');
  index.indexLocation(location.id);
  const claimed = index.imageAnalysis.claimNext();
  index.imageAnalysis.complete(claimed.file_id, claimed.content_fingerprint, {
    contentKind: 'unknown',
    ocr: { text: 'sample' },
  });

  fs.rmSync(imagePath);
  index.indexLocation(location.id);

  assert.equal(index.db.prepare('SELECT COUNT(*) AS count FROM files').get().count, 0);
  assert.equal(index.db.prepare('SELECT COUNT(*) AS count FROM image_analysis_jobs').get().count, 0);
  assert.equal(index.db.prepare('SELECT COUNT(*) AS count FROM image_analysis').get().count, 0);
});

test('interrupted and retryable jobs return to the pending queue', (t) => {
  const { filesPath, index, location } = fixture(t);
  fs.writeFileSync(path.join(filesPath, 'receipt.webp'), 'image-placeholder');
  index.indexLocation(location.id);

  const interrupted = index.imageAnalysis.claimNext();
  assert.equal(interrupted.attempt_count, 1);
  const recoveredQueue = new ImageAnalysisQueue({ db: index.db });
  const recovered = index.db.prepare('SELECT state, attempt_count, error_code FROM image_analysis_jobs').get();
  assert.deepEqual({ ...recovered }, { state: 'pending', attempt_count: 0, error_code: 'interrupted' });

  const retriedJob = recoveredQueue.claimNext();
  assert.equal(recoveredQueue.fail(retriedJob.file_id, new Error('temporary OCR failure')), true);
  assert.equal(recoveredQueue.status().retryableErrors, 1);
  assert.equal(recoveredQueue.retryErrors(retriedJob.file_id), 1);
  assert.equal(recoveredQueue.status().pending, 1);
});

test('a configured queue resumes persisted pending work on startup', async (t) => {
  const { filesPath, index, location } = fixture(t);
  const imagePath = path.join(filesPath, 'pending.jpg');
  fs.writeFileSync(imagePath, 'image-placeholder');
  index.indexLocation(location.id);
  assert.equal(index.imageAnalysis.status().pending, 1);

  const resumedQueue = new ImageAnalysisQueue({
    db: index.db,
    processor: async () => ({
      contentKind: 'receipt',
      ocr: { text: 'TOTAL 75000', language: 'id' },
      receipt: { total: 75000, currency: 'IDR' },
    }),
  });
  t.after(() => resumedQueue.stop());

  await waitFor(() => resumedQueue.status().ready === 1);
  const analysis = index.db.prepare('SELECT content_kind, ocr_text FROM image_analysis').get();
  assert.deepEqual({ ...analysis }, { content_kind: 'receipt', ocr_text: 'TOTAL 75000' });
});

test('a configured processor consumes jobs and persists validated output', async (t) => {
  const processedPaths = [];
  const { filesPath, index, location } = fixture(t, {
    imageAnalysisProcessor: async (job) => {
      processedPaths.push(job.full_path);
      return {
        contentKind: 'receipt',
        ocr: { text: 'TOTAL 50000', language: 'id', confidence: 0.91 },
        receipt: { total: 50000, currency: 'IDR' },
        modelVersions: { ocr: 'processor-test-v1' },
      };
    },
  });
  const imagePath = path.join(filesPath, 'processed.jpg');
  fs.writeFileSync(imagePath, 'image-placeholder');

  index.indexLocation(location.id);
  await waitFor(() => index.imageAnalysis.status().ready === 1);

  assert.deepEqual(processedPaths, [imagePath]);
  const analysis = index.db.prepare(`
    SELECT content_kind, ocr_text, ocr_language, model_versions_json
    FROM image_analysis
  `).get();
  assert.equal(analysis.content_kind, 'receipt');
  assert.equal(analysis.ocr_text, 'TOTAL 50000');
  assert.equal(analysis.ocr_language, 'id');
  assert.deepEqual(JSON.parse(analysis.model_versions_json), { ocr: 'processor-test-v1' });

  const matches = index.search({
    file_type: 'image',
    content_kinds: ['receipt'],
    ocr_terms: ['TOTAL 50000'],
  });
  assert.equal(matches.length, 1);
  assert.equal(matches[0].name, 'processed.jpg');
  assert.equal(matches[0].image_content_kind, 'receipt');
  assert.equal(matches[0].ocr_snippet, 'TOTAL 50000');
  assert.deepEqual(matches[0].receipt, { total: 50000, currency: 'IDR' });

  assert.equal(index.search({ ocr_terms: ['not present'] }).length, 0);
});
