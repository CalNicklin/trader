import Anthropic from "@anthropic-ai/sdk";

import { gradeResearch } from "../graders/code-graders-research.ts";
import { llmGradeResearch } from "../graders/llm-graders.ts";
import type { EvalTask, EvalTrial, Suite } from "../types.ts";

async function runResearchTrial(task: EvalTask): Promise<EvalTrial> {
	const { getConfig } = await import("../../config.ts");
	const config = getConfig();

	const client = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY, maxRetries: 1 });

	const rawData =
		typeof task.input.rawData === "string"
			? task.input.rawData
			: JSON.stringify(task.input.rawData);
	const systemPrompt = typeof task.input.systemPrompt === "string" ? task.input.systemPrompt : "";

	const start = performance.now();
	const response = await client.messages.create({
		model: config.CLAUDE_MODEL,
		max_tokens: 2048,
		system: systemPrompt,
		messages: [{ role: "user", content: rawData }],
	});

	const text = response.content
		.filter((b): b is Anthropic.TextBlock => b.type === "text")
		.map((b) => b.text)
		.join("");

	const jsonMatch = text.match(/\{[\s\S]*\}/);
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

export const researchSuite: Suite = {
	config: {
		name: "research",
		description: "Research quality for Sonnet research analyzer",
		regressionTrials: 1,
		capabilityTrials: 3,
	},
	graders: [
		{ type: "code", fn: gradeResearch },
		{ type: "llm", fn: llmGradeResearch },
	],
	loadTasks: async () => {
		const { loadResearchTasks } = await import("../tasks/seed-from-prod.ts");
		return loadResearchTasks();
	},
	runTrial: runResearchTrial,
};
