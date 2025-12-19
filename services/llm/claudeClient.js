import Anthropic from '@anthropic-ai/sdk';

let anthropicClient = null;

export function initClaude(apiKey) {
  anthropicClient = new Anthropic({ apiKey });
}

const SYSTEM_PROMPT = `あなたはUnit-C3、MAGIシステムのESG・リスク分析担当AIです。
環境・社会・ガバナンス情報、規制リスク、訴訟リスクを調査してください。

出力形式（JSON）:
{
  "unit": "Unit-C3",
  "signal": "BUY" | "HOLD" | "SELL",
  "confidence": 0.0-1.0,
  "analysis": { "esg_score": {...}, "risk_factors": [...], "positive_factors": [...] },
  "reasoning": "判断理由"
}`;

export async function analyzeWithUnitC3(symbol, companyName, context = '') {
  if (!anthropicClient) throw new Error('Claude not initialized');
  
  const userMessage = `${companyName} (${symbol}) のESG・リスク分析を実行。
Web検索でESG情報、規制リスク、訴訟リスクを調査し、投資判断をJSON出力。${context}`;

  try {
    const response = await anthropicClient.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      messages: [{ role: 'user', content: SYSTEM_PROMPT + '\n\n' + userMessage }]
    });
    
    let content = '';
    for (const block of response.content) {
      if (block.type === 'text') content += block.text;
    }
    
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) return JSON.parse(jsonMatch[0]);
    return { unit: 'Unit-C3', signal: 'HOLD', confidence: 0.5, reasoning: content };
  } catch (error) {
    return { unit: 'Unit-C3', signal: 'HOLD', confidence: 0, error: error.message };
  }
}