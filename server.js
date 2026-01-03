import express from 'express';
import { SecretManagerServiceClient } from '@google-cloud/secret-manager';
import { PubSub } from '@google-cloud/pubsub';
import { initMistral } from './services/llm/mistralClient.js';
import { initClaude } from './services/llm/claudeClient.js';
import { initOpenAI } from './services/llm/gptClient.js';
import { initAlpaca } from './services/tools/portfolioTools.js';
import { setApiKeys, executeParallelAnalysis, executeMultiStockAnalysis } from './services/parallelExecutor.js';

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 8080;
const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT || 'screen-share-459802';
const pubsub = new PubSub({ projectId: PROJECT_ID });

// 設定
const CONFIG = {
  UNANIMOUS_REQUIRED: true,
  MIN_CONFIDENCE: 0.70,
  TAKE_PROFIT_PCT: 5,
  STOP_LOSS_PCT: 3,
  DEFAULT_QTY: 1
};

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

// ヘルスチェック
app.get('/health', (req, res) => res.json({ 
  status: 'healthy', 
  service: 'magi-decision', 
  version: '5.0.0',
  pubsub: 'enabled'
}));

// 設定確認
app.get('/config', (req, res) => res.json({
  service: 'magi-decision',
  version: '5.0.0',
  config: CONFIG
}));

// ルート
app.get('/', (req, res) => res.json({
  service: 'MAGI Decision Service',
  version: '5.0.0',
  endpoints: { 
    health: 'GET /health',
    config: 'GET /config',
    analyze: 'POST /analyze', 
    batch: 'POST /analyze/batch',
    decide: 'POST /decide',
    pubsub: 'POST /pubsub/price-update'
  },
  units: ['ISABEL (RAG)', 'Unit-B2 (Grok)', 'Unit-M1 (Gemini)', 'Unit-C3 (Claude)', 'Unit-R4 (Mistral)', 'MARY-4 (GPT-4)']
}));

// 分析エンドポイント
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

// バッチ分析
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

// 手動判断トリガー
app.post('/decide', async (req, res) => {
  const { symbol } = req.body;
  if (!symbol) return res.status(400).json({ error: 'symbol required' });
  
  try {
    console.log(`[DECIDE] Processing ${symbol}`);
    const result = await executeParallelAnalysis(symbol, symbol, {});
    
    // 全会一致判定
    const votes = { BUY: 0, HOLD: 0, SELL: 0 };
    const judgments = result.judgments || result.unitResults || [];
    let totalConfidence = 0;
    
    judgments.forEach(j => {
      const action = j.action || j.signal;
      if (action) votes[action]++;
      if (j.confidence) totalConfidence += j.confidence;
    });
    
    const avgConfidence = judgments.length > 0 ? totalConfidence / judgments.length : 0;
    const isUnanimous = (votes.BUY === judgments.length || votes.SELL === judgments.length);
    const action = votes.BUY > votes.SELL ? 'BUY' : (votes.SELL > votes.BUY ? 'SELL' : 'HOLD');
    
    if (isUnanimous && avgConfidence >= CONFIG.MIN_CONFIDENCE && action !== 'HOLD') {
      // シグナル発行
      const signal = {
        symbol,
        action,
        qty: CONFIG.DEFAULT_QTY,
        confidence: avgConfidence,
        reason: `${judgments.length}AI unanimous ${action}`,
        timestamp: new Date().toISOString()
      };
      
      // Pub/Sub発行
      try {
        const topic = pubsub.topic('trade-signals');
        await topic.publishMessage({ data: Buffer.from(JSON.stringify(signal)) });
        console.log(`[DECIDE] Signal published for ${symbol}: ${action}`);
      } catch (pubErr) {
        console.error('[DECIDE] Pub/Sub error:', pubErr.message);
      }
      
      res.json({ decision: 'signal_issued', symbol, action, signal, votes });
    } else {
      res.json({ 
        decision: 'no_action', 
        reason: `Not unanimous or low confidence: BUY:${votes.BUY} HOLD:${votes.HOLD} SELL:${votes.SELL}, confidence:${avgConfidence.toFixed(2)}`,
        votes,
        avgConfidence
      });
    }
  } catch (e) {
    console.error('[DECIDE] Error:', e);
    res.status(500).json({ error: e.message });
  }
});

// Pub/Sub受信エンドポイント（price-updates用）
app.post('/pubsub/price-update', async (req, res) => {
  console.log('[PUBSUB] Received price-update');
  
  // すぐにACK（200を返す）- 長時間処理でもタイムアウトしない
  res.status(200).send('OK');
  
  try {
    const message = req.body.message;
    if (!message || !message.data) {
      console.log('[PUBSUB] No message data');
      return;
    }
    
    const data = JSON.parse(Buffer.from(message.data, 'base64').toString());
    console.log('[PUBSUB] Data:', data);
    
    const { symbol } = data;
    if (!symbol) {
      console.log('[PUBSUB] No symbol in message');
      return;
    }
    
    // 非同期で分析処理
    const result = await executeParallelAnalysis(symbol, symbol, {});
    console.log(`[PUBSUB] Analysis complete for ${symbol}:`, result.consensus?.final_decision || 'N/A');
  } catch (e) {
    console.error('[PUBSUB] Error:', e.message);
  }
});

// 旧エンドポイント互換（/pubsub → /pubsub/price-update）
app.post('/pubsub', async (req, res) => {
  console.log('[PUBSUB] Redirecting /pubsub to /pubsub/price-update');
  res.status(200).send('OK');
  
  try {
    const message = req.body.message;
    if (message && message.data) {
      const data = JSON.parse(Buffer.from(message.data, 'base64').toString());
      if (data.symbol) {
        await executeParallelAnalysis(data.symbol, data.symbol, {});
      }
    }
  } catch (e) {
    console.error('[PUBSUB] Error:', e.message);
  }
});

init().then(() => app.listen(PORT, () => console.log(`[MAGI] Server on port ${PORT}`)));
