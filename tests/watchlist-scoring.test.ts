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

	test("strong momentum assessment yields max momentum score", () => {
		const score = computeScore({
			qualityPass: "pass",
			changePercentage: 0,
			daysSinceResearch: 0,
			momentumAssessment: "strong",
		});
		expect(score).toBe(100);
	});

	test("exhausted momentum assessment yields zero momentum", () => {
		const score = computeScore({
			qualityPass: "pass",
			changePercentage: 10,
			daysSinceResearch: 0,
			momentumAssessment: "exhausted",
		});
		expect(score).toBe(0);
	});

	test("momentum assessment takes precedence over changePercentage", () => {
		const withAssessment = computeScore({
			qualityPass: "pass",
			changePercentage: 15,
			daysSinceResearch: 0,
			momentumAssessment: "decelerating",
		});
		const withoutAssessment = computeScore({
			qualityPass: "pass",
			changePercentage: 15,
			daysSinceResearch: 0,
		});
		expect(withAssessment).toBeLessThan(withoutAssessment);
	});

	test("null momentum assessment falls back to changePercentage proxy", () => {
		const withNull = computeScore({
			qualityPass: "pass",
			changePercentage: 5,
			daysSinceResearch: 0,
			momentumAssessment: null,
		});
		const withoutField = computeScore({
			qualityPass: "pass",
			changePercentage: 5,
			daysSinceResearch: 0,
		});
		expect(withNull).toBeCloseTo(withoutField);
	});
});
