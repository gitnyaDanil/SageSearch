const { LocalAIInterpretProvider } = require('./local-ai');
const { SageSearchCloudInterpretProvider } = require('./sage-cloud');

function createInterpretProvider(config = {}) {
  const mode = config.mode || 'local';
  if (mode === 'cloud') return new SageSearchCloudInterpretProvider(config.cloud);
  if (mode === 'local') return new LocalAIInterpretProvider(config.local);
  throw new Error(`Unknown intelligence provider mode: ${mode}`);
}

module.exports = { createInterpretProvider };
