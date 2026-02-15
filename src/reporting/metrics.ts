import { and, eq, gte } from "drizzle-orm";
import { getDb } from "../db/client.ts";
import { dailySnapshots, trades } from "../db/schema.ts";

export interface PerformanceMetrics {
	// P&L
	totalPnl: number;
	totalPnlPercent: number;
	dailyPnl: number;
	dailyPnlPercent: number;
	weeklyPnl: number;
	weeklyPnlPercent: number;

	// Win/Loss
	totalTrades: number;
	winCount: number;
	lossCount: number;
	winRate: number;
	avgWin: number;
	avgLoss: number;
	profitFactor: number;

	// Risk
	maxDrawdown: number;
	maxDrawdownPercent: number;
	sharpeRatio: number;
	currentDrawdown: number;

	// Portfolio
	portfolioValue: number;
	cashBalance: number;
	positionsCount: number;
}

/** Calculate comprehensive performance metrics */
export async function calculateMetrics(days: number = 30): Promise<PerformanceMetrics> {
	const db = getDb();
	const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split("T")[0]!;

	// Get snapshots for the period
	const snapshots = await db
		.select()
		.from(dailySnapshots)
		.where(gte(dailySnapshots.date, cutoff))
		.orderBy(dailySnapshots.date);

	// Get all filled trades
	const filledTrades = await db
		.select()
		.from(trades)
		.where(and(eq(trades.status, "FILLED"), gte(trades.createdAt, cutoff)));

	// Calculate P&L metrics
	const latestSnapshot = snapshots[snapshots.length - 1];
	const firstSnapshot = snapshots[0];

	const portfolioValue = latestSnapshot?.portfolioValue ?? 0;
	const cashBalance = latestSnapshot?.cashBalance ?? 0;
	const initialValue = firstSnapshot?.portfolioValue ?? portfolioValue;

	const totalPnl = portfolioValue - initialValue;
	const totalPnlPercent = initialValue > 0 ? (totalPnl / initialValue) * 100 : 0;

	const dailyPnl = latestSnapshot?.dailyPnl ?? 0;
	const dailyPnlPercent = latestSnapshot?.dailyPnlPercent ?? 0;

	// Weekly P&L
	const weekAgoIdx = Math.max(0, snapshots.length - 6);
	const weekAgoValue = snapshots[weekAgoIdx]?.portfolioValue ?? initialValue;
	const weeklyPnl = portfolioValue - weekAgoValue;
	const weeklyPnlPercent = weekAgoValue > 0 ? (weeklyPnl / weekAgoValue) * 100 : 0;

	// Win/Loss stats
	const wins = filledTrades.filter((t) => t.pnl !== null && t.pnl > 0);
	const losses = filledTrades.filter((t) => t.pnl !== null && t.pnl < 0);

	const winCount = wins.length;
	const lossCount = losses.length;
	const totalTrades = filledTrades.length;
	const winRate = totalTrades > 0 ? winCount / totalTrades : 0;

	const avgWin = winCount > 0 ? wins.reduce((sum, t) => sum + (t.pnl ?? 0), 0) / winCount : 0;
	const avgLoss =
		lossCount > 0 ? Math.abs(losses.reduce((sum, t) => sum + (t.pnl ?? 0), 0) / lossCount) : 0;
	const profitFactor = avgLoss > 0 ? avgWin / avgLoss : avgWin > 0 ? Infinity : 0;

	// Drawdown calculation
	let peak = 0;
	let maxDrawdown = 0;
	let maxDrawdownPercent = 0;

	for (const snap of snapshots) {
		if (snap.portfolioValue > peak) {
			peak = snap.portfolioValue;
		}
		const drawdown = peak - snap.portfolioValue;
		const drawdownPct = peak > 0 ? (drawdown / peak) * 100 : 0;
		if (drawdown > maxDrawdown) {
			maxDrawdown = drawdown;
			maxDrawdownPercent = drawdownPct;
		}
	}

	const currentDrawdown = peak > 0 ? ((peak - portfolioValue) / peak) * 100 : 0;

	// Sharpe ratio (annualized, assuming 252 trading days)
	const dailyReturns = snapshots.slice(1).map((s, i) => {
		const prev = snapshots[i]!.portfolioValue;
		return prev > 0 ? (s.portfolioValue - prev) / prev : 0;
	});

	const avgReturn =
		dailyReturns.length > 0 ? dailyReturns.reduce((sum, r) => sum + r, 0) / dailyReturns.length : 0;

	const variance =
		dailyReturns.length > 1
			? dailyReturns.reduce((sum, r) => sum + (r - avgReturn) ** 2, 0) / (dailyReturns.length - 1)
			: 0;

	const stdDev = Math.sqrt(variance);
	const sharpeRatio = stdDev > 0 ? (avgReturn / stdDev) * Math.sqrt(252) : 0;

	const positionsCount = latestSnapshot
		? Math.round(
				((latestSnapshot.portfolioValue - latestSnapshot.cashBalance) /
					(latestSnapshot.portfolioValue || 1)) *
					10,
			)
		: 0;

	return {
		totalPnl,
		totalPnlPercent,
		dailyPnl,
		dailyPnlPercent,
		weeklyPnl,
		weeklyPnlPercent,
		totalTrades,
		winCount,
		lossCount,
		winRate,
		avgWin,
		avgLoss,
		profitFactor,
		maxDrawdown,
		maxDrawdownPercent,
		sharpeRatio,
		currentDrawdown,
		portfolioValue,
		cashBalance,
		positionsCount,
	};
}
