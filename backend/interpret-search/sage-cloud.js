const { ALLOWED_VOCABULARY, validateInterpretation } = require('./schema');

class SageSearchCloudInterpretProvider {
  constructor({ proxyUrl, timeoutMs = 20_000 } = {}) {
    this.proxyUrl = proxyUrl ? proxyUrl.replace(/\/$/, '') : '';
    this.timeoutMs = timeoutMs;
  }

  isConfigured() { return Boolean(this.proxyUrl); }

  async health() {
    if (!this.isConfigured()) throw new Error('SageSearch Cloud proxy URL is not configured.');
    return { connected: true, model: 'SageSearch Cloud', endpoint: this.proxyUrl };
  }

  async interpret({ query, today }) {
    if (!this.isConfigured()) throw new Error('SageSearch Cloud proxy URL is not configured.');
    // This is deliberately the complete cloud payload: no location names,
    // paths, indexed rows, result counts, or document content are included.
    const headers = { 'Content-Type': 'application/json' };
    const response = await fetch(this.proxyUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({ query, today, allowedVocabulary: ALLOWED_VOCABULARY }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok) throw new Error(`SageSearch Cloud returned HTTP ${response.status}: ${await response.text()}`);
    const body = await response.json();
    return validateInterpretation(body);
  }
}

module.exports = { SageSearchCloudInterpretProvider };
