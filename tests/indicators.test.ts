import { describe, expect, test } from "bun:test";
import { computeIndicators, formatIndicatorSummary } from "../src/analysis/indicators.ts";
import type { HistoricalBar } from "../src/broker/market-data.ts";

function makeTrendingBars(count: number, basePrice = 100, dailyGain = 0.1): HistoricalBar[] {
	return Array.from({ length: count }, (_, i) => ({
		time: `2024-01-${String(i + 1).padStart(2, "0")}`,
		open: basePrice + i * dailyGain,
		high: basePrice + i * dailyGain + 2,
		low: basePrice + i * dailyGain - 2,
		close: basePrice + i * dailyGain,
		volume: 100_000 + i * 1000,
	}));
}

function makeFlatBarsWithVolumes(volumes: number[]): HistoricalBar[] {
	return volumes.map((vol, i) => ({
		time: `2024-01-${String(i + 1).padStart(2, "0")}`,
		open: 100,
		high: 102,
		low: 98,
		close: 100,
		volume: vol,
	}));
}

describe("computeIndicators", () => {
	test("produces non-null core indicators with 250 bars of trending data", () => {
		const bars = makeTrendingBars(250);
		const result = computeIndicators("SHEL", bars);

		expect(result.symbol).toBe("SHEL");
		expect(result.computed).toMatch(/^\d{4}-\d{2}-\d{2}T/);
		expect(result.sma20).not.toBeNull();
		expect(result.sma50).not.toBeNull();
		expect(result.sma200).not.toBeNull();
		expect(result.rsi14).not.toBeNull();
		expect(result.macdLine).not.toBeNull();
		expect(result.atr14).not.toBeNull();
		expect(result.bollingerUpper).not.toBeNull();
		expect(result.volumeSma20).not.toBeNull();
		expect(result.trendAlignment).toBeDefined();
		expect(result.rsiRegime).toBeDefined();
	});

	test("degrades gracefully with only 30 bars", () => {
		const bars = makeTrendingBars(30);
		const result = computeIndicators("SHEL", bars);

		expect(result.sma20).not.toBeNull();
		expect(result.sma50).toBeNull();
		expect(result.sma200).toBeNull();
		expect(result.rsi14).not.toBeNull();
		expect(result.macdLine).toBeNull();
		expect(result.atr14).not.toBeNull();
		expect(result.trendAlignment).toBe("neutral");
	});

	test("RSI near 100 for all-up data, overbought regime", () => {
		const bars: HistoricalBar[] = Array.from({ length: 30 }, (_, i) => ({
			time: `2024-01-${String(i + 1).padStart(2, "0")}`,
			open: 100 + i,
			high: 101 + i,
			low: 99 + i,
			close: 100 + i,
			volume: 100_000,
		}));
		const result = computeIndicators("TEST", bars);
		expect(result.rsi14).not.toBeNull();
		expect(result.rsi14!).toBeGreaterThan(95);
		expect(result.rsiRegime).toBe("overbought");
	});

	test("RSI near 0 for all-down data, oversold regime", () => {
		const bars: HistoricalBar[] = Array.from({ length: 30 }, (_, i) => ({
			time: `2024-01-${String(i + 1).padStart(2, "0")}`,
			open: 200 - i,
			high: 201 - i,
			low: 199 - i,
			close: 200 - i,
			volume: 100_000,
		}));
		const result = computeIndicators("TEST", bars);
		expect(result.rsi14).not.toBeNull();
		expect(result.rsi14!).toBeLessThan(5);
		expect(result.rsiRegime).toBe("oversold");
	});

	test("strong_up trend for steadily rising data over 250 bars", () => {
		// Steady uptrend: price > SMA20 > SMA50 > SMA200
		const bars = makeTrendingBars(250, 100, 0.5);
		const result = computeIndicators("UP", bars);
		expect(result.trendAlignment).toBe("strong_up");
	});

	test("strong_down trend for steadily falling data over 250 bars", () => {
		const bars: HistoricalBar[] = Array.from({ length: 250 }, (_, i) => ({
			time: `2024-01-${String(i + 1).padStart(2, "0")}`,
			open: 500 - i * 0.5,
			high: 502 - i * 0.5,
			low: 498 - i * 0.5,
			close: 500 - i * 0.5,
			volume: 100_000,
		}));
		const result = computeIndicators("DOWN", bars);
		expect(result.trendAlignment).toBe("strong_down");
	});

	test("52-week range computed correctly", () => {
		// Bars with known highs and lows
		const bars: HistoricalBar[] = Array.from({ length: 252 }, (_, i) => ({
			time: `2024-01-${String(i + 1).padStart(2, "0")}`,
			open: 100,
			high: i === 50 ? 150 : 105, // spike high at bar 50
			low: i === 200 ? 80 : 95, // dip low at bar 200
			close: 100,
			volume: 100_000,
		}));
		const result = computeIndicators("RANGE", bars);
		// Distance from high: (150 - 100) / 150 * 100 = 33.33%
		expect(result.distanceFromHigh52w).toBeCloseTo(33.33, 1);
		// Distance from low: (100 - 80) / 80 * 100 = 25%
		expect(result.distanceFromLow52w).toBeCloseTo(25, 1);
	});
});

describe("volume ratio normalization", () => {
	test("without elapsedFraction, volumeRatio is raw currentVolume / sma20", () => {
		const volumes = Array.from<number>({ length: 25 }).fill(100_000);
		const bars = makeFlatBarsWithVolumes(volumes);
		const result = computeIndicators("TEST", bars);
		expect(result.volumeRatio).toBeCloseTo(1.0);
		expect(result.volumeSma20).toBeCloseTo(100_000);
	});

	test("projects partial-day volume to full-day with elapsedFraction", () => {
		const completedDays = Array.from<number>({ length: 24 }).fill(100_000);
		const bars = makeFlatBarsWithVolumes([...completedDays, 50_000]);
		const result = computeIndicators("TEST", bars, 0.5);
		// projected volume = 50,000 / 0.5 = 100,000
		// compared against completed-day average = 100,000
		// ratio should be ~1.0, not ~0.51 (the raw partial ratio)
		expect(result.volumeRatio).toBeCloseTo(1.0, 1);
	});

	test("volumeSma20 excludes today's partial bar during market hours", () => {
		const completedDays = Array.from<number>({ length: 24 }).fill(100_000);
		// Today's partial bar has near-zero volume — should NOT contaminate the SMA
		const bars = makeFlatBarsWithVolumes([...completedDays, 1_000]);
		const result = computeIndicators("TEST", bars, 0.1);
		// SMA should be computed from completed days only (all 100k)
		expect(result.volumeSma20).toBeCloseTo(100_000);
	});

	test("very low elapsedFraction returns null volumeRatio to avoid noise", () => {
		const completedDays = Array.from<number>({ length: 24 }).fill(100_000);
		const bars = makeFlatBarsWithVolumes([...completedDays, 5_000]);
		// 2% through the day — projecting would amplify 50x
		const result = computeIndicators("TEST", bars, 0.02);
		expect(result.volumeRatio).toBeNull();
	});

	test("volumeTrend uses completed days during market hours", () => {
		// 20 days at 100k, then 5 days at 150k (increasing trend)
		const oldDays = Array.from<number>({ length: 20 }).fill(100_000);
		const recentDays = Array.from<number>({ length: 5 }).fill(150_000);
		// Today's partial bar is tiny — would drag 5-day avg down if included
		const bars = makeFlatBarsWithVolumes([...oldDays, ...recentDays, 10_000]);
		const result = computeIndicators("TEST", bars, 0.5);
		// 5-day avg of completed days = 150k, 20-day avg of completed = mix
		// ratio 150k / ~112.5k > 1.2, so should be "increasing"
		expect(result.volumeTrend).toBe("increasing");
	});
});

describe("formatIndicatorSummary", () => {
	test("includes symbol, trend, RSI, ATR, and 52w fields", () => {
		const bars = makeTrendingBars(250, 100, 0.5);
		const indicators = computeIndicators("SHEL", bars);
		const summary = formatIndicatorSummary(indicators);

		expect(summary).toContain("SHEL:");
		expect(summary).toContain("Trend:");
		expect(summary).toContain("RSI(14):");
		expect(summary).toContain("ATR:");
		expect(summary).toContain("52w:");
		expect(summary).toContain(" | ");
	});
});
