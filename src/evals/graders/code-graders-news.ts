import { z } from "zod";

import type { EvalTask, EvalTrial, GraderResult } from "../types.ts";

const GRADER = "code:news-discovery";

const Exchange = z.enum(["LSE", "NASDAQ", "NYSE"]);

const NewsEntrySchema = z.object({
	symbol: z.string(),
	name: z.string(),
	exchange: Exchange,
});

const NewsOutputSchema = z.array(NewsEntrySchema);

function parseOutput(trial: EvalTrial): z.infer<typeof NewsOutputSchema> | string {
	const raw = typeof trial.output === "string" ? trial.output : JSON.stringify(trial.output);
	try {
		const parsed: unknown = JSON.parse(raw);
		const result = NewsOutputSchema.safeParse(parsed);
		if (!result.success) {
			return result.error.issues.map((i) => `[${i.path.join(".")}] ${i.message}`).join("; ");
		}
		return result.data;
	} catch {
		return "output is not valid JSON";
	}
}

export function gradeNewsDiscovery(trial: EvalTrial, task: EvalTask): GraderResult[] {
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
		detail: `${parsed.length} entries parsed`,
	});

	const nonUppercase = parsed.filter((e) => e.symbol !== e.symbol.toUpperCase());
	if (nonUppercase.length > 0) {
		results.push({
			kind: "fail",
			grader: `${GRADER}:symbol-case`,
			detail: `symbols not uppercase: ${nonUppercase.map((e) => e.symbol).join(", ")}`,
		});
	} else {
		results.push({ kind: "pass", grader: `${GRADER}:symbol-case` });
	}

	// .L suffix is an IBKR/Yahoo convention, not a canonical symbol format
	const dotLSymbols = parsed.filter((e) => e.symbol.endsWith(".L"));
	if (dotLSymbols.length > 0) {
		results.push({
			kind: "fail",
			grader: `${GRADER}:no-dot-l`,
			detail: `symbols with .L suffix: ${dotLSymbols.map((e) => e.symbol).join(", ")}`,
		});
	} else {
		results.push({ kind: "pass", grader: `${GRADER}:no-dot-l` });
	}

	const seen = new Set<string>();
	const duplicates: string[] = [];
	for (const entry of parsed) {
		if (seen.has(entry.symbol)) {
			duplicates.push(entry.symbol);
		}
		seen.add(entry.symbol);
	}
	if (duplicates.length > 0) {
		results.push({
			kind: "fail",
			grader: `${GRADER}:no-duplicates`,
			detail: `duplicate symbols: ${[...new Set(duplicates)].join(", ")}`,
		});
	} else {
		results.push({ kind: "pass", grader: `${GRADER}:no-duplicates` });
	}

	results.push({
		kind: "label",
		grader: `${GRADER}:count`,
		label: String(parsed.length),
		detail: `discovered ${parsed.length} symbols`,
	});

	return results;
}
