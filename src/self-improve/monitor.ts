import Anthropic from "@anthropic-ai/sdk";
import { desc, gte } from "drizzle-orm";
import { setPaused } from "../agent/orchestrator.ts";
import {
	SELF_IMPROVEMENT_SYSTEM,
	WEEKLY_REVIEW_PROMPT,
} from "../agent/prompts/self-improvement.ts";
import { getConfig } from "../config.ts";
import { getDb } from "../db/client.ts";
import {
	dailySnapshots,
	improvementProposals,
	tradeReviews,
	trades,
	weeklyInsights,
} from "../db/schema.ts";
import { sendEmail } from "../reporting/email.ts";
import { calculateMetrics } from "../reporting/metrics.ts";
import { HARD_LIMITS } from "../risk/limits.ts";
import { createChildLogger } from "../utils/logger.ts";
import { wilsonLower } from "../utils/stats.ts";
import { recordUsage } from "../utils/token-tracker.ts";
import { generateCodeChange } from "./code-generator.ts";
import { createPR } from "./github.ts";

const log = createChildLogger({ module: "self-improve" });

const MAX_PRS_PER_WEEK = 2;

/** Allowed files for self-improvement changes */
const ALLOWED_FILES = [
	"src/agent/prompts/trading-analyst.ts",
	"src/agent/prompts/risk-reviewer.ts",
	"src/agent/prompts/self-improvement.ts",
	"src/research/watchlist.ts",
];

export async function runSelfImprovement(): Promise<void> {
	log.info("Self-improvement analysis starting");
	const db = getDb();

	try {
		// Check PR rate limit
		const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
		const recentProposals = await db
			.select()
			.from(improvementProposals)
			.where(gte(improvementProposals.createdAt, weekAgo));

		const prCount = recentProposals.filter(
			(p) => p.status === "PR_CREATED" || p.status === "MERGED",
		).length;
		if (prCount >= MAX_PRS_PER_WEEK) {
			log.info({ prCount }, "PR rate limit reached, skipping self-improvement");
			return;
		}

		// Check for poor performance - pause if necessary
		const shouldPause = await checkPerformancePause();
		if (shouldPause) return;

		// Gather performance data
		const metrics = await calculateMetrics(7);
		const allTimeMetrics = await calculateMetrics(90);

		const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000)
			.toISOString()
			.split("T")[0]!;
		const recentTrades = await db
			.select()
			.from(trades)
			.where(gte(trades.createdAt, twoWeeksAgo))
			.orderBy(desc(trades.createdAt))
			.limit(50);

		// Get accumulated insights and trade reviews
		const recentInsights = await db
			.select()
			.from(weeklyInsights)
			.where(gte(weeklyInsights.createdAt, twoWeeksAgo))
			.orderBy(desc(weeklyInsights.createdAt));

		const recentReviews = await db
			.select()
			.from(tradeReviews)
			.where(gte(tradeReviews.createdAt, twoWeeksAgo))
			.orderBy(desc(tradeReviews.createdAt));

		const performanceData = `
## Weekly Metrics
${JSON.stringify(metrics, null, 2)}

## All-Time Metrics (90 days)
${JSON.stringify(allTimeMetrics, null, 2)}

## Recent Trades (last 2 weeks)
${JSON.stringify(recentTrades, null, 2)}

## Accumulated Insights
${JSON.stringify(recentInsights, null, 2)}

## Trade Reviews
${JSON.stringify(recentReviews, null, 2)}

## Allowed Files for Changes
${ALLOWED_FILES.join("\n")}
`;

		// Ask Claude for improvement suggestions
		const config = getConfig();
		const client = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });

		const response = await client.messages.create({
			model: config.CLAUDE_MODEL,
			max_tokens: 4096,
			system: [
				{ type: "text", text: SELF_IMPROVEMENT_SYSTEM, cache_control: { type: "ephemeral" } },
			],
			messages: [{ role: "user", content: WEEKLY_REVIEW_PROMPT(performanceData) }],
		});

		await recordUsage(
			"self_improvement",
			response.usage.input_tokens,
			response.usage.output_tokens,
			response.usage.cache_creation_input_tokens ?? undefined,
			response.usage.cache_read_input_tokens ?? undefined,
		);

		const text = response.content
			.filter((b): b is Anthropic.TextBlock => b.type === "text")
			.map((b) => b.text)
			.join("\n");

		log.info({ responseLength: text.length }, "Self-improvement analysis complete");

		// Parse proposals and create PRs
		const proposals = parseProposals(text);

		for (const proposal of proposals.slice(0, MAX_PRS_PER_WEEK - prCount)) {
			if (!ALLOWED_FILES.includes(proposal.file)) {
				log.warn({ file: proposal.file }, "Proposed file change not in allowed list, skipping");
				continue;
			}

			try {
				const change = await generateCodeChange(proposal.file, proposal.description);
				if (!change) continue;

				const prUrl = await createPR({
					title: proposal.title,
					description: proposal.description,
					branch: `self-improve/${Date.now()}`,
					changes: [{ path: proposal.file, content: change }],
				});

				if (prUrl) {
					await db.insert(improvementProposals).values({
						title: proposal.title,
						description: proposal.description,
						filesChanged: proposal.file,
						prUrl,
						status: "PR_CREATED",
					});
					log.info({ title: proposal.title, prUrl }, "Improvement PR created");
				}
			} catch (error) {
				log.error({ title: proposal.title, error }, "Failed to create improvement PR");
			}
		}
	} catch (error) {
		log.error({ error }, "Self-improvement failed");
	}
}

interface Proposal {
	title: string;
	description: string;
	file: string;
}

function parseProposals(text: string): Proposal[] {
	const proposals: Proposal[] = [];

	// Look for structured proposals in the text
	const proposalBlocks = text.split(/(?=##\s*Proposal|Finding:)/i);

	for (const block of proposalBlocks) {
		const titleMatch = block.match(/(?:Proposal|Finding):\s*(.+)/i);
		const fileMatch = block.match(/File:\s*(.+)/i);
		const descMatch = block.match(
			/(?:Description|Proposal|Expected Improvement):\s*(.+(?:\n(?!File:|Finding:|##).+)*)/i,
		);

		if (titleMatch && fileMatch) {
			proposals.push({
				title: titleMatch[1]!.trim(),
				description: descMatch?.[1]?.trim() ?? block.trim(),
				file: fileMatch[1]!.trim(),
			});
		}
	}

	return proposals;
}

/** Check if we should pause trading due to poor performance */
async function checkPerformancePause(): Promise<boolean> {
	const db = getDb();

	// Get last N weeks of snapshots
	const threeWeeksAgo = new Date(Date.now() - 21 * 24 * 60 * 60 * 1000)
		.toISOString()
		.split("T")[0]!;
	const snapshots = await db
		.select()
		.from(dailySnapshots)
		.where(gte(dailySnapshots.date, threeWeeksAgo))
		.orderBy(dailySnapshots.date);

	if (snapshots.length < 10) return false; // Not enough data

	// Calculate win rates for last 2 weeks
	const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
	const recentTrades = await db.select().from(trades).where(gte(trades.createdAt, twoWeeksAgo));

	const wins = recentTrades.filter((t) => t.pnl !== null && t.pnl > 0).length;
	const total = recentTrades.filter((t) => t.pnl !== null).length;

	const winRate = total > 0 ? wins / total : 1;
	const wilsonBound = wilsonLower(wins, total);

	if (wilsonBound < HARD_LIMITS.PAUSE_WIN_RATE_THRESHOLD && total >= 5) {
		log.warn(
			{ winRate, wilsonBound, total },
			"Wilson lower bound below threshold - pausing trading",
		);
		setPaused(true);

		await sendEmail({
			subject: "ALERT: Trading Paused - Poor Performance",
			html: `
<h2>Trading has been automatically paused</h2>
<p>Win rate over the last 2 weeks: <strong>${(winRate * 100).toFixed(1)}%</strong> (Wilson lower bound: ${(wilsonBound * 100).toFixed(1)}%, threshold: ${HARD_LIMITS.PAUSE_WIN_RATE_THRESHOLD * 100}%)</p>
<p>Total trades: ${total} | Wins: ${wins} | Losses: ${total - wins}</p>
<p>Please review performance and manually restart when ready.</p>
			`.trim(),
		});

		return true;
	}

	return false;
}
