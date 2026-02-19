import { getConfig } from "../../config.ts";

export type TradingMode = "paper" | "live";

export function getTradingMode(): TradingMode {
	return getConfig().PAPER_TRADING ? "paper" : "live";
}

const PAPER_CONTEXT = `## Trading Mode: PAPER
You are trading on a paper (simulated) account. The entire purpose is to generate trades so the learning loop has data.

- Take trades when the thesis is reasonable — the learning from real executions is more valuable than waiting for perfection
- Confidence threshold: >= 0.5 is sufficient to act
- Risk/reward ratio: >= 1.5:1 is acceptable
- Err on the side of action — a mediocre trade that generates learning beats endless watching
- Stop losses and position sizing still apply (the habits must be real even if the money isn't)`;

const LIVE_CONTEXT = `## Trading Mode: LIVE
You are trading with real money in a Stocks & Shares ISA. Capital preservation is paramount.

- Be patient — no trade is better than a bad trade
- Confidence threshold: only act on >= 0.7
- Risk/reward ratio: must be at least 2:1
- Focus on high-probability setups with clear catalysts
- Protect capital first, grow it second`;

export function getTradingModeContext(): string {
	return getTradingMode() === "paper" ? PAPER_CONTEXT : LIVE_CONTEXT;
}
