import { Mistral } from '@mistralai/mistralai';
import { allToolDefinitions, executeToolByName } from '../tools/index.js';

let mistralClient = null;

export function initMistral(apiKey) {
  mistralClient = new Mistral({ apiKey });
}

const SYSTEM_PROMPT = `あなたはUnit-R4、MAGIシステムのテクニカル分析担当AIです。
株価とテクニカル指標を分析し、投資判断を出力してください。

必ず以下のJSON形式のみで出力（説明文や改行なし）:
{"unit":"Unit-R4","signal":"BUY","confidence":0.75,"analysis":{"price":250.5,"rsi":45,"macd":"bullish","trend":"upward"},"reasoning":"判断理由をここに記載"}`;

async function runToolLoop(messages, maxIterations = 3) {
  for (let i = 0; i < maxIterations; i++) {
    const response = await mistralClient.chat.complete({
      model: 'mistral-large-latest',
      messages,
      tools: allToolDefinitions,
      toolChoice: 'auto'
    });
    
    const msg = response.choices[0].message;
    messages.push(msg);
    
    if (!msg.toolCalls || msg.toolCalls.length === 0) return msg;
    
    for (const tc of msg.toolCalls) {
      try {
        const args = JSON.parse(tc.function.arguments);
        const result = await executeToolByName(tc.function.name, args);
        messages.push({ role: 'tool', toolCallId: tc.id, content: result });
      } catch (e) {
        messages.push({ role: 'tool', toolCallId: tc.id, content: JSON.stringify({ error: e.message }) });
      }
    }
  }
  return messages[messages.length - 1];
}

export async function analyzeWithUnitR4(symbol, context = '') {
  if (!mistralClient) throw new Error('Mistral not initialized');
  
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: `${symbol}の分析を実行。get_stock_priceとget_technical_indicatorsを使用し、最終的にJSONのみ出力。${context}` }
  ];
  
  try {
    const response = await runToolLoop(messages);
    const content = response.content || '';
    console.log('[Unit-R4] Response:', content.substring(0, 200));
    
    // JSON抽出（複数行対応）
    const cleanContent = content.replace(/[\r\n\t]/g, ' ').replace(/\s+/g, ' ');
    const jsonMatch = cleanContent.match(/\{[^{}]*"unit"[^{}]*"signal"[^{}]*\}/);
    
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    
    // フォールバック：シンプルなJSONを返す
    return { unit: 'Unit-R4', signal: 'HOLD', confidence: 0.5, reasoning: content.substring(0, 500) };
  } catch (error) {
    console.error('[Unit-R4] Error:', error.message);
    return { unit: 'Unit-R4', signal: 'HOLD', confidence: 0, error: error.message };
  }
}