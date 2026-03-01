import { z } from "zod";

import type { EvalTask, EvalTrial, GraderResult } from "../types.ts";

const GRADER = "quick_scan_code";

const QuickScanOutputSchema = z.object({
	escalate: z.boolean(),
	reason: z.string().min(1),
});

function toUnknown(raw: unknown): unknown {
	if (typeof raw === "string") {
		try {
			return JSON.parse(raw) as unknown;
		} catch {
			return raw;
		}
	}
	return raw;
}

export function gradeQuickScan(trial: EvalTrial, task: EvalTask): GraderResult[] {
	const results: GraderResult[] = [];
	const parsed = QuickScanOutputSchema.safeParse(toUnknown(trial.output));

	if (!parsed.success) {
		const issues = parsed.error.issues
			.map((issue: { message: string }) => issue.message)
			.join(", ");
		return [
			{
				kind: "fail",
				grader: GRADER,
				detail: `Invalid output JSON: ${issues}`,
			},
		];
	}

	const { escalate, reason } = parsed.data;

	results.push({ kind: "pass", grader: GRADER, detail: "Valid JSON structure" });

	if (reason.length >= 200) {
		results.push({
			kind: "fail",
			grader: GRADER,
			detail: `Reason is ${reason.length} chars, must be under 200`,
		});
	} else {
		results.push({ kind: "pass", grader: GRADER, detail: "Reason length OK" });
	}

	if (task.input.hasStopLossBreach === true && !escalate) {
		results.push({
			kind: "fail",
			grader: GRADER,
			detail: "Stop-loss breach present but escalate is false",
		});
	} else if (task.input.hasStopLossBreach === true) {
		results.push({
			kind: "pass",
			grader: GRADER,
			detail: "Correctly escalated on stop-loss breach",
		});
	}

	if (task.input.isRoutineTick === true && escalate) {
		results.push({
			kind: "fail",
			grader: GRADER,
			detail: "Routine monitoring tick with no changes but escalate is true",
		});
	} else if (task.input.isRoutineTick === true) {
		results.push({
			kind: "pass",
			grader: GRADER,
			detail: "Correctly skipped escalation on routine tick",
		});
	}

	return results;
}
