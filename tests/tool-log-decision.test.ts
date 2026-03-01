import { expect, test } from "bun:test";

process.env.ANTHROPIC_API_KEY = "test-key";
process.env.RESEND_API_KEY = "test-key";
process.env.ALERT_EMAIL_TO = "test@example.com";

test("log_decision tool description includes conciseness guidance", async () => {
	const { toolDefinitions } = await import("../src/agent/tools.ts");

	const tool = toolDefinitions.find((t) => t.name === "log_decision");
	expect(tool).toBeDefined();
	expect(tool!.description).toContain("under 100 words");
});
