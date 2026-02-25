import { wilsonLower } from "../utils/stats.ts";

interface PromotionInput {
	sampleSize: number;
	challengerWinRate: number;
	championWinRate: number;
	challengerExpectancy: number;
	championExpectancy: number;
	challengerMaxDrawdown: number;
	championMaxDrawdown: number;
}

interface PromotionResult {
	canPromote: boolean;
	reasons: string[];
}

const MIN_SAMPLE_SIZE = 30;
const WILSON_Z = 1.645;
const DRAWDOWN_MULTIPLIER = 1.2;

export function checkPromotionThresholds(input: PromotionInput): PromotionResult {
	const reasons: string[] = [];

	if (input.sampleSize < MIN_SAMPLE_SIZE) {
		reasons.push(`Insufficient sample size: ${input.sampleSize} < ${MIN_SAMPLE_SIZE} required`);
	}

	const challengerWins = Math.round(input.challengerWinRate * input.sampleSize);
	const challengerLowerBound = wilsonLower(challengerWins, input.sampleSize, WILSON_Z);
	if (challengerLowerBound <= input.championWinRate) {
		reasons.push(
			`Wilson lower bound ${(challengerLowerBound * 100).toFixed(1)}% does not exceed champion win rate ${(input.championWinRate * 100).toFixed(1)}%`,
		);
	}

	if (input.challengerExpectancy < input.championExpectancy) {
		reasons.push(
			`Challenger expectancy ${input.challengerExpectancy.toFixed(2)} below champion ${input.championExpectancy.toFixed(2)}`,
		);
	}

	const drawdownLimit = input.championMaxDrawdown * DRAWDOWN_MULTIPLIER;
	if (input.challengerMaxDrawdown > drawdownLimit) {
		reasons.push(
			`Challenger drawdown ${(input.challengerMaxDrawdown * 100).toFixed(1)}% exceeds limit ${(drawdownLimit * 100).toFixed(1)}% (champion ${(input.championMaxDrawdown * 100).toFixed(1)}% × ${DRAWDOWN_MULTIPLIER})`,
		);
	}

	return { canPromote: reasons.length === 0, reasons };
}
