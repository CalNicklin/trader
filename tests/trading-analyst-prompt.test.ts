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
		expect(prompt).toContain("learning from real executions beats waiting for perfection");
		expect(prompt).toContain("only act on >= 0.5");
		expect(prompt).toContain("at least 1.5:1");

		expect(prompt).not.toContain("Trading Mode: LIVE");
		expect(prompt).not.toContain("no trade is better than a bad trade");
		expect(prompt).not.toContain("only act on >= 0.7");
		expect(prompt).not.toContain("at least 2:1");
	});

	test("mini analysis prompt encourages action in paper mode", () => {
		const prompt = getMiniAnalysisPrompt();

		expect(prompt).toContain("willing to act");
		expect(prompt).not.toContain("Be conservative");
	});
});
