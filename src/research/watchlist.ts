import { desc, eq } from "drizzle-orm";
import { getDb } from "../db/client.ts";
import { research, watchlist } from "../db/schema.ts";
import { createChildLogger } from "../utils/logger.ts";

const log = createChildLogger({ module: "research-watchlist" });

/** Scoring weights for watchlist ranking */
export const SCORING_WEIGHTS = {
	sentimentWeight: 0.3,
	confidenceWeight: 0.2,
	fundamentalWeight: 0.25,
	momentumWeight: 0.15,
	liquidityWeight: 0.1,
};

export interface WatchlistEntry {
	symbol: string;
	name: string | null;
	sector: string | null;
	score: number;
	lastResearchedAt: string | null;
	active: boolean;
}

/** Add a symbol to the watchlist */
export async function addToWatchlist(
	symbol: string,
	name?: string,
	sector?: string,
): Promise<void> {
	const db = getDb();
	await db
		.insert(watchlist)
		.values({ symbol: symbol.toUpperCase(), name, sector })
		.onConflictDoNothing();
	log.info({ symbol }, "Added to watchlist");
}

/** Remove a symbol from the watchlist */
export async function removeFromWatchlist(symbol: string): Promise<void> {
	const db = getDb();
	await db
		.update(watchlist)
		.set({ active: false })
		.where(eq(watchlist.symbol, symbol.toUpperCase()));
	log.info({ symbol }, "Removed from watchlist");
}

/** Update the score for a watchlist item based on latest research */
export async function updateScore(symbol: string): Promise<number> {
	const db = getDb();

	// Get latest research for this symbol
	const latestResearch = await db
		.select()
		.from(research)
		.where(eq(research.symbol, symbol))
		.orderBy(desc(research.createdAt))
		.limit(1);

	if (latestResearch.length === 0) {
		return 0;
	}

	const r = latestResearch[0]!;

	// Calculate composite score (0-100)
	const sentimentScore = (((r.sentiment ?? 0) + 1) / 2) * 100; // Normalize -1..1 to 0..100
	const confidenceScore = (r.confidence ?? 0) * 100;

	// Action bonus
	const actionBonus = r.suggestedAction === "BUY" ? 20 : r.suggestedAction === "WATCH" ? 5 : 0;

	const score =
		sentimentScore * SCORING_WEIGHTS.sentimentWeight +
		confidenceScore * SCORING_WEIGHTS.confidenceWeight +
		actionBonus;

	const clampedScore = Math.max(0, Math.min(100, score));

	await db
		.update(watchlist)
		.set({
			score: clampedScore,
			lastResearchedAt: new Date().toISOString(),
		})
		.where(eq(watchlist.symbol, symbol));

	log.debug({ symbol, score: clampedScore }, "Watchlist score updated");
	return clampedScore;
}

/** Get the active watchlist sorted by score */
export async function getActiveWatchlist(): Promise<WatchlistEntry[]> {
	const db = getDb();
	const items = await db
		.select()
		.from(watchlist)
		.where(eq(watchlist.active, true))
		.orderBy(desc(watchlist.score));

	return items.map((i) => ({
		symbol: i.symbol,
		name: i.name,
		sector: i.sector,
		score: i.score ?? 0,
		lastResearchedAt: i.lastResearchedAt,
		active: i.active,
	}));
}

/** Get symbols that need research (not researched in 24h) */
export async function getStaleSymbols(): Promise<string[]> {
	const db = getDb();

	const items = await db
		.select({ symbol: watchlist.symbol, lastResearchedAt: watchlist.lastResearchedAt })
		.from(watchlist)
		.where(eq(watchlist.active, true))
		.orderBy(watchlist.lastResearchedAt);

	const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

	return items
		.filter((i) => !i.lastResearchedAt || i.lastResearchedAt < oneDayAgo)
		.map((i) => i.symbol);
}
