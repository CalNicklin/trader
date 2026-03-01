import { and, desc, eq, gte, sql } from "drizzle-orm";
import { getConfig } from "../config.ts";
import type { DbClient } from "../db/client.ts";
import { getDb } from "../db/client.ts";
import { tokenUsage } from "../db/schema.ts";

const MIN_ESTIMATED_SESSION_COST = 0.2;
const SAFETY_MARGIN = 1.5;
const RECENT_SESSION_COUNT = 5;

export async function getDailySpend(db?: DbClient): Promise<number> {
	const d = db ?? getDb();
	const todayStart = new Date();
	todayStart.setUTCHours(0, 0, 0, 0);

	const [row] = await d
		.select({ total: sql<number>`coalesce(sum(${tokenUsage.estimatedCostUsd}), 0)` })
		.from(tokenUsage)
		.where(gte(tokenUsage.createdAt, todayStart.toISOString()));

	return row?.total ?? 0;
}

export async function getEstimatedSessionCost(db?: DbClient): Promise<number> {
	const d = db ?? getDb();

	const recent = d
		.select({ estimatedCostUsd: tokenUsage.estimatedCostUsd })
		.from(tokenUsage)
		.where(and(eq(tokenUsage.job, "trading_analyst"), eq(tokenUsage.status, "complete")))
		.orderBy(desc(tokenUsage.createdAt))
		.limit(RECENT_SESSION_COUNT)
		.as("recent");

	const [row] = await d
		.select({ avgCost: sql<number>`coalesce(avg(${recent.estimatedCostUsd}), 0)` })
		.from(recent);

	const avgCost = row?.avgCost ? Number(row.avgCost) : 0;
	return Math.max(avgCost * SAFETY_MARGIN, MIN_ESTIMATED_SESSION_COST);
}

export async function canAffordSonnet(db?: DbClient): Promise<boolean> {
	const config = getConfig();
	const d = db ?? getDb();
	const [spent, estimated] = await Promise.all([getDailySpend(d), getEstimatedSessionCost(d)]);
	return spent + estimated < config.DAILY_API_BUDGET_USD;
}
