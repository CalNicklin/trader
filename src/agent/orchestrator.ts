import { desc, eq, gte } from "drizzle-orm";
import { getAccountSummary, getPositions as getBrokerPositions } from "../broker/account.ts";
import { drainAlerts } from "../broker/guardian.ts";
import type { Quote } from "../broker/market-data.ts";
import { getQuotes } from "../broker/market-data.ts";
import { getDb } from "../db/client.ts";
import { agentLogs, dailySnapshots, positions, research, trades, watchlist } from "../db/schema.ts";
import { buildLearningBrief, buildRecentContext } from "../learning/context-builder.ts";
import { getMarketPhase } from "../utils/clock.ts";
import { createChildLogger } from "../utils/logger.ts";
import { runTradingAnalyst, runTradingAnalystFast } from "./planner.ts";
import { getDayPlanPrompt, getMiniAnalysisPrompt } from "./prompts/trading-analyst.ts";

const log = createChildLogger({ module: "orchestrator" });

/** In-memory cache of last-seen quotes for price move detection */
const lastQuotes = new Map<string, number>();

/** Price move threshold to trigger analysis */
const PRICE_MOVE_THRESHOLD = 0.02; // 2%

/** Structured intention logged by the agent via log_intention tool */
export interface Intention {
	symbol: string;
	condition: string; // e.g. "price < 2450", "price > 1200"
	action: string; // e.g. "BUY", "SELL", "RESEARCH"
	note: string;
	createdAt: string;
}

/** In-memory intention queue — agent adds, shouldRunAnalysis consumes */
const pendingIntentions: Intention[] = [];

/** Add a new intention (called from executeTool) */
export function addIntention(intention: Intention): void {
	pendingIntentions.push(intention);
	log.info({ intention }, "Intention logged");
}

/** Get all pending intentions (read-only) */
export function getIntentions(): readonly Intention[] {
	return pendingIntentions;
}

/** Clear all intentions (called at post-market) */
export function clearIntentions(): void {
	const count = pendingIntentions.length;
	pendingIntentions.length = 0;
	if (count > 0) {
		log.info({ cleared: count }, "Intentions cleared for end of day");
	}
}

/**
 * Evaluate intentions against current quotes.
 * Returns fulfilled intentions and removes them from the queue.
 */
function evaluateIntentions(quotes: Map<string, Quote>): Intention[] {
	const fulfilled: Intention[] = [];
	const remaining: Intention[] = [];

	for (const intent of pendingIntentions) {
		const quote = quotes.get(intent.symbol);
		const price = quote?.last ?? null;
		if (price === null) {
			remaining.push(intent);
			continue;
		}

		// Parse simple conditions: "price < 2450", "price > 1200"
		const match = intent.condition.match(/price\s*([<>]=?)\s*([\d.]+)/i);
		if (!match) {
			// Can't evaluate — keep it and surface it as context
			remaining.push(intent);
			continue;
		}

		const op = match[1]!;
		const target = Number.parseFloat(match[2]!);
		let met = false;

		switch (op) {
			case "<":
				met = price < target;
				break;
			case "<=":
				met = price <= target;
				break;
			case ">":
				met = price > target;
				break;
			case ">=":
				met = price >= target;
				break;
		}

		if (met) {
			fulfilled.push(intent);
		} else {
			remaining.push(intent);
		}
	}

	// Replace queue with remaining
	pendingIntentions.length = 0;
	pendingIntentions.push(...remaining);

	return fulfilled;
}

export type OrchestratorState =
	| "idle"
	| "pre_market"
	| "market_open"
	| "active_trading"
	| "wind_down"
	| "post_market"
	| "research"
	| "paused";

let currentState: OrchestratorState = "idle";
let tradingPaused = false;

/** Inter-tick memory: day plan and last agent response */
let currentDayPlan: string | null = null;
let lastAgentResponse: string | null = null;

export function getState(): OrchestratorState {
	return currentState;
}

export function isPaused(): boolean {
	return tradingPaused;
}

export function setPaused(paused: boolean): void {
	tradingPaused = paused;
	log.warn({ paused }, "Trading pause state changed");
}

/** Main orchestrator tick - called by scheduler */
export async function tick(): Promise<void> {
	if (tradingPaused) {
		log.debug("Trading is paused");
		return;
	}

	const phase = getMarketPhase();
	const prevState = currentState;

	switch (phase) {
		case "pre-market":
			currentState = "pre_market";
			if (prevState !== "pre_market") {
				await onPreMarket();
			}
			break;

		case "open":
			currentState = "active_trading";
			await onActiveTradingTick();
			break;

		case "wind-down":
			currentState = "wind_down";
			if (prevState !== "wind_down") {
				await onWindDown();
			}
			break;

		case "post-market":
			currentState = "post_market";
			if (prevState !== "post_market") {
				await onPostMarket();
			}
			break;

		case "research":
			currentState = "research";
			// Research is handled by its own scheduled job
			break;

		case "closed":
			currentState = "idle";
			break;
	}

	if (prevState !== currentState) {
		log.info({ from: prevState, to: currentState }, "State transition");
		const db = getDb();
		await db.insert(agentLogs).values({
			level: "INFO",
			phase: currentState,
			message: `State transition: ${prevState} -> ${currentState}`,
		});
	}
}

/** Pre-market: health check, sync, generate day plan */
async function onPreMarket(): Promise<void> {
	log.info("Pre-market phase starting");

	try {
		// Sync account
		const summary = await getAccountSummary();
		log.info({ netLiq: summary.netLiquidation, cash: summary.totalCashValue }, "Account synced");

		// Reconcile positions
		await reconcilePositions();

		// Generate day plan
		const accountData = JSON.stringify(summary);
		const db = getDb();
		const watchlistItems = await db
			.select()
			.from(watchlist)
			.where(eq(watchlist.active, true))
			.orderBy(desc(watchlist.score))
			.limit(20);

		const positionRows = await db.select().from(positions);

		const learningBrief = await buildLearningBrief();

		const context = `
Account: ${accountData}
Positions: ${JSON.stringify(positionRows)}
Watchlist (top 20): ${JSON.stringify(watchlistItems)}
Date: ${new Date().toISOString()}
${learningBrief ? `\n${learningBrief}` : ""}
`;

		const response = await runTradingAnalyst(`${getDayPlanPrompt()}\n\n${context}`);
		currentDayPlan = response.text;
		log.info({ plan: response.text.substring(0, 200) }, "Day plan generated");
	} catch (error) {
		log.error({ error }, "Pre-market phase failed");
	}
}

interface MarketState {
	reasons: string[];
	quotes: Map<string, Quote>;
}

/** Tier 1: Gather market state and flag notable changes */
async function shouldRunAnalysis(): Promise<MarketState> {
	const reasons: string[] = [];
	const db = getDb();

	// Check for open positions (need monitoring)
	const positionRows = await db.select().from(positions);
	if (positionRows.length > 0) {
		reasons.push(`${positionRows.length} open position(s) to monitor`);
	}

	// Check for pending/submitted orders
	const pendingOrders = await db.select().from(trades).where(eq(trades.status, "SUBMITTED"));
	if (pendingOrders.length > 0) {
		reasons.push(`${pendingOrders.length} pending order(s)`);
	}

	// Get watchlist quotes and check for price moves
	const watchlistItems = await db
		.select()
		.from(watchlist)
		.where(eq(watchlist.active, true))
		.orderBy(desc(watchlist.score))
		.limit(10);

	const symbols = watchlistItems.map((w) => w.symbol);
	const quotes = await getQuotes(symbols);

	for (const [symbol, quote] of quotes) {
		if (!quote.last) continue;
		const lastPrice = lastQuotes.get(symbol);
		if (lastPrice) {
			const move = Math.abs(quote.last - lastPrice) / lastPrice;
			if (move >= PRICE_MOVE_THRESHOLD) {
				reasons.push(`${symbol} moved ${(move * 100).toFixed(1)}%`);
			}
		}
		lastQuotes.set(symbol, quote.last);
	}

	// Check for guardian price alerts (>3% moves detected between ticks)
	const alerts = drainAlerts();
	for (const alert of alerts) {
		reasons.push(`Guardian alert: ${alert.symbol} moved ${alert.movePct.toFixed(1)}%`);
	}

	// Evaluate pending intentions against current quotes
	const fulfilled = evaluateIntentions(quotes);
	for (const intent of fulfilled) {
		reasons.push(
			`Intention triggered: ${intent.action} ${intent.symbol} (${intent.condition}) — "${intent.note}"`,
		);
	}

	// Check for new research with actionable signals (last 24h)
	// BUY signals are always actionable; SELL only if we hold that stock (ISA = long-only, can't short)
	const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
	const actionableResearch = await db
		.select()
		.from(research)
		.where(gte(research.createdAt, oneDayAgo));

	const heldSymbols = new Set(positionRows.map((p) => p.symbol));
	const actionable = actionableResearch.filter(
		(r) =>
			r.suggestedAction === "BUY" || (r.suggestedAction === "SELL" && heldSymbols.has(r.symbol)),
	);
	if (actionable.length > 0) {
		const actions = actionable.map((r) => `${r.symbol}:${r.suggestedAction}`).join(", ");
		reasons.push(`Actionable research: ${actions}`);
	}

	return { reasons, quotes };
}

/** Active trading tick: three-tier analysis (pre-filter -> Haiku -> Sonnet) */
async function onActiveTradingTick(): Promise<void> {
	try {
		// === Tier 1: Gather market state (quotes, positions, research) ===
		const preFilter = await shouldRunAnalysis();
		if (preFilter.reasons.length > 0) {
			log.info({ reasons: preFilter.reasons }, "Pre-filter: notable changes detected");
		}

		const db = getDb();
		const positionRows = await db.select().from(positions);

		// Update position prices if we have positions
		if (positionRows.length > 0) {
			const posSymbols = positionRows.map((p) => p.symbol);
			const posQuotes = await getQuotes(posSymbols);

			for (const pos of positionRows) {
				const quote = posQuotes.get(pos.symbol);
				if (!quote?.last) continue;

				await db
					.update(positions)
					.set({
						currentPrice: quote.last,
						unrealizedPnl: (quote.last - pos.avgCost) * pos.quantity,
						marketValue: quote.last * pos.quantity,
						updatedAt: new Date().toISOString(),
					})
					.where(eq(positions.id, pos.id));

				if (pos.stopLossPrice && quote.last <= pos.stopLossPrice) {
					log.warn(
						{ symbol: pos.symbol, price: quote.last, stopLoss: pos.stopLossPrice },
						"Stop loss triggered!",
					);
				}
			}
		}

		// Build context for Haiku agent
		const watchlistItems = await db
			.select()
			.from(watchlist)
			.where(eq(watchlist.active, true))
			.orderBy(desc(watchlist.score))
			.limit(10);

		const recentContext = await buildRecentContext();

		// Build enrichment context (day plan, last response, data completeness, portfolio composition)
		const enrichments: string[] = [];

		if (currentDayPlan) {
			enrichments.push(`Today's plan: ${currentDayPlan.substring(0, 500)}`);
		}
		if (lastAgentResponse) {
			enrichments.push(`Your last assessment: ${lastAgentResponse.substring(0, 800)}`);
		}

		// Data completeness: how many quotes succeeded vs failed
		const requestedSymbols = watchlistItems.map((w) => w.symbol);
		const gotQuotes = requestedSymbols.filter((s) => preFilter.quotes.has(s));
		const missingQuotes = requestedSymbols.filter((s) => !preFilter.quotes.has(s));
		if (missingQuotes.length > 0) {
			enrichments.push(
				`Data completeness: ${gotQuotes.length}/${requestedSymbols.length} quotes. Missing: ${missingQuotes.join(", ")}`,
			);
		}

		// Portfolio composition: sector breakdown
		if (positionRows.length > 0) {
			const watchlistSectors = await db
				.select({ symbol: watchlist.symbol, sector: watchlist.sector })
				.from(watchlist);
			const sectorLookup = new Map(watchlistSectors.map((w) => [w.symbol, w.sector]));

			const sectorTotals = new Map<string, number>();
			for (const pos of positionRows) {
				const mv = pos.marketValue ?? pos.avgCost * pos.quantity;
				const sec = sectorLookup.get(pos.symbol) ?? "Unknown";
				sectorTotals.set(sec, (sectorTotals.get(sec) ?? 0) + mv);
			}

			const account = await getAccountSummary();
			const cashPct = ((account.totalCashValue / account.netLiquidation) * 100).toFixed(0);
			const sectorBreakdown = [...sectorTotals.entries()]
				.sort((a, b) => b[1] - a[1])
				.map(([sec, val]) => `${sec} ${((val / account.netLiquidation) * 100).toFixed(0)}%`)
				.join(", ");
			enrichments.push(`Portfolio: ${sectorBreakdown}, Cash ${cashPct}%`);
		}

		const enrichmentBlock = enrichments.length > 0 ? `\n${enrichments.join("\n")}` : "";

		let fullContext: string;

		const notable = preFilter.reasons.length > 0 ? preFilter.reasons.join("; ") : "Routine check";

		if (positionRows.length === 0) {
			fullContext = `
Watchlist quotes: ${JSON.stringify(Object.fromEntries(preFilter.quotes))}
Watchlist data: ${JSON.stringify(watchlistItems)}
${recentContext ? `\n${recentContext}` : ""}${enrichmentBlock}
Notable changes: ${notable}
`;
		} else {
			const account = await getAccountSummary();
			fullContext = `
Account: ${JSON.stringify(account)}
Positions with current quotes: ${JSON.stringify(
				positionRows.map((p) => ({
					...p,
					currentPrice: preFilter.quotes.get(p.symbol)?.last,
					bid: preFilter.quotes.get(p.symbol)?.bid,
					ask: preFilter.quotes.get(p.symbol)?.ask,
				})),
			)}
${recentContext ? `\n${recentContext}` : ""}${enrichmentBlock}
Notable changes: ${notable}
`;
		}

		const agentResponse = await runTradingAnalystFast(
			`${getMiniAnalysisPrompt()}\n\n${fullContext}`,
		);
		lastAgentResponse = agentResponse.text;
	} catch (error) {
		log.error({ error }, "Active trading tick failed");
	}
}

/** Wind-down: no new orders */
async function onWindDown(): Promise<void> {
	log.info("Wind-down phase - no new orders will be placed");
	const db = getDb();
	await db.insert(agentLogs).values({
		level: "INFO",
		phase: "wind_down",
		message: "Entering wind-down phase. No new orders.",
	});
}

/** Post-market: reconcile, snapshot, clear intentions */
async function onPostMarket(): Promise<void> {
	log.info("Post-market phase starting");

	try {
		await reconcilePositions();
		await recordDailySnapshot();
		clearIntentions();
		currentDayPlan = null;
		lastAgentResponse = null;

		log.info("Post-market complete");
	} catch (error) {
		log.error({ error }, "Post-market phase failed");
	}
}

/** Reconcile positions with IBKR */
async function reconcilePositions(): Promise<void> {
	const db = getDb();
	const brokerPositions = await getBrokerPositions();

	// Get current DB positions
	const dbPositions = await db.select().from(positions);
	const dbSymbols = new Set(dbPositions.map((p) => p.symbol));

	// Add/update broker positions
	for (const bp of brokerPositions) {
		if (dbSymbols.has(bp.symbol)) {
			await db
				.update(positions)
				.set({
					quantity: bp.quantity,
					avgCost: bp.avgCost,
					updatedAt: new Date().toISOString(),
				})
				.where(eq(positions.symbol, bp.symbol));
		} else {
			await db.insert(positions).values({
				symbol: bp.symbol,
				quantity: bp.quantity,
				avgCost: bp.avgCost,
			});
		}
	}

	// Remove positions no longer in broker
	const brokerSymbols = new Set(brokerPositions.map((p) => p.symbol));
	for (const dbPos of dbPositions) {
		if (!brokerSymbols.has(dbPos.symbol)) {
			await db.delete(positions).where(eq(positions.id, dbPos.id));
		}
	}

	log.info({ broker: brokerPositions.length, db: dbPositions.length }, "Positions reconciled");
}

/** Record end-of-day portfolio snapshot (retries up to 3 times) */
async function recordDailySnapshot(): Promise<void> {
	for (let attempt = 1; attempt <= 3; attempt++) {
		try {
			await recordDailySnapshotInner();
			return;
		} catch (error) {
			log.warn({ attempt, error }, "Daily snapshot failed, retrying...");
			if (attempt < 3) await Bun.sleep(30_000);
		}
	}
	log.error("Daily snapshot failed after 3 attempts — carrying forward previous");
}

async function recordDailySnapshotInner(): Promise<void> {
	const db = getDb();
	const account = await getAccountSummary();
	const today = new Date().toISOString().split("T")[0]!;

	// Get previous snapshot for P&L calc
	const prevSnapshot = await db
		.select()
		.from(dailySnapshots)
		.orderBy(desc(dailySnapshots.date))
		.limit(1);

	const prevValue = prevSnapshot[0]?.portfolioValue ?? account.netLiquidation;
	const dailyPnl = account.netLiquidation - prevValue;
	const dailyPnlPercent = prevValue > 0 ? (dailyPnl / prevValue) * 100 : 0;

	// Count today's trades
	const todayTrades = await db.select().from(trades).where(gte(trades.createdAt, today));

	const wins = todayTrades.filter((t) => t.pnl !== null && t.pnl > 0).length;
	const losses = todayTrades.filter((t) => t.pnl !== null && t.pnl < 0).length;

	// Calculate total P&L
	const firstSnapshot = await db
		.select()
		.from(dailySnapshots)
		.orderBy(dailySnapshots.date)
		.limit(1);
	const initialValue = firstSnapshot[0]?.portfolioValue ?? account.netLiquidation;
	const totalPnl = account.netLiquidation - initialValue;

	await db
		.insert(dailySnapshots)
		.values({
			date: today,
			portfolioValue: account.netLiquidation,
			cashBalance: account.totalCashValue,
			positionsValue: account.grossPositionValue,
			dailyPnl,
			dailyPnlPercent,
			totalPnl,
			tradesCount: todayTrades.length,
			winsCount: wins,
			lossesCount: losses,
		})
		.onConflictDoNothing();

	log.info(
		{ date: today, value: account.netLiquidation, dailyPnl, totalPnl },
		"Daily snapshot recorded",
	);
}
