import { gte, sql } from "drizzle-orm";
import { getDb } from "../db/client.ts";
import { tokenUsage } from "../db/schema.ts";

// Sonnet 4.5 pricing (per million tokens)
const INPUT_COST_PER_M = 3.0;
const OUTPUT_COST_PER_M = 15.0;

function estimateCost(inputTokens: number, outputTokens: number): number {
	return (inputTokens * INPUT_COST_PER_M + outputTokens * OUTPUT_COST_PER_M) / 1_000_000;
}

export async function recordUsage(
	job: string,
	inputTokens: number,
	outputTokens: number,
): Promise<void> {
	const db = getDb();
	await db.insert(tokenUsage).values({
		job,
		inputTokens,
		outputTokens,
		estimatedCostUsd: estimateCost(inputTokens, outputTokens),
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
