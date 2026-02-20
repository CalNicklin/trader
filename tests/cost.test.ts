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

	test("all five Haiku jobs are correctly tiered", () => {
		const haiku_jobs = [
			"quick_scan",
			"research",
			"trade_reviewer",
			"pattern_analyzer",
			"news_discovery",
		];
		for (const job of haiku_jobs) {
			const cost = estimateCost(job, 1_000_000, 0);
			expect(cost).toBeCloseTo(1, 2); // $1/MTok input only
		}
	});

	test("unknown job defaults to Sonnet rates", () => {
		const cost = estimateCost("some_new_job", 1_000_000, 0);
		expect(cost).toBeCloseTo(3, 2); // $3/MTok input at Sonnet
	});

	test("cache tokens are subtracted from input and charged at discounted rates", () => {
		// Sonnet: 1M total input, 200k cache write, 300k cache read, 500k output
		// normalInput = 1M - 200k - 300k = 500k
		// cost = (500k × $3 + 500k × $15 + 200k × $3.75 + 300k × $0.30) / 1M
		//      = (1.5 + 7.5 + 0.75 + 0.09)
		//      = 9.84
		const cost = estimateCost("trading_analyst", 1_000_000, 500_000, 200_000, 300_000);
		expect(cost).toBeCloseTo(9.84, 2);
	});

	test("cache tokens with Haiku rates", () => {
		// Haiku: 1M total input, 400k cache write, 200k cache read, 100k output
		// normalInput = 1M - 400k - 200k = 400k
		// cost = (400k × $1 + 100k × $5 + 400k × $1.25 + 200k × $0.10) / 1M
		//      = (0.4 + 0.5 + 0.5 + 0.02)
		//      = 1.42
		const cost = estimateCost("quick_scan", 1_000_000, 100_000, 400_000, 200_000);
		expect(cost).toBeCloseTo(1.42, 2);
	});

	test("zero tokens returns zero cost", () => {
		expect(estimateCost("quick_scan", 0, 0)).toBe(0);
		expect(estimateCost("trading_analyst", 0, 0)).toBe(0);
	});
});
