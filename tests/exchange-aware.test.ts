import { expect, test } from "bun:test";

process.env.ANTHROPIC_API_KEY = "test-key";
process.env.RESEND_API_KEY = "test-key";
process.env.ALERT_EMAIL_TO = "test@example.com";

test("toYahooSymbol appends .L for LSE, bare for US", async () => {
	const { toYahooSymbol } = await import("../src/research/sources/yahoo-finance.ts");

	expect(toYahooSymbol("SHEL", "LSE")).toBe("SHEL.L");
	expect(toYahooSymbol("SHEL.L", "LSE")).toBe("SHEL.L");
	expect(toYahooSymbol("AAPL", "NASDAQ")).toBe("AAPL");
	expect(toYahooSymbol("IBM", "NYSE")).toBe("IBM");
});

test("toFmpSymbol appends .L for LSE, bare for US", async () => {
	const { toFmpSymbol } = await import("../src/research/sources/fmp.ts");

	expect(toFmpSymbol("SHEL", "LSE")).toBe("SHEL.L");
	expect(toFmpSymbol("AAPL", "NASDAQ")).toBe("AAPL");
	expect(toFmpSymbol("IBM", "NYSE")).toBe("IBM");
});

test("getStampDuty returns 0.5% for LSE, 0% for US exchanges", async () => {
	const { getStampDuty } = await import("../src/risk/limits.ts");

	expect(getStampDuty("LSE")).toBe(0.005);
	expect(getStampDuty("NASDAQ")).toBe(0);
	expect(getStampDuty("NYSE")).toBe(0);
});

test("getStampDuty returns 0% for AIM stocks on LSE", async () => {
	const { getStampDuty } = await import("../src/risk/limits.ts");

	expect(getStampDuty("LSE", true)).toBe(0);
});

test("HARD_LIMITS.MIN_PRICE has GBP and USD thresholds", async () => {
	const { HARD_LIMITS } = await import("../src/risk/limits.ts");

	expect(HARD_LIMITS.MIN_PRICE.GBP).toBe(0.1);
	expect(HARD_LIMITS.MIN_PRICE.USD).toBe(1.0);
});

test("ISA_ALLOWED_EXCHANGES includes LSE, NASDAQ, NYSE", async () => {
	const { HARD_LIMITS } = await import("../src/risk/limits.ts");

	expect(HARD_LIMITS.ISA_ALLOWED_EXCHANGES).toEqual(["LSE", "NASDAQ", "NYSE"]);
});
