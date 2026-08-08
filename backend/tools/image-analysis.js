const VALID_CONTENT_KINDS = new Set(['receipt', 'picture', 'mixed', 'unknown']);

function nowIso(now) {
  return now().toISOString();
}

function asJson(value, fallback) {
  return JSON.stringify(value == null ? fallback : value);
}

function setupImageAnalysisSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS image_analysis_jobs (
      file_id INTEGER PRIMARY KEY REFERENCES files(id) ON DELETE CASCADE,
      content_fingerprint TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'pending'
        CHECK (state IN ('pending', 'analyzing', 'ready', 'retryable_error', 'permanent_error')),
      attempt_count INTEGER NOT NULL DEFAULT 0,
      priority INTEGER NOT NULL DEFAULT 0,
      started_at TEXT,
      completed_at TEXT,
      updated_at TEXT NOT NULL,
      error_code TEXT,
      error_message TEXT
    );

    CREATE INDEX IF NOT EXISTS image_analysis_jobs_state_idx
      ON image_analysis_jobs(state, priority DESC, updated_at);

    CREATE TABLE IF NOT EXISTS image_analysis (
      file_id INTEGER PRIMARY KEY REFERENCES files(id) ON DELETE CASCADE,
      content_fingerprint TEXT NOT NULL,
      content_kind TEXT NOT NULL DEFAULT 'unknown'
        CHECK (content_kind IN ('receipt', 'picture', 'mixed', 'unknown')),
      receipt_confidence REAL,
      picture_confidence REAL,
      ocr_text TEXT,
      ocr_language TEXT,
      ocr_confidence REAL,
      receipt_json TEXT,
      labels_json TEXT,
      face_count INTEGER,
      model_versions_json TEXT NOT NULL DEFAULT '{}',
      analyzed_at TEXT NOT NULL
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS image_fts USING fts5(
      ocr_text,
      receipt_text,
      tokenize = 'unicode61 remove_diacritics 2'
    );

    CREATE TRIGGER IF NOT EXISTS files_image_search_cleanup
    AFTER DELETE ON files
    BEGIN
      DELETE FROM image_fts WHERE rowid = old.id;
    END;
  `);
  db.exec(`
    INSERT INTO image_fts (rowid, ocr_text, receipt_text)
    SELECT ia.file_id, COALESCE(ia.ocr_text, ''),
           CASE WHEN ia.receipt_json = 'null' THEN '' ELSE COALESCE(ia.receipt_json, '') END
    FROM image_analysis ia
    WHERE NOT EXISTS (SELECT 1 FROM image_fts WHERE rowid = ia.file_id);
  `);
}

// A processor receives one claimed job, including its canonical full_path, and
// returns a validated analysis object. The queue owns persistence and retries;
// OCR or vision providers never receive database or filesystem search access.
class ImageAnalysisQueue {
  constructor({ db, processor = null, maxAttempts = 3, now = () => new Date() } = {}) {
    if (!db) throw new Error('ImageAnalysisQueue requires a SQLite database.');
    this.db = db;
    this.processor = processor;
    this.maxAttempts = Math.max(1, Number.parseInt(maxAttempts, 10) || 3);
    this.now = now;
    this.running = false;
    this.scheduled = false;
    this.stopped = false;
    setupImageAnalysisSchema(db);
    this.recoverInterruptedJobs();
    // A prior process may have exited after persisting pending work. Enqueueing
    // skips identical jobs by design, so explicitly resume that durable queue.
    this.schedule();
  }

  recoverInterruptedJobs() {
    const timestamp = nowIso(this.now);
    return this.db.prepare(`
      UPDATE image_analysis_jobs
      SET state = 'pending',
          attempt_count = CASE WHEN attempt_count > 0 THEN attempt_count - 1 ELSE 0 END,
          started_at = NULL, updated_at = ?,
          error_code = 'interrupted', error_message = 'Analysis was interrupted and has been queued again.'
      WHERE state = 'analyzing'
    `).run(timestamp).changes;
  }

  enqueue({ fileId, contentFingerprint, priority = 0 }) {
    return this.enqueueMany([{ fileId, contentFingerprint, priority }]) > 0;
  }

  enqueueMany(items) {
    if (!Array.isArray(items) || !items.length) return 0;
    const getJob = this.db.prepare('SELECT * FROM image_analysis_jobs WHERE file_id = ?');
    const getAnalysis = this.db.prepare('SELECT content_fingerprint FROM image_analysis WHERE file_id = ?');
    const deleteAnalysis = this.db.prepare('DELETE FROM image_analysis WHERE file_id = ?');
    const deleteSearchText = this.db.prepare('DELETE FROM image_fts WHERE rowid = ?');
    const upsertJob = this.db.prepare(`
      INSERT INTO image_analysis_jobs (
        file_id, content_fingerprint, state, attempt_count, priority, updated_at,
        started_at, completed_at, error_code, error_message
      ) VALUES (?, ?, 'pending', 0, ?, ?, NULL, NULL, NULL, NULL)
      ON CONFLICT(file_id) DO UPDATE SET
        content_fingerprint = excluded.content_fingerprint,
        state = 'pending',
        attempt_count = 0,
        priority = excluded.priority,
        updated_at = excluded.updated_at,
        started_at = NULL,
        completed_at = NULL,
        error_code = NULL,
        error_message = NULL
    `);
    let enqueued = 0;
    this.db.exec('BEGIN');
    try {
      for (const { fileId, contentFingerprint, priority = 0 } of items) {
        if (!Number.isInteger(fileId) || fileId < 1) throw new Error('A valid file id is required.');
        if (typeof contentFingerprint !== 'string' || !contentFingerprint) {
          throw new Error('A content fingerprint is required.');
        }

        const job = getJob.get(fileId);
        const analysis = getAnalysis.get(fileId);
        if (job?.content_fingerprint === contentFingerprint &&
            (job.state !== 'ready' || analysis?.content_fingerprint === contentFingerprint)) {
          continue;
        }

        if (job?.content_fingerprint !== contentFingerprint || analysis?.content_fingerprint !== contentFingerprint) {
          deleteAnalysis.run(fileId);
          deleteSearchText.run(fileId);
        }
        upsertJob.run(
          fileId,
          contentFingerprint,
          Number.parseInt(priority, 10) || 0,
          nowIso(this.now),
        );
        enqueued += 1;
      }
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }

    if (enqueued) this.schedule();
    return enqueued;
  }

  claimNext() {
    const timestamp = nowIso(this.now);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const job = this.db.prepare(`
        SELECT j.*, f.full_path, f.name, f.extension, f.size_bytes, f.modified_iso
        FROM image_analysis_jobs j
        JOIN files f ON f.id = j.file_id
        WHERE j.state = 'pending' AND j.attempt_count < ?
        ORDER BY j.priority DESC, j.updated_at ASC, j.file_id ASC
        LIMIT 1
      `).get(this.maxAttempts);
      if (!job) {
        this.db.exec('COMMIT');
        return null;
      }

      this.db.prepare(`
        UPDATE image_analysis_jobs
        SET state = 'analyzing', attempt_count = attempt_count + 1,
            started_at = ?, updated_at = ?, error_code = NULL, error_message = NULL
        WHERE file_id = ? AND state = 'pending'
      `).run(timestamp, timestamp, job.file_id);
      this.db.exec('COMMIT');
      return { ...job, attempt_count: job.attempt_count + 1, state: 'analyzing' };
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  complete(fileId, contentFingerprint, result = {}) {
    const job = this.db.prepare('SELECT * FROM image_analysis_jobs WHERE file_id = ?').get(fileId);
    if (!job || job.state !== 'analyzing') return false;
    if (job.content_fingerprint !== contentFingerprint) return false;

    const contentKind = VALID_CONTENT_KINDS.has(result.contentKind) ? result.contentKind : 'unknown';
    const timestamp = nowIso(this.now);
    const receiptJson = asJson(result.receipt, null);
    this.db.exec('BEGIN');
    try {
      this.db.prepare(`
        INSERT INTO image_analysis (
          file_id, content_fingerprint, content_kind, receipt_confidence,
          picture_confidence, ocr_text, ocr_language, ocr_confidence,
          receipt_json, labels_json, face_count, model_versions_json, analyzed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(file_id) DO UPDATE SET
          content_fingerprint = excluded.content_fingerprint,
          content_kind = excluded.content_kind,
          receipt_confidence = excluded.receipt_confidence,
          picture_confidence = excluded.picture_confidence,
          ocr_text = excluded.ocr_text,
          ocr_language = excluded.ocr_language,
          ocr_confidence = excluded.ocr_confidence,
          receipt_json = excluded.receipt_json,
          labels_json = excluded.labels_json,
          face_count = excluded.face_count,
          model_versions_json = excluded.model_versions_json,
          analyzed_at = excluded.analyzed_at
      `).run(
        fileId,
        contentFingerprint,
        contentKind,
        result.receiptConfidence ?? null,
        result.pictureConfidence ?? null,
        result.ocr?.text ?? null,
        result.ocr?.language ?? null,
        result.ocr?.confidence ?? null,
        receiptJson,
        asJson(result.labels, []),
        Number.isInteger(result.faceCount) ? result.faceCount : null,
        asJson(result.modelVersions, {}),
        timestamp,
      );
      this.db.prepare('DELETE FROM image_fts WHERE rowid = ?').run(fileId);
      this.db.prepare(`
        INSERT INTO image_fts (rowid, ocr_text, receipt_text) VALUES (?, ?, ?)
      `).run(fileId, result.ocr?.text ?? '', receiptJson === 'null' ? '' : receiptJson);
      this.db.prepare(`
        UPDATE image_analysis_jobs
        SET state = 'ready', completed_at = ?, updated_at = ?,
            error_code = NULL, error_message = NULL
        WHERE file_id = ?
      `).run(timestamp, timestamp, fileId);
      this.db.exec('COMMIT');
      return true;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  fail(fileId, error, { retryable = true, code = 'analysis_failed' } = {}) {
    const job = this.db.prepare('SELECT * FROM image_analysis_jobs WHERE file_id = ?').get(fileId);
    if (!job || job.state !== 'analyzing') return false;
    const canRetry = retryable && job.attempt_count < this.maxAttempts;
    const timestamp = nowIso(this.now);
    this.db.prepare(`
      UPDATE image_analysis_jobs
      SET state = ?, started_at = NULL, updated_at = ?, error_code = ?, error_message = ?
      WHERE file_id = ?
    `).run(
      canRetry ? 'retryable_error' : 'permanent_error',
      timestamp,
      String(code).slice(0, 100),
      String(error?.message || error || 'Image analysis failed.').slice(0, 500),
      fileId,
    );
    return true;
  }

  retryErrors(fileId = null) {
    const timestamp = nowIso(this.now);
    const result = fileId == null
      ? this.db.prepare(`
          UPDATE image_analysis_jobs
          SET state = 'pending', updated_at = ?, error_code = NULL, error_message = NULL
          WHERE state = 'retryable_error'
        `).run(timestamp)
      : this.db.prepare(`
          UPDATE image_analysis_jobs
          SET state = 'pending', updated_at = ?, error_code = NULL, error_message = NULL
          WHERE file_id = ? AND state = 'retryable_error'
        `).run(timestamp, fileId);
    if (result.changes) this.schedule();
    return result.changes;
  }

  prioritize(fileId, priority = 100) {
    const timestamp = nowIso(this.now);
    const result = this.db.prepare(`
      UPDATE image_analysis_jobs
      SET state = CASE WHEN state = 'retryable_error' THEN 'pending' ELSE state END,
          priority = ?, updated_at = ?, error_code = NULL, error_message = NULL
      WHERE file_id = ? AND state IN ('pending', 'retryable_error')
    `).run(Number.parseInt(priority, 10) || 100, timestamp, fileId);
    if (result.changes) this.schedule();
    return result.changes > 0;
  }

  status() {
    const counts = Object.fromEntries(this.db.prepare(`
      SELECT state, COUNT(*) AS count
      FROM image_analysis_jobs
      GROUP BY state
    `).all().map((row) => [row.state, Number(row.count)]));
    const indexedImages = Number(this.db.prepare("SELECT COUNT(*) AS count FROM files WHERE category = 'image'").get().count);
    return {
      processorConfigured: typeof this.processor === 'function',
      running: this.running,
      indexedImages,
      pending: counts.pending || 0,
      analyzing: counts.analyzing || 0,
      ready: counts.ready || 0,
      retryableErrors: counts.retryable_error || 0,
      permanentErrors: counts.permanent_error || 0,
    };
  }

  schedule() {
    if (this.stopped || this.scheduled || this.running || typeof this.processor !== 'function') return;
    this.scheduled = true;
    setImmediate(() => {
      this.scheduled = false;
      this.run().catch((error) => console.error(`Image analysis queue failed: ${error.message}`));
    });
  }

  async run() {
    if (this.stopped || this.running || typeof this.processor !== 'function') return;
    this.running = true;
    try {
      let job;
      while (!this.stopped && (job = this.claimNext())) {
        try {
          const result = await this.processor(job);
          this.complete(job.file_id, job.content_fingerprint, result);
        } catch (error) {
          this.fail(job.file_id, error, {
            retryable: error?.retryable !== false,
            code: error?.code || 'analysis_failed',
          });
        }
      }
    } finally {
      this.running = false;
    }
  }

  stop() {
    this.stopped = true;
  }
}

module.exports = { ImageAnalysisQueue, setupImageAnalysisSchema };
