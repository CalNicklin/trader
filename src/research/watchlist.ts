import { desc, eq } from "drizzle-orm";
import { getDb } from "../db/client.ts";
import { positions, research, watchlist } from "../db/schema.ts";
import { createChildLogger } from "../utils/logger.ts";

const log = createChildLogger({ module: "research-watchlist" });

export interface ScoreInput {
	qualityPass: "pass" | "marginal" | "fail" | null;
	changePercentage: number;
	daysSinceResearch: number;
}

/**
 * Pure scoring formula: qualityMultiplier * momentumProxy * recencyDecay.
 * Returns 0-100. quality_pass="fail" always returns 0.
 */
export function computeScore(input: ScoreInput): number {
	const qualityMultiplier =
		input.qualityPass === "pass" ? 1.0 : input.qualityPass === "marginal" ? 0.5 : 0;

	const momentumProxy = Math.max(0, Math.min(100, (input.changePercentage + 10) * (100 / 30)));

	const recencyDecay = Math.max(0, 1 - (input.daysSinceResearch / 7) * 0.05);

	const score = qualityMultiplier * momentumProxy * recencyDecay;
	return Math.max(0, Math.min(100, score));
}

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
	const rawData = r.rawData ? (JSON.parse(r.rawData) as Record<string, unknown>) : null;

	const lastResearched = r.createdAt ? new Date(r.createdAt) : new Date();
	const daysSinceResearch = (Date.now() - lastResearched.getTime()) / (1000 * 60 * 60 * 24);

	const clampedScore = computeScore({
		qualityPass: (rawData?.quality_pass as ScoreInput["qualityPass"]) ?? null,
		changePercentage:
			(rawData?.changePercentage as number) ??
			((rawData?.quote as Record<string, unknown>)?.changePercentage as number) ??
			0,
		daysSinceResearch,
	});

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

/** Decay scores for stale watchlist entries — call at start of research pipeline */
export async function decayScores(): Promise<void> {
	const db = getDb();
	const items = await db.select().from(watchlist).where(eq(watchlist.active, true));

	const now = Date.now();
	let decayed = 0;
	let deactivated = 0;

	for (const item of items) {
		if (!item.lastResearchedAt) continue;
		const daysSinceResearch =
			(now - new Date(item.lastResearchedAt).getTime()) / (1000 * 60 * 60 * 24);
		const decayPoints = Math.floor(daysSinceResearch / 7) * 5;
		if (decayPoints <= 0) continue;

		const newScore = Math.max(0, (item.score ?? 0) - decayPoints);

		if (newScore < 10) {
			await db
				.update(watchlist)
				.set({ active: false, score: newScore })
				.where(eq(watchlist.id, item.id));
			deactivated++;
		} else {
			await db.update(watchlist).set({ score: newScore }).where(eq(watchlist.id, item.id));
			decayed++;
		}
	}

	if (decayed > 0 || deactivated > 0) {
		log.info({ decayed, deactivated }, "Watchlist score decay applied");
	}
}

/** Get symbols that need research (not researched in 24h), prioritized */
export async function getStaleSymbols(): Promise<string[]> {
	const db = getDb();

	const items = await db
		.select({
			symbol: watchlist.symbol,
			score: watchlist.score,
			lastResearchedAt: watchlist.lastResearchedAt,
		})
		.from(watchlist)
		.where(eq(watchlist.active, true));

	const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
	const stale = items.filter((i) => !i.lastResearchedAt || i.lastResearchedAt < oneDayAgo);

	// Prioritize: held positions first, then by score desc, then stalest first
	const heldPositions = await db.select({ symbol: positions.symbol }).from(positions);
	const heldSet = new Set(heldPositions.map((p) => p.symbol));

	stale.sort((a, b) => {
		const aHeld = heldSet.has(a.symbol) ? 0 : 1;
		const bHeld = heldSet.has(b.symbol) ? 0 : 1;
		if (aHeld !== bHeld) return aHeld - bHeld;
		if ((b.score ?? 0) !== (a.score ?? 0)) return (b.score ?? 0) - (a.score ?? 0);
		return (a.lastResearchedAt ?? "").localeCompare(b.lastResearchedAt ?? "");
	});

	return stale.map((i) => i.symbol);
}
