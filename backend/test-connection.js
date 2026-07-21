// Quick connection test for LM Studio
const endpoints = [
  'http://localhost:1234/v1/models',
  'http://localhost:1234/api/v1/models',
  'http://localhost:11434/v1/models', // Ollama fallback
];

async function test() {
  for (const url of endpoints) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(3000) });
      const d = await r.json();
      console.log('OK:', url);
      console.log(JSON.stringify(d, null, 2));
    } catch (e) {
      console.log('FAIL:', url, '-', e.message);
    }
  }
}

test();
