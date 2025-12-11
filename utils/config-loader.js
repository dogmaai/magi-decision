// utils/config-loader.js
// magi-stg から LLM設定を動的に取得するユーティリティ

const CONFIG_BASE_URL = 'https://magi-stg-398890937507.asia-northeast1.run.app';

class ConfigLoader {
  constructor() {
    this.cache = new Map();
    this.cacheTTL = 5 * 60 * 1000; // 5分
  }

  async getLLMConfig() {
    return this._getCached('llm-config', `${CONFIG_BASE_URL}/public/llm-config`);
  }

  async getConstitution() {
    return this._getCached('constitution', `${CONFIG_BASE_URL}/public/constitution`);
  }

  async getProviderConfig(providerName) {
    const config = await this.getLLMConfig();
    return config.providers?.[providerName] || null;
  }

  async getModel(providerName) {
    const providerConfig = await this.getProviderConfig(providerName);
    return providerConfig?.model || null;
  }

  async getInvestmentDecisionAIs() {
    const config = await this.getLLMConfig();
    return config.ai_teams?.investment_decision || ['grok', 'gemini', 'claude', 'mistral'];
  }

  async isRAGSpecialist(providerName) {
    const providerConfig = await this.getProviderConfig(providerName);
    return providerConfig?.rag_specialist === true;
  }

  async _getCached(key, url) {
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.time < this.cacheTTL) {
      console.log(`[ConfigLoader] Cache hit for ${key}`);
      return cached.data;
    }

    try {
      console.log(`[ConfigLoader] Fetching ${key} from ${url}`);
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      this.cache.set(key, { data, time: Date.now() });
      return data;
    } catch (e) {
      console.warn(`[ConfigLoader] Failed to fetch ${key}:`, e.message);
      if (key === 'llm-config') {
        return this._getFallbackLLMConfig();
      }
      throw new Error(`Config unavailable: ${key}`);
    }
  }

  _getFallbackLLMConfig() {
    console.warn('[ConfigLoader] Using fallback LLM config');
    return {
      version: 'fallback',
      providers: {
        grok: { model: 'grok-2-latest', investment_decision: true },
        gemini: { model: 'gemini-2.0-flash-exp', investment_decision: true },
        claude: { model: 'claude-sonnet-4-20250514', investment_decision: true },
        mistral: { model: 'mistral-large-latest', investment_decision: true },
        openai: { model: 'gpt-4o-mini', investment_decision: false },
        cohere: { model: 'command-r-plus', investment_decision: false, rag_specialist: true }
      },
      ai_teams: {
        investment_decision: ['grok', 'gemini', 'claude', 'mistral'],
        document_analysis: ['cohere'],
        qa_integration: ['openai']
      }
    };
  }

  clearCache() {
    this.cache.clear();
    console.log('[ConfigLoader] Cache cleared');
  }
}

export const configLoader = new ConfigLoader();
export default configLoader;
