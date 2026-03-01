import { and, desc, eq, gte, lt } from "drizzle-orm";

import type { GraderResult } from "../types.ts";

interface ResearchOutcomeInput {
	readonly symbol: string;
	readonly researchDate: string;
	readonly suggestedAction: string;
	readonly confidence: number;
	readonly gatePassed?: boolean;
}

/**
 * Outcome eval for Research Analyzer: T+5 price alignment,
 * confidence calibration, gate validation.
 */
export async function evaluateResearchOutcomes(
	inputs: readonly ResearchOutcomeInput[],
): Promise<GraderResult[]> {
	const { getDb } = await import("../../db/client.ts");
	const { decisionScores } = await import("../../db/schema.ts");
	const db = getDb();
	const results: GraderResult[] = [];
	const grader = "outcome:research";

	const calibrationBuckets = new Map<string, { correct: number; total: number }>();

	for (const input of inputs) {
		const fiveDaysLater = new Date(
			new Date(input.researchDate).getTime() + 5 * 86_400_000,
		).toISOString();

		const scores = await db
			.select()
			.from(decisionScores)
			.where(
				and(
					eq(decisionScores.symbol, input.symbol),
					gte(decisionScores.createdAt, input.researchDate),
					lt(decisionScores.createdAt, fiveDaysLater),
				),
			)
			.orderBy(desc(decisionScores.createdAt))
			.limit(1);

		const score = scores[0];
		if (!score) {
			results.push({
				kind: "skip",
				grader,
				reason: `No price data for ${input.symbol} within 5 days of ${input.researchDate}`,
			});
			continue;
		}

		// T+5 price alignment
		const priceAligned =
			(input.suggestedAction === "BUY" && score.changePct > 0) ||
			(input.suggestedAction === "SELL" && score.changePct < 0) ||
			(input.suggestedAction === "HOLD" && Math.abs(score.changePct) < 3);

		if (priceAligned) {
			results.push({
				kind: "pass",
				grader: `${grader}:price_alignment`,
				detail: `${input.symbol} ${input.suggestedAction}: price moved ${score.changePct.toFixed(1)}% (aligned)`,
			});
		} else {
			results.push({
				kind: "flag",
				grader: `${grader}:price_alignment`,
				flag: "price_misaligned",
				detail: `${input.symbol} ${input.suggestedAction}: price moved ${score.changePct.toFixed(1)}% (misaligned)`,
			});
		}

		// Confidence calibration bucketing
		const bucket = input.confidence >= 0.7 ? "high" : input.confidence >= 0.4 ? "medium" : "low";
		const existing = calibrationBuckets.get(bucket) ?? { correct: 0, total: 0 };
		existing.total++;
		if (priceAligned) existing.correct++;
		calibrationBuckets.set(bucket, existing);

		// Gate validation: track gate-passed vs gate-failed separately
		if (input.gatePassed !== undefined) {
			const gateLabel = input.gatePassed ? "gate_passed" : "gate_failed";
			results.push({
				kind: "label",
				grader: `${grader}:gate_tracking`,
				label: `${gateLabel}_${priceAligned ? "aligned" : "misaligned"}`,
				detail: `${input.symbol}: gate=${gateLabel}, action=${input.suggestedAction}, change=${score.changePct.toFixed(1)}%`,
			});
		}

		// BUY momentum continuation check
		if (input.suggestedAction === "BUY" && score.changePct < -2) {
			results.push({
				kind: "flag",
				grader: `${grader}:buy_reversal`,
				flag: "buy_reversed",
				detail: `${input.symbol} BUY recommendation reversed ${score.changePct.toFixed(1)}% in 5d`,
			});
		}
	}

	// Confidence calibration summary
	for (const [bucket, data] of calibrationBuckets) {
		const accuracy = data.total > 0 ? data.correct / data.total : 0;
		const expectedRange =
			bucket === "high" ? [0.6, 0.9] : bucket === "medium" ? [0.35, 0.65] : [0.1, 0.45];

		const calibrated = accuracy >= expectedRange[0]! && accuracy <= expectedRange[1]!;

		if (calibrated) {
			results.push({
				kind: "pass",
				grader: `${grader}:calibration`,
				detail: `${bucket} confidence: ${(accuracy * 100).toFixed(0)}% accurate (${data.correct}/${data.total})`,
			});
		} else {
			results.push({
				kind: "flag",
				grader: `${grader}:calibration`,
				flag: `${bucket}_miscalibrated`,
				detail: `${bucket} confidence: ${(accuracy * 100).toFixed(0)}% accurate (${data.correct}/${data.total}), expected ${(expectedRange[0]! * 100).toFixed(0)}-${(expectedRange[1]! * 100).toFixed(0)}%`,
			});
		}
	}

	return results;
}
