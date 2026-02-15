import { beforeEach, expect, test } from "bun:test";

// Set required env vars before importing config
beforeEach(() => {
	process.env.ANTHROPIC_API_KEY = "test-key";
	process.env.RESEND_API_KEY = "test-key";
	process.env.ALERT_EMAIL_TO = "test@example.com";
	process.env.NODE_ENV = "test";
	process.env.LOG_LEVEL = "error";
});

test("config validates required env vars", async () => {
	// Reset the cached config
	const { getConfig } = await import("../src/config.ts");
	const config = getConfig();

	expect(config.ANTHROPIC_API_KEY).toBe("test-key");
	expect(config.IBKR_HOST).toBe("127.0.0.1");
	expect(config.IBKR_PORT).toBe(4002);
	expect(config.PAPER_TRADING).toBe(true);
});
