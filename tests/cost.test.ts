import { describe, expect, test } from "bun:test";
import { estimateCost } from "../src/utils/cost.ts";

describe("estimateCost", () => {
	test("Haiku job uses Haiku rates ($1/$5 per MTok)", () => {
		const cost = estimateCost("quick_scan", 1_000_000, 1_000_000);
		// 1M input × $1/MTok + 1M output × $5/MTok = $6
		expect(cost).toBeCloseTo(6, 2);
	});

	test("Sonnet job uses Sonnet rates ($3/$15 per MTok)", () => {
		const cost = estimateCost("trading_analyst", 1_000_000, 1_000_000);
		// 1M input × $3/MTok + 1M output × $15/MTok = $18
		expect(cost).toBeCloseTo(18, 2);
	});

	test("Haiku jobs are correctly tiered", () => {
		const haiku_jobs = [
			"quick_scan",
			"trade_reviewer",
			"pattern_analyzer",
			"news_discovery",
			"decision_scorer_extract",
		];
		for (const job of haiku_jobs) {
			const cost = estimateCost(job, 1_000_000, 0);
			expect(cost).toBeCloseTo(1, 2); // $1/MTok input only
		}
	});

	test("research uses Sonnet rates (analyzer calls CLAUDE_MODEL)", () => {
		const cost = estimateCost("research", 1_000_000, 0);
		expect(cost).toBeCloseTo(3, 2); // $3/MTok at Sonnet
	});

	test("unknown job defaults to Sonnet rates", () => {
		const cost = estimateCost("some_new_job", 1_000_000, 0);
		expect(cost).toBeCloseTo(3, 2); // $3/MTok input at Sonnet
	});

	test("cache tokens are additive (input_tokens already excludes cache per Anthropic API)", () => {
		// Sonnet: 1M non-cache input, 200k cache write, 300k cache read, 500k output
		// cost = (1M × $3 + 500k × $15 + 200k × $3.75 + 300k × $0.30) / 1M
		//      = (3.0 + 7.5 + 0.75 + 0.09) = 11.34
		const cost = estimateCost("trading_analyst", 1_000_000, 500_000, 200_000, 300_000);
		expect(cost).toBeCloseTo(11.34, 2);
	});

	test("cache tokens with Haiku rates", () => {
		// Haiku: 1M non-cache input, 400k cache write, 200k cache read, 100k output
		// cost = (1M × $1 + 100k × $5 + 400k × $1.25 + 200k × $0.10) / 1M
		//      = (1.0 + 0.5 + 0.5 + 0.02) = 2.02
		const cost = estimateCost("quick_scan", 1_000_000, 100_000, 400_000, 200_000);
		expect(cost).toBeCloseTo(2.02, 2);
	});

	test("zero tokens returns zero cost", () => {
		expect(estimateCost("quick_scan", 0, 0)).toBe(0);
		expect(estimateCost("trading_analyst", 0, 0)).toBe(0);
	});
});
