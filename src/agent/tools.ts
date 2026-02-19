import type Anthropic from "@anthropic-ai/sdk";
import { desc, eq } from "drizzle-orm";
import { getAccountSummary, getPositions } from "../broker/account.ts";
import { searchContracts } from "../broker/contracts.ts";
import { getHistoricalBars, getQuote, getQuotes } from "../broker/market-data.ts";
import { cancelOrder, placeTrade, type TradeRequest } from "../broker/orders.ts";
import { getDb } from "../db/client.ts";
import { research, trades, watchlist } from "../db/schema.ts";
import { researchSymbol } from "../research/pipeline.ts";
import { updateScore } from "../research/watchlist.ts";
import { checkTradeRisk, getMaxPositionSize } from "../risk/manager.ts";
import { getMarketPhase } from "../utils/clock.ts";
import { createChildLogger } from "../utils/logger.ts";
import { addIntention, getIntentions, type Intention } from "./orchestrator.ts";

const log = createChildLogger({ module: "agent-tools" });

/** Tool definitions for Claude function calling */
export const toolDefinitions: Anthropic.Tool[] = [
	{
		name: "get_quote",
		description: "Get current market quote for an LSE-listed stock",
		input_schema: {
			type: "object" as const,
			properties: {
				symbol: { type: "string", description: "Stock ticker symbol (e.g., VOD, SHEL, AZN)" },
			},
			required: ["symbol"],
		},
	},
	{
		name: "get_multiple_quotes",
		description: "Get market quotes for multiple LSE-listed stocks at once",
		input_schema: {
			type: "object" as const,
			properties: {
				symbols: {
					type: "array",
					items: { type: "string" },
					description: "Array of stock ticker symbols",
				},
			},
			required: ["symbols"],
		},
	},
	{
		name: "get_historical_bars",
		description: "Get historical daily price bars for a stock",
		input_schema: {
			type: "object" as const,
			properties: {
				symbol: { type: "string", description: "Stock ticker symbol" },
				duration: {
					type: "string",
					description: "Duration (e.g., '1 M', '3 M', '1 Y'). Default: '1 M'",
				},
			},
			required: ["symbol"],
		},
	},
	{
		name: "get_account_summary",
		description: "Get current account balance, cash, and portfolio value",
		input_schema: { type: "object" as const, properties: {} },
	},
	{
		name: "get_positions",
		description: "Get all current open positions from IBKR",
		input_schema: { type: "object" as const, properties: {} },
	},
	{
		name: "get_watchlist",
		description: "Get the current watchlist with scores and research data",
		input_schema: { type: "object" as const, properties: {} },
	},
	{
		name: "get_recent_research",
		description: "Get recent research analysis for a specific symbol",
		input_schema: {
			type: "object" as const,
			properties: {
				symbol: { type: "string", description: "Stock ticker symbol" },
			},
			required: ["symbol"],
		},
	},
	{
		name: "research_symbol",
		description:
			"Run fresh research on a symbol RIGHT NOW. Fetches latest quote, fundamentals, news, and historical data, then analyses with Claude. Use this BEFORE trading a symbol if existing research is stale (>24h old) or missing. Returns the new analysis.",
		input_schema: {
			type: "object" as const,
			properties: {
				symbol: { type: "string", description: "Stock ticker symbol to research" },
			},
			required: ["symbol"],
		},
	},
	{
		name: "get_recent_trades",
		description: "Get recent trade history",
		input_schema: {
			type: "object" as const,
			properties: {
				limit: { type: "number", description: "Number of recent trades to return. Default: 20" },
			},
		},
	},
	{
		name: "check_risk",
		description: "Run risk checks on a proposed trade before executing it",
		input_schema: {
			type: "object" as const,
			properties: {
				symbol: { type: "string" },
				side: { type: "string", enum: ["BUY", "SELL"] },
				quantity: { type: "number" },
				estimatedPrice: { type: "number" },
				sector: { type: "string" },
			},
			required: ["symbol", "side", "quantity", "estimatedPrice"],
		},
	},
	{
		name: "get_max_position_size",
		description: "Calculate the maximum position size allowed for a given stock price",
		input_schema: {
			type: "object" as const,
			properties: {
				price: { type: "number", description: "Current stock price in GBP" },
			},
			required: ["price"],
		},
	},
	{
		name: "place_trade",
		description: "Execute a trade order. ALWAYS run check_risk first before calling this.",
		input_schema: {
			type: "object" as const,
			properties: {
				symbol: { type: "string", description: "Stock ticker symbol" },
				side: { type: "string", enum: ["BUY", "SELL"] },
				quantity: { type: "number", description: "Number of shares" },
				orderType: { type: "string", enum: ["LIMIT", "MARKET"] },
				limitPrice: { type: "number", description: "Limit price (required for LIMIT orders)" },
				reasoning: { type: "string", description: "Explanation of why this trade is being made" },
				confidence: { type: "number", description: "Confidence level 0.0-1.0" },
			},
			required: ["symbol", "side", "quantity", "orderType", "reasoning", "confidence"],
		},
	},
	{
		name: "cancel_order",
		description:
			"Cancel a pending/submitted order. Use get_recent_trades first to find the trade ID. Only works on orders with status SUBMITTED or PENDING.",
		input_schema: {
			type: "object" as const,
			properties: {
				tradeId: {
					type: "number",
					description: "The trade ID from the trades table (not the IBKR order ID)",
				},
				reason: { type: "string", description: "Why this order is being cancelled" },
			},
			required: ["tradeId", "reason"],
		},
	},
	{
		name: "search_contracts",
		description: "Search for LSE-listed stock contracts matching a pattern",
		input_schema: {
			type: "object" as const,
			properties: {
				pattern: { type: "string", description: "Search pattern for stock symbol or name" },
			},
			required: ["pattern"],
		},
	},
	{
		name: "log_decision",
		description: "Log a decision or observation to the agent audit trail",
		input_schema: {
			type: "object" as const,
			properties: {
				message: { type: "string", description: "Decision or observation to log" },
				level: { type: "string", enum: ["INFO", "WARN", "DECISION", "ACTION"] },
			},
			required: ["message"],
		},
	},
	{
		name: "log_intention",
		description:
			'Log a conditional trading intention for the next tick. Use when you want to remember something across ticks, e.g. "buy SHEL if price drops below 2450". Conditions are evaluated automatically against live quotes each tick.',
		input_schema: {
			type: "object" as const,
			properties: {
				symbol: { type: "string", description: "Stock ticker symbol" },
				condition: {
					type: "string",
					description:
						'Price condition in format "price < 2450" or "price > 1200". Supports <, <=, >, >=',
				},
				action: {
					type: "string",
					description: "What to do when condition is met: BUY, SELL, or RESEARCH",
				},
				note: {
					type: "string",
					description: "Context for why this intention was set",
				},
			},
			required: ["symbol", "condition", "action", "note"],
		},
	},
	{
		name: "get_intentions",
		description: "View all pending trading intentions that are waiting to be triggered",
		input_schema: { type: "object" as const, properties: {} },
	},
];

/** Execute a tool call and return the result */
export async function executeTool(name: string, input: Record<string, unknown>): Promise<string> {
	try {
		switch (name) {
			case "get_quote": {
				const quote = await getQuote(input.symbol as string);
				return JSON.stringify(quote);
			}
			case "get_multiple_quotes": {
				const quotes = await getQuotes(input.symbols as string[]);
				return JSON.stringify(Object.fromEntries(quotes));
			}
			case "get_historical_bars": {
				const bars = await getHistoricalBars(
					input.symbol as string,
					(input.duration as string) ?? "1 M",
				);
				return JSON.stringify(bars);
			}
			case "get_account_summary": {
				const summary = await getAccountSummary();
				return JSON.stringify(summary);
			}
			case "get_positions": {
				const pos = await getPositions();
				return JSON.stringify(pos);
			}
			case "get_watchlist": {
				const db = getDb();
				const items = await db
					.select()
					.from(watchlist)
					.where(eq(watchlist.active, true))
					.orderBy(desc(watchlist.score));
				return JSON.stringify(items);
			}
			case "get_recent_research": {
				const db = getDb();
				const items = await db
					.select()
					.from(research)
					.where(eq(research.symbol, input.symbol as string))
					.orderBy(desc(research.createdAt))
					.limit(5);
				return JSON.stringify(items);
			}
			case "research_symbol": {
				const symbol = (input.symbol as string).toUpperCase();
				await researchSymbol(symbol, []);
				await updateScore(symbol);
				// Return the fresh analysis
				const db = getDb();
				const freshResearch = await db
					.select()
					.from(research)
					.where(eq(research.symbol, symbol))
					.orderBy(desc(research.createdAt))
					.limit(1);
				return JSON.stringify(freshResearch[0] ?? { error: "Research produced no results" });
			}
			case "get_recent_trades": {
				const db = getDb();
				const items = await db
					.select()
					.from(trades)
					.orderBy(desc(trades.createdAt))
					.limit((input.limit as number) ?? 20);
				return JSON.stringify(items);
			}
			case "check_risk": {
				const result = await checkTradeRisk({
					symbol: input.symbol as string,
					side: input.side as "BUY" | "SELL",
					quantity: input.quantity as number,
					estimatedPrice: input.estimatedPrice as number,
					sector: input.sector as string | undefined,
				});
				return JSON.stringify(result);
			}
			case "get_max_position_size": {
				const result = await getMaxPositionSize(input.price as number);
				return JSON.stringify(result);
			}
			case "place_trade": {
				const side = input.side as "BUY" | "SELL";
				const confidence = input.confidence as number;
				const symbol = input.symbol as string;
				const quantity = input.quantity as number;
				const limitPrice = input.limitPrice as number | undefined;
				const orderType = input.orderType as "LIMIT" | "MARKET";
				let estimatedPrice = limitPrice ?? 0;

				// For MARKET orders, fetch current price for risk checks
				if (!limitPrice) {
					try {
						const quote = await getQuote(symbol);
						estimatedPrice = quote.last ?? quote.bid ?? quote.ask ?? 0;
					} catch {
						// Quote fetch failed — estimatedPrice stays 0, risk check will reject
					}
				}

				// Gate 1: Wind-down / post-market rejection for BUY orders
				if (side === "BUY") {
					const phase = getMarketPhase();
					if (phase === "wind-down" || phase === "post-market" || phase === "closed") {
						log.warn({ symbol, phase }, "BUY order rejected — market phase");
						return JSON.stringify({
							error: `BUY orders not allowed during ${phase} phase`,
							rejected: true,
						});
					}
				}

				// Gate 2: Confidence threshold
				if (confidence < 0.7) {
					log.warn({ symbol, confidence }, "Trade rejected — confidence below 0.7");
					return JSON.stringify({
						error: `Confidence ${confidence} is below minimum threshold of 0.7`,
						rejected: true,
					});
				}

				// Gate 3: Mandatory risk check
				if (side === "BUY") {
					const riskResult = await checkTradeRisk({
						symbol,
						side,
						quantity,
						estimatedPrice,
					});
					if (!riskResult.approved) {
						log.warn({ symbol, reasons: riskResult.reasons }, "Trade rejected by risk gate");
						return JSON.stringify({
							error: "Trade rejected by risk manager",
							reasons: riskResult.reasons,
							rejected: true,
						});
					}
				}

				const tradeReq: TradeRequest = {
					symbol,
					side,
					quantity,
					orderType,
					limitPrice,
					reasoning: input.reasoning as string,
					confidence,
				};
				const result = await placeTrade(tradeReq);
				return JSON.stringify(result);
			}
			case "cancel_order": {
				const tradeId = input.tradeId as number;
				const reason = input.reason as string;
				const db = getDb();
				const [trade] = await db.select().from(trades).where(eq(trades.id, tradeId)).limit(1);
				if (!trade) {
					return JSON.stringify({ error: `Trade ${tradeId} not found` });
				}
				if (trade.status !== "SUBMITTED" && trade.status !== "PENDING") {
					return JSON.stringify({
						error: `Cannot cancel trade ${tradeId} — status is ${trade.status}`,
					});
				}
				if (!trade.ibOrderId) {
					return JSON.stringify({ error: `Trade ${tradeId} has no IBKR order ID` });
				}
				await cancelOrder(trade.ibOrderId);
				await db
					.update(trades)
					.set({ status: "CANCELLED", updatedAt: new Date().toISOString() })
					.where(eq(trades.id, tradeId));
				log.info({ tradeId, ibOrderId: trade.ibOrderId, reason }, "Order cancelled by agent");
				return JSON.stringify({
					cancelled: true,
					tradeId,
					symbol: trade.symbol,
					reason,
				});
			}
			case "search_contracts": {
				const results = await searchContracts(input.pattern as string);
				return JSON.stringify(results);
			}
			case "log_decision": {
				const db = getDb();
				const { agentLogs } = await import("../db/schema.ts");
				const level = ((input.level as string) ?? "INFO") as
					| "INFO"
					| "WARN"
					| "ERROR"
					| "DECISION"
					| "ACTION";
				await db.insert(agentLogs).values({
					level,
					message: input.message as string,
					phase: "trading",
				});
				return JSON.stringify({ logged: true });
			}
			case "log_intention": {
				const intention: Intention = {
					symbol: (input.symbol as string).toUpperCase(),
					condition: input.condition as string,
					action: (input.action as string).toUpperCase(),
					note: input.note as string,
					createdAt: new Date().toISOString(),
				};
				addIntention(intention);
				return JSON.stringify({
					logged: true,
					intention,
					pendingCount: getIntentions().length,
				});
			}
			case "get_intentions": {
				return JSON.stringify(getIntentions());
			}
			default:
				return JSON.stringify({ error: `Unknown tool: ${name}` });
		}
	} catch (error) {
		log.error({ tool: name, error }, "Tool execution failed");
		return JSON.stringify({
			error: error instanceof Error ? error.message : String(error),
		});
	}
}
