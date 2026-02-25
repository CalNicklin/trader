import { describe, expect, test } from "bun:test";

process.env.ANTHROPIC_API_KEY = "test-key";
process.env.RESEND_API_KEY = "test-key";
process.env.ALERT_EMAIL_TO = "test@test.com";
process.env.PAPER_TRADING = "true";

import { checkTradeGates } from "../src/agent/trade-gates.ts";

const baseInput = {
	side: "BUY" as const,
	marketPhase: "open" as const,
	riskApproved: true,
	riskReasons: [],
};

describe("checkTradeGates confidence threshold adapts to trading mode", () => {
	test("paper mode allows confidence >= 0.5", () => {
		const result = checkTradeGates({ ...baseInput, confidence: 0.6 });
		expect(result).toBeNull();
	});

	test("paper mode rejects confidence below 0.5", () => {
		const result = checkTradeGates({ ...baseInput, confidence: 0.4 });
		expect(result).toContain("below minimum");
	});
});

describe("exchange-specific wind-down enforcement", () => {
	test("US BUY allowed during LSE wind-down when US exchange is open", () => {
		const result = checkTradeGates({
			...baseInput,
			confidence: 0.8,
			marketPhase: "open",
			exchangePhase: "open",
		});
		expect(result).toBeNull();
	});

	test("LSE BUY rejected during LSE wind-down even if global phase is open", () => {
		const result = checkTradeGates({
			...baseInput,
			confidence: 0.8,
			marketPhase: "open",
			exchangePhase: "wind-down",
		});
		expect(result).toContain("wind-down");
	});

	test("US BUY rejected during US wind-down", () => {
		const result = checkTradeGates({
			...baseInput,
			confidence: 0.8,
			marketPhase: "wind-down",
			exchangePhase: "wind-down",
		});
		expect(result).toContain("wind-down");
	});

	test("BUY rejected during exchange post-market", () => {
		const result = checkTradeGates({
			...baseInput,
			confidence: 0.8,
			marketPhase: "open",
			exchangePhase: "post-market",
		});
		expect(result).toContain("post-market");
	});

	test("falls back to marketPhase when exchangePhase not provided", () => {
		const result = checkTradeGates({
			...baseInput,
			confidence: 0.8,
			marketPhase: "wind-down",
		});
		expect(result).toContain("wind-down");
	});
});
