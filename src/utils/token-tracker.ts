import { gte, sql } from "drizzle-orm";
import { getDb } from "../db/client.ts";
import { tokenUsage } from "../db/schema.ts";
import { estimateCost } from "./cost.ts";

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
