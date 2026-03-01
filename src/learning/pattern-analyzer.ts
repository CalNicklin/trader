import Anthropic from "@anthropic-ai/sdk";
import { desc, eq, gte, not } from "drizzle-orm";
import { getConfig } from "../config.ts";
import { getDb } from "../db/client.ts";
import {
	dailySnapshots,
	decisionScores,
	strategyHypotheses,
	tradeReviews,
	watchlist,
	weeklyInsights,
} from "../db/schema.ts";
import { createChildLogger } from "../utils/logger.ts";
import { recordUsage } from "../utils/token-tracker.ts";
import { checkPromotionThresholds } from "./hypothesis-gates.ts";
import { PATTERN_ANALYZER_SYSTEM } from "./prompts.ts";

const log = createChildLogger({ module: "pattern-analyzer" });

export type InsightCategory =
	| "confidence_calibration"
	| "sector_performance"
	| "timing"
	| "risk_management"
	| "momentum_compliance"
	| "holding_asymmetry"
	| "general";

interface InsightResult {
	category: InsightCategory;
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

	// Decision scores from the last 7 days (Phase 3)
	const decisionScoreRows = await db
		.select()
		.from(decisionScores)
		.where(gte(decisionScores.createdAt, sevenDaysAgo));

	const missedOpps = decisionScoreRows.filter((d) => d.score === "missed_opportunity");
	const goodAvoids = decisionScoreRows.filter((d) => d.score === "good_avoid");
	const goodHolds = decisionScoreRows.filter((d) => d.score === "good_hold");
	const goodPasses = decisionScoreRows.filter((d) => d.score === "good_pass");

	// Per-signal effectiveness: group by signal regime
	const signalEffectiveness: Record<string, { wins: number; losses: number; total: number }> = {};
	for (const d of decisionScoreRows) {
		if (!d.signalState) continue;
		try {
			const signals = JSON.parse(d.signalState) as Record<string, unknown>;
			const trend = signals.trendAlignment as string | undefined;
			const rsiRegime = signals.rsiRegime as string | undefined;
			if (trend) {
				const key = `trend_alignment=${trend}`;
				if (!signalEffectiveness[key]) signalEffectiveness[key] = { wins: 0, losses: 0, total: 0 };
				signalEffectiveness[key].total++;
				if (d.score === "good_hold" || d.score === "good_avoid" || d.score === "good_pass") {
					signalEffectiveness[key].wins++;
				} else if (d.score === "missed_opportunity") {
					signalEffectiveness[key].losses++;
				}
			}
			if (rsiRegime) {
				const key = `rsi_regime=${rsiRegime}`;
				if (!signalEffectiveness[key]) signalEffectiveness[key] = { wins: 0, losses: 0, total: 0 };
				signalEffectiveness[key].total++;
				if (d.score === "good_hold" || d.score === "good_avoid" || d.score === "good_pass") {
					signalEffectiveness[key].wins++;
				} else if (d.score === "missed_opportunity") {
					signalEffectiveness[key].losses++;
				}
			}
		} catch {
			// ignore parse errors
		}
	}

	// AI override hit rate: gate-qualified stocks where AI passed
	const aiOverrides = decisionScoreRows.filter(
		(d) => d.gateResult === "passed" && (d.statedAction === "WATCH" || d.statedAction === "PASS"),
	);
	const aiOverrideCorrect = aiOverrides.filter(
		(d) => d.score === "good_avoid" || d.score === "good_pass",
	);
	const aiOverrideIncorrect = aiOverrides.filter((d) => d.score === "missed_opportunity");

	let decisionQualitySection = "";
	if (decisionScoreRows.length > 0) {
		const cautionRatio =
			decisionScoreRows.length > 0
				? ((missedOpps.length / decisionScoreRows.length) * 100).toFixed(0)
				: "0";
		const goodAvoidRatio =
			decisionScoreRows.length > 0
				? ((goodAvoids.length / decisionScoreRows.length) * 100).toFixed(0)
				: "0";

		decisionQualitySection = `

## Decision Quality + Signal Effectiveness (${decisionScoreRows.length} scored decisions)
- Missed opportunities: ${missedOpps.length} (stocks passed on that rallied >5%)
${missedOpps.map((d) => `  - ${d.symbol}: passed at ${d.priceAtDecision.toFixed(1)}p, now ${d.priceNow.toFixed(1)}p (+${d.changePct.toFixed(1)}%) — ${d.lesson ?? d.reason ?? "no lesson"}`).join("\n")}
- Good avoids: ${goodAvoids.length} (stocks passed on that dropped >3%)
- Good holds: ${goodHolds.length}
- Good passes: ${goodPasses.length}
- Caution ratio: ${cautionRatio}% missed vs ${goodAvoidRatio}% good avoid

### Per-Signal Effectiveness
${Object.entries(signalEffectiveness)
	.map(
		([key, data]) =>
			`- ${key}: ${data.total > 0 ? ((data.wins / data.total) * 100).toFixed(0) : 0}% good decisions (n=${data.total})`,
	)
	.join("\n")}

### AI Override Hit Rate (gate-qualified stocks where AI passed)
- Total AI overrides: ${aiOverrides.length}
- Correct passes (good avoid/pass): ${aiOverrideCorrect.length}
- Incorrect passes (missed opportunity): ${aiOverrideIncorrect.length}
${aiOverrideIncorrect.map((d) => `  - ${d.symbol}: AI passed because "${d.aiOverrideReason ?? "unknown"}", stock moved +${d.changePct.toFixed(1)}%`).join("\n")}`;
	}

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
${decisionQualitySection}
${await buildHypothesesContext(db)}

Return a JSON object with "insights" and "hypotheses" arrays.`;

	try {
		const client = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });

		const response = await client.messages.create({
			model: config.CLAUDE_MODEL_STANDARD,
			max_tokens: 3072,
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

		// Parse response — try object format first (new), fall back to array (legacy)
		let insights: InsightResult[] = [];
		let hypothesisUpdates: HypothesisUpdate[] = [];

		const objectMatch = text.match(/\{[\s\S]*\}/);
		if (objectMatch) {
			try {
				const parsed = JSON.parse(objectMatch[0]) as {
					insights?: InsightResult[];
					hypotheses?: HypothesisUpdate[];
				};
				insights = parsed.insights ?? [];
				hypothesisUpdates = parsed.hypotheses ?? [];
			} catch {
				// Fall back to array format
				const arrayMatch = text.match(/\[[\s\S]*\]/);
				if (arrayMatch) {
					insights = JSON.parse(arrayMatch[0]) as InsightResult[];
				}
			}
		} else {
			const arrayMatch = text.match(/\[[\s\S]*\]/);
			if (arrayMatch) {
				insights = JSON.parse(arrayMatch[0]) as InsightResult[];
			}
		}

		if (insights.length === 0 && hypothesisUpdates.length === 0) {
			log.warn("No insights or hypotheses in pattern analysis response");
			return;
		}

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

		// Process hypothesis updates
		await processHypothesisUpdates(db, hypothesisUpdates);

		log.info(
			{ runType, insightCount: insights.length, hypothesisUpdates: hypothesisUpdates.length },
			"Pattern analysis complete",
		);
	} catch (error) {
		log.error({ error }, "Pattern analysis failed");
	}
}

interface HypothesisUpdate {
	action: "propose" | "update" | "reject";
	id: number | null;
	hypothesis: string;
	evidence: string;
	actionable: string;
	targetType?: "gate_param" | "prompt" | "risk_config";
	targetParam?: string | null;
	category: string;
	status: string;
	supportingTrades?: number;
	winRate?: number | null;
	championWinRate?: number | null;
	expectancy?: number | null;
	championExpectancy?: number | null;
	maxDrawdown?: number | null;
	championMaxDrawdown?: number | null;
	sampleSize?: number;
	rejectionReason?: string | null;
}

type DbClient = ReturnType<typeof getDb>;

async function buildHypothesesContext(db: DbClient): Promise<string> {
	const existing = await db
		.select()
		.from(strategyHypotheses)
		.where(not(eq(strategyHypotheses.status, "rejected")));

	if (existing.length === 0) return "";

	const formatted = existing.map((h) => {
		const target =
			h.targetType === "gate_param"
				? `[GATE: ${h.targetParam}]`
				: `[${(h.targetType ?? "prompt").toUpperCase()}]`;
		return `- ID ${h.id}: ${target} "${h.hypothesis}" (status: ${h.status}, n=${h.sampleSize}, WR=${((h.winRate ?? 0) * 100).toFixed(0)}%, exp=${h.expectancy?.toFixed(2) ?? "?"})`;
	});

	return `\n## Existing Strategy Hypotheses (evaluate these)\n${formatted.join("\n")}`;
}

async function processHypothesisUpdates(db: DbClient, updates: HypothesisUpdate[]): Promise<void> {
	for (const update of updates) {
		try {
			if (update.action === "propose") {
				await db.insert(strategyHypotheses).values({
					hypothesis: update.hypothesis,
					evidence: update.evidence,
					actionable: update.actionable,
					targetType: (update.targetType ?? "prompt") as "gate_param" | "prompt" | "risk_config",
					targetParam: update.targetParam ?? null,
					category: update.category as
						| "sector"
						| "timing"
						| "momentum"
						| "value"
						| "risk"
						| "sizing"
						| "general",
					status: "proposed",
					supportingTrades: update.supportingTrades ?? 0,
					winRate: update.winRate ?? null,
					sampleSize: update.sampleSize ?? 0,
				});
				log.info({ hypothesis: update.hypothesis }, "New hypothesis proposed");
			} else if (update.action === "update" && update.id) {
				let newStatus = update.status;

				// Enforce promotion gate: if trying to set CONFIRMED, verify thresholds
				if (newStatus === "confirmed") {
					const result = checkPromotionThresholds({
						sampleSize: update.sampleSize ?? 0,
						challengerWinRate: update.winRate ?? 0,
						championWinRate: update.championWinRate ?? 0,
						challengerExpectancy: update.expectancy ?? 0,
						championExpectancy: update.championExpectancy ?? 0,
						challengerMaxDrawdown: update.maxDrawdown ?? 0,
						championMaxDrawdown: update.championMaxDrawdown ?? 0,
					});

					if (!result.canPromote) {
						log.warn(
							{ id: update.id, reasons: result.reasons },
							"Promotion blocked — thresholds not met, keeping current status",
						);
						newStatus = "active";
					}
				}

				await db
					.update(strategyHypotheses)
					.set({
						evidence: update.evidence,
						status: newStatus as "proposed" | "active" | "confirmed" | "rejected",
						supportingTrades: update.supportingTrades ?? undefined,
						winRate: update.winRate ?? undefined,
						championWinRate: update.championWinRate ?? undefined,
						expectancy: update.expectancy ?? undefined,
						championExpectancy: update.championExpectancy ?? undefined,
						maxDrawdown: update.maxDrawdown ?? undefined,
						championMaxDrawdown: update.championMaxDrawdown ?? undefined,
						sampleSize: update.sampleSize ?? undefined,
						lastEvaluatedAt: new Date().toISOString(),
						statusChangedAt: newStatus !== "proposed" ? new Date().toISOString() : undefined,
					})
					.where(eq(strategyHypotheses.id, update.id));
				log.info({ id: update.id, status: newStatus }, "Hypothesis updated");
			} else if (update.action === "reject" && update.id) {
				await db
					.update(strategyHypotheses)
					.set({
						status: "rejected",
						rejectionReason: update.rejectionReason ?? null,
						lastEvaluatedAt: new Date().toISOString(),
						statusChangedAt: new Date().toISOString(),
					})
					.where(eq(strategyHypotheses.id, update.id));
				log.info({ id: update.id }, "Hypothesis rejected");
			}
		} catch (error) {
			log.error({ update, error }, "Failed to process hypothesis update");
		}
	}
}
