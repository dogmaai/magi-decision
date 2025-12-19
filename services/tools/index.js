export * from './stockTools.js';
export * from './portfolioTools.js';
export * from './technicalTools.js';

import { stockToolDefinition, executeStockTool } from './stockTools.js';
import { portfolioToolDefinition, executePortfolioTool } from './portfolioTools.js';
import { technicalToolDefinition, executeTechnicalTool } from './technicalTools.js';

export const allToolDefinitions = [
  stockToolDefinition,
  portfolioToolDefinition,
  technicalToolDefinition
];

export async function executeToolByName(toolName, args) {
  switch (toolName) {
    case 'get_stock_price':
      return await executeStockTool(args);
    case 'get_portfolio_position':
      return await executePortfolioTool(args);
    case 'get_technical_indicators':
      return await executeTechnicalTool(args);
    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}