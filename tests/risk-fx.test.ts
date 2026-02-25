import { describe, expect, mock, test } from "bun:test";

process.env.ANTHROPIC_API_KEY = "test-key";
process.env.RESEND_API_KEY = "test-key";
process.env.ALERT_EMAIL_TO = "test@example.com";
process.env.PAPER_TRADING = "true";

describe("convertCurrency", () => {
	test("identity: GBP to GBP returns same amount", async () => {
		const { convertCurrency } = await import("../src/utils/fx.ts");
		const result = await convertCurrency(1000, "GBP", "GBP");
		expect(result).toBe(1000);
	});

	test("identity: USD to USD returns same amount", async () => {
		const { convertCurrency } = await import("../src/utils/fx.ts");
		const result = await convertCurrency(500, "USD", "USD");
		expect(result).toBe(500);
	});

	test("GBP to USD multiplies by rate", async () => {
		const { convertCurrency, resetFxCache } = await import("../src/utils/fx.ts");
		resetFxCache();

		const mockFetch = mock(() =>
			Promise.resolve(
				new Response(
					JSON.stringify({
						chart: { result: [{ meta: { regularMarketPrice: 1.25 } }] },
					}),
				),
			),
		);
		const originalFetch = globalThis.fetch;
		globalThis.fetch = mockFetch as unknown as typeof fetch;

		try {
			const result = await convertCurrency(1000, "GBP", "USD");
			expect(result).toBe(1250);
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	test("USD to GBP divides by rate", async () => {
		const { convertCurrency, resetFxCache } = await import("../src/utils/fx.ts");
		resetFxCache();

		const mockFetch = mock(() =>
			Promise.resolve(
				new Response(
					JSON.stringify({
						chart: { result: [{ meta: { regularMarketPrice: 1.25 } }] },
					}),
				),
			),
		);
		const originalFetch = globalThis.fetch;
		globalThis.fetch = mockFetch as unknown as typeof fetch;

		try {
			const result = await convertCurrency(1000, "USD", "GBP");
			expect(result).toBe(800);
		} finally {
			globalThis.fetch = originalFetch;
		}
	});
});

describe("calculateMaxPosition (pure)", () => {
	test("LSE stock: limits used directly in GBP", async () => {
		const { calculateMaxPosition } = await import("../src/risk/manager.ts");

		const result = calculateMaxPosition(
			100,
			"GBP",
			{
				netLiquidation: 10000,
				totalCashValue: 8000,
			},
			{
				MAX_POSITION_PCT: 15,
				MAX_POSITION_VALUE: 50000,
				MIN_CASH_RESERVE_PCT: 10,
			},
			1,
		);

		// pctLimit = 10000 * 15/100 = 1500 GBP
		// availableCash = 8000 - (10000 * 10/100) = 7000 GBP
		// maxValue = min(1500, 50000, 7000) = 1500 GBP
		// maxQuantity = floor(1500 / 100) = 15
		expect(result.maxValue).toBe(1500);
		expect(result.maxQuantity).toBe(15);
	});

	test("US stock: GBP limits converted to USD via FX rate", async () => {
		const { calculateMaxPosition } = await import("../src/risk/manager.ts");
		const fxRate = 1.25; // 1 GBP = 1.25 USD

		const result = calculateMaxPosition(
			100,
			"USD",
			{
				netLiquidation: 10000,
				totalCashValue: 8000,
			},
			{
				MAX_POSITION_PCT: 15,
				MAX_POSITION_VALUE: 50000,
				MIN_CASH_RESERVE_PCT: 10,
			},
			fxRate,
		);

		// pctLimit = 10000 * 15/100 = 1500 GBP → 1500 * 1.25 = 1875 USD
		// availableCash = 8000 - 1000 = 7000 GBP → 8750 USD
		// maxValueGbp = min(1500, 50000, 7000) = 1500 GBP
		// maxValue = 1500 * 1.25 = 1875 USD
		// maxQuantity = floor(1875 / 100) = 18
		expect(result.maxValue).toBe(1875);
		expect(result.maxQuantity).toBe(18);
	});

	test("zero available cash returns zero", async () => {
		const { calculateMaxPosition } = await import("../src/risk/manager.ts");

		const result = calculateMaxPosition(
			100,
			"GBP",
			{
				netLiquidation: 10000,
				totalCashValue: 500,
			},
			{
				MAX_POSITION_PCT: 15,
				MAX_POSITION_VALUE: 50000,
				MIN_CASH_RESERVE_PCT: 10,
			},
			1,
		);

		// availableCash = 500 - 1000 = -500 → clamped to 0
		// maxValue = min(1500, 50000, 0) = 0
		expect(result.maxValue).toBe(0);
		expect(result.maxQuantity).toBe(0);
	});
});

describe("calculateAtrPosition (pure)", () => {
	test("US stock: ATR-based sizing converts limits to USD", async () => {
		const { calculateAtrPosition } = await import("../src/risk/manager.ts");
		const fxRate = 1.25;

		const result = calculateAtrPosition(
			100,
			5,
			"USD",
			{
				netLiquidation: 10000,
				totalCashValue: 8000,
			},
			{
				MAX_POSITION_PCT: 15,
				MAX_POSITION_VALUE: 50000,
				MIN_CASH_RESERVE_PCT: 10,
				STOP_LOSS_ATR_MULTIPLIER: 2,
				RISK_PER_TRADE_PCT: 1,
				TARGET_ATR_MULTIPLIER: 3,
			},
			fxRate,
		);

		// riskPerShare = 5 * 2 = 10 USD
		// riskBudget = 10000 * 1/100 = 100 GBP → 100 * 1.25 = 125 USD
		// atrQuantity = floor(125 / 10) = 12
		// atrValue = 12 * 100 = 1200 USD
		// pctLimit = 1500 GBP → 1875 USD
		// maxValue = min(1200, 1875, 50000*1.25, 7000*1.25) = 1200 USD
		// maxQuantity = floor(1200 / 100) = 12
		expect(result.maxQuantity).toBe(12);
		expect(result.maxValue).toBe(1200);
		expect(result.stopLossPrice).toBe(90); // 100 - 10
		expect(result.targetPrice).toBe(115); // 100 + 5*3
		expect(result.riskPerShare).toBe(10);
	});
});
