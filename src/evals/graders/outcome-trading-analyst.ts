import { and, desc, eq, gte, lt } from "drizzle-orm";

import type { GraderResult } from "../types.ts";

interface OutcomeInput {
	readonly symbol: string;
	readonly decisionTime: string;
	readonly statedAction: string;
}

function safeJsonParse(raw: string | null): Record<string, unknown> | null {
	if (!raw) return null;
	try {
		const parsed: unknown = JSON.parse(raw);
		if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
			return parsed as Record<string, unknown>;
		}
		return null;
	} catch {
		return null;
	}
}

/**
 * Outcome eval for Trading Analyst: cross-reference decisions with
 * decision_scores (T+1), missed opportunities, and trade profitability.
 */
export async function evaluateTradeOutcomes(
	inputs: readonly OutcomeInput[],
): Promise<GraderResult[]> {
	const { getDb } = await import("../../db/client.ts");
	const { decisionScores, tradeReviews } = await import("../../db/schema.ts");
	const db = getDb();
	const results: GraderResult[] = [];
	const grader = "outcome:trading_analyst";

	for (const input of inputs) {
		const windowEnd = new Date(
			new Date(input.decisionTime).getTime() + 2 * 86_400_000,
		).toISOString();

		const scores = await db
			.select()
			.from(decisionScores)
			.where(
				and(
					eq(decisionScores.symbol, input.symbol),
					gte(decisionScores.decisionTime, input.decisionTime),
					lt(decisionScores.decisionTime, windowEnd),
				),
			)
			.orderBy(desc(decisionScores.createdAt))
			.limit(1);

		const scoreRow = scores[0];
		if (!scoreRow) {
			results.push({
				kind: "skip",
				grader,
				reason: `No decision_score found for ${input.symbol} near ${input.decisionTime}`,
			});
			continue;
		}

		if (input.statedAction === "HOLD" && Math.abs(scoreRow.changePct) > 5) {
			results.push({
				kind: "flag",
				grader,
				flag: "missed_opportunity",
				detail: `HOLD on ${input.symbol} but price moved ${scoreRow.changePct.toFixed(1)}% (T+1)`,
			});
		}

		if (scoreRow.score === "missed_opportunity" && scoreRow.genuineMiss) {
			results.push({
				kind: "flag",
				grader,
				flag: "genuine_miss",
				detail: `${input.symbol}: genuine missed opportunity — ${scoreRow.lesson ?? "no lesson"}`,
			});
		}

		if (input.statedAction === "BUY") {
			const reviews = await db
				.select()
				.from(tradeReviews)
				.where(eq(tradeReviews.symbol, input.symbol))
				.orderBy(desc(tradeReviews.createdAt))
				.limit(1);

			const review = reviews[0];
			if (review) {
				const profitable = review.outcome === "win";
				results.push({
					kind: "label",
					grader,
					label: profitable ? "profitable_buy" : "unprofitable_buy",
					detail: `${input.symbol} BUY outcome: ${review.outcome}, PnL: ${review.pnl ?? "unknown"}`,
				});
			}
		}

		const signalState = safeJsonParse(scoreRow.signalState);
		if (signalState) {
			results.push({
				kind: "label",
				grader: `${grader}:score`,
				label: scoreRow.score,
				detail: `${input.symbol}: ${scoreRow.score}, change=${scoreRow.changePct.toFixed(1)}%`,
			});
		}
	}

	return results;
}
