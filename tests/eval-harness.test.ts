import { describe, expect, mock, test } from "bun:test";

import { runSuite, runSuites } from "../src/evals/harness.ts";
import type { EvalTask, EvalTrial, GraderResult, Suite, SuiteConfig } from "../src/evals/types.ts";

mock.module("../src/utils/logger.ts", () => ({
	createChildLogger: () => ({
		info: () => {},
		warn: () => {},
		error: () => {},
		debug: () => {},
	}),
}));

function makeTrial(taskId: string, index: number): EvalTrial {
	return {
		taskId,
		trialIndex: index,
		output: JSON.stringify({ escalate: true, reason: "test" }),
		durationMs: 50,
	};
}

function makeTask(id: string, type?: "regression" | "capability"): EvalTask {
	return {
		id,
		suite: "quick_scan",
		input: {},
		metadata: type ? { type } : undefined,
	};
}

function makeConfig(overrides: Partial<SuiteConfig> = {}): SuiteConfig {
	return {
		name: "quick_scan",
		description: "Test suite",
		regressionTrials: 1,
		capabilityTrials: 3,
		...overrides,
	};
}

function makeSuite(overrides: Partial<Suite> = {}): Suite {
	return {
		config: makeConfig(),
		graders: [
			{
				type: "code",
				fn: (): GraderResult => ({ kind: "pass", grader: "test" }),
			},
		],
		loadTasks: async () => [makeTask("t1")],
		runTrial: async (task) => makeTrial(task.id, 0),
		...overrides,
	};
}

describe("runSuite", () => {
	test("runs correct number of trials for capability tasks", async () => {
		const suite = makeSuite({
			config: makeConfig({ capabilityTrials: 3 }),
			loadTasks: async () => [makeTask("t1")],
		});

		const summary = await runSuite(suite);
		expect(summary.totalTrials).toBe(3);
		expect(summary.totalTasks).toBe(1);
	});

	test("runs 1 trial for regression tasks", async () => {
		const suite = makeSuite({
			config: makeConfig({ regressionTrials: 1, capabilityTrials: 5 }),
			loadTasks: async () => [makeTask("t1", "regression")],
		});

		const summary = await runSuite(suite);
		expect(summary.totalTrials).toBe(1);
	});

	test("reports 100% pass rate when all graders pass", async () => {
		const suite = makeSuite();
		const summary = await runSuite(suite);
		expect(summary.passRate).toBe(1);
		expect(summary.regressions).toHaveLength(0);
	});

	test("reports 0% pass rate when grader fails", async () => {
		const suite = makeSuite({
			graders: [
				{
					type: "code",
					fn: (): GraderResult => ({
						kind: "fail",
						grader: "test",
						detail: "always fails",
					}),
				},
			],
		});

		const summary = await runSuite(suite);
		expect(summary.passRate).toBe(0);
		expect(summary.regressions).toHaveLength(1);
	});

	test("handles graders that return arrays", async () => {
		const arrayGrader = (_trial: EvalTrial, _task: EvalTask): GraderResult => {
			// Simulates code graders that return arrays at runtime
			return [
				{ kind: "pass", grader: "test-a" },
				{ kind: "pass", grader: "test-b" },
			] as unknown as GraderResult;
		};
		const suite = makeSuite({
			graders: [{ type: "code", fn: arrayGrader }],
		});

		const summary = await runSuite(suite);
		expect(summary.results[0]!.graderResults.length).toBeGreaterThanOrEqual(2);
	});

	test("captures trial errors gracefully", async () => {
		const suite = makeSuite({
			runTrial: async () => {
				throw new Error("API timeout");
			},
		});

		const summary = await runSuite(suite);
		expect(summary.totalTrials).toBeGreaterThan(0);
		expect(summary.results[0]!.trials[0]!.error).toBe("API timeout");
	});

	test("captures grader errors as fail results", async () => {
		const suite = makeSuite({
			graders: [
				{
					type: "code",
					fn: (): GraderResult => {
						throw new Error("grader bug");
					},
				},
			],
		});

		const summary = await runSuite(suite);
		const failResults = summary.results[0]!.graderResults.filter((r) => r.kind === "fail");
		expect(failResults.length).toBeGreaterThan(0);
		expect(failResults[0]!.detail).toContain("grader bug");
	});

	test("computes average score from score grader results", async () => {
		const suite = makeSuite({
			config: makeConfig({ capabilityTrials: 1 }),
			graders: [
				{
					type: "code",
					fn: (): GraderResult => ({
						kind: "score",
						grader: "test",
						score: 4,
					}),
				},
			],
		});

		const summary = await runSuite(suite);
		expect(summary.avgScore).toBe(4);
	});

	test("returns null avgScore when no score results", async () => {
		const suite = makeSuite();
		const summary = await runSuite(suite);
		expect(summary.avgScore).toBeNull();
	});

	test("handles multiple tasks", async () => {
		const suite = makeSuite({
			config: makeConfig({ capabilityTrials: 1 }),
			loadTasks: async () => [makeTask("t1"), makeTask("t2"), makeTask("t3")],
		});

		const summary = await runSuite(suite);
		expect(summary.totalTasks).toBe(3);
		expect(summary.totalTrials).toBe(3);
		expect(summary.results).toHaveLength(3);
	});
});

describe("runSuites", () => {
	test("runs multiple suites sequentially", async () => {
		const suite1 = makeSuite({
			config: makeConfig({ name: "quick_scan" }),
		});
		const suite2 = makeSuite({
			config: makeConfig({ name: "research" }),
		});

		const summaries = await runSuites([suite1, suite2]);
		expect(summaries).toHaveLength(2);
		expect(summaries[0]!.suite).toBe("quick_scan");
		expect(summaries[1]!.suite).toBe("research");
	});

	test("returns empty array for no suites", async () => {
		const summaries = await runSuites([]);
		expect(summaries).toHaveLength(0);
	});
});
