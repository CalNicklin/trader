import { describe, expect, test } from "bun:test";

process.env.ANTHROPIC_API_KEY = "test-key";
process.env.RESEND_API_KEY = "test-key";
process.env.ALERT_EMAIL_TO = "test@test.com";
process.env.PAPER_TRADING = "true";

import {
	getMiniAnalysisPrompt,
	getTradingAnalystSystem,
} from "../src/agent/prompts/trading-analyst.ts";

describe("trading analyst prompt adapts to paper mode", () => {
	test("system prompt includes paper trading context and thresholds", () => {
		const prompt = getTradingAnalystSystem();

		expect(prompt).toContain("Trading Mode: PAPER");
		expect(prompt).toContain("learning from executions beats waiting for perfection");
		expect(prompt).toContain("only act on >= 0.5");
		expect(prompt).toContain("momentum-qualified candidates");
		expect(prompt).toContain("override_reason");

		expect(prompt).not.toContain("Trading Mode: LIVE");
		expect(prompt).not.toContain("only act on >= 0.7");
	});

	test("mini analysis prompt encourages action in paper mode", () => {
		const prompt = getMiniAnalysisPrompt();

		expect(prompt).toContain("willing to act");
		expect(prompt).toContain("gate-qualified");
		expect(prompt).toContain("trailing stop");
		expect(prompt).not.toContain("genuine conviction beyond");
	});
});

describe("output budget constraints", () => {
	test("system prompt constrains total response length", () => {
		const prompt = getTradingAnalystSystem();
		expect(prompt).toContain("under 300 words");
	});

	test("system prompt constrains log_decision length", () => {
		const prompt = getTradingAnalystSystem();
		expect(prompt).toContain("100 words");
	});

	test("system prompt discourages repeating ISA rules", () => {
		const prompt = getTradingAnalystSystem();
		expect(prompt).toContain("Do NOT repeat ISA compliance rules");
	});
});
