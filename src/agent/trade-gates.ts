import { getTradingMode } from "./prompts/trading-mode.ts";

type MarketPhase = "pre-market" | "open" | "wind-down" | "post-market" | "research" | "closed";

export interface TradeGateInput {
	side: "BUY" | "SELL";
	confidence: number;
	marketPhase: MarketPhase;
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

		if (input.marketPhase === "wind-down" || input.marketPhase === "post-market") {
			return `BUY orders rejected during ${input.marketPhase}`;
		}

		if (!input.riskApproved) {
			return `Risk check failed: ${input.riskReasons.join("; ")}`;
		}
	}

	return null;
}
