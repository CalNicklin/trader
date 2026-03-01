import { z } from "zod";

import type { EvalTask, EvalTrial, GraderResult } from "../types.ts";

const GRADER = "code:trade-review";

const Outcome = z.enum(["win", "loss", "breakeven"]);

const TradeReviewOutputSchema = z.object({
	outcome: Outcome,
	reasoningQuality: z.number().int().min(1).max(5),
	lessonLearned: z.string().min(1),
});

function parseOutput(trial: EvalTrial): z.infer<typeof TradeReviewOutputSchema> | string {
	const raw = typeof trial.output === "string" ? trial.output : JSON.stringify(trial.output);
	try {
		const parsed: unknown = JSON.parse(raw);
		const result = TradeReviewOutputSchema.safeParse(parsed);
		if (!result.success) {
			return result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
		}
		return result.data;
	} catch {
		return "output is not valid JSON";
	}
}

export function gradeTradeReview(trial: EvalTrial, task: EvalTask): GraderResult[] {
	const results: GraderResult[] = [];
	void task;

	if (trial.error) {
		results.push({ kind: "skip", grader: GRADER, reason: `trial errored: ${trial.error}` });
		return results;
	}

	const parsed = parseOutput(trial);
	if (typeof parsed === "string") {
		results.push({ kind: "fail", grader: GRADER, detail: `schema validation failed: ${parsed}` });
		return results;
	}

	results.push({
		kind: "pass",
		grader: `${GRADER}:schema`,
		detail: "output matches TradeReviewOutputSchema",
	});

	results.push({
		kind: "score",
		grader: `${GRADER}:reasoning-quality`,
		score: parsed.reasoningQuality,
		detail: `reasoningQuality=${parsed.reasoningQuality}/5`,
	});

	results.push({
		kind: "label",
		grader: `${GRADER}:outcome`,
		label: parsed.outcome,
		detail: `lesson: ${parsed.lessonLearned.slice(0, 120)}`,
	});

	return results;
}
