import Anthropic from "@anthropic-ai/sdk";

import { gradeNewsDiscovery } from "../graders/code-graders-news.ts";
import type { EvalTask, EvalTrial, Suite } from "../types.ts";

async function runNewsDiscoveryTrial(task: EvalTask): Promise<EvalTrial> {
	const { getConfig } = await import("../../config.ts");
	const config = getConfig();

	const client = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY, maxRetries: 1 });

	const newsContent =
		typeof task.input.newsContent === "string"
			? task.input.newsContent
			: JSON.stringify(task.input.newsContent);
	const systemPrompt = typeof task.input.systemPrompt === "string" ? task.input.systemPrompt : "";

	const start = performance.now();
	const response = await client.messages.create({
		model: config.CLAUDE_MODEL_FAST,
		max_tokens: 1024,
		system: systemPrompt,
		messages: [{ role: "user", content: newsContent }],
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
