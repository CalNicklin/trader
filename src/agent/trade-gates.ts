import type { MarketPhase } from "../utils/clock.ts";
import { getTradingMode } from "./prompts/trading-mode.ts";

export interface TradeGateInput {
	side: "BUY" | "SELL";
	confidence: number;
	marketPhase: MarketPhase;
	/** Exchange-specific phase — used for wind-down/post-market checks when provided */
	exchangePhase?: MarketPhase;
	riskApproved: boolean;
	riskReasons: string[];
}

/**
 * Pre-trade validation gates. Returns null if trade may proceed,
 * or an error message string if it should be rejected.
 */
export function checkTradeGates(input: TradeGateInput): string | null {
	if (input.side === "BUY") {
		const minConfidence = getTradingMode() === "paper" ? 0.5 : 0.7;
		if (input.confidence < minConfidence) {
			return `Confidence ${input.confidence} below minimum ${minConfidence}`;
		}

		const phase = input.exchangePhase ?? input.marketPhase;
		if (phase === "wind-down" || phase === "post-market") {
			return `BUY orders rejected during ${phase}`;
		}

		if (!input.riskApproved) {
			return `Risk check failed: ${input.riskReasons.join("; ")}`;
		}
	}

	return null;
}
