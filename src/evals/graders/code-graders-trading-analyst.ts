import type { EvalTask, EvalTrial, GraderResult } from "../types.ts";

const GRADER = "trading_analyst_code";

function countWords(text: string): number {
	return text.split(/\s+/).filter(Boolean).length;
}

/**
 * maxIterations controls API round-trips, not individual tool calls.
 * Each round-trip can invoke multiple tools in parallel, so the
 * tool-call budget is iterations * TOOLS_PER_ITERATION.
 */
const TOOLS_PER_ITERATION = 3;

function getMaxToolCalls(task: EvalTask): number {
	const raw = task.metadata?.maxIterations;
	const iterations = typeof raw === "number" && raw > 0 ? raw : 5;
	return iterations * TOOLS_PER_ITERATION;
}

export function gradeTradeAnalyst(trial: EvalTrial, task: EvalTask): GraderResult[] {
	const results: GraderResult[] = [];
	const output = typeof trial.output === "string" ? trial.output : String(trial.output ?? "");
	const wordCount = countWords(output);
	const maxToolCalls = getMaxToolCalls(task);

	if (wordCount > 300) {
		results.push({
			kind: "fail",
			grader: GRADER,
			detail: `Response is ${wordCount} words, exceeds 300 word limit`,
		});
	} else {
		results.push({ kind: "pass", grader: GRADER, detail: `Response is ${wordCount} words` });
	}

	const toolCalls = trial.toolCalls ?? [];
	const conclusion = task.input.conclusion;

	if (conclusion === "acted") {
		const hasTradeAction = toolCalls.some(
			(tc) => tc.name === "place_trade" || tc.name === "cancel_order",
		);
		if (!hasTradeAction) {
			results.push({
				kind: "fail",
				grader: GRADER,
				detail: "Conclusion is 'acted' but no place_trade or cancel_order tool call found",
			});
		} else {
			results.push({
				kind: "pass",
				grader: GRADER,
				detail: "Trade action tool call present for 'acted' conclusion",
			});
		}
	}

	if (conclusion === "hold") {
		const hasTrade = toolCalls.some((tc) => tc.name === "place_trade");
		if (hasTrade) {
			results.push({
				kind: "fail",
				grader: GRADER,
				detail: "Conclusion is 'hold' but place_trade tool call found",
			});
		} else {
			results.push({
				kind: "pass",
				grader: GRADER,
				detail: "No place_trade for 'hold' conclusion",
			});
		}
	}

	const gateOverrides = task.input.gateOverrides;
	if (Array.isArray(gateOverrides) && gateOverrides.length > 0) {
		results.push({
			kind: "flag",
			grader: GRADER,
			flag: "gate_override",
			detail: `${gateOverrides.length} gate override(s) present: ${JSON.stringify(gateOverrides)}`,
		});
	}

	if (toolCalls.length > maxToolCalls) {
		results.push({
			kind: "fail",
			grader: GRADER,
			detail: `${toolCalls.length} tool calls exceeds limit (${maxToolCalls})`,
		});
	} else {
		results.push({
			kind: "pass",
			grader: GRADER,
			detail: `${toolCalls.length} tool calls within limit (${maxToolCalls})`,
		});
	}

	for (const tc of toolCalls) {
		if (tc.name !== "log_decision") continue;
		const outputText = typeof tc.output === "string" ? tc.output : String(tc.output ?? "");
		const words = countWords(outputText);
		if (words > 100) {
			results.push({
				kind: "fail",
				grader: GRADER,
				detail: `log_decision output is ${words} words, exceeds 100 word limit`,
			});
		}
	}

	return results;
}
