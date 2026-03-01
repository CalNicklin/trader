import { and, gte, like, lt, lte, sql } from "drizzle-orm";
import type { DbClient } from "../db/client.ts";
import { agentLogs, escalationState, positions, tokenUsage } from "../db/schema.ts";

export interface EvalResult {
	name: string;
	passed: boolean;
	skipped?: boolean;
	detail: string;
	[key: string]: unknown;
}

const DUPLICATE_WINDOW_MS = 30 * 60_000;

/**
 * Waste reduction: no Sonnet sessions should have the same fingerprint
 * as a previous session within 30 minutes.
 */
export async function evalWasteReduction(
	db: DbClient,
	date: string,
): Promise<EvalResult & { duplicateCount: number }> {
	const d = db;
	const nextDate = nextDay(date);

	const rows = await d
		.select({
			fingerprint: escalationState.fingerprint,
			createdAt: escalationState.createdAt,
		})
		.from(escalationState)
		.where(and(gte(escalationState.createdAt, date), lt(escalationState.createdAt, nextDate)))
		.orderBy(escalationState.createdAt);

	let duplicateCount = 0;
	for (let i = 1; i < rows.length; i++) {
		const prev = rows[i - 1]!;
		const curr = rows[i]!;
		if (curr.fingerprint === prev.fingerprint) {
			const gap = new Date(curr.createdAt).getTime() - new Date(prev.createdAt).getTime();
			if (gap <= DUPLICATE_WINDOW_MS) {
				duplicateCount++;
			}
		}
	}

	return {
		name: "waste_reduction",
		passed: duplicateCount === 0,
		detail:
			duplicateCount === 0
				? `${rows.length} Sonnet sessions, no duplicate fingerprints within 30min`
				: `${duplicateCount} duplicate fingerprint(s) within 30min window`,
		duplicateCount,
	};
}

/**
 * Budget headroom: on days where the budget cap was NOT hit,
 * Sonnet session count should be 0–6 (gates doing the work, budget is just a backstop).
 */
export async function evalBudgetHeadroom(
	db: DbClient,
	date: string,
): Promise<EvalResult & { sessionCount: number; skipped?: boolean }> {
	const d = db;
	const nextDate = nextDay(date);

	const budgetSkips = await d
		.select({ id: agentLogs.id })
		.from(agentLogs)
		.where(
			and(
				gte(agentLogs.createdAt, date),
				lt(agentLogs.createdAt, nextDate),
				like(agentLogs.message, "%budget_exceeded%"),
			),
		);

	if (budgetSkips.length > 0) {
		return {
			name: "budget_headroom",
			passed: true,
			skipped: true,
			detail: "Budget cap was hit — eval not meaningful for this day",
			sessionCount: 0,
		};
	}

	const sessions = await d
		.select({ id: tokenUsage.id })
		.from(tokenUsage)
		.where(
			and(
				gte(tokenUsage.createdAt, date),
				lt(tokenUsage.createdAt, nextDate),
				sql`${tokenUsage.job} = 'trading_analyst'`,
			),
		);

	const sessionCount = sessions.length;
	const passed = sessionCount <= 6;

	return {
		name: "budget_headroom",
		passed,
		detail: passed
			? `${sessionCount} Sonnet sessions (within 0–6 range)`
			: `${sessionCount} Sonnet sessions — gates may not be working (expected 0–6)`,
		sessionCount,
	};
}

/**
 * Material-change sensitivity: when cooldown overrides occurred,
 * at least one should have led to a Sonnet session with conclusion "acted".
 */
export async function evalMaterialChangeSensitivity(
	db: DbClient,
	date: string,
): Promise<EvalResult & { overridesThatActed: number; skipped?: boolean }> {
	const d = db;
	const nextDate = nextDay(date);

	const overrideLogs = await d
		.select({ createdAt: agentLogs.createdAt })
		.from(agentLogs)
		.where(
			and(
				gte(agentLogs.createdAt, date),
				lt(agentLogs.createdAt, nextDate),
				like(agentLogs.message, "%Material change detected%"),
			),
		)
		.orderBy(agentLogs.createdAt);

	if (overrideLogs.length === 0) {
		return {
			name: "material_change_sensitivity",
			passed: true,
			skipped: true,
			detail: "No cooldown overrides occurred — eval not applicable",
			overridesThatActed: 0,
		};
	}

	let overridesThatActed = 0;
	for (const override of overrideLogs) {
		const overrideTime = override.createdAt;
		const fiveMinLater = new Date(new Date(overrideTime).getTime() + 5 * 60_000).toISOString();

		const escalations = await d
			.select({ conclusion: escalationState.conclusion })
			.from(escalationState)
			.where(
				and(
					gte(escalationState.createdAt, overrideTime),
					lte(escalationState.createdAt, fiveMinLater),
				),
			);

		if (escalations.some((e) => e.conclusion === "acted")) {
			overridesThatActed++;
		}
	}

	return {
		name: "material_change_sensitivity",
		passed: overridesThatActed > 0,
		detail:
			overridesThatActed > 0
				? `${overridesThatActed}/${overrideLogs.length} cooldown overrides led to action`
				: `0/${overrideLogs.length} cooldown overrides led to action — override may be too sensitive`,
		overridesThatActed,
	};
}

/**
 * Phantom recurrence: no positions should have negative quantity.
 */
export async function evalPhantomRecurrence(
	db: DbClient,
): Promise<EvalResult & { phantomCount: number }> {
	const d = db;

	const phantoms = await d
		.select({ id: positions.id, symbol: positions.symbol, quantity: positions.quantity })
		.from(positions)
		.where(lt(positions.quantity, 0));

	return {
		name: "phantom_recurrence",
		passed: phantoms.length === 0,
		detail:
			phantoms.length === 0
				? "No phantom positions found"
				: `${phantoms.length} phantom position(s): ${phantoms.map((p) => `${p.symbol}=${p.quantity}`).join(", ")}`,
		phantomCount: phantoms.length,
	};
}

/**
 * Tracking accuracy: compare tracked cost vs expected range.
 * The Anthropic dashboard comparison is manual, but we can check
 * that the tracking gap ratio is within bounds.
 */
export async function evalTrackingAccuracy(
	db: DbClient,
	date: string,
	actualDashboardCost: number,
): Promise<EvalResult & { trackedCost: number; ratio: number }> {
	const d = db;
	const nextDate = nextDay(date);

	const [row] = await d
		.select({ total: sql<number>`coalesce(sum(${tokenUsage.estimatedCostUsd}), 0)` })
		.from(tokenUsage)
		.where(and(gte(tokenUsage.createdAt, date), lt(tokenUsage.createdAt, nextDate)));

	const trackedCost = row?.total ?? 0;
	const ratio = actualDashboardCost > 0 ? actualDashboardCost / trackedCost : 1;
	const passed = ratio <= 1.3;

	return {
		name: "tracking_accuracy",
		passed,
		detail: passed
			? `Tracked $${trackedCost.toFixed(2)}, actual $${actualDashboardCost.toFixed(2)} (ratio ${ratio.toFixed(2)}×)`
			: `Tracking gap too large: $${trackedCost.toFixed(2)} tracked vs $${actualDashboardCost.toFixed(2)} actual (${ratio.toFixed(2)}× — target ≤1.3×)`,
		trackedCost,
		ratio,
	};
}

/**
 * Run all automated evals for a given date and log results.
 * Imports logger and DB lazily to avoid triggering config validation at import time.
 */
export async function runCostEvals(date?: string): Promise<EvalResult[]> {
	const { getDb } = await import("../db/client.ts");
	const { createChildLogger } = await import("../utils/logger.ts");
	const log = createChildLogger({ module: "cost-evals" });

	const d = getDb();
	const evalDate = date ?? new Date().toISOString().split("T")[0]!;

	const results = await Promise.all([
		evalWasteReduction(d, evalDate),
		evalBudgetHeadroom(d, evalDate),
		evalMaterialChangeSensitivity(d, evalDate),
		evalPhantomRecurrence(d),
	]);

	for (const result of results) {
		log.info({ eval: result.name, passed: result.passed, detail: result.detail }, "Eval result");
		await d.insert(agentLogs).values({
			level: result.passed ? "INFO" : "WARN",
			phase: "eval",
			message: `[${result.passed ? "PASS" : "FAIL"}] ${result.name}: ${result.detail}`,
			data: JSON.stringify(result),
		});
	}

	const passed = results.filter((r) => r.passed).length;
	const failed = results.filter((r) => !r.passed).length;
	log.info({ passed, failed, total: results.length }, "Cost evals complete");

	return results;
}

function nextDay(dateStr: string): string {
	const d = new Date(`${dateStr}T00:00:00.000Z`);
	d.setUTCDate(d.getUTCDate() + 1);
	return d.toISOString().split("T")[0]!;
}
