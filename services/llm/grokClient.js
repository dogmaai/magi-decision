const SYSTEM_PROMPT = `あなたはUnit-B2、MAGIシステムのソーシャルセンチメント分析担当AIです。
X/Twitterのリアルタイムデータから市場センチメントを分析してください。

出力形式（JSON）:
{
  "unit": "Unit-B2",
  "signal": "BUY" | "HOLD" | "SELL",
  "confidence": 0.0-1.0,
  "analysis": { "sentiment_score": -1.0 to 1.0, "key_topics": [...], "social_volume": "LOW|NORMAL|HIGH" },
  "reasoning": "判断理由"
}`;

export async function analyzeWithUnitB2(apiKey, symbol, companyName, context = '') {
  const userMessage = `${companyName} (${symbol}) のソーシャルセンチメント分析を実行。
X/Twitterでの言及、投資家の反応、トレンドを分析し、投資判断をJSON出力。${context}`;

  try {
    const response = await fetch('https://api.x.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'grok-2-latest',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userMessage }
        ],
        temperature: 0.7,
        max_tokens: 2048
      })
    });
    
    if (!response.ok) throw new Error(`Grok API error: ${response.status}`);
    
    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    
    if (jsonMatch) return JSON.parse(jsonMatch[0]);
    return { unit: 'Unit-B2', signal: 'HOLD', confidence: 0.5, reasoning: content };
  } catch (error) {
    return { unit: 'Unit-B2', signal: 'HOLD', confidence: 0, error: error.message };
  }
}