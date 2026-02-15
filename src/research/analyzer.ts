import Anthropic from "@anthropic-ai/sdk";
import { getConfig } from "../config.ts";
import { createChildLogger } from "../utils/logger.ts";

const log = createChildLogger({ module: "research-analyzer" });

let _client: Anthropic | null = null;

function getClient(): Anthropic {
	if (!_client) {
		_client = new Anthropic({ apiKey: getConfig().ANTHROPIC_API_KEY });
	}
	return _client;
}

export interface AnalysisResult {
	sentiment: number; // -1 to 1
	action: "BUY" | "SELL" | "HOLD" | "WATCH";
	confidence: number; // 0 to 1
	bullCase: string;
	bearCase: string;
	analysis: string;
}

const ANALYSIS_SYSTEM = `You are a stock analyst specializing in LSE-listed UK equities. Analyze the provided data and give a clear, structured assessment.

Always respond in valid JSON with these fields:
- sentiment: number from -1 (very bearish) to 1 (very bullish)
- action: "BUY" | "SELL" | "HOLD" | "WATCH"
- confidence: number from 0 to 1
- bullCase: string (max 200 chars)
- bearCase: string (max 200 chars)
- analysis: string (max 500 chars)

Be conservative. Default to WATCH unless there's a compelling case.`;

/** Analyze a stock using Claude */
export async function analyzeStock(
	symbol: string,
	data: {
		quote?: unknown;
		fundamentals?: unknown;
		news?: unknown;
		historicalBars?: unknown;
	},
): Promise<AnalysisResult> {
	const client = getClient();
	const config = getConfig();

	const prompt = `Analyze ${symbol} (LSE) based on this data:

Quote: ${JSON.stringify(data.quote ?? "N/A")}
Fundamentals: ${JSON.stringify(data.fundamentals ?? "N/A")}
Recent News: ${JSON.stringify(data.news ?? "N/A")}
Price History: ${JSON.stringify(data.historicalBars ?? "N/A")}

Provide your analysis as JSON.`;

	try {
		const response = await client.messages.create({
			model: config.CLAUDE_MODEL,
			max_tokens: 1024,
			system: ANALYSIS_SYSTEM,
			messages: [{ role: "user", content: prompt }],
		});

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
		};
	}
}
