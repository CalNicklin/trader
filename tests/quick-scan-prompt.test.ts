import { describe, expect, test } from "bun:test";

process.env.ANTHROPIC_API_KEY = "test-key";
process.env.RESEND_API_KEY = "test-key";
process.env.ALERT_EMAIL_TO = "test@test.com";
process.env.PAPER_TRADING = "true";

import { getQuickScanSystem } from "../src/agent/prompts/quick-scan.ts";

describe("quick scan prompt", () => {
	test("includes deduplication rule to avoid re-escalating on already-analyzed signals", () => {
		const prompt = getQuickScanSystem();

		expect(prompt).toContain("NOT already analyzed in the last Sonnet decision");
		expect(prompt).toContain("last Sonnet decision already analyzed these same signals");
	});

	test("instructs Haiku to respond with JSON only", () => {
		const prompt = getQuickScanSystem();

		expect(prompt).toContain('{"escalate": true/false, "reason":');
	});
});
