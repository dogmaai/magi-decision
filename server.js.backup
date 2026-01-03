import express from 'express';
import { SecretManagerServiceClient } from '@google-cloud/secret-manager';
import { initMistral } from './services/llm/mistralClient.js';
import { initClaude } from './services/llm/claudeClient.js';
import { initOpenAI } from './services/llm/gptClient.js';
import { initAlpaca } from './services/tools/portfolioTools.js';
import { setApiKeys, executeParallelAnalysis, executeMultiStockAnalysis } from './services/parallelExecutor.js';

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 8080;
const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT || 'screen-share-459802';

async function getSecret(name) {
  try {
    const client = new SecretManagerServiceClient();
    const [version] = await client.accessSecretVersion({ name: `projects/${PROJECT_ID}/secrets/${name}/versions/latest` });
    return version.payload.data.toString('utf8');
  } catch (e) {
    console.error(`Secret ${name} error:`, e.message);
    return process.env[name] || null;
  }
}

async function init() {
  console.log('[MAGI] Initializing...');
  const [mistral, anthropic, openai, gemini, grok, alpacaKey, alpacaSecret] = await Promise.all([
    getSecret('MISTRAL_API_KEY'), getSecret('ANTHROPIC_API_KEY'), getSecret('OPENAI_API_KEY'),
    getSecret('GEMINI_API_KEY'), getSecret('XAI_API_KEY'), getSecret('ALPACA_API_KEY'), getSecret('ALPACA_SECRET_KEY')
  ]);
  
  if (mistral) { initMistral(mistral); console.log('[MAGI] Mistral OK'); }
  if (anthropic) { initClaude(anthropic); console.log('[MAGI] Claude OK'); }
  if (openai) { initOpenAI(openai); console.log('[MAGI] OpenAI OK'); }
  if (alpacaKey && alpacaSecret) { initAlpaca({ apiKey: alpacaKey, secretKey: alpacaSecret }); console.log('[MAGI] Alpaca OK'); }
  
  setApiKeys({ mistral, anthropic, openai, gemini, grok });
  console.log('[MAGI] Ready');
}

app.get('/health', (req, res) => res.json({ status: 'healthy', service: 'magi-decision', version: '2.0.0-hybrid' }));

app.get('/', (req, res) => res.json({
  service: 'MAGI Decision Service',
  version: '2.0.0-hybrid',
  endpoints: { health: 'GET /health', analyze: 'POST /analyze', batch: 'POST /analyze/batch' },
  units: ['ISABEL (RAG)', 'Unit-B2 (Grok)', 'Unit-M1 (Gemini)', 'Unit-C3 (Claude)', 'Unit-R4 (Mistral)', 'MARY-4 (GPT-4)']
}));

app.post('/analyze', async (req, res) => {
  const { symbol, companyName, context, units } = req.body;
  if (!symbol) return res.status(400).json({ error: 'symbol required' });
  try {
    const result = await executeParallelAnalysis(symbol, companyName || symbol, { context, units });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/analyze/batch', async (req, res) => {
  const { stocks, context, units } = req.body;
  if (!stocks?.length) return res.status(400).json({ error: 'stocks array required' });
  try {
    const results = await executeMultiStockAnalysis(stocks, { context, units });
    res.json({ count: results.length, results });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

init().then(() => app.listen(PORT, () => console.log(`[MAGI] Server on port ${PORT}`)));