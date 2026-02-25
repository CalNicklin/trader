// Requires env vars: ANTHROPIC_API_KEY, RESEND_API_KEY, ALERT_EMAIL_TO (module-level logger triggers config)
import { describe, expect, test } from "bun:test";
import { scoreDecision } from "../src/learning/decision-scorer.ts";

describe("scoreDecision", () => {
	describe("HOLD decisions (existing position)", () => {
		test("good hold when stock dropped", () => {
			expect(scoreDecision("HOLD", -5)).toBe("good_hold");
		});

		test("good hold when stock flat", () => {
			expect(scoreDecision("HOLD", 0.5)).toBe("good_hold");
		});

		test("good hold when stock slightly up but under 2%", () => {
			expect(scoreDecision("HOLD", 1.9)).toBe("good_hold");
		});

		test("missed opportunity when stock rallied over 5%", () => {
			expect(scoreDecision("HOLD", 6)).toBe("missed_opportunity");
		});

		test("unclear when stock up between 2% and 5%", () => {
			expect(scoreDecision("HOLD", 3.5)).toBe("unclear");
		});
	});

	describe("WATCH decisions (not in position)", () => {
		test("missed opportunity when stock rallied over 5%", () => {
			expect(scoreDecision("WATCH", 7.2)).toBe("missed_opportunity");
		});

		test("good avoid when stock dropped over 3%", () => {
			expect(scoreDecision("WATCH", -4)).toBe("good_avoid");
		});

		test("good pass when stock stayed flat", () => {
			expect(scoreDecision("WATCH", 0.3)).toBe("good_pass");
		});

		test("unclear when stock moved 2-5% up", () => {
			expect(scoreDecision("WATCH", 3)).toBe("unclear");
		});

		test("unclear when stock moved 2-3% down", () => {
			expect(scoreDecision("WATCH", -2.5)).toBe("unclear");
		});
	});

	describe("PASS decisions (explicitly rejected)", () => {
		test("missed opportunity when stock rallied over 5%", () => {
			expect(scoreDecision("PASS", 8)).toBe("missed_opportunity");
		});

		test("good avoid when stock dropped over 3%", () => {
			expect(scoreDecision("PASS", -5)).toBe("good_avoid");
		});

		test("good pass when stock flat", () => {
			expect(scoreDecision("PASS", -0.5)).toBe("good_pass");
		});
	});

	describe("BUY/SELL and unknown actions", () => {
		test("BUY returns unclear (scored by trade reviewer instead)", () => {
			expect(scoreDecision("BUY", 10)).toBe("unclear");
		});

		test("SELL returns unclear", () => {
			expect(scoreDecision("SELL", -5)).toBe("unclear");
		});
	});

	describe("boundary values", () => {
		test("WATCH at exactly +5% is missed_opportunity", () => {
			expect(scoreDecision("WATCH", 5.01)).toBe("missed_opportunity");
		});

		test("WATCH at exactly -3% is unclear (not good_avoid)", () => {
			expect(scoreDecision("WATCH", -3)).toBe("unclear");
		});

		test("HOLD at exactly +5% is unclear (not missed_opportunity)", () => {
			expect(scoreDecision("HOLD", 5)).toBe("unclear");
		});

		test("HOLD at exactly +2% is unclear (not good_hold)", () => {
			expect(scoreDecision("HOLD", 2)).toBe("unclear");
		});
	});
});
