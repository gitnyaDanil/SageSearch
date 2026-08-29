const fs = require('fs');
const path = require('path');
const os = require('os');
const { DatabaseSync } = require('node:sqlite');

const FILE_TYPES = {
  document: ['.pdf', '.doc', '.docx', '.docm', '.dot', '.dotx', '.xls', '.xlsx', '.xlsm', '.xlsb', '.ppt', '.pptx', '.pps', '.ppsx', '.pot', '.potx', '.txt', '.csv', '.rtf', '.odt', '.ods', '.odp', '.md'],
  image: ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.svg', '.ico', '.tiff', '.tif', '.heic', '.heif', '.raw'],
  video: ['.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.webm', '.m4v', '.3gp', '.ts', '.mts'],
  audio: ['.mp3', '.wav', '.flac', '.aac', '.ogg', '.m4a', '.wma', '.opus', '.aiff'],
};

function categoryForExtension(extension) {
  for (const [category, extensions] of Object.entries(FILE_TYPES)) {
    if (extensions.includes(extension)) return category;
  }
  return 'other';
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function readableDate(iso) {
  return new Date(iso).toLocaleString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function defaultLocations() {
  const home = os.homedir();
  return [
    ['Documents', path.join(home, 'Documents')],
    ['Downloads', path.join(home, 'Downloads')],
    ['Desktop', path.join(home, 'Desktop')],
    ['Pictures', path.join(home, 'Pictures')],
    ['Videos', path.join(home, 'Videos')],
    ['Music', path.join(home, 'Music')],
  ];
}

function shouldSkip(entry) {
  return entry.name.startsWith('.') || entry.name.startsWith('$') ||
    entry.name === 'node_modules' || entry.name === 'System Volume Information' ||
    entry.name === 'WindowsApps';
}

class SearchIndex {
  constructor({ databasePath, maxDepth = 6, locations = defaultLocations() } = {}) {
    const dataDir = path.dirname(databasePath || path.join(__dirname, '..', 'data', 'sagesearch.sqlite'));
    fs.mkdirSync(dataDir, { recursive: true });
    this.db = new DatabaseSync(databasePath || path.join(dataDir, 'sagesearch.sqlite'));
    this.maxDepth = maxDepth;
    this.defaults = locations;
    this.indexing = new Set();
    this.setup();
  }

  setup() {
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS locations (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        path TEXT NOT NULL UNIQUE,
        is_default INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'ready',
        indexed_at TEXT,
        file_count INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS files (
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
      CREATE INDEX IF NOT EXISTS files_location_idx ON files(location_id);
      CREATE INDEX IF NOT EXISTS files_name_idx ON files(name COLLATE NOCASE);
      CREATE INDEX IF NOT EXISTS files_modified_idx ON files(modified_iso);
      CREATE INDEX IF NOT EXISTS files_created_idx ON files(created_iso);
    `);

    const initialized = this.db.prepare("SELECT value FROM app_meta WHERE key = 'locations_initialized'").get();
    if (!initialized) {
      const insert = this.db.prepare('INSERT OR IGNORE INTO locations (name, path, is_default, status) VALUES (?, ?, 1, ?)');
      for (const [name, locationPath] of this.defaults) {
        insert.run(name, path.resolve(locationPath), fs.existsSync(locationPath) ? 'indexing' : 'disconnected');
      }
      this.db.prepare("INSERT INTO app_meta (key, value) VALUES ('locations_initialized', '1')").run();
    }
  }

  start() {
    this.refreshLocationAvailability();
    for (const location of this.locations()) {
      if (location.exists) this.scheduleIndex(location.id);
    }
  }

  locations() {
    return this.db.prepare('SELECT * FROM locations ORDER BY is_default DESC, name COLLATE NOCASE').all().map((location) => ({
      ...location,
      is_default: Boolean(location.is_default),
      exists: fs.existsSync(location.path),
    }));
  }

  refreshLocationAvailability() {
    for (const location of this.locations()) {
      if (!location.exists) {
        if (location.status !== 'disconnected') {
          this.db.prepare("UPDATE locations SET status = 'disconnected' WHERE id = ?").run(location.id);
        }
      } else if (location.status === 'disconnected') {
        this.db.prepare("UPDATE locations SET status = 'indexing' WHERE id = ?").run(location.id);
        this.scheduleIndex(location.id);
      }
    }
  }

  addLocation({ name, locationPath }) {
    if (typeof locationPath !== 'string' || !locationPath.trim()) throw new Error('A folder path is required.');
    const resolved = path.resolve(locationPath.trim());
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
      throw new Error('That folder is not currently available. Connect the drive or choose an existing folder.');
    }
    const displayName = (name || path.basename(resolved) || resolved).trim();
    const result = this.db.prepare("INSERT INTO locations (name, path, status) VALUES (?, ?, 'indexing')").run(displayName, resolved);
    this.scheduleIndex(Number(result.lastInsertRowid));
    return this.locationById(Number(result.lastInsertRowid));
  }

  removeLocation(id) {
    const location = this.locationById(id);
    if (!location) return false;
    this.db.prepare('DELETE FROM files WHERE location_id = ?').run(id);
    this.db.prepare('DELETE FROM locations WHERE id = ?').run(id);
    return true;
  }

  locationById(id) {
    const location = this.db.prepare('SELECT * FROM locations WHERE id = ?').get(id);
    return location && { ...location, is_default: Boolean(location.is_default), exists: fs.existsSync(location.path) };
  }

  scheduleIndex(id) {
    if (this.indexing.has(id)) return;
    this.indexing.add(id);
    this.db.prepare("UPDATE locations SET status = 'indexing' WHERE id = ?").run(id);
    setImmediate(() => {
      try { this.indexLocation(id); }
      catch (error) {
        console.error(`Indexing location ${id} failed: ${error.message}`);
        this.db.prepare("UPDATE locations SET status = 'disconnected' WHERE id = ?").run(id);
      } finally {
        this.indexing.delete(id);
      }
    });
  }

  indexLocation(id) {
    const location = this.locationById(id);
    if (!location || !location.exists) {
      if (location) this.db.prepare("UPDATE locations SET status = 'disconnected' WHERE id = ?").run(id);
      return;
    }

    const rows = [];
    const walk = (directory, depth = 0) => {
      if (depth > this.maxDepth) return;
      let entries;
      try { entries = fs.readdirSync(directory, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) {
        if (shouldSkip(entry)) continue;
        const fullPath = path.join(directory, entry.name);
        if (entry.isDirectory()) walk(fullPath, depth + 1);
        else if (entry.isFile()) {
          try {
            const stat = fs.statSync(fullPath);
            const extension = path.extname(entry.name).toLowerCase();
            rows.push({
              name: entry.name, fullPath, folder: path.dirname(fullPath), extension,
              category: categoryForExtension(extension), size: stat.size,
              created: stat.birthtime.toISOString(), modified: stat.mtime.toISOString(),
            });
          } catch { /* File was removed or is inaccessible. */ }
        }
      }
    };
    walk(location.path);

    const replace = (files) => {
      this.db.exec('BEGIN');
      try {
      this.db.prepare('DELETE FROM files WHERE location_id = ?').run(id);
      const insert = this.db.prepare(`
        INSERT OR REPLACE INTO files (location_id, name, full_path, folder, extension, category, size_bytes, created_iso, modified_iso)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const file of files) insert.run(id, file.name, file.fullPath, file.folder, file.extension, file.category, file.size, file.created, file.modified);
      this.db.prepare("UPDATE locations SET status = 'ready', indexed_at = ?, file_count = ? WHERE id = ?")
        .run(new Date().toISOString(), files.length, id);
        this.db.exec('COMMIT');
      } catch (error) {
        this.db.exec('ROLLBACK');
        throw error;
      }
    };
    replace(rows);
  }

  search({ folder, file_type, extensions, keyword, filename_keywords, date_after, date_before, date_field = 'modified', limit = 30 } = {}) {
    this.refreshLocationAvailability();
    const field = date_field === 'created' ? 'created_iso' : 'modified_iso';
    const where = [];
    const values = [];
    if (file_type && (FILE_TYPES[file_type] || file_type === 'other')) { where.push('f.category = ?'); values.push(file_type); }
    const extensionFilters = Array.isArray(extensions) ? extensions : [];
    const safeExtensions = [...new Set(extensionFilters
      .filter((extension) => typeof extension === 'string' && /^\.[a-z0-9]{1,10}$/i.test(extension))
      .map((extension) => extension.toLowerCase()))]
      .slice(0, 12);
    if (safeExtensions.length) {
      where.push(`f.extension IN (${safeExtensions.map(() => '?').join(', ')})`);
      values.push(...safeExtensions);
    }
    const keywords = Array.isArray(filename_keywords)
      ? filename_keywords
      : keyword ? [keyword] : [];
    for (const item of keywords.slice(0, 8)) {
      if (typeof item !== 'string' || !item.trim()) continue;
      where.push("LOWER(f.name) LIKE ? ESCAPE '\\'");
      values.push(`%${item.trim().toLowerCase().replace(/[\\%_]/g, '\\$&')}%`);
    }
    if (date_after && !Number.isNaN(Date.parse(date_after))) { where.push(`f.${field} >= ?`); values.push(new Date(date_after).toISOString()); }
    if (date_before && !Number.isNaN(Date.parse(date_before))) {
      where.push(`f.${field} <= ?`);
      values.push(new Date(`${date_before}T23:59:59.999Z`).toISOString());
    }
    if (folder) {
      where.push('(LOWER(l.name) LIKE ? OR LOWER(l.path) LIKE ? OR LOWER(f.folder) LIKE ?)');
      const needle = `%${String(folder).toLowerCase().replace(/[\\%_]/g, '\\$&')}%`;
      values.push(needle, needle, needle);
    }
    const safeLimit = Math.min(Math.max(Number.parseInt(limit, 10) || 30, 1), 200);
    const query = `
      SELECT f.*, l.name AS source_location, l.path AS source_path, l.status AS location_status
      FROM files f JOIN locations l ON l.id = f.location_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY f.${field} DESC LIMIT ?
    `;
    const result = this.db.prepare(query).all(...values, safeLimit);
    return result.map((file) => ({
      name: file.name, path: file.full_path, folder: file.folder, extension: file.extension,
      category: file.category, size_bytes: file.size_bytes, size_readable: formatSize(file.size_bytes),
      created_iso: file.created_iso, created_readable: readableDate(file.created_iso),
      modified_iso: file.modified_iso, modified_readable: readableDate(file.modified_iso),
      source_location: file.source_location,
      available: file.location_status !== 'disconnected',
      availability: file.location_status === 'disconnected' ? 'unavailable' : 'available',
    }));
  }

  close() { this.db.close(); }

  status() {
    const locations = this.locations();
    return {
      indexing: locations.some((location) => location.status === 'indexing'),
      totalLocations: locations.length,
      readyLocations: locations.filter((location) => location.status === 'ready').length,
      indexedFiles: locations.reduce((total, location) => total + (location.file_count || 0), 0),
    };
  }
}

let searchIndex;

function initializeSearchIndex(options = {}) {
  if (!searchIndex) searchIndex = new SearchIndex(options);
  searchIndex.start();
  return searchIndex;
}

function requireIndex() {
  return searchIndex || initializeSearchIndex();
}

function searchDocuments(params) { return requireIndex().search(params); }
function listSearchFolders() { return requireIndex().locations(); }
function addSearchLocation(params) { return requireIndex().addLocation(params); }
function removeSearchLocation(id) { return requireIndex().removeLocation(id); }
function reindexLocation(id) { const index = requireIndex(); if (!index.locationById(id)) return false; index.scheduleIndex(id); return true; }
function getSearchIndexStatus() { return requireIndex().status(); }

module.exports = {
  SearchIndex, FILE_TYPES, initializeSearchIndex, searchDocuments, listSearchFolders,
  addSearchLocation, removeSearchLocation, reindexLocation, getSearchIndexStatus,
};
