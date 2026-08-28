const fs = require('fs');
const path = require('path');
const os = require('os');

function formatYmd(year, month, day) {
  const mm = String(month).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return `${year}-${mm}-${dd}`;
}

/**
 * Parses informal date ranges like 'last_month', 'last_30_days', '2026-07'.
 */
function parseDateRange(rangeStr) {
  if (!rangeStr || typeof rangeStr !== 'string') return {};
  const lower = rangeStr.toLowerCase().trim();
  const now = new Date();

  if (lower === 'last_month') {
    let year = now.getFullYear();
    let month = now.getMonth(); // 0-indexed: previous month is now.getMonth()
    if (month === 0) {
      month = 12;
      year -= 1;
    }
    const lastDay = new Date(year, month, 0).getDate();
    return {
      date_after: formatYmd(year, month, 1),
      date_before: formatYmd(year, month, lastDay),
    };
  }
  if (lower === 'last_30_days') {
    const start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    return {
      date_after: formatYmd(start.getFullYear(), start.getMonth() + 1, start.getDate()),
      date_before: formatYmd(now.getFullYear(), now.getMonth() + 1, now.getDate()),
    };
  }
  // YYYY-MM format
  if (/^\d{4}-\d{2}$/.test(lower)) {
    const [y, m] = lower.split('-').map(Number);
    const lastDay = new Date(y, m, 0).getDate();
    return {
      date_after: formatYmd(y, m, 1),
      date_before: formatYmd(y, m, lastDay),
    };
  }
  return {};
}

/**
 * Executes a file search on the local SQLite SearchIndex.
 */
function localSearchFiles(params = {}, searchIndex) {
  const { query = '', file_types = [], date_range, max_results = 20 } = params;
  const { date_after, date_before } = parseDateRange(date_range);

  const extensions = Array.isArray(file_types)
    ? file_types.map((ft) => (ft.startsWith('.') ? ft.toLowerCase() : `.${ft.toLowerCase()}`))
    : [];

  const keywords = query
    .split(/\s+/)
    .map((k) => k.trim())
    .filter((k) => k.length > 1);

  if (searchIndex && typeof searchIndex.search === 'function') {
    const rows = searchIndex.search({
      filename_keywords: keywords,
      extensions: extensions.length ? extensions : undefined,
      date_after,
      date_before,
      limit: max_results,
    });

    return rows.map((r) => ({
      path: r.full_path,
      name: r.name,
      extension: r.extension,
      size_bytes: r.size_bytes,
      modified: r.modified_iso,
      folder: r.folder,
      snippet: `${r.name} (${r.extension}, ${(r.size_bytes / 1024).toFixed(1)} KB)`
    }));
  }

  return [];
}

/**
 * Reads local file content up to max_chars limit.
 */
async function localReadFileContent(params = {}) {
  const { path: filePath, max_chars = 8000 } = params;
  if (!filePath || typeof filePath !== 'string') {
    return { path: filePath, content: '', char_count: 0, status: 'error', error: 'Missing path argument' };
  }

  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    return { path: filePath, content: '', char_count: 0, status: 'not_found', error: `File does not exist: ${filePath}` };
  }

  try {
    const stats = fs.statSync(resolved);
    if (!stats.isFile()) {
      return { path: filePath, content: '', char_count: 0, status: 'error', error: `Path is not a regular file: ${filePath}` };
    }

    // Read content as UTF-8
    const raw = fs.readFileSync(resolved, 'utf8');
    const content = raw.slice(0, max_chars);
    return {
      path: resolved,
      content,
      char_count: content.length,
      total_bytes: stats.size,
      status: 'success'
    };
  } catch (error) {
    return { path: filePath, content: '', char_count: 0, status: 'error', error: error.message };
  }
}

/**
 * Creates an artifact file on the local filesystem.
 */
async function localCreateArtifact(params = {}) {
  const { filename, content_type = 'text/plain', data = '', target_directory } = params;
  if (!filename || typeof filename !== 'string') {
    throw new Error('Filename is required to create an artifact.');
  }

  const sanitizedName = path.basename(filename);
  const targetDir = target_directory || path.join(os.homedir(), 'Documents', 'SageSearch_Exports');
  fs.mkdirSync(targetDir, { recursive: true });

  const destinationPath = path.join(targetDir, sanitizedName);
  fs.writeFileSync(destinationPath, data, 'utf8');
  const stats = fs.statSync(destinationPath);

  return {
    filename: sanitizedName,
    content_type,
    byte_count: stats.size,
    saved_path: destinationPath,
    status: 'created'
  };
}

module.exports = {
  parseDateRange,
  localSearchFiles,
  localReadFileContent,
  localCreateArtifact,
};
