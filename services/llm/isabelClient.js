import { GoogleAuth } from 'google-auth-library';

const MAGI_AC_URL = 'https://magi-ac-398890937507.asia-northeast1.run.app';

let authClient = null;

async function getIdentityToken() {
  try {
    if (!authClient) {
      const auth = new GoogleAuth();
      authClient = await auth.getIdTokenClient(MAGI_AC_URL);
    }
    const headers = await authClient.getRequestHeaders();
    return headers.Authorization.replace('Bearer ', '');
  } catch (error) {
    console.error('[ISABEL] Token error:', error.message);
    throw error;
  }
}

export async function searchIsabel(symbol, query) {
  try {
    const token = await getIdentityToken();
    console.log(`[ISABEL] Searching: ${symbol} - "${query}"`);
    
    const response = await fetch(`${MAGI_AC_URL}/api/isabel/search-v2`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol, query, limit: 10 })
    });
    
    if (!response.ok) throw new Error(`ISABEL API error: ${response.status}`);
    
    const data = await response.json();
    console.log(`[ISABEL] Found ${data.documents?.length || 0} documents`);
    
    return { success: true, data: { documents: data.documents || [], summary: data.summary || '' } };
  } catch (error) {
    console.error('[ISABEL] Search error:', error.message);
    return { success: false, error: error.message, data: { documents: [], summary: '' } };
  }
}

export async function getHistoricalContext(symbol, companyName) {
  try {
    const queries = [`${companyName} latest news`, `${symbol} stock analysis`];
    const results = await Promise.allSettled(queries.map(q => searchIsabel(symbol, q)));
    
    const allDocs = [];
    results.forEach(r => {
      if (r.status === 'fulfilled' && r.value.success) {
        allDocs.push(...r.value.data.documents);
      }
    });
    
    const uniqueDocs = Array.from(new Map(allDocs.map(d => [d.id || d.title, d])).values()).slice(0, 15);
    
    return {
      unit: 'ISABEL',
      type: 'historical',
      success: true,
      data: {
        documents: uniqueDocs,
        documentCount: uniqueDocs.length,
        summary: uniqueDocs.length > 0 ? `Found ${uniqueDocs.length} relevant documents.` : 'No recent documents found.'
      }
    };
  } catch (error) {
    return { unit: 'ISABEL', type: 'historical', success: false, error: error.message, data: { documents: [], summary: '' } };
  }
}