import { z } from "zod";

import type { EvalTask, EvalTrial, GraderResult } from "../types.ts";

const GRADER = "code:research";

const SuggestedAction = z.enum(["BUY", "SELL", "HOLD", "WATCH"]);
const QualityPass = z.enum(["pass", "marginal", "fail"]);

const ResearchOutputSchema = z.object({
	sentiment: z.number(),
	action: SuggestedAction,
	confidence: z.number(),
	quality_pass: QualityPass,
});

function parseOutput(trial: EvalTrial): z.infer<typeof ResearchOutputSchema> | string {
	const raw = typeof trial.output === "string" ? trial.output : JSON.stringify(trial.output);
	try {
		const parsed: unknown = JSON.parse(raw);
		const result = ResearchOutputSchema.safeParse(parsed);
		if (!result.success) {
			return result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
		}
		return result.data;
	} catch {
		return "output is not valid JSON";
	}
}

export function gradeResearch(trial: EvalTrial, task: EvalTask): GraderResult[] {
	const results: GraderResult[] = [];

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
		detail: "output matches ResearchOutputSchema",
	});

	if (parsed.confidence < 0 || parsed.confidence > 1) {
		results.push({
			kind: "fail",
			grader: `${GRADER}:confidence-range`,
			detail: `confidence ${parsed.confidence} outside [0, 1]`,
		});
	} else {
		results.push({ kind: "pass", grader: `${GRADER}:confidence-range` });
	}

	if (parsed.quality_pass === "fail" && parsed.action === "BUY") {
		results.push({
			kind: "flag",
			grader: `${GRADER}:quality-action`,
			flag: "buy-on-fail",
			detail: `action is BUY but quality_pass is "fail"`,
		});
	} else {
		results.push({ kind: "pass", grader: `${GRADER}:quality-action` });
	}

	// Stamp duty on LSE makes low-conviction BUYs unprofitable
	const exchange = task.input.exchange;
	if (exchange === "LSE" && parsed.action === "BUY" && parsed.confidence < 0.6) {
		results.push({
			kind: "flag",
			grader: `${GRADER}:lse-conviction`,
			flag: "low-conviction-lse-buy",
			detail: `LSE BUY with confidence ${parsed.confidence} < 0.6 threshold (stamp duty friction)`,
		});
	} else if (exchange === "LSE" && parsed.action === "BUY") {
		results.push({ kind: "pass", grader: `${GRADER}:lse-conviction` });
	}

	results.push({
		kind: "label",
		grader: `${GRADER}:action`,
		label: parsed.action,
		detail: `confidence=${parsed.confidence}, quality=${parsed.quality_pass}`,
	});

	return results;
}
