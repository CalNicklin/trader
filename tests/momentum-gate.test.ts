import { describe, expect, test } from "bun:test";
import type { TechnicalIndicators } from "../src/analysis/indicators.ts";
import { evaluateGate, type MomentumGateConfig } from "../src/analysis/momentum-gate.ts";

const DEFAULT_GATE: MomentumGateConfig = {
	trendAlignment: ["strong_up", "up"],
	rsiRange: [45, 75],
	minVolumeRatio: 0.8,
	excludeOverbought: true,
};

function makeIndicators(overrides: Partial<TechnicalIndicators> = {}): TechnicalIndicators {
	return {
		symbol: "SHEL",
		computed: new Date().toISOString(),
		sma20: 100,
		sma50: 95,
		sma200: 90,
		trendAlignment: "strong_up",
		priceVsSma20Pct: 5,
		priceVsSma50Pct: 10,
		rsi14: 60,
		rsiRegime: "bullish",
		macdLine: 1.5,
		macdSignal: 1.0,
		macdHistogram: 0.5,
		macdCrossover: "none",
		adx14: 30,
		adxTrend: "trending",
		macdHistogramTrend: "expanding",
		atr14: 3.5,
		atrPercent: 2.1,
		bollingerUpper: 110,
		bollingerMiddle: 100,
		bollingerLower: 90,
		bollingerPercentB: 0.6,
		volumeSma20: 100_000,
		volumeRatio: 1.2,
		volumeTrend: "stable",
		distanceFromHigh52w: 5,
		distanceFromLow52w: 20,
		...overrides,
	};
}

describe("evaluateGate", () => {
	test("passes when all criteria met", () => {
		const result = evaluateGate(makeIndicators(), DEFAULT_GATE);
		expect(result.passed).toBe(true);
		expect(result.reasons).toContain("all_gates_passed");
		expect(result.signalState).toBeDefined();
	});

	test("fails on wrong trend alignment", () => {
		const result = evaluateGate(makeIndicators({ trendAlignment: "down" }), DEFAULT_GATE);
		expect(result.passed).toBe(false);
		expect(result.reasons.some((r) => r.includes("trend_alignment=down"))).toBe(true);
	});

	test("fails when RSI outside range", () => {
		const result = evaluateGate(
			makeIndicators({ rsi14: 80, rsiRegime: "overbought" }),
			DEFAULT_GATE,
		);
		expect(result.passed).toBe(false);
		expect(result.reasons.some((r) => r.includes("rsi=80"))).toBe(true);
	});

	test("fails when volume too low", () => {
		const result = evaluateGate(makeIndicators({ volumeRatio: 0.5 }), DEFAULT_GATE);
		expect(result.passed).toBe(false);
		expect(result.reasons.some((r) => r.includes("volume_ratio=0.50"))).toBe(true);
	});

	test("fails when overbought even if RSI in range", () => {
		const result = evaluateGate(
			makeIndicators({ rsi14: 69, rsiRegime: "overbought" }),
			DEFAULT_GATE,
		);
		expect(result.passed).toBe(false);
		expect(result.reasons).toContain("rsi_overbought");
	});

	test("accumulates multiple failure reasons", () => {
		const result = evaluateGate(
			makeIndicators({
				trendAlignment: "neutral",
				rsi14: 25,
				rsiRegime: "oversold",
				volumeRatio: 0.3,
			}),
			DEFAULT_GATE,
		);
		expect(result.passed).toBe(false);
		expect(result.reasons.length).toBeGreaterThanOrEqual(3);
	});

	test("signal state captures key indicator values", () => {
		const indicators = makeIndicators({ rsi14: 55, volumeRatio: 1.1 });
		const result = evaluateGate(indicators, DEFAULT_GATE);
		expect(result.signalState.rsi14).toBe(55);
		expect(result.signalState.volumeRatio).toBe(1.1);
		expect(result.signalState.trendAlignment).toBe("strong_up");
	});
});
