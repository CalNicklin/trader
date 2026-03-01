import { z } from "zod";

// ---------------------------------------------------------------------------
// Suite names
// ---------------------------------------------------------------------------

export const SuiteName = z.enum([
	"quick_scan",
	"trading_analyst",
	"research",
	"news_discovery",
	"trade_review",
]);
export type SuiteName = z.infer<typeof SuiteName>;

// ---------------------------------------------------------------------------
// Grader result
// ---------------------------------------------------------------------------

export const GraderResultSchema = z.discriminatedUnion("kind", [
	z.object({
		kind: z.literal("pass"),
		grader: z.string(),
		detail: z.string().optional(),
	}),
	z.object({
		kind: z.literal("fail"),
		grader: z.string(),
		detail: z.string(),
	}),
	z.object({
		kind: z.literal("score"),
		grader: z.string(),
		score: z.number().min(0).max(5),
		dimensions: z.record(z.string(), z.number()).optional(),
		detail: z.string().optional(),
	}),
	z.object({
		kind: z.literal("label"),
		grader: z.string(),
		label: z.string(),
		detail: z.string().optional(),
	}),
	z.object({
		kind: z.literal("flag"),
		grader: z.string(),
		flag: z.string(),
		detail: z.string(),
	}),
	z.object({
		kind: z.literal("skip"),
		grader: z.string(),
		reason: z.string(),
	}),
]);
export type GraderResult = z.infer<typeof GraderResultSchema>;

// ---------------------------------------------------------------------------
// Eval task — a frozen scenario to replay
// ---------------------------------------------------------------------------

export const EvalTaskSchema = z.object({
	id: z.string(),
	suite: SuiteName,
	input: z.record(z.string(), z.unknown()),
	expectedBehavior: z.string().optional(),
	metadata: z.record(z.string(), z.unknown()).optional(),
});
export type EvalTask = z.infer<typeof EvalTaskSchema>;

// ---------------------------------------------------------------------------
// Eval trial — one execution of a task
// ---------------------------------------------------------------------------

export const EvalTrialSchema = z.object({
	taskId: z.string(),
	trialIndex: z.number().int().nonnegative(),
	output: z.unknown(),
	transcript: z.string().optional(),
	toolCalls: z
		.array(
			z.object({
				name: z.string(),
				input: z.unknown(),
				output: z.unknown(),
			}),
		)
		.optional(),
	tokenUsage: z
		.object({
			inputTokens: z.number().int().nonnegative(),
			outputTokens: z.number().int().nonnegative(),
			cacheCreationTokens: z.number().int().nonnegative().optional(),
			cacheReadTokens: z.number().int().nonnegative().optional(),
		})
		.optional(),
	durationMs: z.number().nonnegative(),
	error: z.string().optional(),
});
export type EvalTrial = z.infer<typeof EvalTrialSchema>;

// ---------------------------------------------------------------------------
// Eval result — aggregated outcome for one task
// ---------------------------------------------------------------------------

export const EvalResultSchema = z.object({
	taskId: z.string(),
	suite: SuiteName,
	trials: z.array(EvalTrialSchema),
	graderResults: z.array(GraderResultSchema),
	passed: z.boolean(),
	score: z.number().optional(),
	metadata: z.record(z.string(), z.unknown()).optional(),
});
export type EvalResult = z.infer<typeof EvalResultSchema>;

// ---------------------------------------------------------------------------
// Grader function signatures
// ---------------------------------------------------------------------------

export type CodeGrader = (trial: EvalTrial, task: EvalTask) => GraderResult;

export type LlmGrader = (trial: EvalTrial, task: EvalTask) => Promise<GraderResult>;

export type TranscriptGrader = (trial: EvalTrial, task: EvalTask) => GraderResult;

export type Grader =
	| { type: "code"; fn: CodeGrader }
	| { type: "llm"; fn: LlmGrader }
	| { type: "transcript"; fn: TranscriptGrader };

// ---------------------------------------------------------------------------
// Suite config — wires tasks to graders
// ---------------------------------------------------------------------------

export const SuiteConfigSchema = z.object({
	name: SuiteName,
	description: z.string(),
	regressionTrials: z.number().int().positive().default(1),
	capabilityTrials: z.number().int().positive().default(3),
});
export type SuiteConfig = z.infer<typeof SuiteConfigSchema>;

export interface Suite {
	config: SuiteConfig;
	graders: readonly Grader[];
	loadTasks: () => Promise<readonly EvalTask[]>;
	runTrial: (task: EvalTask) => Promise<EvalTrial>;
}

// ---------------------------------------------------------------------------
// Run summary — top-level output of a full eval run
// ---------------------------------------------------------------------------

export interface RunSummary {
	suite: SuiteName;
	totalTasks: number;
	totalTrials: number;
	passRate: number;
	avgScore: number | null;
	regressions: readonly EvalResult[];
	results: readonly EvalResult[];
	durationMs: number;
}
