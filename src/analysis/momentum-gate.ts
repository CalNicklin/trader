import type { TechnicalIndicators } from "./indicators.ts";

export interface MomentumGateConfig {
	trendAlignment: ReadonlyArray<"strong_up" | "up">;
	rsiRange: readonly [number, number];
	minVolumeRatio: number;
	excludeOverbought: boolean;
}

export interface GateResult {
	passed: boolean;
	reasons: string[];
	signalState: Record<string, unknown>;
}

export function evaluateGate(
	indicators: TechnicalIndicators,
	gate: MomentumGateConfig,
): GateResult {
	const reasons: string[] = [];
	let passed = true;

	const allowedTrends: ReadonlyArray<string> = gate.trendAlignment;
	if (!allowedTrends.includes(indicators.trendAlignment)) {
		reasons.push(
			`trend_alignment=${indicators.trendAlignment} (need ${gate.trendAlignment.join("|")})`,
		);
		passed = false;
	}

	if (indicators.rsi14 !== null) {
		if (indicators.rsi14 < gate.rsiRange[0] || indicators.rsi14 > gate.rsiRange[1]) {
			reasons.push(
				`rsi=${indicators.rsi14.toFixed(0)} (need ${gate.rsiRange[0]}-${gate.rsiRange[1]})`,
			);
			passed = false;
		}
	}

	if (indicators.volumeRatio !== null && indicators.volumeRatio < gate.minVolumeRatio) {
		reasons.push(
			`volume_ratio=${indicators.volumeRatio.toFixed(2)} (need >=${gate.minVolumeRatio})`,
		);
		passed = false;
	}

	if (gate.excludeOverbought && indicators.rsiRegime === "overbought") {
		reasons.push("rsi_overbought");
		passed = false;
	}

	if (passed) {
		reasons.push("all_gates_passed");
	}

	return {
		passed,
		reasons,
		signalState: {
			trendAlignment: indicators.trendAlignment,
			rsi14: indicators.rsi14,
			rsiRegime: indicators.rsiRegime,
			volumeRatio: indicators.volumeRatio,
			macdCrossover: indicators.macdCrossover,
			atrPercent: indicators.atrPercent,
			bollingerPercentB: indicators.bollingerPercentB,
		},
	};
}

export function loadGateConfig(): MomentumGateConfig {
	try {
		const raw = require("../../config/momentum-gate.json");
		return raw as MomentumGateConfig;
	} catch {
		return {
			trendAlignment: ["strong_up", "up"],
			rsiRange: [45, 75],
			minVolumeRatio: 0.8,
			excludeOverbought: true,
		};
	}
}
