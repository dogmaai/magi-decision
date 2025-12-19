import OpenAI from 'openai';

let openaiClient = null;

export function initOpenAI(apiKey) {
  openaiClient = new OpenAI({ apiKey });
}

const SYSTEM_PROMPT = `あなたはMARY-4、MAGIシステムの統合・裁定担当AIです。
各AIユニットの分析結果を統合し、最終投資判断を下してください。

判断基準:
1. 多数決（3/4以上で強いシグナル）
2. 信頼度加重
3. リスク優先（SELLは優先考慮）

出力形式（JSON）:
{
  "final_decision": "BUY" | "HOLD" | "SELL",
  "consensus_strength": "STRONG" | "MODERATE" | "WEAK",
  "confidence": 0.0-1.0,
  "order_params": { "symbol": "...", "qty": 10, "side": "buy|sell", "stop_loss": ..., "take_profit": ... },
  "unit_votes": [...],
  "risk_warnings": [...],
  "reasoning": "統合判断の説明"
}`;

function analyzeConsensus(results) {
  const valid = results.filter(r => r?.signal && !r.error);
  const votes = { BUY: [], HOLD: [], SELL: [] };
  valid.forEach(r => votes[r.signal]?.push(r));
  
  const weighted = {
    BUY: votes.BUY.reduce((s, r) => s + (r.confidence || 0.5), 0),
    HOLD: votes.HOLD.reduce((s, r) => s + (r.confidence || 0.5), 0),
    SELL: votes.SELL.reduce((s, r) => s + (r.confidence || 0.5), 0)
  };
  
  const max = Math.max(weighted.BUY, weighted.HOLD, weighted.SELL);
  const decision = weighted.BUY === max ? 'BUY' : weighted.SELL === max ? 'SELL' : 'HOLD';
  const total = weighted.BUY + weighted.HOLD + weighted.SELL;
  const ratio = max / total;
  const avgConf = valid.reduce((s, r) => s + (r.confidence || 0.5), 0) / valid.length;
  
  const strength = ratio >= 0.75 && avgConf >= 0.7 ? 'STRONG' : ratio >= 0.5 ? 'MODERATE' : 'WEAK';
  
  return { decision, strength, avgConf, votes, weighted };
}

export async function makeConsensusDecision(symbol, unitResults, portfolioInfo = null) {
  if (!openaiClient) throw new Error('OpenAI not initialized');
  
  const pre = analyzeConsensus(unitResults);
  
  const userMessage = `## 銘柄: ${symbol}

## 各AIユニット分析結果:
${unitResults.map(r => `- ${r.unit}: ${r.signal} (信頼度: ${r.confidence || 'N/A'})\n  理由: ${r.reasoning || 'N/A'}`).join('\n')}

## 事前分析:
- 暫定判断: ${pre.decision}
- 合意強度: ${pre.strength}
- 平均信頼度: ${pre.avgConf.toFixed(2)}

${portfolioInfo ? `## ポートフォリオ: 現金$${portfolioInfo.account?.cash || 'N/A'}` : ''}

最終投資判断をJSON出力してください。`;

  try {
    const response = await openaiClient.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userMessage }
      ],
      temperature: 0.3,
      max_tokens: 2048
    });
    
    const content = response.choices[0].message.content;
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    
    if (jsonMatch) {
      const result = JSON.parse(jsonMatch[0]);
      result.symbol = symbol;
      result.timestamp = new Date().toISOString();
      return result;
    }
    
    return {
      symbol, final_decision: pre.decision, consensus_strength: pre.strength,
      confidence: pre.avgConf, reasoning: content, timestamp: new Date().toISOString()
    };
  } catch (error) {
    return {
      symbol, final_decision: pre.decision, consensus_strength: 'WEAK',
      confidence: pre.avgConf, error: error.message, timestamp: new Date().toISOString()
    };
  }
}