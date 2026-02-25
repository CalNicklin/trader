import type { HistoricalBar } from "../broker/market-data.ts";

export interface TechnicalIndicators {
	symbol: string;
	computed: string;

	sma20: number | null;
	sma50: number | null;
	sma200: number | null;
	trendAlignment: "strong_up" | "up" | "neutral" | "down" | "strong_down";
	priceVsSma20Pct: number | null;
	priceVsSma50Pct: number | null;

	rsi14: number | null;
	rsiRegime: "overbought" | "bullish" | "neutral" | "bearish" | "oversold" | null;
	macdLine: number | null;
	macdSignal: number | null;
	macdHistogram: number | null;
	macdCrossover: "bullish" | "bearish" | "none";

	atr14: number | null;
	atrPercent: number | null;
	bollingerUpper: number | null;
	bollingerMiddle: number | null;
	bollingerLower: number | null;
	bollingerPercentB: number | null;

	volumeSma20: number | null;
	volumeRatio: number | null;
	volumeTrend: "increasing" | "stable" | "decreasing" | null;

	distanceFromHigh52w: number | null;
	distanceFromLow52w: number | null;
}

function sma(data: readonly number[], period: number): number | null {
	if (data.length < period) return null;
	const slice = data.slice(-period);
	return slice.reduce((a, b) => a + b, 0) / period;
}

function rsi(closes: readonly number[], period = 14): number | null {
	if (closes.length < period + 1) return null;
	let avgGain = 0;
	let avgLoss = 0;
	for (let i = 1; i <= period; i++) {
		const change = closes[i]! - closes[i - 1]!;
		if (change > 0) avgGain += change;
		else avgLoss += Math.abs(change);
	}
	avgGain /= period;
	avgLoss /= period;
	for (let i = period + 1; i < closes.length; i++) {
		const change = closes[i]! - closes[i - 1]!;
		avgGain = (avgGain * (period - 1) + Math.max(0, change)) / period;
		avgLoss = (avgLoss * (period - 1) + Math.max(0, -change)) / period;
	}
	if (avgLoss === 0) return 100;
	const rs = avgGain / avgLoss;
	return 100 - 100 / (1 + rs);
}

function emaSeriesFrom(data: readonly number[], period: number): number[] {
	if (data.length < period) return [];
	const k = 2 / (period + 1);
	const series: number[] = [];
	let val = data.slice(0, period).reduce((a, b) => a + b, 0) / period;
	series.push(val);
	for (let i = period; i < data.length; i++) {
		val = data[i]! * k + val * (1 - k);
		series.push(val);
	}
	return series;
}

function macd(closes: readonly number[]): {
	line: number | null;
	signal: number | null;
	histogram: number | null;
} {
	if (closes.length < 35) return { line: null, signal: null, histogram: null };

	const ema12Series = emaSeriesFrom(closes, 12);
	const ema26Series = emaSeriesFrom(closes, 26);

	// Align: ema12 starts at index 12, ema26 at index 26. Overlap starts at index 26.
	const offset = 26 - 12; // 14 — skip first 14 of ema12 to align
	const macdLine: number[] = [];
	for (let i = 0; i < ema26Series.length; i++) {
		macdLine.push(ema12Series[i + offset]! - ema26Series[i]!);
	}

	if (macdLine.length < 9) return { line: null, signal: null, histogram: null };

	const signalSeries = emaSeriesFrom(macdLine, 9);
	const latestLine = macdLine[macdLine.length - 1]!;
	const latestSignal = signalSeries[signalSeries.length - 1]!;

	return {
		line: latestLine,
		signal: latestSignal,
		histogram: latestLine - latestSignal,
	};
}

function atr(bars: readonly HistoricalBar[], period = 14): number | null {
	if (bars.length < period + 1) return null;
	const trueRanges: number[] = [];
	for (let i = 1; i < bars.length; i++) {
		const tr = Math.max(
			bars[i]!.high - bars[i]!.low,
			Math.abs(bars[i]!.high - bars[i - 1]!.close),
			Math.abs(bars[i]!.low - bars[i - 1]!.close),
		);
		trueRanges.push(tr);
	}
	let result = trueRanges.slice(0, period).reduce((a, b) => a + b, 0) / period;
	for (let i = period; i < trueRanges.length; i++) {
		result = (result * (period - 1) + trueRanges[i]!) / period;
	}
	return result;
}

function bollingerBands(
	closes: readonly number[],
	period = 20,
	mult = 2,
): {
	upper: number | null;
	middle: number | null;
	lower: number | null;
	percentB: number | null;
} {
	const middle = sma(closes, period);
	if (middle === null) return { upper: null, middle: null, lower: null, percentB: null };
	const slice = closes.slice(-period);
	const variance = slice.reduce((sum, v) => sum + (v - middle) ** 2, 0) / period;
	const stdDev = Math.sqrt(variance);
	const upper = middle + mult * stdDev;
	const lower = middle - mult * stdDev;
	const currentPrice = closes[closes.length - 1]!;
	const percentB = upper !== lower ? (currentPrice - lower) / (upper - lower) : 0.5;
	return { upper, middle, lower, percentB };
}

function classifyTrend(
	price: number,
	sma20: number | null,
	sma50: number | null,
	sma200: number | null,
): TechnicalIndicators["trendAlignment"] {
	if (sma20 === null || sma50 === null) return "neutral";
	if (sma200 !== null && price > sma20 && sma20 > sma50 && sma50 > sma200) return "strong_up";
	if (sma200 !== null && price < sma20 && sma20 < sma50 && sma50 < sma200) return "strong_down";
	if (price > sma50 && sma20 > sma50) return "up";
	if (price < sma50 && sma20 < sma50) return "down";
	return "neutral";
}

function classifyRsi(value: number | null): TechnicalIndicators["rsiRegime"] {
	if (value === null) return null;
	if (value > 70) return "overbought";
	if (value > 55) return "bullish";
	if (value > 45) return "neutral";
	if (value > 30) return "bearish";
	return "oversold";
}

function detectMacdCrossover(closes: readonly number[]): TechnicalIndicators["macdCrossover"] {
	if (closes.length < 38) return "none";
	// Check last 3 bars for crossover by computing MACD for current and 3-bars-ago
	const currentMacd = macd(closes);
	const prevMacd = macd(closes.slice(0, -3));
	if (
		currentMacd.line === null ||
		currentMacd.signal === null ||
		prevMacd.line === null ||
		prevMacd.signal === null
	)
		return "none";
	const currentAbove = currentMacd.line > currentMacd.signal;
	const prevAbove = prevMacd.line > prevMacd.signal;
	if (currentAbove && !prevAbove) return "bullish";
	if (!currentAbove && prevAbove) return "bearish";
	return "none";
}

function classifyVolumeTrend(
	volume5Avg: number | null,
	volume20Avg: number | null,
): TechnicalIndicators["volumeTrend"] {
	if (volume5Avg === null || volume20Avg === null || volume20Avg === 0) return null;
	const ratio = volume5Avg / volume20Avg;
	if (ratio > 1.2) return "increasing";
	if (ratio < 0.8) return "decreasing";
	return "stable";
}

export function computeIndicators(
	symbol: string,
	bars: readonly HistoricalBar[],
): TechnicalIndicators {
	const closes = bars.map((b) => b.close);
	const volumes = bars.map((b) => b.volume);
	const currentPrice = closes[closes.length - 1]!;
	const currentVolume = volumes[volumes.length - 1]!;

	const sma20Val = sma(closes, 20);
	const sma50Val = sma(closes, 50);
	const sma200Val = sma(closes, 200);
	const rsi14Val = rsi(closes, 14);
	const macdResult = macd(closes);
	const atr14Val = atr(bars, 14);
	const bbands = bollingerBands(closes, 20, 2);
	const volumeSma20Val = sma(volumes, 20);
	const volume5Avg = sma(volumes.slice(-5), 5);

	const high52w = Math.max(...bars.map((b) => b.high));
	const low52w = Math.min(...bars.map((b) => b.low));

	return {
		symbol,
		computed: new Date().toISOString(),
		sma20: sma20Val,
		sma50: sma50Val,
		sma200: sma200Val,
		trendAlignment: classifyTrend(currentPrice, sma20Val, sma50Val, sma200Val),
		priceVsSma20Pct: sma20Val ? ((currentPrice - sma20Val) / sma20Val) * 100 : null,
		priceVsSma50Pct: sma50Val ? ((currentPrice - sma50Val) / sma50Val) * 100 : null,
		rsi14: rsi14Val,
		rsiRegime: classifyRsi(rsi14Val),
		macdLine: macdResult.line,
		macdSignal: macdResult.signal,
		macdHistogram: macdResult.histogram,
		macdCrossover: detectMacdCrossover(closes),
		atr14: atr14Val,
		atrPercent: atr14Val ? (atr14Val / currentPrice) * 100 : null,
		bollingerUpper: bbands.upper,
		bollingerMiddle: bbands.middle,
		bollingerLower: bbands.lower,
		bollingerPercentB: bbands.percentB,
		volumeSma20: volumeSma20Val,
		volumeRatio: volumeSma20Val ? currentVolume / volumeSma20Val : null,
		volumeTrend: classifyVolumeTrend(volume5Avg, volumeSma20Val),
		distanceFromHigh52w: high52w > 0 ? ((high52w - currentPrice) / high52w) * 100 : null,
		distanceFromLow52w: low52w > 0 ? ((currentPrice - low52w) / low52w) * 100 : null,
	};
}

const barsCache = new Map<string, { bars: HistoricalBar[]; fetchedAt: number }>();
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

export async function getIndicatorsForSymbol(
	symbol: string,
	duration = "3 M",
): Promise<TechnicalIndicators | null> {
	const cacheKey = `${symbol}:${duration}`;
	const cached = barsCache.get(cacheKey);
	if (cached && Date.now() - cached.fetchedAt < CACHE_TTL) {
		return computeIndicators(symbol, cached.bars);
	}
	try {
		const { getHistoricalBars } = await import("../broker/market-data.ts");
		const bars = await getHistoricalBars(symbol, duration);
		if (bars.length === 0) return null;
		barsCache.set(cacheKey, { bars, fetchedAt: Date.now() });
		return computeIndicators(symbol, bars);
	} catch {
		return null;
	}
}

export function formatIndicatorSummary(ind: TechnicalIndicators): string {
	const parts: string[] = [`${ind.symbol}:`];

	if (ind.trendAlignment) {
		parts.push(`Trend: ${ind.trendAlignment.replace("_", " ")}`);
	}
	if (ind.priceVsSma50Pct !== null) {
		parts.push(
			`Price vs SMA50: ${ind.priceVsSma50Pct > 0 ? "+" : ""}${ind.priceVsSma50Pct.toFixed(1)}%`,
		);
	}
	if (ind.rsi14 !== null) {
		parts.push(`RSI(14): ${ind.rsi14.toFixed(0)} (${ind.rsiRegime})`);
	}
	if (ind.macdCrossover !== "none") {
		parts.push(`MACD: ${ind.macdCrossover} crossover`);
	}
	if (ind.atrPercent !== null) {
		parts.push(`ATR: ${ind.atrPercent.toFixed(1)}% daily`);
	}
	if (ind.bollingerPercentB !== null) {
		const bbPos =
			ind.bollingerPercentB > 0.8
				? "near upper band"
				: ind.bollingerPercentB < 0.2
					? "near lower band"
					: "mid-band";
		parts.push(`BB: ${bbPos} (${(ind.bollingerPercentB * 100).toFixed(0)}%B)`);
	}
	if (ind.volumeRatio !== null) {
		parts.push(`Volume: ${(ind.volumeRatio * 100).toFixed(0)}% of 20d avg`);
	}
	if (ind.distanceFromHigh52w !== null) {
		parts.push(`52w: ${ind.distanceFromHigh52w.toFixed(1)}% below high`);
	}

	return parts.join(" | ");
}
