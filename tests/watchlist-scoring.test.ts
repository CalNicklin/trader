import { describe, expect, test } from "bun:test";
import { computeScore } from "../src/research/watchlist.ts";

describe("computeScore", () => {
	test("quality pass with high momentum yields high score", () => {
		const score = computeScore({
			qualityPass: "pass",
			changePercentage: 8,
			daysSinceResearch: 0,
		});
		expect(score).toBeGreaterThan(50);
		expect(score).toBeLessThanOrEqual(100);
	});

	test("quality fail returns zero regardless of momentum", () => {
		const score = computeScore({
			qualityPass: "fail",
			changePercentage: 15,
			daysSinceResearch: 0,
		});
		expect(score).toBe(0);
	});

	test("marginal quality halves the score vs pass", () => {
		const passScore = computeScore({
			qualityPass: "pass",
			changePercentage: 5,
			daysSinceResearch: 0,
		});
		const marginalScore = computeScore({
			qualityPass: "marginal",
			changePercentage: 5,
			daysSinceResearch: 0,
		});
		expect(marginalScore).toBeCloseTo(passScore / 2, 1);
	});

	test("stale research decays the score", () => {
		const fresh = computeScore({
			qualityPass: "pass",
			changePercentage: 5,
			daysSinceResearch: 0,
		});
		const stale = computeScore({
			qualityPass: "pass",
			changePercentage: 5,
			daysSinceResearch: 14,
		});
		expect(stale).toBeLessThan(fresh);
		expect(stale).toBeGreaterThan(0);
	});

	test("null quality pass treated as fail", () => {
		const score = computeScore({
			qualityPass: null,
			changePercentage: 10,
			daysSinceResearch: 0,
		});
		expect(score).toBe(0);
	});
});
