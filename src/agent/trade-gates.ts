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
		if (input.confidence < 0.7) {
			return `Confidence ${input.confidence} below minimum 0.7`;
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
