import yahooFinance from 'yahoo-finance2';
import { RSI, MACD, SMA, EMA, BollingerBands } from 'technicalindicators';

// テクニカル指標のパラメータを定数として設定
const INDICATOR_SETTINGS = {
  RSI_PERIOD: 14,
  RSI_OVERBOUGHT: 70,
  RSI_OVERSOLD: 30,
  MACD_FAST: 12,
  MACD_SLOW: 26,
  MACD_SIGNAL: 9,
  SMA_SHORT: 20,
  SMA_LONG: 50,
  BB_PERIOD: 20,
  BB_STDDEV: 2,
};

export const technicalToolDefinition = {
  type: "function",
  function: {
    name: "get_technical_indicators",
    description: "RSI、MACD、移動平均などのテクニカル指標を計算",
    parameters: {
      type: "object",
      properties: {
        symbol: { type: "string", description: "ティッカーシンボル" },
        period: { type: "string", description: "期間: 1mo, 3mo, 6mo" }
      },
      required: ["symbol"]
    }
  }
};

/**
 * 指定された銘柄と期間の過去データをYahoo Financeから取得します。
 * @param {string} symbol - ティッカーシンボル (例: 'AAPL')
 * @param {string} [period='3mo'] - データ取得期間 (例: '1mo', '3mo', '6mo')
 * @returns {Promise<object>} 終値、高値、安値の配列を含むオブジェクト
 */
async function getHistoricalData(symbol, period = '3mo') {
  const result = await yahooFinance.chart(symbol, { period1: period, interval: '1d' });
  return {
    close: result.quotes.map(q => q.close),
    high: result.quotes.map(q => q.high),
    low: result.quotes.map(q => q.low)
  };
}

/**
 * 指定された銘柄のテクニカル指標を計算し、売買シグナルを生成します。
 * @param {string} symbol - ティッカーシンボル (例: 'AAPL')
 * @param {string} [period='3mo'] - 分析に使用するデータ期間
 * @returns {Promise<object>} 分析結果。成功した場合は各種指標と総合シグナル、失敗した場合はエラーメッセージを含みます。
 */
export async function getTechnicalIndicators(symbol, period = '3mo') {
  try {
    const historicalData = await getHistoricalData(symbol, period);
    // データが不足している場合のエラーハンドリングを強化
    if (!historicalData || !historicalData.close || historicalData.close.length < INDICATOR_SETTINGS.SMA_LONG) {
      return { success: false, error: `Historical data for ${symbol} is insufficient for analysis.` };
    }
    const closes = historicalData.close.filter(c => c != null);
    
    // 各指標を計算
    const rsi = RSI.calculate({ values: closes, period: INDICATOR_SETTINGS.RSI_PERIOD });
    const macd = MACD.calculate({ 
      values: closes, 
      fastPeriod: INDICATOR_SETTINGS.MACD_FAST, 
      slowPeriod: INDICATOR_SETTINGS.MACD_SLOW, 
      signalPeriod: INDICATOR_SETTINGS.MACD_SIGNAL, 
      SimpleMAOscillator: false, 
      SimpleMASignal: false 
    });
    const smaShort = SMA.calculate({ values: closes, period: INDICATOR_SETTINGS.SMA_SHORT });
    const smaLong = SMA.calculate({ values: closes, period: INDICATOR_SETTINGS.SMA_LONG });
    const bb = BollingerBands.calculate({ values: closes, period: INDICATOR_SETTINGS.BB_PERIOD, stdDev: INDICATOR_SETTINGS.BB_STDDEV });
    
    // 最新の指標値を取得（データが存在しない場合も考慮）
    const getLast = arr => arr?.[arr.length - 1];
    const currentPrice = getLast(closes);
    const currentRSI = getLast(rsi);
    const currentMACD = getLast(macd);
    const currentBB = getLast(bb);
    const currentSmaShort = getLast(smaShort);
    const currentSmaLong = getLast(smaLong);
    
    // RSIシグナル判定
    let rsiSignal = 'NEUTRAL';
    if (currentRSI >= INDICATOR_SETTINGS.RSI_OVERBOUGHT) rsiSignal = 'OVERBOUGHT';
    else if (currentRSI <= INDICATOR_SETTINGS.RSI_OVERSOLD) rsiSignal = 'OVERSOLD';
    
    // MACDシグナル判定
    let macdSignal = 'NEUTRAL';
    if (currentMACD?.MACD > currentMACD?.signal) macdSignal = 'BULLISH_TREND';
    else if (currentMACD?.MACD < currentMACD?.signal) macdSignal = 'BEARISH_TREND';
    
    // SMAゴールデンクロス/デッドクロス判定
    let smaSignal = 'NEUTRAL';
    if (currentSmaShort > currentSmaLong) smaSignal = 'GOLDEN_CROSS';
    else if (currentSmaShort < currentSmaLong) smaSignal = 'DEAD_CROSS';

    // 総合シグナル判定
    const signals = [
      rsiSignal === 'OVERSOLD' ? 'BUY' : rsiSignal === 'OVERBOUGHT' ? 'SELL' : 'HOLD',
      macdSignal === 'BULLISH_TREND' ? 'BUY' : macdSignal === 'BEARISH_TREND' ? 'SELL' : 'HOLD',
      smaSignal === 'GOLDEN_CROSS' ? 'BUY' : smaSignal === 'DEAD_CROSS' ? 'SELL' : 'HOLD'
    ];
    const buyCount = signals.filter(s => s === 'BUY').length;
    const sellCount = signals.filter(s => s === 'SELL').length;
    const score = buyCount - sellCount;

    let overallSignal = 'NEUTRAL';
    if (score >= 2) {
      overallSignal = 'STRONG_BUY';
    } else if (score === 1) {
      overallSignal = 'BUY';
    } else if (score <= -2) {
      overallSignal = 'STRONG_SELL';
    } else if (score === -1) {
      overallSignal = 'SELL';
    }

    return {
      success: true,
      data: {
        symbol, 
        currentPrice,
        rsi: { value: currentRSI, signal: rsiSignal },
        macd: { macd: currentMACD?.MACD, signal: currentMACD?.signal, histogram: currentMACD?.histogram, trend: macdSignal },
        sma: { short: currentSmaShort, long: currentSmaLong, signal: smaSignal },
        bollinger: currentBB,
        overallSignal: overallSignal
      }
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function executeTechnicalTool(args) {
  const result = await getTechnicalIndicators(args.symbol, args.period);
  return JSON.stringify(result, null, 2);
}