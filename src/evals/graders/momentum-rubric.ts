/**
 * Structured momentum trading principles for LLM grader prompts.
 * Sourced from: QuantInsti momentum strategies, Investopedia momentum definition,
 * Bayes/City UK momentum survival research.
 */

export interface MomentumPrinciple {
	readonly id: number;
	readonly name: string;
	readonly summary: string;
	readonly graderGuidance: string;
}

export const MOMENTUM_PRINCIPLES = [
	{
		id: 1,
		name: "Buy high, sell higher",
		summary:
			"Momentum trading is NOT value investing. A stock near 52-week highs with confirmed trend alignment and volume is a BUY candidate, not overvalued.",
		graderGuidance:
			"Do NOT downgrade a BUY decision solely because the stock is near 52-week highs, provided trend alignment (SMA20 > SMA50) and volume confirm.",
	},
	{
		id: 2,
		name: "Trend persistence is the edge",
		summary:
			"Trends persist before reversing. Positive momentum survives ~4 months on average in UK style portfolios; negative momentum survives 2-3 months.",
		graderGuidance:
			"Expect the agent to hold winners longer than it cuts losers. A 2-week hold on a trending stock is not premature.",
	},
	{
		id: 3,
		name: "Volume confirms momentum",
		summary:
			"Price moves without volume confirmation are noise. Increasing volume during advances confirms momentum; decreasing volume suggests weakening.",
		graderGuidance:
			"Flag when the agent ignores volume divergence. The gate requires volumeRatio >= 0.8; BUY decisions with low volume are suspect.",
	},
	{
		id: 4,
		name: "Multiple indicator confirmation",
		summary:
			"Relying on a single indicator is fragile. Triangulate across trend alignment + RSI + MACD + volume.",
		graderGuidance:
			"Reward decisions that reference multiple confirming signals. Penalise decisions based on a single indicator.",
	},
	{
		id: 5,
		name: "Transaction cost awareness",
		summary:
			"LSE stocks carry 0.5% stamp duty. The momentum move must exceed ~2% to be profitable. US stocks have lower friction for shorter plays.",
		graderGuidance:
			"Flag LSE BUY decisions where the expected move is < 2%. Prefer US stocks for shorter-duration momentum plays.",
	},
	{
		id: 6,
		name: "Momentum decay and exit timing",
		summary:
			"Momentum decays predictably. Declining ADX, bearish RSI divergence, or shrinking MACD histogram are exit signals.",
		graderGuidance:
			'Penalise "diamond hands" behaviour when deceleration signals are clear. The agent should not hold indefinitely.',
	},
	{
		id: 7,
		name: "Reversal risk at extremes",
		summary:
			"RSI > 75 (overbought) and RSI < 30 (oversold) are inflection zones, not continuation zones.",
		graderGuidance:
			"Entering a new position at RSI > 75 without a specific catalyst is chasing exhausted momentum — treat as a significant error.",
	},
	{
		id: 8,
		name: "Golden cross / death cross",
		summary:
			"SMA crossovers are the foundational momentum signal. SMA20 > SMA50 = bullish trend alignment; SMA20 < SMA50 = bearish.",
		graderGuidance:
			"Buying into a death cross (SMA20 < SMA50) without extraordinary justification is wrong. Verify the agent respects trend alignment.",
	},
	{
		id: 9,
		name: "Bollinger Band context",
		summary:
			"Price near the upper Bollinger Band in a trending market is normal (riding the band), not a sell signal.",
		graderGuidance:
			"Do NOT penalise holds when bollingerPercentB > 0.8 if trend alignment is strong. Lower band break in downtrend confirms continuation.",
	},
	{
		id: 10,
		name: "UK momentum survival asymmetry",
		summary:
			"Negative momentum in UK large caps survives ~2 months vs ~4 months for positive. Cut losers quicker than winners.",
		graderGuidance:
			"Penalise symmetric holding periods for winners and losers. Losing positions held beyond 2 months should be flagged.",
	},
] as const satisfies readonly MomentumPrinciple[];

export type MomentumPrincipleId = (typeof MOMENTUM_PRINCIPLES)[number]["id"];

/**
 * Format principles for inclusion in an LLM grader prompt.
 * @param ids - Subset of principle IDs to include, or omit for all 10.
 */
export function formatPrinciplesForPrompt(ids?: readonly number[]): string {
	const selected = ids
		? MOMENTUM_PRINCIPLES.filter((p) => ids.includes(p.id))
		: MOMENTUM_PRINCIPLES;

	return selected
		.map(
			(p) =>
				`${p.id}. **${p.name}**: ${p.summary}\n   Grading: ${p.graderGuidance}`,
		)
		.join("\n\n");
}
