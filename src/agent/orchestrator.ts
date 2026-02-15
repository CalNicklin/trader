import { desc, eq, gte } from "drizzle-orm";
import { getAccountSummary, getPositions as getBrokerPositions } from "../broker/account.ts";
import { getQuotes } from "../broker/market-data.ts";
import { getDb } from "../db/client.ts";
import { agentLogs, dailySnapshots, positions, trades, watchlist } from "../db/schema.ts";
import { getMarketPhase } from "../utils/clock.ts";
import { createChildLogger } from "../utils/logger.ts";
import { runTradingAnalyst } from "./planner.ts";
import { DAY_PLAN_PROMPT, MINI_ANALYSIS_PROMPT } from "./prompts/trading-analyst.ts";

const log = createChildLogger({ module: "orchestrator" });

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

		const context = `
Account: ${accountData}
Positions: ${JSON.stringify(positionRows)}
Watchlist (top 20): ${JSON.stringify(watchlistItems)}
Date: ${new Date().toISOString()}
`;

		const response = await runTradingAnalyst(`${DAY_PLAN_PROMPT}\n\n${context}`);
		log.info({ plan: response.text.substring(0, 200) }, "Day plan generated");
	} catch (error) {
		log.error({ error }, "Pre-market phase failed");
	}
}

/** Active trading tick: refresh data, check positions, run mini-analysis */
async function onActiveTradingTick(): Promise<void> {
	try {
		const db = getDb();

		// Get current positions
		const positionRows = await db.select().from(positions);
		if (positionRows.length === 0) {
			// No positions - get watchlist for potential entries
			const watchlistItems = await db
				.select()
				.from(watchlist)
				.where(eq(watchlist.active, true))
				.orderBy(desc(watchlist.score))
				.limit(10);

			if (watchlistItems.length === 0) return;

			const symbols = watchlistItems.map((w) => w.symbol);
			const quotes = await getQuotes(symbols);

			const context = `
Watchlist quotes: ${JSON.stringify(Object.fromEntries(quotes))}
Watchlist data: ${JSON.stringify(watchlistItems)}
`;
			await runTradingAnalyst(`${MINI_ANALYSIS_PROMPT}\n\n${context}`);
		} else {
			// Have positions - monitor them
			const symbols = positionRows.map((p) => p.symbol);
			const quotes = await getQuotes(symbols);

			// Check for stop loss hits
			for (const pos of positionRows) {
				const quote = quotes.get(pos.symbol);
				if (!quote?.last) continue;

				// Update position current price
				await db
					.update(positions)
					.set({
						currentPrice: quote.last,
						unrealizedPnl: (quote.last - pos.avgCost) * pos.quantity,
						marketValue: quote.last * pos.quantity,
						updatedAt: new Date().toISOString(),
					})
					.where(eq(positions.id, pos.id));

				// Check stop loss
				if (pos.stopLossPrice && quote.last <= pos.stopLossPrice) {
					log.warn(
						{ symbol: pos.symbol, price: quote.last, stopLoss: pos.stopLossPrice },
						"Stop loss triggered!",
					);
					// Agent will handle the sell in its analysis
				}
			}

			const account = await getAccountSummary();
			const context = `
Account: ${JSON.stringify(account)}
Positions with current quotes: ${JSON.stringify(
				positionRows.map((p) => ({
					...p,
					currentPrice: quotes.get(p.symbol)?.last,
					bid: quotes.get(p.symbol)?.bid,
					ask: quotes.get(p.symbol)?.ask,
				})),
			)}
`;
			await runTradingAnalyst(`${MINI_ANALYSIS_PROMPT}\n\n${context}`);
		}
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

/** Post-market: reconcile, snapshot, send daily email */
async function onPostMarket(): Promise<void> {
	log.info("Post-market phase starting");

	try {
		await reconcilePositions();
		await recordDailySnapshot();

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

/** Record end-of-day portfolio snapshot */
async function recordDailySnapshot(): Promise<void> {
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
