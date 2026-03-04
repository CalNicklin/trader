// Pricing per million tokens by model tier (Claude API rates)
export const PRICING = {
	opus: { input: 15.0, output: 75.0, cacheWrite: 18.75, cacheRead: 1.5 },
	sonnet: { input: 3.0, output: 15.0, cacheWrite: 3.75, cacheRead: 0.3 },
	haiku: { input: 1.0, output: 5.0, cacheWrite: 1.25, cacheRead: 0.1 },
} as const;

const HAIKU_JOBS = new Set([
	"quick_scan",
	"trade_reviewer",
	"pattern_analyzer",
	"news_discovery",
	"decision_scorer_extract",
	"trading_analyst",
]);

type Tier = keyof typeof PRICING;

function getPricing(job: string): (typeof PRICING)[Tier] {
	if (HAIKU_JOBS.has(job)) return PRICING.haiku;
	return PRICING.sonnet;
}

export function estimateCost(
	job: string,
	inputTokens: number,
	outputTokens: number,
	cacheCreationTokens?: number,
	cacheReadTokens?: number,
): number {
	const p = getPricing(job);
	// Anthropic API: input_tokens already EXCLUDES cache tokens.
	// total_input = input_tokens + cache_creation + cache_read (they're additive, not overlapping)
	const cacheWrite = cacheCreationTokens ?? 0;
	const cacheRead = cacheReadTokens ?? 0;
	return (
		(inputTokens * p.input +
			outputTokens * p.output +
			cacheWrite * p.cacheWrite +
			cacheRead * p.cacheRead) /
		1_000_000
	);
}
