import Anthropic from "@anthropic-ai/sdk";

import { gradeNewsDiscovery } from "../graders/code-graders-news.ts";
import type { EvalTask, EvalTrial, Suite } from "../types.ts";

const EXTRACTION_PROMPT = `Extract stock tickers mentioned in these financial headlines. Only include companies clearly mentioned by name.

Exchange selection rules (CRITICAL — follow exactly):
- Choose exchange based on the company's primary listing, NOT from the ticker symbol. UK-listed companies → LSE. US-listed companies → NASDAQ or NYSE.
- Use ONLY "LSE", "NASDAQ", or "NYSE". No other values (AMEX, XETRA, LON, OTC, etc.) are valid.
- If unsure of primary listing: UK companies → prefer LSE; US companies → prefer NYSE.

Return a JSON array of objects with "symbol" (without .L suffix), "name", and "exchange". Return [] if none found.`;

async function runNewsDiscoveryTrial(task: EvalTask): Promise<EvalTrial> {
	const { getConfig } = await import("../../config.ts");
	const config = getConfig();

	const client = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY, maxRetries: 1 });

	const headlines =
		typeof task.input.headlines === "string"
			? task.input.headlines
			: JSON.stringify(task.input.headlines);

	const userMessage = `${EXTRACTION_PROMPT}\n\nHeadlines:\n${headlines}`;

	const start = performance.now();
	const response = await client.messages.create({
		model: config.CLAUDE_MODEL_FAST,
		max_tokens: 512,
		messages: [{ role: "user", content: userMessage }],
	});

	const text = response.content
		.filter((b): b is Anthropic.TextBlock => b.type === "text")
		.map((b) => b.text)
		.join("");

	const jsonMatch = text.match(/\[[\s\S]*\]/);
	const output = jsonMatch ? jsonMatch[0] : text;

	return {
		taskId: task.id,
		trialIndex: 0,
		output,
		durationMs: performance.now() - start,
		tokenUsage: {
			inputTokens: response.usage.input_tokens,
			outputTokens: response.usage.output_tokens,
			cacheCreationTokens: response.usage.cache_creation_input_tokens ?? undefined,
			cacheReadTokens: response.usage.cache_read_input_tokens ?? undefined,
		},
	};
}

export const newsDiscoverySuite: Suite = {
	config: {
		name: "news_discovery",
		description: "Extraction quality for Haiku news discovery",
		regressionTrials: 1,
		capabilityTrials: 1,
	},
	graders: [{ type: "code", fn: gradeNewsDiscovery }],
	loadTasks: async () => {
		const { loadNewsDiscoveryTasks } = await import("../tasks/seed-from-prod.ts");
		return loadNewsDiscoveryTasks();
	},
	runTrial: runNewsDiscoveryTrial,
};
