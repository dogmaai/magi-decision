import yahooFinance from 'yahoo-finance2';

export const stockToolDefinition = {
  type: "function",
  function: {
    name: "get_stock_price",
    description: "指定銘柄の現在株価、出来高、日次変動を取得",
    parameters: {
      type: "object",
      properties: {
        symbol: { type: "string", description: "ティッカーシンボル (例: AAPL)" }
      },
      required: ["symbol"]
    }
  }
};

export async function getStockPrice(symbol) {
  try {
    const quote = await yahooFinance.quote(symbol);
    return {
      success: true,
      data: {
        symbol: quote.symbol,
        name: quote.shortName || quote.longName,
        price: quote.regularMarketPrice,
        previousClose: quote.regularMarketPreviousClose,
        change: quote.regularMarketChange,
        changePercent: quote.regularMarketChangePercent,
        volume: quote.regularMarketVolume,
        marketCap: quote.marketCap,
        fiftyTwoWeekHigh: quote.fiftyTwoWeekHigh,
        fiftyTwoWeekLow: quote.fiftyTwoWeekLow,
        pe: quote.trailingPE,
        timestamp: new Date().toISOString()
      }
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function executeStockTool(args) {
  const result = await getStockPrice(args.symbol);
  return JSON.stringify(result, null, 2);
}