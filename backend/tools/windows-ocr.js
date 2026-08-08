const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const SUPPORTED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.bmp', '.tif', '.tiff']);
const RECEIPT_TERMS = [
  'receipt', 'invoice', 'subtotal', 'total', 'tax', 'cash', 'change',
  'struk', 'faktur', 'jumlah', 'pajak', 'tunai', 'kembali',
];

class ImageAnalysisError extends Error {
  constructor(message, { code = 'ocr_failed', retryable = true } = {}) {
    super(message);
    this.name = 'ImageAnalysisError';
    this.code = code;
    this.retryable = retryable;
  }
}

function receiptSignals(text) {
  const normalized = String(text || '').toLowerCase();
  const matchedTerms = RECEIPT_TERMS.filter((term) => new RegExp(`\\b${term}\\b`, 'i').test(normalized));
  const hasCurrency = /(?:\brp\.?\s*|\bidr\b|[$€£¥])\s*\d/i.test(normalized);
  const hasAmountLine = /(?:total|jumlah|amount\s+due)[^\r\n]{0,30}\d/i.test(normalized);
  const hasDate = /\b(?:\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4})\b/.test(normalized);
  const score = Math.min(1,
    matchedTerms.length * 0.12 +
    (hasCurrency ? 0.25 : 0) +
    (hasAmountLine ? 0.25 : 0) +
    (hasDate ? 0.1 : 0));
  return { score: Number(score.toFixed(2)), matchedTerms, hasCurrency, hasAmountLine, hasDate };
}

function amountFromText(value) {
  const compact = String(value || '').replace(/[^\d.,-]/g, '');
  if (!compact || !/\d/.test(compact)) return null;
  const lastDot = compact.lastIndexOf('.');
  const lastComma = compact.lastIndexOf(',');
  const separator = Math.max(lastDot, lastComma);
  let normalized;
  if (separator >= 0 && compact.length - separator - 1 === 2) {
    normalized = `${compact.slice(0, separator).replace(/[.,]/g, '')}.${compact.slice(separator + 1)}`;
  } else {
    normalized = compact.replace(/[.,]/g, '');
  }
  const amount = Number(normalized);
  return Number.isFinite(amount) && amount >= 0 ? amount : null;
}

function extractReceiptFields(text, lines = null) {
  const sourceLines = Array.isArray(lines) && lines.length
    ? lines.map((line) => String(line).trim()).filter(Boolean)
    : String(text || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const currency = /\b(?:rp\.?|idr)\b/i.test(text) ? 'IDR'
    : /\busd\b|\$/i.test(text) ? 'USD'
      : /\beur\b|€/i.test(text) ? 'EUR'
        : null;
  const totalLine = [...sourceLines].reverse().find((line) => /\b(?:grand\s+total|total|jumlah|amount\s+due)\b/i.test(line));
  const amountToken = totalLine?.match(/(?:rp\.?|idr|usd|eur|[$€£¥])?\s*-?\d[\d.,\s]*/i)?.[0]?.trim() || null;
  const dateText = String(text || '').match(/\b(?:\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4})\b/)?.[0] || null;
  const merchant = sourceLines.find((line) =>
    /[a-z]/i.test(line) && line.length <= 80 &&
    !/\b(?:receipt|invoice|struk|faktur|tanggal|date|total|subtotal)\b/i.test(line)) || null;
  return {
    merchantCandidate: merchant,
    transactionDateText: dateText,
    totalText: amountToken,
    total: amountFromText(amountToken),
    currency,
  };
}

function runWindowsOcr(imagePath, {
  scriptPath = path.join(__dirname, 'windows-ocr.ps1'),
  timeoutMs = 30_000,
  spawnImpl = spawn,
} = {}) {
  return new Promise((resolve, reject) => {
    const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const child = spawnImpl(powershell, [
      '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-File', scriptPath, '-ImagePath', imagePath,
    ], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(new ImageAnalysisError('Windows OCR timed out.', { code: 'ocr_timeout' }));
    }, timeoutMs);

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      if (stdout.length > 2_000_000 && !settled) {
        settled = true;
        clearTimeout(timer);
        child.kill();
        reject(new ImageAnalysisError('Windows OCR returned too much data.', { code: 'ocr_output_limit', retryable: false }));
      }
    });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new ImageAnalysisError(`Could not start Windows OCR: ${error.message}`, { code: 'ocr_unavailable', retryable: false }));
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        return reject(new ImageAnalysisError(
          stderr.trim().split(/\r?\n/).slice(-1)[0] || `Windows OCR exited with code ${code}.`,
          { code: 'ocr_failed', retryable: false },
        ));
      }
      try {
        resolve(JSON.parse(stdout.trim()));
      } catch {
        reject(new ImageAnalysisError('Windows OCR returned invalid JSON.', { code: 'ocr_invalid_output', retryable: false }));
      }
    });
  });
}

function createWindowsOcrProcessor({ maxFileBytes = 25 * 1024 * 1024, ...runnerOptions } = {}) {
  return async (job) => {
    if (process.platform !== 'win32') {
      throw new ImageAnalysisError('Windows OCR is available only on Windows.', { code: 'unsupported_platform', retryable: false });
    }
    const extension = path.extname(job.full_path).toLowerCase();
    if (!SUPPORTED_EXTENSIONS.has(extension)) {
      throw new ImageAnalysisError(`Windows OCR does not support ${extension || 'this file type'}.`, {
        code: 'unsupported_image_format', retryable: false,
      });
    }
    let stat;
    try {
      stat = fs.statSync(job.full_path);
    } catch {
      throw new ImageAnalysisError('The image is no longer available.', { code: 'image_unavailable', retryable: true });
    }
    if (!stat.isFile() || stat.size > maxFileBytes) {
      throw new ImageAnalysisError('The image exceeds the local OCR file-size limit.', {
        code: 'image_too_large', retryable: false,
      });
    }

    const ocr = await runWindowsOcr(job.full_path, runnerOptions);
    const signals = receiptSignals(ocr.text);
    const isReceipt = signals.score >= 0.45;
    return {
      contentKind: isReceipt ? 'receipt' : 'unknown',
      receiptConfidence: signals.score,
      ocr: { text: ocr.text || '', language: ocr.language || null, confidence: null },
      receipt: isReceipt ? extractReceiptFields(ocr.text, ocr.lines) : null,
      labels: [],
      faceCount: null,
      modelVersions: { ocr: `${ocr.engine || 'windows-media-ocr'}:v1` },
    };
  };
}

module.exports = {
  ImageAnalysisError,
  SUPPORTED_EXTENSIONS,
  amountFromText,
  createWindowsOcrProcessor,
  extractReceiptFields,
  receiptSignals,
  runWindowsOcr,
};
