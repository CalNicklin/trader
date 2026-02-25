import { describe, expect, test } from "bun:test";
import type { Exchange } from "../src/broker/contracts.ts";
import type { Quote } from "../src/broker/market-data.ts";

process.env.ANTHROPIC_API_KEY = "test-key";
process.env.RESEND_API_KEY = "test-key";
process.env.ALERT_EMAIL_TO = "test@example.com";

function makeQuote(symbol: string, last: number): Quote {
	return {
		symbol,
		bid: null,
		ask: null,
		last,
		volume: null,
		high: null,
		low: null,
		close: null,
		timestamp: new Date(),
	};
}

describe("getQuotesGroupedByExchange", () => {
	test("groups symbols by exchange and merges results into one map", async () => {
		const { getQuotesGroupedByExchange } = await import("../src/broker/market-data.ts");

		const calls: Array<{ symbols: string[]; exchange: Exchange }> = [];
		const mockGetQuotes = async (
			symbols: string[],
			options?: { exchange?: Exchange },
		): Promise<Map<string, Quote>> => {
			const exchange = options?.exchange ?? "LSE";
			calls.push({ symbols, exchange });
			const map = new Map<string, Quote>();
			for (const s of symbols) map.set(s, makeQuote(s, exchange === "LSE" ? 100 : 200));
			return map;
		};

		const items: Array<{ symbol: string; exchange: Exchange }> = [
			{ symbol: "SHEL", exchange: "LSE" },
			{ symbol: "AZN", exchange: "LSE" },
			{ symbol: "AAPL", exchange: "NASDAQ" },
			{ symbol: "MSFT", exchange: "NASDAQ" },
			{ symbol: "IBM", exchange: "NYSE" },
		];

		const result = await getQuotesGroupedByExchange(items, mockGetQuotes);

		// All 5 symbols present in merged map
		expect(result.size).toBe(5);
		expect(result.get("SHEL")?.last).toBe(100);
		expect(result.get("AAPL")?.last).toBe(200);
		expect(result.get("IBM")?.last).toBe(200);

		// Called once per exchange group (3 groups: LSE, NASDAQ, NYSE)
		expect(calls.length).toBe(3);
		expect(calls.find((c) => c.exchange === "LSE")?.symbols).toEqual(["SHEL", "AZN"]);
		expect(calls.find((c) => c.exchange === "NASDAQ")?.symbols).toEqual(["AAPL", "MSFT"]);
		expect(calls.find((c) => c.exchange === "NYSE")?.symbols).toEqual(["IBM"]);
	});

	test("returns empty map for empty input", async () => {
		const { getQuotesGroupedByExchange } = await import("../src/broker/market-data.ts");

		const mockGetQuotes = async () => new Map<string, Quote>();
		const result = await getQuotesGroupedByExchange([], mockGetQuotes);

		expect(result.size).toBe(0);
	});
});
