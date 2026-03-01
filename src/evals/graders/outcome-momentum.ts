import { and, desc, eq, gte, lt } from "drizzle-orm";

import type { GraderResult } from "../types.ts";

interface MomentumOutcomeInput {
	readonly symbol: string;
	readonly decisionTime: string;
	readonly statedAction: string;
	readonly exchange?: string;
	readonly signalState?: {
		readonly rsi14?: number | null;
		readonly trendAlignment?: string;
		readonly adxDeclining?: boolean;
		readonly macdHistogramShrinking?: boolean;
	};
}

/**
 * Momentum-specific outcome checks for Trading Analyst decisions.
 * Cross-references with price data to validate momentum-based reasoning.
 */
export async function evaluateMomentumOutcomes(
	inputs: readonly MomentumOutcomeInput[],
): Promise<GraderResult[]> {
	const { getDb } = await import("../../db/client.ts");
	const { decisionScores, positions } = await import("../../db/schema.ts");
	const db = getDb();
	const results: GraderResult[] = [];
	const grader = "outcome:momentum";

	for (const input of inputs) {
		const threeDaysLater = new Date(
			new Date(input.decisionTime).getTime() + 3 * 86_400_000,
		).toISOString();
		const fiveDaysLater = new Date(
			new Date(input.decisionTime).getTime() + 5 * 86_400_000,
		).toISOString();

		const scores3d = await db
			.select()
			.from(decisionScores)
			.where(
				and(
					eq(decisionScores.symbol, input.symbol),
					gte(decisionScores.createdAt, input.decisionTime),
					lt(decisionScores.createdAt, threeDaysLater),
				),
			)
			.orderBy(desc(decisionScores.createdAt))
			.limit(1);

		const scores5d = await db
			.select()
			.from(decisionScores)
			.where(
				and(
					eq(decisionScores.symbol, input.symbol),
					gte(decisionScores.createdAt, input.decisionTime),
					lt(decisionScores.createdAt, fiveDaysLater),
				),
			)
			.orderBy(desc(decisionScores.createdAt))
			.limit(1);

		const score3d = scores3d[0];
		const score5d = scores5d[0];

		// BUY when gate passed: did trend continue for at least 3 days?
		if (input.statedAction === "BUY" && score3d) {
			if (score3d.changePct > 0) {
				results.push({
					kind: "pass",
					grader: `${grader}:trend_continuation`,
					detail: `${input.symbol} BUY: trend continued +${score3d.changePct.toFixed(1)}% over 3d`,
				});
			} else {
				results.push({
					kind: "flag",
					grader: `${grader}:trend_continuation`,
					flag: "trend_reversal_after_buy",
					detail: `${input.symbol} BUY: trend reversed ${score3d.changePct.toFixed(1)}% over 3d`,
				});
			}
		}

		// BUY when RSI > 70: did stock reverse within 5 days?
		if (
			input.statedAction === "BUY" &&
			input.signalState?.rsi14 != null &&
			input.signalState.rsi14 > 70 &&
			score5d
		) {
			const reversed = score5d.changePct < 0;
			if (reversed) {
				results.push({
					kind: "flag",
					grader: `${grader}:overbought_entry`,
					flag: "overbought_reversal",
					detail: `${input.symbol} BUY at RSI=${input.signalState.rsi14.toFixed(0)}: reversed ${score5d.changePct.toFixed(1)}% in 5d`,
				});
			}
		}

		// BUY on LSE with small expected move: did it profit after stamp duty?
		if (input.statedAction === "BUY" && input.exchange === "LSE" && score5d) {
			const netAfterStampDuty = score5d.changePct - 0.5;
			if (netAfterStampDuty < 0) {
				results.push({
					kind: "flag",
					grader: `${grader}:lse_stamp_duty`,
					flag: "lse_unprofitable_after_duty",
					detail: `${input.symbol} LSE BUY: ${score5d.changePct.toFixed(1)}% move, net after 0.5% stamp duty = ${netAfterStampDuty.toFixed(1)}%`,
				});
			}
		}

		// HOLD on decelerating momentum: did the stock drop?
		if (
			input.statedAction === "HOLD" &&
			(input.signalState?.adxDeclining || input.signalState?.macdHistogramShrinking) &&
			score3d
		) {
			if (score3d.changePct < -2) {
				results.push({
					kind: "flag",
					grader: `${grader}:deceleration_hold`,
					flag: "should_have_exited",
					detail: `${input.symbol} HOLD on decelerating momentum: dropped ${score3d.changePct.toFixed(1)}% in 3d`,
				});
			}
		}

		// HOLD on losing position beyond 2 months: check if it recovered
		if (input.statedAction === "HOLD") {
			const posRows = await db
				.select()
				.from(positions)
				.where(eq(positions.symbol, input.symbol))
				.limit(1);

			const pos = posRows[0];
			if (pos && pos.unrealizedPnl != null && pos.unrealizedPnl < 0) {
				const holdDurationMs =
					new Date(input.decisionTime).getTime() - new Date(pos.updatedAt).getTime();
				const holdDurationMonths = Math.abs(holdDurationMs) / (30 * 86_400_000);

				if (holdDurationMonths > 2 && score5d && score5d.changePct < 0) {
					results.push({
						kind: "flag",
						grader: `${grader}:loser_hold_duration`,
						flag: "loser_held_too_long",
						detail: `${input.symbol} losing position held ~${holdDurationMonths.toFixed(1)} months, still declining (${score5d.changePct.toFixed(1)}%)`,
					});
				}
			}
		}

		// Winner/loser asymmetry check
		if (input.statedAction === "PASS" && score5d && score5d.changePct > 3) {
			results.push({
				kind: "flag",
				grader: `${grader}:missed_momentum`,
				flag: "passed_on_momentum",
				detail: `${input.symbol} PASS but rallied ${score5d.changePct.toFixed(1)}% in 5d`,
			});
		}
	}

	return results;
}
