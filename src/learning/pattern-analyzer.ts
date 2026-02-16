import Anthropic from "@anthropic-ai/sdk";
import { desc, gte } from "drizzle-orm";
import { getConfig } from "../config.ts";
import { getDb } from "../db/client.ts";
import { dailySnapshots, tradeReviews, watchlist, weeklyInsights } from "../db/schema.ts";
import { createChildLogger } from "../utils/logger.ts";
import { recordUsage } from "../utils/token-tracker.ts";
import { PATTERN_ANALYZER_SYSTEM } from "./prompts.ts";

const log = createChildLogger({ module: "pattern-analyzer" });

interface InsightResult {
	category:
		| "confidence_calibration"
		| "sector_performance"
		| "timing"
		| "risk_management"
		| "general";
	insight: string;
	actionable: string;
	severity: "info" | "warning" | "critical";
	data: Record<string, unknown>;
}

function getWeekStart(): string {
	const now = new Date();
	const day = now.getDay();
	const diff = day === 0 ? 6 : day - 1; // Monday = 0
	const monday = new Date(now);
	monday.setDate(now.getDate() - diff);
	return monday.toISOString().split("T")[0]!;
}

export async function runPatternAnalysis(runType: "mid_week" | "end_of_week"): Promise<void> {
	log.info({ runType }, "Pattern analysis starting");
	const db = getDb();
	const config = getConfig();

	const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

	// Get recent trade reviews
	const reviews = await db
		.select()
		.from(tradeReviews)
		.where(gte(tradeReviews.createdAt, sevenDaysAgo))
		.orderBy(desc(tradeReviews.createdAt));

	if (reviews.length < 1) {
		log.info("No trade reviews for pattern analysis");
		return;
	}

	// Get daily snapshots for the period
	const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0]!;
	const snapshots = await db.select().from(dailySnapshots).where(gte(dailySnapshots.date, cutoff));

	// Get watchlist for sector mapping
	const watchlistItems = await db.select().from(watchlist);
	const sectorMap = new Map(watchlistItems.map((w) => [w.symbol, w.sector ?? "Unknown"]));

	// Calculate confidence calibration
	const buckets: Record<string, { wins: number; total: number }> = {
		"0.7-0.8": { wins: 0, total: 0 },
		"0.8-0.9": { wins: 0, total: 0 },
		"0.9-1.0": { wins: 0, total: 0 },
	};

	for (const r of reviews) {
		const conf = r.confidence ?? 0;
		const bucket =
			conf >= 0.9 ? "0.9-1.0" : conf >= 0.8 ? "0.8-0.9" : conf >= 0.7 ? "0.7-0.8" : null;
		if (!bucket) continue;
		buckets[bucket]!.total++;
		if (r.outcome === "win") buckets[bucket]!.wins++;
	}

	const confidenceCalibration = Object.entries(buckets).map(([range, data]) => ({
		range,
		winRate: data.total > 0 ? data.wins / data.total : 0,
		sampleSize: data.total,
	}));

	// Calculate sector breakdown
	const sectorStats: Record<string, { wins: number; losses: number; totalPnl: number }> = {};
	for (const r of reviews) {
		const sector = sectorMap.get(r.symbol) ?? "Unknown";
		if (!sectorStats[sector]) sectorStats[sector] = { wins: 0, losses: 0, totalPnl: 0 };
		if (r.outcome === "win") sectorStats[sector].wins++;
		if (r.outcome === "loss") sectorStats[sector].losses++;
		sectorStats[sector].totalPnl += r.pnl ?? 0;
	}

	const sectorBreakdown = Object.entries(sectorStats).map(([sector, data]) => ({
		sector,
		winRate: data.wins + data.losses > 0 ? data.wins / (data.wins + data.losses) : 0,
		avgPnl: data.wins + data.losses > 0 ? data.totalPnl / (data.wins + data.losses) : 0,
		trades: data.wins + data.losses,
	}));

	// Calculate tag frequency in wins vs losses
	const tagWins: Record<string, number> = {};
	const tagLosses: Record<string, number> = {};
	for (const r of reviews) {
		const tags = JSON.parse(r.tags) as string[];
		for (const tag of tags) {
			if (r.outcome === "win") tagWins[tag] = (tagWins[tag] ?? 0) + 1;
			if (r.outcome === "loss") tagLosses[tag] = (tagLosses[tag] ?? 0) + 1;
		}
	}

	const allTags = new Set([...Object.keys(tagWins), ...Object.keys(tagLosses)]);
	const tagAnalysis = [...allTags].map((tag) => ({
		tag,
		wins: tagWins[tag] ?? 0,
		losses: tagLosses[tag] ?? 0,
	}));

	const prompt = `Analyze these accumulated trading data for a UK ISA portfolio:

## Trade Reviews (${reviews.length} trades)
${JSON.stringify(
	reviews.map((r) => ({
		symbol: r.symbol,
		side: r.side,
		pnl: r.pnl,
		confidence: r.confidence,
		outcome: r.outcome,
		reasoningQuality: r.reasoningQuality,
		lesson: r.lessonLearned,
		tags: JSON.parse(r.tags),
		shouldRepeat: r.shouldRepeat,
	})),
	null,
	2,
)}

## Confidence Calibration
${JSON.stringify(confidenceCalibration, null, 2)}

## Sector Breakdown
${JSON.stringify(sectorBreakdown, null, 2)}

## Tag Analysis (wins vs losses)
${JSON.stringify(tagAnalysis, null, 2)}

## Daily Snapshots
${JSON.stringify(
	snapshots.map((s) => ({ date: s.date, value: s.portfolioValue, dailyPnl: s.dailyPnl })),
	null,
	2,
)}

Return a JSON array of up to 5 insights.`;

	try {
		const client = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });

		const response = await client.messages.create({
			model: config.CLAUDE_MODEL_STANDARD,
			max_tokens: 2048,
			system: [
				{ type: "text", text: PATTERN_ANALYZER_SYSTEM, cache_control: { type: "ephemeral" } },
			],
			messages: [{ role: "user", content: prompt }],
		});

		await recordUsage(
			"pattern_analyzer",
			response.usage.input_tokens,
			response.usage.output_tokens,
			response.usage.cache_creation_input_tokens ?? undefined,
			response.usage.cache_read_input_tokens ?? undefined,
		);

		const text = response.content
			.filter((b): b is Anthropic.TextBlock => b.type === "text")
			.map((b) => b.text)
			.join("");

		const jsonMatch = text.match(/\[[\s\S]*\]/);
		if (!jsonMatch) {
			log.warn("No JSON array in pattern analysis response");
			return;
		}

		const insights = JSON.parse(jsonMatch[0]) as InsightResult[];
		const weekStart = getWeekStart();

		for (const insight of insights.slice(0, 5)) {
			await db.insert(weeklyInsights).values({
				weekStart,
				runType,
				category: insight.category,
				insight: insight.insight,
				actionable: insight.actionable,
				severity: insight.severity,
				data: JSON.stringify(insight.data),
			});
		}

		log.info({ runType, insightCount: insights.length }, "Pattern analysis complete");
	} catch (error) {
		log.error({ error }, "Pattern analysis failed");
	}
}
