import { eq } from "drizzle-orm";
import { getDb } from "../db/client.ts";
import { agentLogs, positions, trades, watchlist } from "../db/schema.ts";
import { HARD_LIMITS } from "../risk/limits.ts";
import { getMarketPhase } from "../utils/clock.ts";
import { createChildLogger } from "../utils/logger.ts";
import type { Exchange } from "./contracts.ts";
import { getQuotes, type Quote } from "./market-data.ts";
import { computeCleanupActions } from "./order-cleanup.ts";
import { computeReconciliation } from "./order-reconcile.ts";
import type { ExecutionLike, OpenOrderLike, SubmittedTrade } from "./order-types.ts";
import { getOpenOrders, placeTrade } from "./orders.ts";
import { findStopLossBreaches } from "./stop-loss.ts";
import { computeTrailingStopUpdate } from "./trailing-stops.ts";

const log = createChildLogger({ module: "guardian" });

const GUARDIAN_INTERVAL_MS = 60_000;
const PRICE_ALERT_THRESHOLD = 0.03; // 3% move triggers alert

let intervalHandle: ReturnType<typeof setInterval> | null = null;

/** Prices from the last guardian tick, keyed by symbol */
const lastPrices = new Map<string, number>();

/** Alert queue consumed by the orchestrator's shouldRunAnalysis() */
export const alertQueue: Array<{ symbol: string; movePct: number; price: number }> = [];

/** Drain and return all pending alerts (clears the queue) */
export function drainAlerts() {
	return alertQueue.splice(0, alertQueue.length);
}

export function startGuardian(): void {
	if (intervalHandle) return;
	log.info("Position Guardian started");
	intervalHandle = setInterval(guardianTick, GUARDIAN_INTERVAL_MS);
	// Run immediately on start
	guardianTick();
}

export function stopGuardian(): void {
	if (intervalHandle) {
		clearInterval(intervalHandle);
		intervalHandle = null;
		log.info("Position Guardian stopped");
	}
}

async function guardianTick(): Promise<void> {
	const phase = getMarketPhase();

	// Only run during market-relevant hours
	if (phase === "closed" || phase === "research") return;

	// Post-market: run cleanup only
	if (phase === "post-market") {
		await cleanupUnfilledOrders();
		return;
	}

	try {
		const db = getDb();

		// Gather all symbols we need quotes for, grouped by exchange
		const positionRows = await db.select().from(positions);
		const watchlistRows = await db
			.select({ symbol: watchlist.symbol, exchange: watchlist.exchange })
			.from(watchlist)
			.where(eq(watchlist.active, true))
			.limit(10);

		const symbolExchangeMap = new Map<string, Exchange>();
		for (const p of positionRows) {
			symbolExchangeMap.set(p.symbol, p.exchange as Exchange);
		}
		for (const w of watchlistRows) {
			if (!symbolExchangeMap.has(w.symbol)) {
				symbolExchangeMap.set(w.symbol, w.exchange as Exchange);
			}
		}

		if (symbolExchangeMap.size === 0) return;

		// Group symbols by exchange and fetch quotes per-exchange.
		// IBKR only, no FMP fallback — Guardian runs every 60s and would saturate FMP's rate limit.
		const byExchange = new Map<Exchange, string[]>();
		for (const [symbol, exchange] of symbolExchangeMap) {
			const list = byExchange.get(exchange) ?? [];
			list.push(symbol);
			byExchange.set(exchange, list);
		}

		const quotes = new Map<string, Quote>();
		for (const [exchange, symbols] of byExchange) {
			const exchangeQuotes = await getQuotes(symbols, { skipFmpFallback: true, exchange });
			for (const [symbol, quote] of exchangeQuotes) {
				quotes.set(symbol, quote);
			}
		}

		// 1. Stop-loss enforcement
		await enforceStopLosses(positionRows, quotes);

		// 2. Update position prices
		await updatePositionPrices(positionRows, quotes);

		// 3. Trailing stop updates
		await updateTrailingStops(positionRows, quotes);

		// 4. Price alert accumulator
		accumulateAlerts(quotes);
	} catch (error) {
		log.error({ error }, "Guardian tick failed");
	}
}

/** Check stop-loss levels and trigger immediate MARKET SELL if breached */
async function enforceStopLosses(
	positionRows: Array<{
		id: number;
		symbol: string;
		exchange: string;
		quantity: number;
		stopLossPrice: number | null;
	}>,
	quotes: Map<string, Quote>,
): Promise<void> {
	const breaches = findStopLossBreaches(positionRows, quotes);
	const exchangeBySymbol = new Map(positionRows.map((p) => [p.symbol, p.exchange as Exchange]));

	for (const breach of breaches) {
		log.warn(
			{ symbol: breach.symbol, price: breach.price, stopLoss: breach.stopLossPrice },
			"Stop-loss triggered — placing MARKET SELL",
		);

		try {
			await placeTrade({
				symbol: breach.symbol,
				exchange: exchangeBySymbol.get(breach.symbol),
				side: "SELL",
				quantity: breach.quantity,
				orderType: "MARKET",
				reasoning: `Stop-loss triggered: price ${breach.price} <= stop ${breach.stopLossPrice}`,
				confidence: 1.0,
			});

			const db = getDb();
			await db.insert(agentLogs).values({
				level: "ACTION",
				phase: "guardian",
				message: `Stop-loss executed for ${breach.symbol}: price ${breach.price} <= stop ${breach.stopLossPrice}, sold ${breach.quantity} shares`,
			});
		} catch (error) {
			log.error({ symbol: breach.symbol, error }, "Stop-loss SELL failed");
		}
	}
}

/** Update position currentPrice, unrealizedPnl, and marketValue from quotes */
async function updatePositionPrices(
	positionRows: Array<{ id: number; symbol: string; quantity: number; avgCost: number }>,
	quotes: Map<string, Quote>,
): Promise<void> {
	const db = getDb();

	for (const pos of positionRows) {
		const quote = quotes.get(pos.symbol);
		const price = quote?.last ?? quote?.bid ?? null;
		if (price === null) continue;

		const marketValue = price * pos.quantity;
		const unrealizedPnl = (price - pos.avgCost) * pos.quantity;

		await db
			.update(positions)
			.set({
				currentPrice: price,
				marketValue,
				unrealizedPnl,
				updatedAt: new Date().toISOString(),
			})
			.where(eq(positions.id, pos.id));
	}
}

/** Track price moves >3% and queue alerts for the orchestrator */
function accumulateAlerts(quotes: Map<string, Quote>): void {
	for (const [symbol, quote] of quotes) {
		const price = quote.last ?? quote.bid;
		if (!price) continue;

		const prev = lastPrices.get(symbol);
		if (prev) {
			const movePct = (price - prev) / prev;
			if (Math.abs(movePct) >= PRICE_ALERT_THRESHOLD) {
				alertQueue.push({
					symbol,
					movePct: Math.round(movePct * 1000) / 10, // e.g. 3.2%
					price,
				});
				log.info(
					{ symbol, movePct: `${(movePct * 100).toFixed(1)}%`, price },
					"Price alert queued",
				);
			}
		}
		lastPrices.set(symbol, price);
	}
}

/** Update trailing stops for positions with ATR data */
async function updateTrailingStops(
	positionRows: Array<{
		id: number;
		symbol: string;
		exchange: string;
		quantity: number;
		highWaterMark: number | null;
		trailingStopPrice: number | null;
	}>,
	quotes: Map<string, Quote>,
): Promise<void> {
	const db = getDb();

	for (const pos of positionRows) {
		const quote = quotes.get(pos.symbol);
		const currentPrice = quote?.last ?? quote?.bid ?? null;
		if (!currentPrice) continue;

		// Look up ATR from the indicators cache (compute if needed)
		let atr14: number | null = null;
		try {
			const { getIndicatorsForSymbol } = await import("../analysis/indicators.ts");
			const indicators = await getIndicatorsForSymbol(pos.symbol, "3 M", pos.exchange as Exchange);
			atr14 = indicators?.atr14 ?? null;
		} catch {
			// Indicators not available — skip trailing stop update
		}

		const update = computeTrailingStopUpdate(
			{
				id: pos.id,
				symbol: pos.symbol,
				quantity: pos.quantity,
				highWaterMark: pos.highWaterMark,
				trailingStopPrice: pos.trailingStopPrice,
				atr14,
				currentPrice,
			},
			HARD_LIMITS.TRAILING_STOP_ATR_MULTIPLIER,
		);

		if (!update) continue;

		await db
			.update(positions)
			.set({
				highWaterMark: update.highWaterMark,
				trailingStopPrice: update.trailingStopPrice,
				updatedAt: new Date().toISOString(),
			})
			.where(eq(positions.id, pos.id));

		if (update.triggered) {
			log.warn(
				{
					symbol: pos.symbol,
					price: currentPrice,
					trailingStop: update.trailingStopPrice,
				},
				"Trailing stop triggered — placing MARKET SELL",
			);

			try {
				await placeTrade({
					symbol: pos.symbol,
					exchange: pos.exchange as Exchange,
					side: "SELL",
					quantity: pos.quantity,
					orderType: "MARKET",
					reasoning: `Trailing stop triggered: price ${currentPrice} <= stop ${update.trailingStopPrice.toFixed(2)}`,
					confidence: 1.0,
				});

				await db.insert(agentLogs).values({
					level: "ACTION",
					phase: "guardian",
					message: `Trailing stop executed for ${pos.symbol}: price ${currentPrice} <= trailing stop ${update.trailingStopPrice.toFixed(2)}, sold ${pos.quantity} shares`,
				});
			} catch (error) {
				log.error({ symbol: pos.symbol, error }, "Trailing stop SELL failed");
			}
		}
	}
}

/** After market close, reconcile SUBMITTED orders before marking as expired.
 *  Prevents Bug 5: fast-filled orders being incorrectly marked CANCELLED. */
async function cleanupUnfilledOrders(): Promise<void> {
	const db = getDb();
	const unfilled = await db.select().from(trades).where(eq(trades.status, "SUBMITTED"));

	if (unfilled.length === 0) return;

	const submittedTrades: SubmittedTrade[] = unfilled
		.filter((t): t is typeof t & { ibOrderId: number } => t.ibOrderId !== null)
		.map((t) => ({
			id: t.id,
			ibOrderId: t.ibOrderId,
			symbol: t.symbol,
			status: "SUBMITTED" as const,
		}));

	let ibOpenOrders: readonly OpenOrderLike[] = [];
	const ibExecutions: readonly ExecutionLike[] = [];
	try {
		ibOpenOrders = await getOpenOrders();
	} catch (err) {
		log.warn({ error: err }, "Failed to fetch open orders for reconciliation");
	}

	const reconciled = computeReconciliation(submittedTrades, ibOpenOrders, ibExecutions);
	const actions = computeCleanupActions(submittedTrades, reconciled, true);

	let filledCount = 0;
	let cancelledCount = 0;

	for (const action of actions) {
		const updateData: Record<string, unknown> = {
			updatedAt: new Date().toISOString(),
		};

		if (action.action === "FILLED") {
			updateData.status = "FILLED";
			updateData.filledAt = new Date().toISOString();
			if (action.fillPrice) updateData.fillPrice = action.fillPrice;
			if (action.commission) updateData.commission = action.commission;
			filledCount++;
			log.info(
				{ tradeId: action.tradeId, fillPrice: action.fillPrice },
				"Reconciled as FILLED during cleanup",
			);
		} else {
			updateData.status = "CANCELLED";
			cancelledCount++;
			log.info({ tradeId: action.tradeId }, "Unfilled order expired — marked CANCELLED");
		}

		await db.update(trades).set(updateData).where(eq(trades.id, action.tradeId));
	}

	if (filledCount > 0 || cancelledCount > 0) {
		await db.insert(agentLogs).values({
			level: "INFO",
			phase: "guardian",
			message: `Post-market cleanup: ${filledCount} reconciled as FILLED, ${cancelledCount} expired as CANCELLED`,
		});
	}
}
