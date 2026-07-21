const FILE_TYPES = Object.freeze(['document', 'image', 'video', 'audio', 'other']);
const DATE_FIELDS = Object.freeze(['created', 'modified']);
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
  fileTypes: FILE_TYPES,
  extensions: FILE_EXTENSIONS,
  dateFields: DATE_FIELDS,
  fields: Object.freeze([
    'fileType',
    'extensions',
    'filenameKeywords',
    'locationLabel',
    'dateField',
    'dateAfter',
    'dateBefore',
    'unsupportedClues',
    'clarifyingQuestion',
  ]),
});

const REQUEST_FIELDS = new Set(['query', 'today', 'allowedVocabulary']);

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
  return [...new Set(items.map((item) => stringOrNull(item, MAX_KEYWORD_LENGTH)).filter(Boolean))].slice(0, MAX_KEYWORDS);
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
  return value.map((item) => stringOrNull(item, 200)).filter(Boolean).slice(0, 5);
}

function isAllowedVocabulary(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const expectedKeys = Object.keys(ALLOWED_VOCABULARY);
  const receivedKeys = Object.keys(value);
  if (receivedKeys.length !== expectedKeys.length || receivedKeys.some((key) => !expectedKeys.includes(key))) return false;
  return expectedKeys.every((key) => Array.isArray(value[key])
    && value[key].length === ALLOWED_VOCABULARY[key].length
    && value[key].every((item, index) => item === ALLOWED_VOCABULARY[key][index]));
}

function validateRequest(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { error: 'Request body must be a JSON object.' };
  const keys = Object.keys(value);
  if (keys.length !== REQUEST_FIELDS.size || keys.some((key) => !REQUEST_FIELDS.has(key))) {
    return { error: 'Only query, today, and allowedVocabulary are accepted.' };
  }
  const query = stringOrNull(value.query, 500);
  const today = dateOrNull(value.today);
  if (!query) return { error: 'query must be a non-empty string up to 500 characters.' };
  if (!today) return { error: 'today must be an ISO date (YYYY-MM-DD).' };
  if (!isAllowedVocabulary(value.allowedVocabulary)) return { error: 'allowedVocabulary does not match the SageSearch contract.' };
  return { value: { query, today, allowedVocabulary: ALLOWED_VOCABULARY } };
}

function validateInterpretation(payload) {
  const source = payload && typeof payload === 'object' && !Array.isArray(payload)
    ? (payload.interpretation && typeof payload.interpretation === 'object' ? payload.interpretation : payload)
    : {};
  const rawFilters = source.filters && typeof source.filters === 'object' && !Array.isArray(source.filters)
    ? source.filters
    : source;
  const fileType = stringOrNull(rawFilters.fileType || rawFilters.file_type, 30);
  const dateField = stringOrNull(rawFilters.dateField || rawFilters.date_field, 20);

  return {
    filters: {
      fileType: FILE_TYPES.includes(fileType) ? fileType : null,
      extensions: normalizeExtensions(rawFilters.extensions || rawFilters.extensionFilters || rawFilters.extension_filters),
      filenameKeywords: normalizeKeywords(rawFilters.filenameKeywords || rawFilters.filename_keywords || rawFilters.keyword),
      locationLabel: stringOrNull(rawFilters.locationLabel || rawFilters.location_label || rawFilters.folder, 120),
      dateField: DATE_FIELDS.includes(dateField) ? dateField : 'modified',
      dateAfter: dateOrNull(rawFilters.dateAfter || rawFilters.date_after),
      dateBefore: dateOrNull(rawFilters.dateBefore || rawFilters.date_before),
    },
    unsupportedClues: normalizeClues(source.unsupportedClues || source.unsupported_clues),
    clarifyingQuestion: stringOrNull(source.clarifyingQuestion || source.clarifying_question, 300),
  };
}

const RESPONSE_JSON_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['filters', 'unsupportedClues', 'clarifyingQuestion'],
  properties: {
    filters: {
      type: 'object',
      additionalProperties: false,
      required: ['fileType', 'extensions', 'filenameKeywords', 'locationLabel', 'dateField', 'dateAfter', 'dateBefore'],
      properties: {
        fileType: { anyOf: [{ type: 'string', enum: FILE_TYPES }, { type: 'null' }] },
        extensions: { type: 'array', maxItems: MAX_EXTENSIONS, items: { type: 'string', enum: FILE_EXTENSIONS } },
        filenameKeywords: { type: 'array', maxItems: MAX_KEYWORDS, items: { type: 'string', maxLength: MAX_KEYWORD_LENGTH } },
        locationLabel: { anyOf: [{ type: 'string', maxLength: 120 }, { type: 'null' }] },
        dateField: { type: 'string', enum: DATE_FIELDS },
        dateAfter: { anyOf: [{ type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' }, { type: 'null' }] },
        dateBefore: { anyOf: [{ type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' }, { type: 'null' }] },
      },
    },
    unsupportedClues: { type: 'array', maxItems: 5, items: { type: 'string', maxLength: 200 } },
    clarifyingQuestion: { anyOf: [{ type: 'string', maxLength: 300 }, { type: 'null' }] },
  },
});

module.exports = { ALLOWED_VOCABULARY, RESPONSE_JSON_SCHEMA, validateInterpretation, validateRequest };
