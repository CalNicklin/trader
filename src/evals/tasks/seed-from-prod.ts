import { and, desc, eq, gte, isNotNull, like, lt } from "drizzle-orm";

import type { EvalTask } from "../types.ts";

function safeJsonParse(raw: string | null): Record<string, unknown> | null {
	if (!raw) return null;
	try {
		const parsed: unknown = JSON.parse(raw);
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
			return parsed as Record<string, unknown>;
		}
		return null;
	} catch {
		return null;
	}
}

function oneMinuteBefore(iso: string): string {
	const d = new Date(iso);
	d.setMinutes(d.getMinutes() - 1);
	return d.toISOString();
}

function fiveMinutesAfter(iso: string): string {
	const d = new Date(iso);
	d.setMinutes(d.getMinutes() + 5);
	return d.toISOString();
}

/**
 * Derive hasStopLossBreach / isRoutineTick flags from scan context text.
 * The scan context is a multi-line string built in orchestrator.ts.
 */
function deriveScanFlags(context: string): {
	hasStopLossBreach: boolean;
	isRoutineTick: boolean;
} {
	const lower = context.toLowerCase();
	const hasStopLossBreach =
		lower.includes("stop loss triggered") || lower.includes("stop-loss breach");
	const isRoutineTick =
		lower.includes("none — routine monitoring tick") || lower.includes("notable changes: none");
	return { hasStopLossBreach, isRoutineTick };
}

/**
 * Load frozen Quick Scan eval tasks from production data.
 * Seeded from "Quick scan:" messages logged by the Haiku triage step,
 * with surrounding gate evaluation logs for context reconstruction.
 */
export async function loadQuickScanTasks(): Promise<readonly EvalTask[]> {
	const { getDb } = await import("../../db/client.ts");
	const { agentLogs } = await import("../../db/schema.ts");
	const db = getDb();

	const rows = await db
		.select()
		.from(agentLogs)
		.where(
			and(
				like(agentLogs.message, "Quick scan:%"),
				eq(agentLogs.phase, "trading"),
				eq(agentLogs.level, "INFO"),
			),
		)
		.orderBy(desc(agentLogs.createdAt))
		.limit(20);

	const tasks: EvalTask[] = [];

	for (const row of rows) {
		const windowStart = oneMinuteBefore(row.createdAt);
		const surroundingLogs = await db
			.select()
			.from(agentLogs)
			.where(
				and(
					gte(agentLogs.createdAt, windowStart),
					lt(agentLogs.createdAt, row.createdAt),
					eq(agentLogs.phase, "trading"),
				),
			)
			.orderBy(desc(agentLogs.createdAt))
			.limit(30);

		const gateEntries = surroundingLogs.filter((l) => {
			const parsed = safeJsonParse(l.data);
			return parsed?.type === "gate_evaluation";
		});

		let scanContext: string;

		if (gateEntries.length > 0) {
			const gateData = gateEntries
				.map((g) => {
					const parsed = safeJsonParse(g.data);
					return parsed
						? `${parsed.symbol}: ${parsed.passed ? "PASS" : "FAIL"} — ${
								Array.isArray(parsed.reasons)
									? (parsed.reasons as unknown[]).join(", ")
									: "no reasons"
							}`
						: g.message;
				})
				.join("\n");

			const contextParts = surroundingLogs
				.filter((l) => !l.message.startsWith("Gate "))
				.map((l) => l.message);

			scanContext = [...contextParts, `Gate results:\n${gateData}`].join("\n");
		} else {
			scanContext = surroundingLogs.map((l) => l.message).join("\n");
		}

		if (!scanContext) continue;

		const { hasStopLossBreach, isRoutineTick } = deriveScanFlags(scanContext);

		tasks.push({
			id: `qs-${row.id}`,
			suite: "quick_scan",
			input: { context: scanContext, hasStopLossBreach, isRoutineTick },
			metadata: { type: "regression", sourceLogId: row.id },
		});
	}

	return tasks;
}

/**
 * Load frozen Trading Analyst eval tasks from production data.
 * Seeded from agent_logs DECISION entries with data.quotes/gateStates.
 */
export async function loadTradingAnalystTasks(): Promise<readonly EvalTask[]> {
	const { getDb } = await import("../../db/client.ts");
	const { agentLogs, escalationState } = await import("../../db/schema.ts");
	const db = getDb();

	const rows = await db
		.select()
		.from(agentLogs)
		.where(and(eq(agentLogs.level, "DECISION"), eq(agentLogs.phase, "trading")))
		.orderBy(desc(agentLogs.createdAt))
		.limit(10);

	const tasks: EvalTask[] = [];

	for (const row of rows) {
		const data = safeJsonParse(row.data);
		if (!data) continue;

		const windowEnd = fiveMinutesAfter(row.createdAt);
		const escalations = await db
			.select()
			.from(escalationState)
			.where(
				and(
					gte(escalationState.createdAt, row.createdAt),
					lt(escalationState.createdAt, windowEnd),
				),
			)
			.orderBy(desc(escalationState.createdAt))
			.limit(1);

		const conclusion = escalations[0]?.conclusion ?? "unknown";

		const quotes = data.quotes ?? null;
		const gateStates = data.gateStates ?? null;

		tasks.push({
			id: `ta-${row.id}`,
			suite: "trading_analyst",
			input: {
				context: row.data ?? JSON.stringify(data),
				conclusion,
				...(quotes !== null ? { quotes } : {}),
				...(gateStates !== null ? { gateStates } : {}),
			},
			metadata: { type: "regression", sourceLogId: row.id },
		});
	}

	return tasks;
}

/**
 * Load frozen Research Analyzer eval tasks from production data.
 * Seeded from research table entries with rawData.
 */
export async function loadResearchTasks(): Promise<readonly EvalTask[]> {
	const { getDb } = await import("../../db/client.ts");
	const { research, watchlist } = await import("../../db/schema.ts");
	const db = getDb();

	const rows = await db
		.select()
		.from(research)
		.where(isNotNull(research.rawData))
		.orderBy(desc(research.createdAt))
		.limit(15);

	const tasks: EvalTask[] = [];

	for (const row of rows) {
		const rawData = safeJsonParse(row.rawData);
		if (!rawData) continue;

		const [watchlistRow] = await db
			.select({ exchange: watchlist.exchange })
			.from(watchlist)
			.where(eq(watchlist.symbol, row.symbol))
			.limit(1);

		tasks.push({
			id: `res-${row.id}`,
			suite: "research",
			input: {
				rawData,
				symbol: row.symbol,
				exchange: watchlistRow?.exchange ?? "LSE",
			},
			expectedBehavior: `suggestedAction=${row.suggestedAction ?? "unknown"} confidence=${row.confidence ?? 0}`,
			metadata: {
				type: "regression",
				sourceId: row.id,
				actualSentiment: row.sentiment,
				actualAction: row.suggestedAction,
				actualConfidence: row.confidence,
			},
		});
	}

	return tasks;
}

/**
 * Load News Discovery eval tasks from live RSS feeds.
 * These are capability evals (not regression) since the production pipeline
 * doesn't persist the original headlines sent to Claude.
 */
export async function loadNewsDiscoveryTasks(): Promise<readonly EvalTask[]> {
	const { fetchNews } = await import("../../research/sources/news-scraper.ts");

	const allNews = await fetchNews(5);
	if (allNews.length === 0) return [];

	const batchSize = 15;
	const tasks: EvalTask[] = [];

	for (let i = 0; i < allNews.length; i += batchSize) {
		const batch = allNews.slice(i, i + batchSize);
		const headlines = batch.map((n) => `- ${n.title} (${n.source})`).join("\n");

		tasks.push({
			id: `news-live-${i}`,
			suite: "news_discovery",
			input: { headlines },
			metadata: { type: "capability", batchStart: i, batchSize: batch.length },
		});

		if (tasks.length >= 5) break;
	}

	return tasks;
}
