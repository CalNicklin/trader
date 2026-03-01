import { desc, eq, or } from "drizzle-orm";
import { getDb } from "../db/client.ts";
import { strategyHypotheses, tradeReviews, weeklyInsights } from "../db/schema.ts";

/** Build a learning brief for pre-market planning */
export async function buildLearningBrief(): Promise<string> {
	const db = getDb();

	// Latest weekly insights — prioritize by severity (critical > warning > info)
	const insights = await db
		.select()
		.from(weeklyInsights)
		.orderBy(desc(weeklyInsights.createdAt))
		.limit(15); // Fetch more, then sort by severity

	const severityOrder = { critical: 0, warning: 1, info: 2 };
	insights.sort(
		(a, b) =>
			(severityOrder[a.severity as keyof typeof severityOrder] ?? 2) -
			(severityOrder[b.severity as keyof typeof severityOrder] ?? 2),
	);
	// Keep all critical, fill remaining from warning then info up to 5
	const sortedInsights = insights.slice(0, 5);

	// Last 5 trade reviews with lessons
	const reviews = await db
		.select()
		.from(tradeReviews)
		.orderBy(desc(tradeReviews.createdAt))
		.limit(5);

	// Active and confirmed strategy hypotheses
	const hypotheses = await db
		.select()
		.from(strategyHypotheses)
		.where(or(eq(strategyHypotheses.status, "active"), eq(strategyHypotheses.status, "confirmed")))
		.orderBy(desc(strategyHypotheses.sampleSize));

	if (sortedInsights.length === 0 && reviews.length === 0 && hypotheses.length === 0) return "";

	const parts: string[] = ["## Learning Brief"];

	if (sortedInsights.length > 0) {
		parts.push("\n### Insights from recent analysis:");
		for (const i of sortedInsights) {
			const prefix =
				i.severity === "critical" ? "[CRITICAL] " : i.severity === "warning" ? "[WARNING] " : "";
			parts.push(`- ${prefix}${i.insight}`);
			parts.push(`  Action: ${i.actionable}`);
		}

		// Extract confidence calibration one-liner if available
		const calibration = sortedInsights.find((i) => i.category === "confidence_calibration");
		if (calibration) {
			parts.push(`\nConfidence calibration: ${calibration.insight}`);
		}
	}

	if (reviews.length > 0) {
		parts.push("\n### Recent trade lessons:");
		let againstMomentumCount = 0;
		let againstMomentumLosses = 0;
		for (const r of reviews) {
			parts.push(
				`- ${r.symbol} (${r.outcome}, reasoning: ${r.reasoningQuality}): ${r.lessonLearned}`,
			);
			const tags = JSON.parse(r.tags) as string[];
			if (tags.some((t) => t.includes("against-momentum") || t.includes("death-cross"))) {
				againstMomentumCount++;
				if (r.outcome === "loss") againstMomentumLosses++;
			}
		}
		if (againstMomentumCount > 0) {
			parts.push(
				`\n### Momentum compliance: ${againstMomentumCount}/${reviews.length} recent trades entered against momentum signals (${againstMomentumLosses} resulted in losses)`,
			);
		}
	}

	if (hypotheses.length > 0) {
		parts.push("\n### Strategy Journal (Active Hypotheses):");
		for (const h of hypotheses) {
			const prefix = h.status === "confirmed" ? "[CONFIRMED] " : "";
			parts.push(`- ${prefix}${h.hypothesis}`);
			parts.push(`  Action: ${h.actionable}`);
			parts.push(
				`  Evidence: ${h.evidence} (n=${h.sampleSize}, win rate=${((h.winRate ?? 0) * 100).toFixed(0)}%)`,
			);
		}
	}

	return parts.join("\n");
}

/** Build lighter context for mini-analysis (recent reviews + critical insights) */
export async function buildRecentContext(): Promise<string> {
	const db = getDb();

	// Last 3 trade reviews
	const reviews = await db
		.select()
		.from(tradeReviews)
		.orderBy(desc(tradeReviews.createdAt))
		.limit(3);

	// Any warning or critical severity insights
	const criticalInsights = await db
		.select()
		.from(weeklyInsights)
		.where(or(eq(weeklyInsights.severity, "warning"), eq(weeklyInsights.severity, "critical")))
		.orderBy(desc(weeklyInsights.createdAt))
		.limit(3);

	// Only confirmed hypotheses for lighter context
	const confirmedHypotheses = await db
		.select()
		.from(strategyHypotheses)
		.where(eq(strategyHypotheses.status, "confirmed"))
		.orderBy(desc(strategyHypotheses.sampleSize));

	if (reviews.length === 0 && criticalInsights.length === 0 && confirmedHypotheses.length === 0)
		return "";

	const parts: string[] = [];

	if (criticalInsights.length > 0) {
		parts.push("Active warnings:");
		for (const i of criticalInsights) {
			parts.push(`- [${i.severity.toUpperCase()}] ${i.actionable}`);
		}
	}

	if (confirmedHypotheses.length > 0) {
		parts.push("Confirmed strategy rules:");
		for (const h of confirmedHypotheses) {
			parts.push(`- [CONFIRMED] ${h.actionable} (${h.hypothesis}, n=${h.sampleSize})`);
		}
	}

	if (reviews.length > 0) {
		parts.push("Recent trade lessons:");
		for (const r of reviews) {
			parts.push(`- ${r.symbol} (${r.outcome}): ${r.lessonLearned}`);
		}
	}

	return parts.join("\n");
}
