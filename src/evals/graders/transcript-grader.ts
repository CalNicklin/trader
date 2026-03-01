import type { EvalTask, EvalTrial, GraderResult } from "../types.ts";

const GRADER = "trading_analyst_transcript";

function getMaxIterations(task: EvalTask): number {
	const raw = task.metadata?.maxIterations;
	return typeof raw === "number" && raw > 0 ? raw : 5;
}

export function gradeTranscript(trial: EvalTrial, task: EvalTask): GraderResult[] {
	const results: GraderResult[] = [];

	if (trial.tokenUsage && task.metadata?.medianTokens != null) {
		const totalTokens = trial.tokenUsage.inputTokens + trial.tokenUsage.outputTokens;
		const median = Number(task.metadata.medianTokens);
		if (Number.isFinite(median) && median > 0 && totalTokens > 2 * median) {
			results.push({
				kind: "flag",
				grader: GRADER,
				flag: "token_usage_high",
				detail: `Total tokens (${totalTokens}) exceeds 2x median (${median * 2})`,
			});
		}
	}

	const toolCalls = trial.toolCalls ?? [];
	const maxIterations = getMaxIterations(task);

	if (toolCalls.length >= maxIterations) {
		results.push({
			kind: "flag",
			grader: GRADER,
			flag: "iteration_count_high",
			detail: `${toolCalls.length} tool calls >= max iterations (${maxIterations})`,
		});
	}

	const callCounts = new Map<string, number>();
	const duplicateTargets = new Set(["get_positions", "get_account_summary"]);
	for (const tc of toolCalls) {
		if (duplicateTargets.has(tc.name)) {
			callCounts.set(tc.name, (callCounts.get(tc.name) ?? 0) + 1);
		}
	}
	for (const [name, count] of callCounts) {
		if (count > 1) {
			results.push({
				kind: "flag",
				grader: GRADER,
				flag: "duplicate_tool_call",
				detail: `${name} called ${count} times`,
			});
		}
	}

	return results;
}
