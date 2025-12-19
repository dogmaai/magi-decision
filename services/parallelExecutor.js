import { analyzeWithUnitR4 } from './llm/mistralClient.js';
import { analyzeWithUnitM1 } from './llm/geminiClient.js';
import { analyzeWithUnitC3 } from './llm/claudeClient.js';
import { analyzeWithUnitB2 } from './llm/grokClient.js';
import { makeConsensusDecision } from './llm/gptClient.js';
import { getHistoricalContext } from './llm/isabelClient.js';
import { getPortfolioSummary } from './tools/portfolioTools.js';

let apiKeys = {};

export function setApiKeys(keys) {
  apiKeys = keys;
}

export async function executeParallelAnalysis(symbol, companyName, options = {}) {
  const startTime = Date.now();
  const context = options.context || '';
  const units = options.units || ['ISABEL', 'B2', 'M1', 'C3', 'R4'];
  
  console.log(`[Parallel] Starting ${symbol} (${companyName})`);
  
  const tasks = [];
  
  if (units.includes('ISABEL')) {
    tasks.push({ name: 'ISABEL', promise: getHistoricalContext(symbol, companyName).catch(e => ({ unit: 'ISABEL', error: e.message })) });
  }
  if (units.includes('B2') && apiKeys.grok) {
    tasks.push({ name: 'Unit-B2', promise: analyzeWithUnitB2(apiKeys.grok, symbol, companyName, context).catch(e => ({ unit: 'Unit-B2', signal: 'HOLD', confidence: 0, error: e.message })) });
  }
  if (units.includes('M1') && apiKeys.gemini) {
    tasks.push({ name: 'Unit-M1', promise: analyzeWithUnitM1(apiKeys.gemini, symbol, companyName, context).catch(e => ({ unit: 'Unit-M1', signal: 'HOLD', confidence: 0, error: e.message })) });
  }
  if (units.includes('C3') && apiKeys.anthropic) {
    tasks.push({ name: 'Unit-C3', promise: analyzeWithUnitC3(symbol, companyName, context).catch(e => ({ unit: 'Unit-C3', signal: 'HOLD', confidence: 0, error: e.message })) });
  }
  if (units.includes('R4') && apiKeys.mistral) {
    tasks.push({ name: 'Unit-R4', promise: analyzeWithUnitR4(symbol, context).catch(e => ({ unit: 'Unit-R4', signal: 'HOLD', confidence: 0, error: e.message })) });
  }
  
  const [unitSettled, portfolio] = await Promise.all([
    Promise.allSettled(tasks.map(t => t.promise)),
    getPortfolioSummary().catch(e => ({ error: e.message }))
  ]);
  
  const unitResults = unitSettled.map((r, i) => r.status === 'fulfilled' ? r.value : { unit: tasks[i].name, error: r.reason?.message, signal: 'HOLD', confidence: 0 });
  
  unitResults.forEach(r => console.log(`[Parallel] ${r.unit}: ${r.signal || 'N/A'} (${r.confidence || 0})`));
  
  console.log('[Parallel] Running MARY-4 consensus...');
  const consensus = await makeConsensusDecision(symbol, unitResults.filter(r => r.signal), portfolio.success ? portfolio.data : null);
  
  const execTime = Date.now() - startTime;
  console.log(`[Parallel] Done in ${execTime}ms: ${consensus.final_decision}`);
  
  return { symbol, companyName, timestamp: new Date().toISOString(), executionTimeMs: execTime, unitResults, portfolioInfo: portfolio.data || null, consensus };
}

export async function executeMultiStockAnalysis(stocks, options = {}) {
  const results = [];
  for (const stock of stocks) {
    results.push(await executeParallelAnalysis(stock.symbol, stock.companyName, options));
  }
  return results;
}