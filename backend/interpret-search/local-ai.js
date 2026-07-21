const { ALLOWED_VOCABULARY, validateInterpretation } = require('./schema');

function interpretationPrompt(today) {
  return `You convert a file-search request into JSON filters. Today is ${today}.
Return JSON only, with exactly this shape:
{
  "filters": {
    "fileType": "document|image|video|audio|other|null",
    "extensions": ["extensions from the allowed vocabulary, or an empty array"],
    "filenameKeywords": ["words that appear in a filename"],
    "locationLabel": "configured location label or null",
    "dateField": "created|modified",
    "dateAfter": "YYYY-MM-DD or null",
    "dateBefore": "YYYY-MM-DD or null"
  },
  "unsupportedClues": ["clues not present in file metadata"],
  "clarifyingQuestion": "one question or null"
}
Only infer supported metadata filters. Sender, document contents, and file-open history are unsupported clues. For relative dates, calculate dates from today. File-kind words are filters, not filename words: use extensions for presentation/slides/PowerPoint/ppt, spreadsheet/Excel, PDF, and Word requests; use fileType for photo/image, video/movie, and audio/music requests. Use filenameKeywords only when the user explicitly says named, called, filename, or means words in the actual filename. Treat an unqualified "screenshot" request as an image type, not a filename keyword. Ask at most one question, and only if it would materially improve a search. Allowed vocabulary: ${JSON.stringify(ALLOWED_VOCABULARY)}.`;
}

function parseJson(content) {
  if (typeof content === 'object' && content) return content;
  if (typeof content !== 'string') throw new Error('Local AI returned no JSON interpretation.');
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced ? fenced[1] : content).trim();
  const first = candidate.indexOf('{');
  const last = candidate.lastIndexOf('}');
  if (first === -1 || last === -1 || last < first) throw new Error('Local AI did not return a JSON object.');
  try {
    return JSON.parse(candidate.slice(first, last + 1));
  } catch {
    throw new Error('Local AI returned invalid JSON.');
  }
}

class LocalAIInterpretProvider {
  constructor({ endpoint = 'http://localhost:1234', model = null, timeoutMs = 60_000 } = {}) {
    this.endpoint = endpoint.replace(/\/$/, '');
    this.model = model;
    this.timeoutMs = timeoutMs;
  }

  async health() {
    const response = await fetch(`${this.endpoint}/v1/models`, { signal: AbortSignal.timeout(2_500) });
    if (!response.ok) throw new Error(`Local AI returned HTTP ${response.status}.`);
    const body = await response.json();
    return { connected: true, model: this.model || body?.data?.[0]?.id || 'local model', endpoint: this.endpoint };
  }

  async interpret({ query, today }) {
    const health = await this.health();
    const request = {
      model: health.model,
      messages: [
        { role: 'system', content: interpretationPrompt(today) },
        { role: 'user', content: query },
      ],
      temperature: 0,
      max_tokens: 500,
    };
    let response = await fetch(`${this.endpoint}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...request, response_format: { type: 'json_object' } }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    // Older LM Studio builds can be OpenAI-compatible without supporting
    // response_format. The prompt still requires JSON, which we validate.
    if (response.status === 400 || response.status === 422) {
      response = await fetch(`${this.endpoint}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    }
    if (!response.ok) throw new Error(`Local AI returned HTTP ${response.status}: ${await response.text()}`);
    const body = await response.json();
    return validateInterpretation(parseJson(body?.choices?.[0]?.message?.content));
  }
}

module.exports = { LocalAIInterpretProvider };
