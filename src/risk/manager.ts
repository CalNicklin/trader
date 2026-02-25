import { and, eq, gte, sql } from "drizzle-orm";
import { getTradingMode } from "../agent/prompts/trading-mode.ts";
import { getAccountSummary } from "../broker/account.ts";
import type { Exchange } from "../broker/contracts.ts";
import { getDb } from "../db/client.ts";
import { dailySnapshots, positions, trades, watchlist } from "../db/schema.ts";
import { getYahooQuote } from "../research/sources/yahoo-finance.ts";
import { convertCurrency } from "../utils/fx.ts";
import { createChildLogger } from "../utils/logger.ts";
import { isSectorExcluded, isSymbolExcluded } from "./exclusions.ts";
import { getActiveLimits, getTradeIntervalMin, HARD_LIMITS } from "./limits.ts";

const log = createChildLogger({ module: "risk-manager" });

export interface RiskCheckResult {
	approved: boolean;
	reasons: string[];
}

export interface TradeProposal {
	symbol: string;
	exchange?: Exchange;
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

	const exchange = proposal.exchange ?? "LSE";
	const currency = exchange === "LSE" ? "GBP" : "USD";

	// --- Exchange allowed check ---
	if (!HARD_LIMITS.ISA_ALLOWED_EXCHANGES.includes(exchange)) {
		reasons.push(
			`Exchange ${exchange} not in allowed list: ${HARD_LIMITS.ISA_ALLOWED_EXCHANGES.join(", ")}`,
		);
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

	// --- Price check (currency-aware) ---
	const minPrice = HARD_LIMITS.MIN_PRICE[currency] ?? 0.1;
	if (proposal.estimatedPrice < minPrice) {
		const sym = currency === "GBP" ? "£" : "$";
		reasons.push(
			`Price ${sym}${proposal.estimatedPrice} below minimum ${sym}${minPrice} (penny stock)`,
		);
	}

	// --- Currency allowed check ---
	if (!HARD_LIMITS.ISA_ALLOWED_CURRENCIES.includes(currency)) {
		reasons.push(
			`Currency ${currency} not in allowed list: ${HARD_LIMITS.ISA_ALLOWED_CURRENCIES.join(", ")}`,
		);
	}

	// --- Account checks ---
	const mode = getTradingMode();
	const limits = getActiveLimits(mode);
	const account = await getAccountSummary();
	const tradeValue = proposal.quantity * proposal.estimatedPrice;
	const tradeValueGbp = await convertCurrency(tradeValue, currency, "GBP");

	// Position size as % of portfolio (GBP-equivalent comparison)
	const positionPct = (tradeValueGbp / account.netLiquidation) * 100;
	if (positionPct > limits.MAX_POSITION_PCT) {
		reasons.push(`Position ${positionPct.toFixed(1)}% exceeds max ${limits.MAX_POSITION_PCT}%`);
	}

	// Hard cap (GBP equivalent)
	if (tradeValueGbp > limits.MAX_POSITION_VALUE) {
		reasons.push(
			`Position value £${tradeValueGbp.toFixed(0)} exceeds hard cap £${limits.MAX_POSITION_VALUE}`,
		);
	}

	// Cash reserve check (convert trade value to GBP for cash comparison)
	const cashAfterTrade = account.totalCashValue - tradeValueGbp;
	const cashReservePct = (cashAfterTrade / account.netLiquidation) * 100;
	if (cashReservePct < limits.MIN_CASH_RESERVE_PCT) {
		reasons.push(
			`Cash reserve would be ${cashReservePct.toFixed(1)}% (min ${limits.MIN_CASH_RESERVE_PCT}%)`,
		);
	}

	// --- Position count check ---
	const db = getDb();
	const openPositions = await db.select().from(positions);
	const existingPosition = openPositions.find(
		(p) => p.symbol === proposal.symbol && p.exchange === exchange,
	);
	if (!existingPosition && openPositions.length >= limits.MAX_POSITIONS) {
		reasons.push(`Max positions (${limits.MAX_POSITIONS}) reached`);
	}

	// --- Sector concentration check ---
	if (proposal.sector) {
		const sectorRows = await db
			.select({ symbol: positions.symbol, marketValue: positions.marketValue })
			.from(positions);

		// Look up sector for each position via watchlist
		const watchlistRows = await db
			.select({ symbol: watchlist.symbol, sector: watchlist.sector })
			.from(watchlist);
		const sectorMap = new Map(watchlistRows.map((w) => [w.symbol, w.sector]));

		// Sum market value by sector
		const sectorExposure = new Map<string, number>();
		for (const pos of sectorRows) {
			const sec = sectorMap.get(pos.symbol);
			if (sec) {
				sectorExposure.set(sec, (sectorExposure.get(sec) ?? 0) + (pos.marketValue ?? 0));
			}
		}

		// Add proposed trade value to the target sector
		const currentSectorValue = sectorExposure.get(proposal.sector) ?? 0;
		const proposedSectorValue = currentSectorValue + tradeValue;
		const sectorPct = (proposedSectorValue / account.netLiquidation) * 100;

		if (sectorPct > HARD_LIMITS.MAX_SECTOR_EXPOSURE_PCT) {
			reasons.push(
				`Sector "${proposal.sector}" would be ${sectorPct.toFixed(1)}% of portfolio (max ${HARD_LIMITS.MAX_SECTOR_EXPOSURE_PCT}%)`,
			);
		}
	}

	// --- Volume check (fresh Yahoo data) ---
	const yahooQuote = await getYahooQuote(proposal.symbol, exchange);
	if (!yahooQuote) {
		reasons.push("Unable to verify volume — Yahoo Finance quote unavailable");
	} else if (yahooQuote.avgVolume < HARD_LIMITS.MIN_AVG_VOLUME) {
		reasons.push(
			`Avg daily volume ${yahooQuote.avgVolume.toLocaleString()} below minimum ${HARD_LIMITS.MIN_AVG_VOLUME.toLocaleString()}`,
		);
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
		const intervalMin = getTradeIntervalMin(getTradingMode());
		if (minutesSinceLast < intervalMin) {
			reasons.push(
				`Only ${minutesSinceLast.toFixed(0)}min since last trade (min ${intervalMin}min)`,
			);
		}
	}

	// --- Daily loss limit ---
	const dailyLossCheck = await checkDailyLossLimit(
		account.netLiquidation,
		limits.DAILY_LOSS_LIMIT_PCT,
	);
	if (dailyLossCheck.breached) {
		reasons.push(`Daily loss limit breached: ${dailyLossCheck.message}`);
	}

	// --- Weekly loss limit ---
	const weeklyLossCheck = await checkWeeklyLossLimit(
		account.netLiquidation,
		limits.WEEKLY_LOSS_LIMIT_PCT,
	);
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
	limitPct: number,
): Promise<{ breached: boolean; message: string }> {
	const db = getDb();
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

	if (loss < -limitPct) {
		return {
			breached: true,
			message: `Daily loss ${loss.toFixed(2)}% exceeds -${limitPct}%`,
		};
	}

	return { breached: false, message: "" };
}

async function checkWeeklyLossLimit(
	portfolioValue: number,
	limitPct: number,
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

	if (loss < -limitPct) {
		return {
			breached: true,
			message: `Weekly loss ${loss.toFixed(2)}% exceeds -${limitPct}%`,
		};
	}

	return { breached: false, message: "" };
}

/** Calculate the stop loss price for a given entry price. Uses ATR when available, falls back to fixed 3%. */
export function calculateStopLoss(entryPrice: number, atr?: number): number {
	if (atr) {
		return entryPrice - atr * HARD_LIMITS.STOP_LOSS_ATR_MULTIPLIER;
	}
	return entryPrice * (1 - HARD_LIMITS.PER_TRADE_STOP_LOSS_PCT / 100);
}

interface PortfolioSnapshot {
	netLiquidation: number;
	totalCashValue: number;
}

interface PositionLimits {
	MAX_POSITION_PCT: number;
	MAX_POSITION_VALUE: number;
	MIN_CASH_RESERVE_PCT: number;
}

/** Pure calculation of max position size. All limits are GBP-denominated; fxRate converts to native currency. */
export function calculateMaxPosition(
	price: number,
	currency: "GBP" | "USD",
	portfolio: PortfolioSnapshot,
	limits: PositionLimits,
	fxRate: number,
): { maxQuantity: number; maxValue: number } {
	const pctLimit = (portfolio.netLiquidation * limits.MAX_POSITION_PCT) / 100;
	const valueLimit = limits.MAX_POSITION_VALUE;
	const availableCash =
		portfolio.totalCashValue - (portfolio.netLiquidation * limits.MIN_CASH_RESERVE_PCT) / 100;

	const maxValueGbp = Math.min(pctLimit, valueLimit, Math.max(0, availableCash));
	const maxValue = currency === "GBP" ? maxValueGbp : maxValueGbp * fxRate;
	const maxQuantity = Math.floor(maxValue / price);

	return { maxQuantity, maxValue };
}

/** Calculate maximum position size respecting all limits */
export async function getMaxPositionSize(
	price: number,
	exchange: Exchange = "LSE",
): Promise<{ maxQuantity: number; maxValue: number }> {
	const currency: "GBP" | "USD" = exchange === "LSE" ? "GBP" : "USD";
	const limits = getActiveLimits(getTradingMode());
	const account = await getAccountSummary();
	const fxRate = currency !== "GBP" ? await convertCurrency(1, "GBP", currency) : 1;

	return calculateMaxPosition(price, currency, account, limits, fxRate);
}

export interface AtrPositionSize {
	maxQuantity: number;
	maxValue: number;
	stopLossPrice: number;
	targetPrice: number;
	riskPerShare: number;
	riskTotal: number;
}

interface AtrLimits extends PositionLimits {
	STOP_LOSS_ATR_MULTIPLIER: number;
	RISK_PER_TRADE_PCT: number;
	TARGET_ATR_MULTIPLIER: number;
}

/** Pure ATR-based position sizing. GBP limits converted to native currency via fxRate. */
export function calculateAtrPosition(
	price: number,
	atr: number,
	currency: "GBP" | "USD",
	portfolio: PortfolioSnapshot,
	limits: AtrLimits,
	fxRate: number,
): AtrPositionSize {
	const riskPerShare = atr * limits.STOP_LOSS_ATR_MULTIPLIER;
	const riskBudgetGbp = (portfolio.netLiquidation * limits.RISK_PER_TRADE_PCT) / 100;
	const riskBudget = currency === "GBP" ? riskBudgetGbp : riskBudgetGbp * fxRate;
	const atrBasedQuantity = Math.floor(riskBudget / riskPerShare);
	const atrBasedValue = atrBasedQuantity * price;

	const pctLimitGbp = (portfolio.netLiquidation * limits.MAX_POSITION_PCT) / 100;
	const valueLimitGbp = limits.MAX_POSITION_VALUE;
	const availableCashGbp =
		portfolio.totalCashValue - (portfolio.netLiquidation * limits.MIN_CASH_RESERVE_PCT) / 100;

	const maxValueGbp = Math.min(pctLimitGbp, valueLimitGbp, Math.max(0, availableCashGbp));
	const capNative = currency === "GBP" ? maxValueGbp : maxValueGbp * fxRate;
	const maxValue = Math.min(atrBasedValue, capNative);
	const maxQuantity = Math.floor(maxValue / price);

	const stopLossPrice = price - riskPerShare;
	const targetPrice = price + atr * limits.TARGET_ATR_MULTIPLIER;

	return {
		maxQuantity,
		maxValue,
		stopLossPrice,
		targetPrice,
		riskPerShare,
		riskTotal: maxQuantity * riskPerShare,
	};
}

/**
 * ATR-based position sizing. Risk per trade = RISK_PER_TRADE_PCT of portfolio.
 * Stop distance = STOP_LOSS_ATR_MULTIPLIER x ATR.
 * Cross-checks against existing hard limits.
 */
export async function getAtrPositionSize(
	price: number,
	atr: number,
	exchange: Exchange = "LSE",
): Promise<AtrPositionSize> {
	const currency: "GBP" | "USD" = exchange === "LSE" ? "GBP" : "USD";
	const limits = getActiveLimits(getTradingMode());
	const account = await getAccountSummary();
	const fxRate = currency !== "GBP" ? await convertCurrency(1, "GBP", currency) : 1;

	return calculateAtrPosition(price, atr, currency, account, limits, fxRate);
}
