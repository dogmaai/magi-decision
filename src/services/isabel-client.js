/**
 * ISABEL API Client
 * magi-ac の ISABEL インサイト取得
 */

import { GoogleAuth } from 'google-auth-library';

const ISABEL_URL = 'https://magi-ac-398890937507.asia-northeast1.run.app/api/isabel/insights';
const TIMEOUT_MS = 15000;

let authClient = null;

/**
 * Identity Token を取得
 */
async function getIdentityToken(targetAudience) {
  try {
    // Cloud Run環境ではメタデータサーバーから取得
    const metadataUrl = `http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity?audience=${targetAudience}`;
    const res = await fetch(metadataUrl, {
      headers: { 'Metadata-Flavor': 'Google' }
    });
    if (res.ok) {
      return await res.text();
    }
  } catch (e) {
    // メタデータサーバー利用不可（ローカル環境など）
  }

  // ローカル環境: google-auth-library を使用
  try {
    if (!authClient) {
      const auth = new GoogleAuth();
      authClient = await auth.getIdTokenClient(targetAudience);
    }
    const token = await authClient.idTokenProvider.fetchIdToken(targetAudience);
    return token;
  } catch (e) {
    console.warn('[ISABEL] Failed to get identity token:', e.message);
    return null;
  }
}

/**
 * ISABEL API を呼び出してインサイトを取得
 * @param {string} symbol - 銘柄シンボル
 * @param {string} query - クエリ（デフォルト: 直近24時間のニュース要約）
 * @returns {Promise<object|null>} ISABELインサイト or null（失敗時）
 */
export async function getIsabelInsights(symbol, query = '直近24時間のニュース要約') {
  console.log(`[ISABEL] Fetching insights for ${symbol}...`);

  const targetAudience = 'https://magi-ac-398890937507.asia-northeast1.run.app';

  try {
    const token = await getIdentityToken(targetAudience);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const response = await fetch(ISABEL_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {})
      },
      body: JSON.stringify({ symbol, query }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text();
      console.warn(`[ISABEL] API error: ${response.status} - ${errorText}`);
      return null;
    }

    const data = await response.json();
    console.log(`[ISABEL] Got insights for ${symbol}:`, data.summary?.slice(0, 100) || 'no summary');
    return data;

  } catch (error) {
    if (error.name === 'AbortError') {
      console.warn(`[ISABEL] Request timeout (${TIMEOUT_MS}ms)`);
    } else {
      console.warn(`[ISABEL] Error: ${error.message}`);
    }
    return null;
  }
}

/**
 * ISABELインサイトをAIプロンプト用にフォーマット
 * @param {object|null} insights - ISABELインサイト
 * @returns {string} フォーマット済みテキスト
 */
export function formatInsightsForPrompt(insights) {
  if (!insights) {
    return '';
  }

  const parts = [];

  if (insights.summary) {
    parts.push(`関連ニュース要約: ${insights.summary}`);
  }

  if (insights.articles && insights.articles.length > 0) {
    const headlines = insights.articles
      .slice(0, 5)
      .map(a => `- ${a.title}`)
      .join('\n');
    parts.push(`主要ニュース:\n${headlines}`);
  }

  if (insights.sentiment) {
    parts.push(`市場センチメント: ${insights.sentiment}`);
  }

  return parts.join('\n\n');
}

export default {
  getIsabelInsights,
  formatInsightsForPrompt
};
