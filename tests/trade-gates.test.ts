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
