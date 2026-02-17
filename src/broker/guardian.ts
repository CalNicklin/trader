import { eq } from "drizzle-orm";
import { getDb } from "../db/client.ts";
import { agentLogs, positions, trades, watchlist } from "../db/schema.ts";
import { getMarketPhase } from "../utils/clock.ts";
import { createChildLogger } from "../utils/logger.ts";
import { getQuotes, type Quote } from "./market-data.ts";
import { placeTrade } from "./orders.ts";

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

		// Gather all symbols we need quotes for
		const positionRows = await db.select().from(positions);
		const watchlistRows = await db
			.select({ symbol: watchlist.symbol })
			.from(watchlist)
			.where(eq(watchlist.active, true))
			.limit(10);

		const posSymbols = positionRows.map((p) => p.symbol);
		const watchSymbols = watchlistRows.map((w) => w.symbol);
		const allSymbols = [...new Set([...posSymbols, ...watchSymbols])];

		if (allSymbols.length === 0) return;

		// Single batch quote fetch — IBKR only, no FMP fallback.
		// Guardian runs every 60s and would saturate FMP's 5 req/min rate limit,
		// starving the orchestrator. Guardian gracefully skips symbols without quotes.
		const quotes = await getQuotes(allSymbols, { skipFmpFallback: true });

		// 1. Stop-loss enforcement
		await enforceStopLosses(positionRows, quotes);

		// 2. Update position prices
		await updatePositionPrices(positionRows, quotes);

		// 3. Price alert accumulator
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
		quantity: number;
		stopLossPrice: number | null;
	}>,
	quotes: Map<string, Quote>,
): Promise<void> {
	for (const pos of positionRows) {
		if (!pos.stopLossPrice || pos.quantity <= 0) continue;

		const quote = quotes.get(pos.symbol);
		const price = quote?.last ?? quote?.bid ?? null;
		if (price === null) continue;

		if (price <= pos.stopLossPrice) {
			log.warn(
				{ symbol: pos.symbol, price, stopLoss: pos.stopLossPrice },
				"Stop-loss triggered — placing MARKET SELL",
			);

			try {
				await placeTrade({
					symbol: pos.symbol,
					side: "SELL",
					quantity: pos.quantity,
					orderType: "MARKET",
					reasoning: `Stop-loss triggered: price ${price} <= stop ${pos.stopLossPrice}`,
					confidence: 1.0,
				});

				const db = getDb();
				await db.insert(agentLogs).values({
					level: "ACTION",
					phase: "guardian",
					message: `Stop-loss executed for ${pos.symbol}: price ${price} <= stop ${pos.stopLossPrice}, sold ${pos.quantity} shares`,
				});
			} catch (error) {
				log.error({ symbol: pos.symbol, error }, "Stop-loss SELL failed");
			}
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

/** After market close, mark any SUBMITTED orders as expired */
async function cleanupUnfilledOrders(): Promise<void> {
	const db = getDb();
	const unfilled = await db.select().from(trades).where(eq(trades.status, "SUBMITTED"));

	if (unfilled.length === 0) return;

	for (const trade of unfilled) {
		await db
			.update(trades)
			.set({ status: "CANCELLED", updatedAt: new Date().toISOString() })
			.where(eq(trades.id, trade.id));

		log.info(
			{ tradeId: trade.id, symbol: trade.symbol },
			"Unfilled order expired — marked CANCELLED",
		);
	}

	await db.insert(agentLogs).values({
		level: "INFO",
		phase: "guardian",
		message: `Post-market cleanup: ${unfilled.length} unfilled order(s) expired`,
	});
}
