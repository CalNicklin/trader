import { describe, expect, test } from "bun:test";
import type { Exchange } from "../src/broker/contracts.ts";

process.env.ANTHROPIC_API_KEY = "test-key";
process.env.RESEND_API_KEY = "test-key";
process.env.ALERT_EMAIL_TO = "test@example.com";

describe("getStaleSymbols return type", () => {
	test("getStaleSymbols returns StaleSymbol objects (not bare strings)", async () => {
		const { getStaleSymbols } = await import("../src/research/watchlist.ts");

		const returnType = getStaleSymbols satisfies () => Promise<
			Array<{ symbol: string; exchange: Exchange }>
		>;
		expect(returnType).toBeFunction();
	});
});

describe("decision scorer exchange propagation", () => {
	test("DecisionExtract prompt asks for exchange field", async () => {
		const mod = await import("../src/learning/decision-scorer.ts");
		const exported = mod as Record<string, unknown>;
		expect(exported.EXTRACT_DECISIONS_PROMPT).toBeDefined();

		const prompt = exported.EXTRACT_DECISIONS_PROMPT as string;
		expect(prompt).toContain("exchange");
		expect(prompt).toContain("LSE");
		expect(prompt).toContain("NASDAQ");
		expect(prompt).toContain("NYSE");
	});

	test("parseDecisionExtracts includes exchange field", async () => {
		const { parseDecisionExtracts } = await import("../src/learning/decision-scorer.ts");

		const jsonStr = JSON.stringify({
			symbols: [
				{ symbol: "AAPL", exchange: "NASDAQ", statedAction: "WATCH", reason: "good momentum" },
				{ symbol: "SHEL", exchange: "LSE", statedAction: "HOLD", reason: "stable dividend" },
			],
		});

		const result = parseDecisionExtracts(jsonStr);
		expect(result).toHaveLength(2);
		expect(result[0]!.exchange).toBe("NASDAQ");
		expect(result[1]!.exchange).toBe("LSE");
	});

	test("parseDecisionExtracts defaults exchange to LSE when missing", async () => {
		const { parseDecisionExtracts } = await import("../src/learning/decision-scorer.ts");

		const jsonStr = JSON.stringify({
			symbols: [{ symbol: "BARC", statedAction: "HOLD", reason: "cheap" }],
		});

		const result = parseDecisionExtracts(jsonStr);
		expect(result[0]!.exchange).toBe("LSE");
	});
});

describe("orchestrator uses exchange-grouped quotes", () => {
	test("getQuotesGroupedByExchange is importable from market-data", async () => {
		const { getQuotesGroupedByExchange } = await import("../src/broker/market-data.ts");
		expect(getQuotesGroupedByExchange).toBeFunction();
	});
});
