// Pricing per million tokens by model tier (Claude API rates)
export const PRICING = {
	opus: { input: 15.0, output: 75.0, cacheWrite: 18.75, cacheRead: 1.5 },
	sonnet: { input: 3.0, output: 15.0, cacheWrite: 3.75, cacheRead: 0.3 },
	haiku: { input: 1.0, output: 5.0, cacheWrite: 1.25, cacheRead: 0.1 },
} as const;

const HAIKU_JOBS = new Set([
	"quick_scan",
	"research",
	"trade_reviewer",
	"pattern_analyzer",
	"news_discovery",
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
	// Cache tokens are already counted in inputTokens — subtract them to avoid double-counting,
	// then add back at their discounted rates
	const cacheWrite = cacheCreationTokens ?? 0;
	const cacheRead = cacheReadTokens ?? 0;
	const normalInput = inputTokens - cacheWrite - cacheRead;
	return (
		(normalInput * p.input +
			outputTokens * p.output +
			cacheWrite * p.cacheWrite +
			cacheRead * p.cacheRead) /
		1_000_000
	);
}
