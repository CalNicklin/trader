import { gradeTradeAnalyst } from "../graders/code-graders-trading-analyst.ts";
import { llmGradeTradeAnalyst } from "../graders/llm-graders.ts";
import { gradeTranscript } from "../graders/transcript-grader.ts";
import type { EvalTask, EvalTrial, Suite } from "../types.ts";

async function runTradingAnalystTrial(task: EvalTask): Promise<EvalTrial> {
	const { runTradingAnalyst } = await import("../../agent/planner.ts");

	const context =
		typeof task.input.context === "string" ? task.input.context : JSON.stringify(task.input);
	const maxIterations =
		typeof task.metadata?.maxIterations === "number" ? task.metadata.maxIterations : undefined;

	const start = performance.now();
	const response = await runTradingAnalyst(context, maxIterations);

	return {
		taskId: task.id,
		trialIndex: 0,
		output: response.text,
		toolCalls: response.toolCalls.map((tc) => ({
			name: tc.name,
			input: tc.input,
			output: tc.result,
		})),
		durationMs: performance.now() - start,
		tokenUsage: {
			inputTokens: response.tokensUsed.input,
			outputTokens: response.tokensUsed.output,
		},
	};
}

export const tradingAnalystSuite: Suite = {
	config: {
		name: "trading_analyst",
		description: "Decision quality for Sonnet trading analyst sessions",
		regressionTrials: 1,
		capabilityTrials: 3,
	},
	graders: [
		{ type: "code", fn: gradeTradeAnalyst },
		{ type: "llm", fn: llmGradeTradeAnalyst },
		{ type: "transcript", fn: gradeTranscript },
	],
	loadTasks: async () => {
		const { loadTradingAnalystTasks } = await import("../tasks/seed-from-prod.ts");
		return loadTradingAnalystTasks();
	},
	runTrial: runTradingAnalystTrial,
};
