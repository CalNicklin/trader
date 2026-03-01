import Anthropic from "@anthropic-ai/sdk";
import { getTradingMode } from "../agent/prompts/trading-mode.ts";
import { formatIndicatorSummary, type TechnicalIndicators } from "../analysis/indicators.ts";
import { getConfig } from "../config.ts";
import { formatPrinciplesForPrompt } from "../evals/graders/momentum-rubric.ts";
import { createChildLogger } from "../utils/logger.ts";
import { recordUsage } from "../utils/token-tracker.ts";

const log = createChildLogger({ module: "research-analyzer" });

let _client: Anthropic | null = null;

function getClient(): Anthropic {
	if (!_client) {
		_client = new Anthropic({ apiKey: getConfig().ANTHROPIC_API_KEY });
	}
	return _client;
}

export interface AnalysisResult {
	sentiment: number;
	action: "BUY" | "SELL" | "HOLD" | "WATCH";
	confidence: number;
	bullCase: string;
	bearCase: string;
	analysis: string;
	quality_pass: "pass" | "marginal" | "fail";
	quality_flags: string[];
	catalyst: "positive" | "neutral" | "negative" | "earnings_imminent";
	catalyst_detail: string;
	fundamental_value: "undervalued" | "fair" | "overvalued";
	earnings_proximity: number | null;
	momentum_assessment: "strong" | "building" | "neutral" | "decelerating" | "exhausted";
}

const ANALYSIS_BASE = `You are a MOMENTUM trader. Momentum trading is NOT value investing. A stock near 52-week highs with confirmed trend alignment and volume is a BUY candidate, not overvalued.

## MOMENTUM PRINCIPLES

${formatPrinciplesForPrompt()}

## HARD RULES (violations = quality_pass: "fail")

- Do NOT recommend BUY when SMA20 < SMA50 (death cross) unless there is an extraordinary catalyst
- Do NOT recommend BUY when RSI > 75 without a specific catalyst
- For LSE stocks: Do NOT recommend BUY if expected momentum move < 2% (stamp duty friction)
- Do NOT recommend HOLD or WATCH when the pre-computed Momentum verdict is BUY or STRONG_BUY unless a HARD RULE violation exists (death cross, RSI>75, stamp duty). Fundamental concerns (P/E, P/B, debt ratios) are NOT valid reasons to override a momentum BUY signal.
- Death cross and building momentum are mutually exclusive. If SMA20 < SMA50, momentum_assessment MUST be 'decelerating' or 'exhausted', never 'building' or 'strong'.

## GUIDANCE (consider but may override with justification)

- Volume ratio >= 0.8 confirms momentum; low volume = noise
- Triangulate across trend + RSI + MACD + volume + Bollinger
- Declining ADX + bearish RSI divergence + shrinking MACD histogram = exit signals
- Near 52w highs with confirmed trend = BUY candidate, not "overvalued"
- Bollinger %B > 0.8 in trending market = riding the band (normal), not sell signal

## SECONDARY: Fundamental quality filter

After evaluating momentum signals, also consider:
1. Does this business have real revenue, positive cash flow, and sustainable operations?
2. Are there specific red flags? (cash burn, debt/equity > 1.5, margin compression, revenue decline, pending regulatory action)
3. Are there upcoming catalysts? (earnings, contracts, upgrades, sector shifts)
4. Is the stock cheap, fair, or expensive relative to its sector?

Fundamentals serve as a quality gate — they can disqualify a candidate but should not override strong momentum signals.

## CONSISTENCY CHECK

Before finalizing your response, verify internal consistency:
1. If the Momentum verdict in the Technical Indicators is BUY or STRONG_BUY, your action must be BUY unless a HARD RULE prevents it. State which HARD RULE if overriding.
2. If the Momentum verdict is SELL or STRONG_SELL, your action must be SELL or WATCH (not BUY or HOLD).
3. Your momentum_assessment must be consistent with the trend alignment: if SMA20 < SMA50 (death cross), momentum_assessment cannot be 'strong' or 'building'.
4. Do not use value-investing vocabulary ('distribution phase', 'overvalued', 'expensive') to describe momentum signals. Use momentum vocabulary: 'breakout', 'continuation', 'exhaustion', 'reversal'.

## RESPONSE FORMAT

Always respond in valid JSON with these fields:
- sentiment: number from -1 (very bearish) to 1 (very bullish)
- action: "BUY" | "SELL" | "HOLD" | "WATCH"
- confidence: number from 0 to 1
- bullCase: string (max 200 chars)
- bearCase: string (max 200 chars)
- analysis: string (max 500 chars)
- quality_pass: "pass" | "marginal" | "fail"
- quality_flags: string[] (e.g. ["high_debt", "margin_compression", "cash_burn", "death_cross_buy", "overbought_no_catalyst"])
- catalyst: "positive" | "neutral" | "negative" | "earnings_imminent"
- catalyst_detail: string (e.g. "earnings beat + raised guidance")
- fundamental_value: "undervalued" | "fair" | "overvalued"
- earnings_proximity: number | null (trading days to next earnings, null if unknown)
- momentum_assessment: "strong" | "building" | "neutral" | "decelerating" | "exhausted"`;

const PAPER_SUFFIX =
	"\n\nAssess objectively. Recommend BUY when the thesis is supported by fundamentals or technicals — do not default to WATCH out of caution. This is a paper account generating data for a learning loop.";
const LIVE_SUFFIX = "\n\nBe conservative. Default to WATCH unless there's a compelling case.";

export function getAnalysisSystem(): string {
	return ANALYSIS_BASE + (getTradingMode() === "paper" ? PAPER_SUFFIX : LIVE_SUFFIX);
}

/** Analyze a stock using Claude */
export async function analyzeStock(
	symbol: string,
	data: {
		quote?: unknown;
		fundamentals?: unknown;
		news?: unknown;
		historicalBars?: unknown;
		indicators?: TechnicalIndicators | null;
	},
): Promise<AnalysisResult> {
	const client = getClient();
	const config = getConfig();

	const indicatorLine = data.indicators
		? `\nTechnical Indicators: ${formatIndicatorSummary(data.indicators)}`
		: "";

	const prompt = `Analyze ${symbol} based on this data:

Quote: ${JSON.stringify(data.quote ?? "N/A")}
Fundamentals: ${JSON.stringify(data.fundamentals ?? "N/A")}
Recent News: ${JSON.stringify(data.news ?? "N/A")}
Price History: ${JSON.stringify(data.historicalBars ?? "N/A")}${indicatorLine}

Provide your analysis as JSON.`;

	try {
		const response = await client.messages.create({
			model: config.CLAUDE_MODEL,
			max_tokens: 1024,
			system: [{ type: "text", text: getAnalysisSystem(), cache_control: { type: "ephemeral" } }],
			messages: [{ role: "user", content: prompt }],
		});

		await recordUsage(
			"research",
			response.usage.input_tokens,
			response.usage.output_tokens,
			response.usage.cache_creation_input_tokens ?? undefined,
			response.usage.cache_read_input_tokens ?? undefined,
		);

		const text = response.content
			.filter((b): b is Anthropic.TextBlock => b.type === "text")
			.map((b) => b.text)
			.join("");

		// Extract JSON from response (handle markdown code blocks)
		const jsonMatch = text.match(/\{[\s\S]*\}/);
		if (!jsonMatch) {
			throw new Error("No JSON found in response");
		}

		const result = JSON.parse(jsonMatch[0]) as AnalysisResult;
		log.info({ symbol, action: result.action, confidence: result.confidence }, "Analysis complete");
		return result;
	} catch (error) {
		log.error({ symbol, error }, "Stock analysis failed");
		return {
			sentiment: 0,
			action: "WATCH",
			confidence: 0,
			bullCase: "Analysis failed",
			bearCase: "Analysis failed",
			analysis: `Error: ${error instanceof Error ? error.message : String(error)}`,
			quality_pass: "fail",
			quality_flags: ["analysis_error"],
			catalyst: "neutral",
			catalyst_detail: "",
			fundamental_value: "fair",
			earnings_proximity: null,
			momentum_assessment: "neutral",
		};
	}
}
