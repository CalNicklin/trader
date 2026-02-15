import { desc, eq, or } from "drizzle-orm";
import { getDb } from "../db/client.ts";
import { tradeReviews, weeklyInsights } from "../db/schema.ts";

/** Build a learning brief for pre-market planning */
export async function buildLearningBrief(): Promise<string> {
	const db = getDb();

	// Latest weekly insights (up to 5)
	const insights = await db
		.select()
		.from(weeklyInsights)
		.orderBy(desc(weeklyInsights.createdAt))
		.limit(5);

	// Last 5 trade reviews with lessons
	const reviews = await db
		.select()
		.from(tradeReviews)
		.orderBy(desc(tradeReviews.createdAt))
		.limit(5);

	if (insights.length === 0 && reviews.length === 0) return "";

	const parts: string[] = ["## Learning Brief"];

	if (insights.length > 0) {
		parts.push("\n### Insights from recent analysis:");
		for (const i of insights) {
			const prefix =
				i.severity === "critical" ? "[CRITICAL] " : i.severity === "warning" ? "[WARNING] " : "";
			parts.push(`- ${prefix}${i.insight}`);
			parts.push(`  Action: ${i.actionable}`);
		}

		// Extract confidence calibration one-liner if available
		const calibration = insights.find((i) => i.category === "confidence_calibration");
		if (calibration) {
			parts.push(`\nConfidence calibration: ${calibration.insight}`);
		}
	}

	if (reviews.length > 0) {
		parts.push("\n### Recent trade lessons:");
		for (const r of reviews) {
			parts.push(
				`- ${r.symbol} (${r.outcome}, reasoning: ${r.reasoningQuality}): ${r.lessonLearned}`,
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

	if (reviews.length === 0 && criticalInsights.length === 0) return "";

	const parts: string[] = [];

	if (criticalInsights.length > 0) {
		parts.push("Active warnings:");
		for (const i of criticalInsights) {
			parts.push(`- [${i.severity.toUpperCase()}] ${i.actionable}`);
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
