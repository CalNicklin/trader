import { expect, test } from "bun:test";

process.env.ANTHROPIC_API_KEY = "test-key";
process.env.RESEND_API_KEY = "test-key";
process.env.ALERT_EMAIL_TO = "test@example.com";

test("screenUSStocks returns candidates with correct exchange from screener results", async () => {
	const { screenUSStocks } = await import("../src/research/sources/us-screener.ts");

	const results = await screenUSStocks({
		fetchScreener: async () => [
			{
				symbol: "AAPL",
				companyName: "Apple Inc",
				marketCap: 3_000_000_000_000,
				sector: "Technology",
				industry: "Consumer Electronics",
				country: "US",
				price: 180,
				volume: 50_000_000,
				exchange: "NASDAQ",
				exchangeShortName: "NASDAQ",
				isEtf: false,
				isFund: false,
				isActivelyTrading: true,
			},
			{
				symbol: "IBM",
				companyName: "International Business Machines",
				marketCap: 150_000_000_000,
				sector: "Technology",
				industry: "IT Services",
				country: "US",
				price: 170,
				volume: 4_000_000,
				exchange: "NYSE",
				exchangeShortName: "NYSE",
				isEtf: false,
				isFund: false,
				isActivelyTrading: true,
			},
		],
	});

	expect(results).toHaveLength(2);
	expect(results[0]).toEqual({
		symbol: "AAPL",
		name: "Apple Inc",
		sector: "Technology",
		exchange: "NASDAQ",
	});
	expect(results[1]).toEqual({
		symbol: "IBM",
		name: "International Business Machines",
		sector: "Technology",
		exchange: "NYSE",
	});
});

test("screenUSStocks filters out ETFs and funds", async () => {
	const { screenUSStocks } = await import("../src/research/sources/us-screener.ts");

	const results = await screenUSStocks({
		fetchScreener: async () => [
			{
				symbol: "SPY",
				companyName: "SPDR S&P 500 ETF",
				marketCap: 400_000_000_000,
				sector: "Financial",
				industry: "ETF",
				country: "US",
				price: 450,
				volume: 80_000_000,
				exchange: "NYSE",
				exchangeShortName: "NYSE",
				isEtf: true,
				isFund: false,
				isActivelyTrading: true,
			},
			{
				symbol: "MSFT",
				companyName: "Microsoft Corp",
				marketCap: 2_800_000_000_000,
				sector: "Technology",
				industry: "Software",
				country: "US",
				price: 380,
				volume: 20_000_000,
				exchange: "NASDAQ",
				exchangeShortName: "NASDAQ",
				isEtf: false,
				isFund: false,
				isActivelyTrading: true,
			},
		],
	});

	expect(results).toHaveLength(1);
	expect(results[0]!.symbol).toBe("MSFT");
});

test("screenUSStocks returns empty when screener returns null", async () => {
	const { screenUSStocks } = await import("../src/research/sources/us-screener.ts");

	const results = await screenUSStocks({
		fetchScreener: async () => null,
	});

	expect(results).toHaveLength(0);
});
