/**
 * MAGI Decision Engine v5.1
 * AI全会一致ルールによる自動売買判断
 * ISABELインサイト統合版
 */

import express from 'express';
import configLoader from '../utils/config-loader.js';
import { PubSub } from '@google-cloud/pubsub';
import { getIsabelInsights, formatInsightsForPrompt } from './services/isabel-client.js';

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 8080;
const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT || 'screen-share-459802';
const MAGI_AC_URL = process.env.MAGI_AC_URL || 'https://magi-ac-398890937507.asia-northeast1.run.app';

const pubsub = new PubSub({ projectId: PROJECT_ID });

// ========== 設定 ==========
const CONFIG = {
  // 全会一致ルール
  UNANIMOUS_REQUIRED: true,
  MIN_CONFIDENCE: 0.70,

  // Bracket注文パラメータ
  TAKE_PROFIT_PCT: 5,
  STOP_LOSS_PCT: 3,

  // ポジションサイズ
  MAX_POSITION_PCT: 25,
  DEFAULT_QTY: 1,

  // ISABEL設定
  ISABEL_ENABLED: true
};

// ========== Identity Token取得 ==========
async function getIdentityToken() {
  try {
    const url = 'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity?audience=' + MAGI_AC_URL;
    const res = await fetch(url, { headers: { 'Metadata-Flavor': 'Google' } });
    return await res.text();
  } catch (e) { return null; }
}

// ========== Groq緊急アラート呼び出し ==========
async function callGroqAlert(symbol, changePercent, currentPrice, previousPrice) {
  try {
    const token = await getIdentityToken();
    const response = await fetch(MAGI_AC_URL + "/api/alert/groq", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": token ? "Bearer " + token : ""
      },
      body: JSON.stringify({
        symbol,
        changePercent,
        currentPrice,
        previousPrice,
        trigger: "PubSub価格変動"
      })
    });
    const data = await response.json();
    console.log("[GROQ-ALERT] Response:", data);
    return data.alert || null;
  } catch (e) {
    console.error("[GROQ-ALERT] Error:", e.message);
    return null;
  }
}

// ========== ISABELインサイト取得 ==========
async function fetchIsabelInsights(symbol) {
  if (!CONFIG.ISABEL_ENABLED) {
    return null;
  }

  try {
    const insights = await getIsabelInsights(symbol, '直近24時間のニュース要約');
    return insights;
  } catch (e) {
    console.warn('[DECISION] ISABEL fetch failed, continuing without insights');
    return null;
  }
}

// ========== AI分析呼び出し（ISABELインサイト付き） ==========
async function getAIAnalysis(symbol, isabelInsights = null) {
  console.log('[DECISION] Requesting AI analysis for', symbol);

  const token = await getIdentityToken();

  // リクエストボディ構築
  const requestBody = { symbol };

  // ISABELインサイトがあれば追加
  if (isabelInsights) {
    const formattedInsights = formatInsightsForPrompt(isabelInsights);
    if (formattedInsights) {
      requestBody.context = formattedInsights;
      console.log('[DECISION] Including ISABEL insights in analysis');
    }
  }

  const res = await fetch(MAGI_AC_URL + '/api/analyze', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { 'Authorization': `Bearer ${token}` } : {})
    },
    body: JSON.stringify(requestBody)
  });

  if (!res.ok) {
    throw new Error('AI analysis failed: ' + res.status);
  }

  return await res.json();
}

// ========== 全会一致判定 ==========
function evaluateUnanimous(analysis) {
  const recommendations = analysis.aiRecommendations || [];
  const consensus = analysis.consensus || {};

  // 各AIの判断を取得
  const votes = recommendations.map(r => ({
    provider: r.provider,
    action: r.action,
    confidence: r.confidence
  }));

  console.log('[DECISION] AI Votes:', JSON.stringify(votes));

  // 全会一致チェック
  const allBuy = votes.every(v => v.action === 'BUY');
  const allSell = votes.every(v => v.action === 'SELL');
  const avgConfidence = parseFloat(consensus.average_confidence) || 0;

  // 判定結果
  let decision = {
    action: 'HOLD',
    unanimous: false,
    confidence: avgConfidence,
    reason: '',
    votes: votes
  };

  if (allBuy && avgConfidence >= CONFIG.MIN_CONFIDENCE) {
    decision.action = 'BUY';
    decision.unanimous = true;
    decision.reason = '4AI全会一致BUY (信頼度: ' + (avgConfidence * 100).toFixed(0) + '%)';
  } else if (allSell && avgConfidence >= CONFIG.MIN_CONFIDENCE) {
    decision.action = 'SELL';
    decision.unanimous = true;
    decision.reason = '4AI全会一致SELL (信頼度: ' + (avgConfidence * 100).toFixed(0) + '%)';
  } else if (allBuy) {
    decision.reason = '全会一致BUYだが信頼度不足 (' + (avgConfidence * 100).toFixed(0) + '% < ' + (CONFIG.MIN_CONFIDENCE * 100) + '%)';
  } else if (allSell) {
    decision.reason = '全会一致SELLだが信頼度不足';
  } else {
    decision.reason = '意見分散 (BUY:' + consensus.buy + ' HOLD:' + consensus.hold + ' SELL:' + consensus.sell + ')';
  }

  return decision;
}

// ========== Bracket価格計算 ==========
function calculateBracketPrices(price) {
  return {
    entryPrice: price,
    takeProfitPrice: Math.round(price * (1 + CONFIG.TAKE_PROFIT_PCT / 100) * 100) / 100,
    stopLossPrice: Math.round(price * (1 - CONFIG.STOP_LOSS_PCT / 100) * 100) / 100
  };
}

// ========== 売買シグナル発行 ==========
async function publishTradeSignal(signal) {
  const topic = pubsub.topic('magi-trading-signal');
  const data = Buffer.from(JSON.stringify(signal));

  try {
    const messageId = await topic.publishMessage({ data });
    console.log('[DECISION] Published trade signal:', messageId);
    return messageId;
  } catch (err) {
    console.error('[DECISION] Failed to publish:', err.message);
    throw err;
  }
}

// ========== 判断実行（ISABELインサイト統合） ==========
async function executeDecision(symbol, price = null, trigger = 'manual') {
  console.log(`[DECISION] Executing decision for ${symbol} (trigger: ${trigger})`);

  // 1. ISABELインサイト取得（5秒タイムアウト、失敗時スキップ）
  const isabelInsights = await fetchIsabelInsights(symbol);
  const hasInsights = isabelInsights !== null;
  console.log(`[DECISION] ISABEL insights: ${hasInsights ? 'available' : 'not available'}`);

  // 2. AI分析実行（ISABELインサイト付き）
  const analysis = await getAIAnalysis(symbol, isabelInsights);

  // 3. 全会一致判定
  const decision = evaluateUnanimous(analysis);

  // 4. 価格情報
  const currentPrice = price || analysis.financialData?.currentPrice;
  const brackets = currentPrice ? calculateBracketPrices(currentPrice) : null;

  return {
    symbol,
    decision,
    price: currentPrice,
    brackets,
    isabelInsights: hasInsights ? {
      summary: isabelInsights.summary?.slice(0, 200),
      articleCount: isabelInsights.articles?.length || 0
    } : null,
    analysis
  };
}

// ========== API Endpoints ==========

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'magi-decision',
    version: '5.1.0',
    features: {
      isabel: CONFIG.ISABEL_ENABLED
    }
  });
});

// 手動で判断をトリガー
app.post('/decide', async (req, res) => {
  try {
    const { symbol } = req.body;
    if (!symbol) {
      return res.status(400).json({ ok: false, error: 'symbol required' });
    }

    console.log('[DECISION] Manual decision request for', symbol);

    const result = await executeDecision(symbol, null, 'manual');

    // レスポンス
    const response = {
      ok: true,
      symbol: result.symbol,
      decision: result.decision,
      price: result.price,
      brackets: result.brackets,
      isabelInsights: result.isabelInsights,
      timestamp: new Date().toISOString()
    };

    // 全会一致の場合はシグナル発行
    if (result.decision.unanimous && result.decision.action !== 'HOLD') {
      const signal = {
        symbol: result.symbol,
        action: result.decision.action,
        qty: CONFIG.DEFAULT_QTY,
        price: result.price,
        brackets: result.brackets,
        confidence: result.decision.confidence,
        reason: result.decision.reason,
        hasIsabelInsights: result.isabelInsights !== null,
        timestamp: new Date().toISOString()
      };

      response.signalPublished = true;
      response.signal = signal;

      await publishTradeSignal(signal);
    } else {
      response.signalPublished = false;
    }

    res.json(response);

  } catch (err) {
    console.error('[DECISION] Error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Pub/Subからのプッシュ受信（price-updates）
app.post('/pubsub', async (req, res) => {
  try {
    const message = req.body.message;
    if (!message || !message.data) {
      return res.status(400).send('Invalid message');
    }

    const data = JSON.parse(Buffer.from(message.data, 'base64').toString());
    console.log('[DECISION] Received price update:', data);

    const { symbol, price, changePercent } = data;

    // 価格変動が閾値を超えた場合のみ判断
    if (Math.abs(changePercent) < 1.5) {
      console.log('[DECISION] Change too small, skipping');
      return res.status(204).send();
    }

    // 5%以上の急変はGroqで緊急判定
    if (Math.abs(changePercent) >= 5.0) {
      console.log("[DECISION] Sharp move detected! Calling Groq alert...");
      const groqAlert = await callGroqAlert(symbol, changePercent, price, price / (1 + changePercent/100));
      if (groqAlert && (groqAlert.urgency === "CRITICAL" || groqAlert.urgency === "HIGH")) {
        console.log("[DECISION] CRITICAL alert from Groq:", groqAlert.reason);
        // 緊急時は4AI合議をスキップして即時シグナル発行
        const urgentSignal = {
          symbol: symbol,
          action: changePercent < 0 ? "SELL" : "BUY",
          qty: 1,
          price: price,
          confidence: 0.9,
          reason: "Groq緊急判定: " + groqAlert.reason,
          trigger: "groq-critical-alert",
          timestamp: new Date().toISOString()
        };
        await publishTradeSignal(urgentSignal);
        return res.status(204).send();
      }
    }

    // 判断実行（ISABELインサイト統合）
    const result = await executeDecision(symbol, price, 'price-alert');

    if (result.decision.unanimous && result.decision.action !== 'HOLD') {
      const signal = {
        symbol: symbol,
        action: result.decision.action,
        qty: CONFIG.DEFAULT_QTY,
        price: price,
        brackets: result.brackets,
        confidence: result.decision.confidence,
        reason: result.decision.reason,
        hasIsabelInsights: result.isabelInsights !== null,
        trigger: 'price-alert',
        timestamp: new Date().toISOString()
      };

      await publishTradeSignal(signal);
    }

    res.status(204).send();

  } catch (err) {
    console.error('[DECISION] Pub/Sub error:', err.message);
    res.status(500).send(err.message);
  }
});

// 設定確認
app.get('/config', (req, res) => {
  res.json({
    ok: true,
    config: CONFIG,
    endpoints: {
      magi_ac: MAGI_AC_URL,
      isabel: MAGI_AC_URL + '/api/isabel/insights'
    }
  });
});

// ISABELテスト用エンドポイント
app.post('/test/isabel', async (req, res) => {
  try {
    const { symbol } = req.body;
    if (!symbol) {
      return res.status(400).json({ ok: false, error: 'symbol required' });
    }

    console.log('[TEST] ISABEL test for', symbol);
    const insights = await getIsabelInsights(symbol, '直近24時間のニュース要約');

    res.json({
      ok: true,
      symbol,
      insights,
      formatted: formatInsightsForPrompt(insights)
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ========== Server Start ==========
app.listen(PORT, () => {
  console.log('');
  console.log('========================================');
  console.log('  MAGI Decision Engine v5.1');
  console.log('  AI全会一致ルール + ISABELインサイト統合');
  console.log('========================================');
  console.log('  Port:', PORT);
  console.log('  MAGI-AC:', MAGI_AC_URL);
  console.log('  ISABEL:', CONFIG.ISABEL_ENABLED ? 'Enabled' : 'Disabled');
  console.log('  Min Confidence:', CONFIG.MIN_CONFIDENCE);
  console.log('  Take Profit:', CONFIG.TAKE_PROFIT_PCT + '%');
  console.log('  Stop Loss:', CONFIG.STOP_LOSS_PCT + '%');
  console.log('========================================');
  console.log('');
});
