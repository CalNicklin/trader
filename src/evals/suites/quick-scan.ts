import Anthropic from "@anthropic-ai/sdk";

import { gradeQuickScan } from "../graders/code-graders-quick-scan.ts";
import { llmGradeQuickScan } from "../graders/llm-graders.ts";
import type { EvalTask, EvalTrial, Suite } from "../types.ts";

async function runQuickScanTrial(task: EvalTask): Promise<EvalTrial> {
	const { getConfig } = await import("../../config.ts");
	const { getQuickScanSystem } = await import("../../agent/prompts/quick-scan.ts");
	const config = getConfig();

	const client = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY, maxRetries: 1 });
	const context =
		typeof task.input.context === "string" ? task.input.context : JSON.stringify(task.input);

	const start = performance.now();
	const response = await client.messages.create({
		model: config.CLAUDE_MODEL_FAST,
		max_tokens: 256,
		system: getQuickScanSystem(),
		messages: [{ role: "user", content: context }],
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

export const quickScanSuite: Suite = {
	config: {
		name: "quick_scan",
		description: "Escalation quality for Haiku quick scan decisions",
		regressionTrials: 1,
		capabilityTrials: 3,
	},
	graders: [
		{ type: "code", fn: gradeQuickScan },
		{ type: "llm", fn: llmGradeQuickScan },
	],
	loadTasks: async () => {
		const { loadQuickScanTasks } = await import("../tasks/seed-from-prod.ts");
		return loadQuickScanTasks();
	},
	runTrial: runQuickScanTrial,
};
