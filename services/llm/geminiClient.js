const GEMINI_MODEL = 'gemini-1.5-flash-latest'; // モデル名を定数化

const SYSTEM_PROMPT = `あなたはUnit-M1、MAGIシステムのファンダメンタル分析担当AIです。
最新ニュース、決算情報、アナリスト評価を分析してください。

出力は必ず以下のJSON形式のみ（説明文なし）:
{"unit":"Unit-M1","signal":"BUY","confidence":0.75,"analysis":{"news":["ニュース1","ニュース2"],"financials":{"pe":25,"growth":"10%"},"analyst_rating":"Buy"},"reasoning":"判断理由"}`;

export async function analyzeWithUnitM1(symbol, companyName, context = '') {
  const apiKey = process.env.GEMINI_API_KEY; // 環境変数からAPIキーを取得
  const userMessage = `${companyName} (${symbol}) の最新ニュースと決算情報をGoogle検索で調べて、ファンダメンタル分析を実行し、JSONのみ出力してください。${context}`;

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: SYSTEM_PROMPT + '\n\n' + userMessage }] }],
          tools: [{ google_search: {} }],
          generationConfig: { temperature: 0.7, maxOutputTokens: 2048 }
        })
      }
    );
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('[Unit-M1] Gemini error:', errorText);
      throw new Error(`Gemini API error: ${response.status}`);
    }
    
    const data = await response.json();
    const content = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    console.log('[Unit-M1] Response:', content.substring(0, 200));
    
    // より堅牢なJSON抽出
    const startIndex = content.indexOf('{');
    const endIndex = content.lastIndexOf('}');
    if (startIndex !== -1 && endIndex !== -1 && startIndex < endIndex) {
      const jsonString = content.substring(startIndex, endIndex + 1);
      const result = JSON.parse(jsonString);
      result.unit = 'Unit-M1'; // 念のためユニット名を上書き保証
      return result;
    }
    return { unit: 'Unit-M1', signal: 'HOLD', confidence: 0.5, reasoning: content };
  } catch (error) {
    console.error('[Unit-M1] Error:', error.message);
    return { unit: 'Unit-M1', signal: 'HOLD', confidence: 0, error: error.message };
  }
}