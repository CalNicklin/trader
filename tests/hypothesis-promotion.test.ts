import { describe, expect, test } from "bun:test";
import { checkPromotionThresholds } from "../src/learning/hypothesis-gates.ts";

describe("checkPromotionThresholds", () => {
	test("rejects when sample size below 30", () => {
		const result = checkPromotionThresholds({
			sampleSize: 20,
			challengerWinRate: 0.7,
			championWinRate: 0.5,
			challengerExpectancy: 1.5,
			championExpectancy: 1.0,
			challengerMaxDrawdown: 0.05,
			championMaxDrawdown: 0.05,
		});
		expect(result.canPromote).toBe(false);
		expect(result.reasons.some((r) => r.includes("sample"))).toBe(true);
	});

	test("rejects when Wilson lower bound of challenger does not exceed champion point estimate", () => {
		// 16 wins out of 30 = ~53% WR, Wilson lower bound at z=1.645 is ~0.38
		// Champion at 55% — challenger lower bound (0.38) does NOT exceed champion (0.55)
		const result = checkPromotionThresholds({
			sampleSize: 30,
			challengerWinRate: 0.533,
			championWinRate: 0.55,
			challengerExpectancy: 1.2,
			championExpectancy: 1.0,
			challengerMaxDrawdown: 0.04,
			championMaxDrawdown: 0.05,
		});
		expect(result.canPromote).toBe(false);
		expect(result.reasons.some((r) => r.includes("Wilson"))).toBe(true);
	});

	test("rejects when challenger expectancy below champion", () => {
		const result = checkPromotionThresholds({
			sampleSize: 35,
			challengerWinRate: 0.75,
			championWinRate: 0.5,
			challengerExpectancy: 0.8,
			championExpectancy: 1.0,
			challengerMaxDrawdown: 0.04,
			championMaxDrawdown: 0.05,
		});
		expect(result.canPromote).toBe(false);
		expect(result.reasons.some((r) => r.includes("expectancy"))).toBe(true);
	});

	test("rejects when challenger drawdown exceeds champion x 1.2", () => {
		const result = checkPromotionThresholds({
			sampleSize: 35,
			challengerWinRate: 0.75,
			championWinRate: 0.5,
			challengerExpectancy: 1.5,
			championExpectancy: 1.0,
			challengerMaxDrawdown: 0.07,
			championMaxDrawdown: 0.05,
		});
		expect(result.canPromote).toBe(false);
		expect(result.reasons.some((r) => r.includes("drawdown"))).toBe(true);
	});

	test("approves when all thresholds met", () => {
		// 25 wins out of 35 = ~71% WR, Wilson lower bound at z=1.645 ≈ 0.56
		// Champion at 50% — challenger lower bound exceeds champion
		const result = checkPromotionThresholds({
			sampleSize: 35,
			challengerWinRate: 0.714,
			championWinRate: 0.5,
			challengerExpectancy: 1.5,
			championExpectancy: 1.0,
			challengerMaxDrawdown: 0.05,
			championMaxDrawdown: 0.05,
		});
		expect(result.canPromote).toBe(true);
		expect(result.reasons).toHaveLength(0);
	});

	test("accumulates multiple failure reasons", () => {
		const result = checkPromotionThresholds({
			sampleSize: 10,
			challengerWinRate: 0.4,
			championWinRate: 0.6,
			challengerExpectancy: 0.5,
			championExpectancy: 1.0,
			challengerMaxDrawdown: 0.1,
			championMaxDrawdown: 0.05,
		});
		expect(result.canPromote).toBe(false);
		expect(result.reasons.length).toBeGreaterThanOrEqual(3);
	});

	test("drawdown at exactly 1.2x champion passes", () => {
		const result = checkPromotionThresholds({
			sampleSize: 35,
			challengerWinRate: 0.714,
			championWinRate: 0.5,
			challengerExpectancy: 1.5,
			championExpectancy: 1.0,
			challengerMaxDrawdown: 0.06,
			championMaxDrawdown: 0.05,
		});
		// 0.06 = 0.05 * 1.2 — exactly at boundary, should pass
		expect(result.canPromote).toBe(true);
	});
});
