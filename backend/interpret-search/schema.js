const FILE_TYPES = new Set(['document', 'image', 'video', 'audio', 'other']);
const DATE_FIELDS = new Set(['created', 'modified']);
const FILE_EXTENSIONS = Object.freeze([
  '.pdf', '.doc', '.docx', '.docm', '.dot', '.dotx', '.xls', '.xlsx', '.xlsm', '.xlsb', '.ppt', '.pptx', '.pps', '.ppsx', '.pot', '.potx', '.txt', '.csv', '.rtf', '.odt', '.ods', '.odp', '.md',
  '.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.svg', '.ico', '.tiff', '.tif', '.heic', '.heif', '.raw',
  '.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.webm', '.m4v', '.3gp', '.ts', '.mts',
  '.mp3', '.wav', '.flac', '.aac', '.ogg', '.m4a', '.wma', '.opus', '.aiff',
]);
const FILE_EXTENSION_SET = new Set(FILE_EXTENSIONS);
const MAX_KEYWORDS = 8;
const MAX_KEYWORD_LENGTH = 80;
const MAX_EXTENSIONS = 12;

const ALLOWED_VOCABULARY = Object.freeze({
  fileTypes: [...FILE_TYPES],
  extensions: FILE_EXTENSIONS,
  dateFields: [...DATE_FIELDS],
  fields: [
    'fileType',
    'extensions',
    'filenameKeywords',
    'locationLabel',
    'dateField',
    'dateAfter',
    'dateBefore',
    'unsupportedClues',
    'clarifyingQuestion',
  ],
});

function stringOrNull(value, maxLength = 300) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= maxLength ? trimmed : null;
}

function dateOrNull(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value ? null : value;
}

function normalizeKeywords(value) {
  const items = Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
  return [...new Set(items
    .map((item) => stringOrNull(item, MAX_KEYWORD_LENGTH))
    .filter(Boolean))]
    .slice(0, MAX_KEYWORDS);
}

function normalizeExtensions(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .map((item) => stringOrNull(item, 12)?.toLowerCase())
    .filter((item) => FILE_EXTENSION_SET.has(item)))]
    .slice(0, MAX_EXTENSIONS);
}

function normalizeClues(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => stringOrNull(item, 200))
    .filter(Boolean)
    .slice(0, 5);
}

/**
 * Treat provider output as untrusted input. Unknown fields are intentionally
 * discarded so an LLM can never widen the local SQLite query surface.
 */
function validateInterpretation(payload) {
  const source = payload && typeof payload === 'object' && !Array.isArray(payload)
    ? (payload.interpretation && typeof payload.interpretation === 'object' ? payload.interpretation : payload)
    : {};
  const rawFilters = source.filters && typeof source.filters === 'object' && !Array.isArray(source.filters)
    ? source.filters
    : source;

  const fileType = stringOrNull(rawFilters.fileType || rawFilters.file_type, 30);
  const dateField = stringOrNull(rawFilters.dateField || rawFilters.date_field, 20);
  const dateAfter = dateOrNull(rawFilters.dateAfter || rawFilters.date_after);
  const dateBefore = dateOrNull(rawFilters.dateBefore || rawFilters.date_before);

  return {
    filters: {
      fileType: FILE_TYPES.has(fileType) ? fileType : null,
      extensions: normalizeExtensions(rawFilters.extensions || rawFilters.extensionFilters || rawFilters.extension_filters),
      filenameKeywords: normalizeKeywords(rawFilters.filenameKeywords || rawFilters.filename_keywords || rawFilters.keyword),
      locationLabel: stringOrNull(rawFilters.locationLabel || rawFilters.location_label || rawFilters.folder, 120),
      dateField: DATE_FIELDS.has(dateField) ? dateField : 'modified',
      dateAfter,
      dateBefore,
    },
    unsupportedClues: normalizeClues(source.unsupportedClues || source.unsupported_clues),
    clarifyingQuestion: stringOrNull(source.clarifyingQuestion || source.clarifying_question, 300),
  };
}

function hasSupportedFilter(interpretation) {
  const filters = interpretation.filters;
  return Boolean(
    filters.fileType || filters.extensions.length || filters.filenameKeywords.length || filters.locationLabel || filters.dateAfter || filters.dateBefore,
  );
}

/**
 * "Screenshot" describes an image category, not necessarily a filename. A
 * screenshot saved under a custom name has no local metadata that identifies
 * it as a screenshot, so searching for the generated `screenshot` filename
 * token would incorrectly hide it. Keep that token only when the user
 * explicitly says it is part of the filename.
 */
const FILE_KIND_ALIASES = Object.freeze([
  { pattern: /\b(?:presentations?|slides?|slide\s+decks?|powerpoints?|pptx?)\b/i, fileType: 'document', extensions: ['.ppt', '.pptx', '.pps', '.ppsx', '.pot', '.potx', '.odp'] },
  { pattern: /\b(?:spreadsheets?|workbooks?|excel|xlsx?|csv)\b/i, fileType: 'document', extensions: ['.xls', '.xlsx', '.xlsm', '.xlsb', '.csv', '.ods'] },
  { pattern: /\b(?:pdfs?)\b/i, fileType: 'document', extensions: ['.pdf'] },
  { pattern: /\b(?:word\s+documents?|word\s+files?)\b/i, fileType: 'document', extensions: ['.doc', '.docx', '.docm', '.dot', '.dotx', '.rtf', '.odt'] },
  { pattern: /\bscreenshots?\b/i, fileType: 'image', extensions: [] },
  { pattern: /\b(?:photos?|pictures?|images?)\b/i, fileType: 'image', extensions: [] },
  { pattern: /\b(?:movies?|videos?|clips?)\b/i, fileType: 'video', extensions: [] },
  { pattern: /\b(?:songs?|music|audio|recordings?)\b/i, fileType: 'audio', extensions: [] },
]);

/**
 * File-kind words describe metadata filters, not a literal filename. The AI
 * receives the same rule, but this local fallback makes common terms work
 * consistently with either Cloud or LM Studio providers.
 */
function applyQueryDefaults(query, interpretation) {
  if (typeof query !== 'string') return interpretation;
  const explicitFilename = /\b(?:named|called|filename|file name)\b/i.test(query);
  if (explicitFilename) return interpretation;

  const matchingAlias = FILE_KIND_ALIASES.find((alias) => alias.pattern.test(query));
  if (!matchingAlias) return interpretation;
  return {
    ...interpretation,
    filters: {
      ...interpretation.filters,
      fileType: matchingAlias.fileType,
      extensions: matchingAlias.extensions,
      filenameKeywords: interpretation.filters.filenameKeywords
        .filter((keyword) => !matchingAlias.pattern.test(keyword)),
    },
  };
}

module.exports = { ALLOWED_VOCABULARY, FILE_EXTENSIONS, validateInterpretation, hasSupportedFilter, applyQueryDefaults };
