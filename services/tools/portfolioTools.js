import Alpaca from '@alpacahq/alpaca-trade-api';

let alpacaClient = null;

export function initAlpaca(config) {
  alpacaClient = new Alpaca({
    keyId: config.apiKey,
    secretKey: config.secretKey,
    paper: true,
    baseUrl: config.baseUrl || 'https://paper-api.alpaca.markets'
  });
}

export const portfolioToolDefinition = {
  type: "function",
  function: {
    name: "get_portfolio_position",
    description: "Alpaca口座の現在ポジションと残高を取得",
    parameters: {
      type: "object",
      properties: {
        symbol: { type: "string", description: "特定銘柄（省略時は全ポジション）" }
      }
    }
  }
};

export async function getAccountInfo() {
  try {
    if (!alpacaClient) throw new Error('Alpaca client not initialized');
    const account = await alpacaClient.getAccount();
    return {
      success: true,
      data: {
        cash: parseFloat(account.cash),
        portfolioValue: parseFloat(account.portfolio_value),
        equity: parseFloat(account.equity),
        buyingPower: parseFloat(account.buying_power)
      }
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function getPositions(symbol = null) {
  try {
    if (!alpacaClient) throw new Error('Alpaca client not initialized');
    let positions = symbol 
      ? [await alpacaClient.getPosition(symbol).catch(() => null)].filter(Boolean)
      : await alpacaClient.getPositions();
    
    return {
      success: true,
      data: {
        positions: positions.map(pos => ({
          symbol: pos.symbol,
          qty: parseFloat(pos.qty),
          avgEntryPrice: parseFloat(pos.avg_entry_price),
          currentPrice: parseFloat(pos.current_price),
          unrealizedPL: parseFloat(pos.unrealized_pl),
          marketValue: parseFloat(pos.market_value)
        })),
        totalPositions: positions.length
      }
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function getPortfolioSummary() {
  const [account, positions] = await Promise.all([getAccountInfo(), getPositions()]);
  if (!account.success || !positions.success) {
    return { success: false, error: 'Failed to fetch portfolio' };
  }
  return {
    success: true,
    data: { account: account.data, positions: positions.data }
  };
}

export async function executePortfolioTool(args) {
  const result = args?.symbol ? await getPositions(args.symbol) : await getPortfolioSummary();
  return JSON.stringify(result, null, 2);
}