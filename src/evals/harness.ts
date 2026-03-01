import type {
	EvalResult,
	EvalTask,
	EvalTrial,
	Grader,
	GraderResult,
	RunSummary,
	Suite,
} from "./types.ts";

function trialCountForTask(suite: Suite, task: EvalTask): number {
	const isRegression = task.metadata?.type === "regression";
	return isRegression ? suite.config.regressionTrials : suite.config.capabilityTrials;
}

async function applyGrader(
	grader: Grader,
	trial: EvalTrial,
	task: EvalTask,
): Promise<GraderResult[]> {
	const raw: GraderResult | GraderResult[] =
		grader.type === "llm" ? await grader.fn(trial, task) : grader.fn(trial, task);
	return Array.isArray(raw) ? raw : [raw];
}

async function evaluateTask(
	suite: Suite,
	task: EvalTask,
	log: { info: (...args: unknown[]) => void },
): Promise<EvalResult> {
	const numTrials = trialCountForTask(suite, task);
	const trials: EvalTrial[] = [];

	for (let i = 0; i < numTrials; i++) {
		try {
			const trial = await suite.runTrial(task);
			trials.push({ ...trial, trialIndex: i });
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : String(err);
			trials.push({
				taskId: task.id,
				trialIndex: i,
				output: null,
				durationMs: 0,
				error: message,
			});
		}
	}

	const graderResults: GraderResult[] = [];
	for (const trial of trials) {
		for (const grader of suite.graders) {
			try {
				const results = await applyGrader(grader, trial, task);
				graderResults.push(...results);
			} catch (err: unknown) {
				const message = err instanceof Error ? err.message : String(err);
				graderResults.push({
					kind: "fail",
					grader: `${grader.type}:error`,
					detail: `Grader threw: ${message}`,
				});
			}
		}
	}

	const passed = !graderResults.some((r) => r.kind === "fail");
	const scoreResults = graderResults.filter(
		(r): r is Extract<GraderResult, { kind: "score" }> => r.kind === "score",
	);
	const score =
		scoreResults.length > 0
			? scoreResults.reduce((sum, r) => sum + r.score, 0) / scoreResults.length
			: undefined;

	log.info(
		{ taskId: task.id, passed, score, trials: trials.length, graderResults: graderResults.length },
		"task complete",
	);

	return {
		taskId: task.id,
		suite: suite.config.name,
		trials,
		graderResults,
		passed,
		score,
		metadata: task.metadata,
	};
}

export async function runSuite(suite: Suite): Promise<RunSummary> {
	const { createChildLogger } = await import("../utils/logger.ts");
	const log = createChildLogger({ module: "eval-harness" });

	const start = performance.now();
	const tasks = await suite.loadTasks();
	log.info({ suite: suite.config.name, taskCount: tasks.length }, "suite started");

	const results: EvalResult[] = [];
	for (const task of tasks) {
		log.info({ taskId: task.id }, "task started");
		const result = await evaluateTask(suite, task, log);
		results.push(result);
	}

	const totalTrials = results.reduce((sum, r) => sum + r.trials.length, 0);
	const passedCount = results.filter((r) => r.passed).length;
	const passRate = tasks.length > 0 ? passedCount / tasks.length : 0;

	const allScores = results.flatMap((r) =>
		r.graderResults
			.filter((g): g is Extract<GraderResult, { kind: "score" }> => g.kind === "score")
			.map((g) => g.score),
	);
	const avgScore =
		allScores.length > 0 ? allScores.reduce((a, b) => a + b, 0) / allScores.length : null;

	const regressions = results.filter((r) => !r.passed);
	const durationMs = performance.now() - start;

	log.info(
		{
			suite: suite.config.name,
			totalTasks: tasks.length,
			totalTrials,
			passRate: Math.round(passRate * 100),
			avgScore,
			regressions: regressions.length,
			durationMs: Math.round(durationMs),
		},
		"suite complete",
	);

	return {
		suite: suite.config.name,
		totalTasks: tasks.length,
		totalTrials,
		passRate,
		avgScore,
		regressions,
		results,
		durationMs,
	};
}

export async function runSuites(suites: readonly Suite[]): Promise<RunSummary[]> {
	const summaries: RunSummary[] = [];
	for (const suite of suites) {
		const summary = await runSuite(suite);
		summaries.push(summary);
	}
	return summaries;
}
