import { gte, sql } from "drizzle-orm";
import { getDb } from "../db/client.ts";
import { tokenUsage } from "../db/schema.ts";

// Pricing per million tokens by model tier
const PRICING = {
	opus: { input: 15.0, output: 75.0, cacheWrite: 18.75, cacheRead: 1.5 },
	sonnet: { input: 3.0, output: 15.0, cacheWrite: 3.75, cacheRead: 0.3 },
	haiku: { input: 1.0, output: 5.0, cacheWrite: 1.25, cacheRead: 0.1 },
} as const;

// Jobs that use the primary (Opus) model
const OPUS_JOBS = new Set(["trading_analyst"]);

function estimateCost(
	job: string,
	inputTokens: number,
	outputTokens: number,
	cacheCreationTokens?: number,
	cacheReadTokens?: number,
): number {
	const p = OPUS_JOBS.has(job) ? PRICING.opus : PRICING.sonnet;
	// Cache tokens are already counted in inputTokens — subtract them to avoid double-counting,
	// then add back at their discounted rates
	const cacheWrite = cacheCreationTokens ?? 0;
	const cacheRead = cacheReadTokens ?? 0;
	const normalInput = inputTokens - cacheWrite - cacheRead;
	return (
		(normalInput * p.input +
			outputTokens * p.output +
			cacheWrite * p.cacheWrite +
			cacheRead * p.cacheRead) /
		1_000_000
	);
}

export async function recordUsage(
	job: string,
	inputTokens: number,
	outputTokens: number,
	cacheCreationTokens?: number,
	cacheReadTokens?: number,
): Promise<void> {
	const db = getDb();
	await db.insert(tokenUsage).values({
		job,
		inputTokens,
		outputTokens,
		estimatedCostUsd: estimateCost(
			job,
			inputTokens,
			outputTokens,
			cacheCreationTokens,
			cacheReadTokens,
		),
	});
}

export interface UsageSummary {
	totalInputTokens: number;
	totalOutputTokens: number;
	totalCostUsd: number;
	byJob: { job: string; inputTokens: number; outputTokens: number; costUsd: number }[];
}

export async function getUsageSummary(days: number): Promise<UsageSummary> {
	const db = getDb();
	const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

	const rows = await db
		.select({
			job: tokenUsage.job,
			inputTokens: sql<number>`sum(${tokenUsage.inputTokens})`,
			outputTokens: sql<number>`sum(${tokenUsage.outputTokens})`,
			costUsd: sql<number>`sum(${tokenUsage.estimatedCostUsd})`,
		})
		.from(tokenUsage)
		.where(gte(tokenUsage.createdAt, cutoff))
		.groupBy(tokenUsage.job);

	const byJob = rows.map((r) => ({
		job: r.job,
		inputTokens: r.inputTokens ?? 0,
		outputTokens: r.outputTokens ?? 0,
		costUsd: r.costUsd ?? 0,
	}));

	return {
		totalInputTokens: byJob.reduce((sum, r) => sum + r.inputTokens, 0),
		totalOutputTokens: byJob.reduce((sum, r) => sum + r.outputTokens, 0),
		totalCostUsd: byJob.reduce((sum, r) => sum + r.costUsd, 0),
		byJob,
	};
}
