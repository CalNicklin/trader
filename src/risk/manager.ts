import { and, eq, gte, sql } from "drizzle-orm";
import { getAccountSummary } from "../broker/account.ts";
import { getDb } from "../db/client.ts";
import { dailySnapshots, positions, trades } from "../db/schema.ts";
import { createChildLogger } from "../utils/logger.ts";
import { isSectorExcluded, isSymbolExcluded } from "./exclusions.ts";
import { HARD_LIMITS } from "./limits.ts";

const log = createChildLogger({ module: "risk-manager" });

export interface RiskCheckResult {
	approved: boolean;
	reasons: string[];
}

export interface TradeProposal {
	symbol: string;
	side: "BUY" | "SELL";
	quantity: number;
	estimatedPrice: number;
	sector?: string;
}

/** Run all pre-trade risk checks */
export async function checkTradeRisk(proposal: TradeProposal): Promise<RiskCheckResult> {
	const reasons: string[] = [];

	// Sells are generally allowed (reducing risk)
	if (proposal.side === "SELL") {
		return { approved: true, reasons: [] };
	}

	// --- Exclusion checks ---
	const symbolCheck = await isSymbolExcluded(proposal.symbol);
	if (symbolCheck.excluded) {
		reasons.push(`Symbol excluded: ${symbolCheck.reason}`);
	}

	if (proposal.sector) {
		const sectorCheck = await isSectorExcluded(proposal.sector);
		if (sectorCheck.excluded) {
			reasons.push(`Sector excluded: ${sectorCheck.reason}`);
		}
	}

	// --- Price check ---
	if (proposal.estimatedPrice < HARD_LIMITS.MIN_PRICE_GBP) {
		reasons.push(
			`Price £${proposal.estimatedPrice} below minimum £${HARD_LIMITS.MIN_PRICE_GBP} (penny stock)`,
		);
	}

	// --- Account checks ---
	const account = await getAccountSummary();
	const tradeValue = proposal.quantity * proposal.estimatedPrice;

	// Position size as % of portfolio
	const positionPct = (tradeValue / account.netLiquidation) * 100;
	if (positionPct > HARD_LIMITS.MAX_POSITION_PCT) {
		reasons.push(
			`Position ${positionPct.toFixed(1)}% exceeds max ${HARD_LIMITS.MAX_POSITION_PCT}%`,
		);
	}

	// Hard GBP cap
	if (tradeValue > HARD_LIMITS.MAX_POSITION_GBP) {
		reasons.push(
			`Position £${tradeValue.toFixed(0)} exceeds hard cap £${HARD_LIMITS.MAX_POSITION_GBP}`,
		);
	}

	// Cash reserve check
	const cashAfterTrade = account.totalCashValue - tradeValue;
	const cashReservePct = (cashAfterTrade / account.netLiquidation) * 100;
	if (cashReservePct < HARD_LIMITS.MIN_CASH_RESERVE_PCT) {
		reasons.push(
			`Cash reserve would be ${cashReservePct.toFixed(1)}% (min ${HARD_LIMITS.MIN_CASH_RESERVE_PCT}%)`,
		);
	}

	// --- Position count check ---
	const db = getDb();
	const openPositions = await db.select().from(positions);
	const existingPosition = openPositions.find((p) => p.symbol === proposal.symbol);
	if (!existingPosition && openPositions.length >= HARD_LIMITS.MAX_POSITIONS) {
		reasons.push(`Max positions (${HARD_LIMITS.MAX_POSITIONS}) reached`);
	}

	// --- Daily trade count ---
	const today = new Date().toISOString().split("T")[0]!;
	const todayTrades = await db
		.select({ count: sql<number>`count(*)` })
		.from(trades)
		.where(and(gte(trades.createdAt, today), eq(trades.side, "BUY")));

	const tradeCount = todayTrades[0]?.count ?? 0;
	if (tradeCount >= HARD_LIMITS.MAX_TRADES_PER_DAY) {
		reasons.push(`Daily trade limit (${HARD_LIMITS.MAX_TRADES_PER_DAY}) reached`);
	}

	// --- Trade interval check ---
	const recentTrades = await db
		.select({ createdAt: trades.createdAt })
		.from(trades)
		.where(gte(trades.createdAt, today))
		.orderBy(sql`${trades.createdAt} DESC`)
		.limit(1);

	if (recentTrades.length > 0) {
		const lastTradeTime = new Date(recentTrades[0]!.createdAt).getTime();
		const minutesSinceLast = (Date.now() - lastTradeTime) / 60000;
		if (minutesSinceLast < HARD_LIMITS.MIN_TRADE_INTERVAL_MIN) {
			reasons.push(
				`Only ${minutesSinceLast.toFixed(0)}min since last trade (min ${HARD_LIMITS.MIN_TRADE_INTERVAL_MIN}min)`,
			);
		}
	}

	// --- Daily loss limit ---
	const dailyLossCheck = await checkDailyLossLimit(account.netLiquidation);
	if (dailyLossCheck.breached) {
		reasons.push(`Daily loss limit breached: ${dailyLossCheck.message}`);
	}

	// --- Weekly loss limit ---
	const weeklyLossCheck = await checkWeeklyLossLimit(account.netLiquidation);
	if (weeklyLossCheck.breached) {
		reasons.push(`Weekly loss limit breached: ${weeklyLossCheck.message}`);
	}

	const approved = reasons.length === 0;
	if (!approved) {
		log.warn({ symbol: proposal.symbol, reasons }, "Trade rejected by risk manager");
	} else {
		log.info({ symbol: proposal.symbol, tradeValue }, "Trade approved by risk manager");
	}

	return { approved, reasons };
}

async function checkDailyLossLimit(
	portfolioValue: number,
): Promise<{ breached: boolean; message: string }> {
	const db = getDb();
	// Get today's snapshot or use yesterday's as baseline
	const snapshots = await db
		.select()
		.from(dailySnapshots)
		.orderBy(sql`${dailySnapshots.date} DESC`)
		.limit(1);

	if (snapshots.length === 0) {
		return { breached: false, message: "No baseline snapshot" };
	}

	const baseline = snapshots[0]!.portfolioValue;
	const loss = ((portfolioValue - baseline) / baseline) * 100;

	if (loss < -HARD_LIMITS.DAILY_LOSS_LIMIT_PCT) {
		return {
			breached: true,
			message: `Daily loss ${loss.toFixed(2)}% exceeds -${HARD_LIMITS.DAILY_LOSS_LIMIT_PCT}%`,
		};
	}

	return { breached: false, message: "" };
}

async function checkWeeklyLossLimit(
	portfolioValue: number,
): Promise<{ breached: boolean; message: string }> {
	const db = getDb();
	const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0]!;

	const snapshots = await db
		.select()
		.from(dailySnapshots)
		.where(gte(dailySnapshots.date, weekAgo))
		.orderBy(sql`${dailySnapshots.date} ASC`)
		.limit(1);

	if (snapshots.length === 0) {
		return { breached: false, message: "No weekly baseline" };
	}

	const baseline = snapshots[0]!.portfolioValue;
	const loss = ((portfolioValue - baseline) / baseline) * 100;

	if (loss < -HARD_LIMITS.WEEKLY_LOSS_LIMIT_PCT) {
		return {
			breached: true,
			message: `Weekly loss ${loss.toFixed(2)}% exceeds -${HARD_LIMITS.WEEKLY_LOSS_LIMIT_PCT}%`,
		};
	}

	return { breached: false, message: "" };
}

/** Calculate the stop loss price for a given entry price */
export function calculateStopLoss(entryPrice: number): number {
	return entryPrice * (1 - HARD_LIMITS.PER_TRADE_STOP_LOSS_PCT / 100);
}

/** Calculate maximum position size respecting all limits */
export async function getMaxPositionSize(
	price: number,
): Promise<{ maxQuantity: number; maxValue: number }> {
	const account = await getAccountSummary();

	// Position size limits
	const pctLimit = (account.netLiquidation * HARD_LIMITS.MAX_POSITION_PCT) / 100;
	const gbpLimit = HARD_LIMITS.MAX_POSITION_GBP;

	// Cash reserve constraint
	const availableCash =
		account.totalCashValue - (account.netLiquidation * HARD_LIMITS.MIN_CASH_RESERVE_PCT) / 100;

	const maxValue = Math.min(pctLimit, gbpLimit, Math.max(0, availableCash));
	const maxQuantity = Math.floor(maxValue / price);

	return { maxQuantity, maxValue };
}
