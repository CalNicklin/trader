import { describe, expect, test } from "bun:test";
import { gradeNewsDiscovery } from "../src/evals/graders/code-graders-news.ts";
import { gradeQuickScan } from "../src/evals/graders/code-graders-quick-scan.ts";
import { gradeResearch } from "../src/evals/graders/code-graders-research.ts";
import { gradeTradeReview } from "../src/evals/graders/code-graders-trade-review.ts";
import { gradeTradeAnalyst } from "../src/evals/graders/code-graders-trading-analyst.ts";
import { gradeTranscript } from "../src/evals/graders/transcript-grader.ts";
import type { EvalTask, EvalTrial } from "../src/evals/types.ts";

function makeTrial(overrides: Partial<EvalTrial> = {}): EvalTrial {
	return {
		taskId: "test-1",
		trialIndex: 0,
		output: null,
		durationMs: 100,
		...overrides,
	};
}

function makeTask(overrides: Partial<EvalTask> & { suite: EvalTask["suite"] }): EvalTask {
	return {
		id: "test-task-1",
		input: {},
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// Quick Scan code grader
// ---------------------------------------------------------------------------

describe("gradeQuickScan", () => {
	const task = makeTask({ suite: "quick_scan", input: {} });

	test("passes on valid JSON with short reason", () => {
		const trial = makeTrial({
			output: JSON.stringify({ escalate: true, reason: "Price spike detected" }),
		});
		const results = gradeQuickScan(trial, task);
		expect(results.every((r) => r.kind === "pass")).toBe(true);
	});

	test("fails on invalid JSON", () => {
		const trial = makeTrial({ output: "not json at all" });
		const results = gradeQuickScan(trial, task);
		expect(results).toHaveLength(1);
		expect(results[0]!.kind).toBe("fail");
	});

	test("fails on missing escalate field", () => {
		const trial = makeTrial({
			output: JSON.stringify({ reason: "something" }),
		});
		const results = gradeQuickScan(trial, task);
		expect(results.some((r) => r.kind === "fail")).toBe(true);
	});

	test("fails when reason exceeds 200 chars", () => {
		const trial = makeTrial({
			output: JSON.stringify({ escalate: true, reason: "x".repeat(201) }),
		});
		const results = gradeQuickScan(trial, task);
		expect(results.some((r) => r.kind === "fail" && r.detail.includes("200"))).toBe(true);
	});

	test("fails when stop-loss breach present but escalate is false", () => {
		const stopLossTask = makeTask({
			suite: "quick_scan",
			input: { hasStopLossBreach: true },
		});
		const trial = makeTrial({
			output: JSON.stringify({ escalate: false, reason: "All clear" }),
		});
		const results = gradeQuickScan(trial, stopLossTask);
		expect(results.some((r) => r.kind === "fail" && r.detail.includes("Stop-loss"))).toBe(true);
	});

	test("passes when stop-loss breach present and escalate is true", () => {
		const stopLossTask = makeTask({
			suite: "quick_scan",
			input: { hasStopLossBreach: true },
		});
		const trial = makeTrial({
			output: JSON.stringify({ escalate: true, reason: "Stop-loss hit" }),
		});
		const results = gradeQuickScan(trial, stopLossTask);
		expect(results.every((r) => r.kind === "pass")).toBe(true);
	});

	test("fails when routine tick but escalate is true", () => {
		const routineTask = makeTask({
			suite: "quick_scan",
			input: { isRoutineTick: true },
		});
		const trial = makeTrial({
			output: JSON.stringify({ escalate: true, reason: "Just checking" }),
		});
		const results = gradeQuickScan(trial, routineTask);
		expect(results.some((r) => r.kind === "fail" && r.detail.includes("Routine"))).toBe(true);
	});

	test("passes when routine tick and escalate is false", () => {
		const routineTask = makeTask({
			suite: "quick_scan",
			input: { isRoutineTick: true },
		});
		const trial = makeTrial({
			output: JSON.stringify({ escalate: false, reason: "No changes" }),
		});
		const results = gradeQuickScan(trial, routineTask);
		expect(results.every((r) => r.kind === "pass")).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Trading Analyst code grader
// ---------------------------------------------------------------------------

describe("gradeTradeAnalyst", () => {
	test("passes when word count under 300 and conclusion matches tool calls", () => {
		const task = makeTask({
			suite: "trading_analyst",
			input: { conclusion: "acted" },
		});
		const trial = makeTrial({
			output: "Bought SHEL at 25.50 based on momentum signals.",
			toolCalls: [{ name: "place_trade", input: {}, output: "ok" }],
		});
		const results = gradeTradeAnalyst(trial, task);
		const fails = results.filter((r) => r.kind === "fail");
		expect(fails).toHaveLength(0);
	});

	test("fails when word count exceeds 500", () => {
		const task = makeTask({
			suite: "trading_analyst",
			input: { conclusion: "hold" },
		});
		const trial = makeTrial({
			output: Array(501).fill("word").join(" "),
			toolCalls: [],
		});
		const results = gradeTradeAnalyst(trial, task);
		expect(results.some((r) => r.kind === "fail" && r.detail.includes("500"))).toBe(true);
	});

	test("passes when word count at 499", () => {
		const task = makeTask({
			suite: "trading_analyst",
			input: { conclusion: "hold" },
		});
		const trial = makeTrial({
			output: Array(499).fill("word").join(" "),
			toolCalls: [],
		});
		const results = gradeTradeAnalyst(trial, task);
		expect(results.some((r) => r.kind === "fail" && r.detail?.includes("word"))).toBe(false);
	});

	test("fails when acted but no trade tool call", () => {
		const task = makeTask({
			suite: "trading_analyst",
			input: { conclusion: "acted" },
		});
		const trial = makeTrial({
			output: "Decided to buy.",
			toolCalls: [{ name: "get_positions", input: {}, output: "[]" }],
		});
		const results = gradeTradeAnalyst(trial, task);
		expect(results.some((r) => r.kind === "fail" && r.detail.includes("place_trade"))).toBe(true);
	});

	test("fails when hold but has place_trade", () => {
		const task = makeTask({
			suite: "trading_analyst",
			input: { conclusion: "hold" },
		});
		const trial = makeTrial({
			output: "Holding positions.",
			toolCalls: [{ name: "place_trade", input: {}, output: "ok" }],
		});
		const results = gradeTradeAnalyst(trial, task);
		expect(results.some((r) => r.kind === "fail" && r.detail.includes("hold"))).toBe(true);
	});

	test("flags gate overrides", () => {
		const task = makeTask({
			suite: "trading_analyst",
			input: { conclusion: "acted", gateOverrides: ["SHEL"] },
		});
		const trial = makeTrial({
			output: "Bought SHEL.",
			toolCalls: [{ name: "place_trade", input: {}, output: "ok" }],
		});
		const results = gradeTradeAnalyst(trial, task);
		expect(results.some((r) => r.kind === "flag" && r.flag === "gate_override")).toBe(true);
	});

	test("fails when tool calls exceed limit (iterations * 3)", () => {
		const task = makeTask({
			suite: "trading_analyst",
			input: { conclusion: "hold" },
			metadata: { maxIterations: 2 },
		});
		const calls = Array.from({ length: 7 }, (_, i) => ({
			name: `tool_${i}`,
			input: {},
			output: "ok",
		}));
		const trial = makeTrial({ output: "Holding.", toolCalls: calls });
		const results = gradeTradeAnalyst(trial, task);
		expect(results.some((r) => r.kind === "fail" && r.detail.includes("tool calls"))).toBe(true);
	});

	test("fails when log_decision output exceeds 150 words", () => {
		const task = makeTask({
			suite: "trading_analyst",
			input: { conclusion: "hold" },
		});
		const trial = makeTrial({
			output: "Holding.",
			toolCalls: [
				{
					name: "log_decision",
					input: {},
					output: Array(151).fill("word").join(" "),
				},
			],
		});
		const results = gradeTradeAnalyst(trial, task);
		expect(results.some((r) => r.kind === "fail" && r.detail.includes("log_decision"))).toBe(true);
		expect(results.some((r) => r.kind === "fail" && r.detail?.includes("150"))).toBe(true);
	});

	test("passes when log_decision output at 149 words", () => {
		const task = makeTask({
			suite: "trading_analyst",
			input: { conclusion: "hold" },
		});
		const trial = makeTrial({
			output: "Holding.",
			toolCalls: [
				{
					name: "log_decision",
					input: {},
					output: Array(149).fill("word").join(" "),
				},
			],
		});
		const results = gradeTradeAnalyst(trial, task);
		expect(results.some((r) => r.kind === "fail" && r.detail?.includes("log_decision"))).toBe(
			false,
		);
	});
});

// ---------------------------------------------------------------------------
// Transcript grader
// ---------------------------------------------------------------------------

describe("gradeTranscript", () => {
	test("flags token usage exceeding 2x median", () => {
		const task = makeTask({
			suite: "trading_analyst",
			input: {},
			metadata: { medianTokens: 1000 },
		});
		const trial = makeTrial({
			tokenUsage: {
				inputTokens: 1500,
				outputTokens: 1000,
			},
		});
		const results = gradeTranscript(trial, task);
		expect(results.some((r) => r.kind === "flag" && r.flag === "token_usage_high")).toBe(true);
	});

	test("does not flag token usage within 2x median", () => {
		const task = makeTask({
			suite: "trading_analyst",
			input: {},
			metadata: { medianTokens: 5000 },
		});
		const trial = makeTrial({
			tokenUsage: {
				inputTokens: 3000,
				outputTokens: 2000,
			},
		});
		const results = gradeTranscript(trial, task);
		expect(results.some((r) => r.kind === "flag" && r.flag === "token_usage_high")).toBe(false);
	});

	test("flags iteration count at max", () => {
		const task = makeTask({
			suite: "trading_analyst",
			input: {},
			metadata: { maxIterations: 3 },
		});
		const trial = makeTrial({
			toolCalls: [
				{ name: "a", input: {}, output: "" },
				{ name: "b", input: {}, output: "" },
				{ name: "c", input: {}, output: "" },
			],
		});
		const results = gradeTranscript(trial, task);
		expect(results.some((r) => r.kind === "flag" && r.flag === "iteration_count_high")).toBe(true);
	});

	test("flags duplicate get_positions calls", () => {
		const task = makeTask({ suite: "trading_analyst", input: {} });
		const trial = makeTrial({
			toolCalls: [
				{ name: "get_positions", input: {}, output: "[]" },
				{ name: "get_quote", input: {}, output: "{}" },
				{ name: "get_positions", input: {}, output: "[]" },
			],
		});
		const results = gradeTranscript(trial, task);
		expect(results.some((r) => r.kind === "flag" && r.flag === "duplicate_tool_call")).toBe(true);
	});

	test("does not flag single get_positions call", () => {
		const task = makeTask({ suite: "trading_analyst", input: {} });
		const trial = makeTrial({
			toolCalls: [{ name: "get_positions", input: {}, output: "[]" }],
		});
		const results = gradeTranscript(trial, task);
		expect(results.some((r) => r.kind === "flag" && r.flag === "duplicate_tool_call")).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// Research code grader
// ---------------------------------------------------------------------------

describe("gradeResearch", () => {
	const task = makeTask({ suite: "research", input: {} });

	test("passes on valid research output", () => {
		const trial = makeTrial({
			output: JSON.stringify({
				sentiment: 0.7,
				action: "BUY",
				confidence: 0.8,
				quality_pass: "pass",
			}),
		});
		const results = gradeResearch(trial, task);
		expect(results.some((r) => r.kind === "fail")).toBe(false);
	});

	test("fails on invalid JSON", () => {
		const trial = makeTrial({ output: "not json" });
		const results = gradeResearch(trial, task);
		expect(results.some((r) => r.kind === "fail")).toBe(true);
	});

	test("fails when confidence outside 0-1", () => {
		const trial = makeTrial({
			output: JSON.stringify({
				sentiment: 0.5,
				action: "HOLD",
				confidence: 1.5,
				quality_pass: "pass",
			}),
		});
		const results = gradeResearch(trial, task);
		expect(results.some((r) => r.kind === "fail" && r.detail.includes("confidence"))).toBe(true);
	});

	test("flags BUY when quality_pass is fail", () => {
		const trial = makeTrial({
			output: JSON.stringify({
				sentiment: 0.3,
				action: "BUY",
				confidence: 0.5,
				quality_pass: "fail",
			}),
		});
		const results = gradeResearch(trial, task);
		expect(results.some((r) => r.kind === "flag" && r.flag === "buy-on-fail")).toBe(true);
	});

	test("flags LSE BUY with low confidence", () => {
		const lseTask = makeTask({ suite: "research", input: { exchange: "LSE" } });
		const trial = makeTrial({
			output: JSON.stringify({
				sentiment: 0.6,
				action: "BUY",
				confidence: 0.5,
				quality_pass: "pass",
			}),
		});
		const results = gradeResearch(trial, lseTask);
		expect(results.some((r) => r.kind === "flag" && r.flag === "low-conviction-lse-buy")).toBe(
			true,
		);
	});

	test("passes LSE BUY with high confidence", () => {
		const lseTask = makeTask({ suite: "research", input: { exchange: "LSE" } });
		const trial = makeTrial({
			output: JSON.stringify({
				sentiment: 0.8,
				action: "BUY",
				confidence: 0.7,
				quality_pass: "pass",
			}),
		});
		const results = gradeResearch(trial, lseTask);
		expect(results.some((r) => r.kind === "flag")).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// News Discovery code grader
// ---------------------------------------------------------------------------

describe("gradeNewsDiscovery", () => {
	const task = makeTask({ suite: "news_discovery", input: {} });

	test("passes on valid news output", () => {
		const trial = makeTrial({
			output: JSON.stringify([
				{ symbol: "SHEL", name: "Shell", exchange: "LSE" },
				{ symbol: "AAPL", name: "Apple", exchange: "NASDAQ" },
			]),
		});
		const results = gradeNewsDiscovery(trial, task);
		expect(results.some((r) => r.kind === "fail")).toBe(false);
	});

	test("fails on non-array output", () => {
		const trial = makeTrial({
			output: JSON.stringify({ symbol: "SHEL" }),
		});
		const results = gradeNewsDiscovery(trial, task);
		expect(results.some((r) => r.kind === "fail")).toBe(true);
	});

	test("fails on lowercase symbols", () => {
		const trial = makeTrial({
			output: JSON.stringify([{ symbol: "shel", name: "Shell", exchange: "LSE" }]),
		});
		const results = gradeNewsDiscovery(trial, task);
		expect(results.some((r) => r.kind === "fail" && r.detail.includes("uppercase"))).toBe(true);
	});

	test("fails on .L suffix", () => {
		const trial = makeTrial({
			output: JSON.stringify([{ symbol: "SHEL.L", name: "Shell", exchange: "LSE" }]),
		});
		const results = gradeNewsDiscovery(trial, task);
		expect(results.some((r) => r.kind === "fail" && r.detail.includes(".L"))).toBe(true);
	});

	test("fails on duplicate symbols", () => {
		const trial = makeTrial({
			output: JSON.stringify([
				{ symbol: "SHEL", name: "Shell", exchange: "LSE" },
				{ symbol: "SHEL", name: "Shell PLC", exchange: "LSE" },
			]),
		});
		const results = gradeNewsDiscovery(trial, task);
		expect(results.some((r) => r.kind === "fail" && r.detail.includes("duplicate"))).toBe(true);
	});

	test("fails on invalid exchange", () => {
		const trial = makeTrial({
			output: JSON.stringify([{ symbol: "SAP", name: "SAP", exchange: "XETRA" }]),
		});
		const results = gradeNewsDiscovery(trial, task);
		expect(results.some((r) => r.kind === "fail")).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Trade Review code grader
// ---------------------------------------------------------------------------

describe("gradeTradeReview", () => {
	const task = makeTask({ suite: "trade_review", input: {} });

	test("passes on valid trade review output", () => {
		const trial = makeTrial({
			output: JSON.stringify({
				outcome: "win",
				reasoningQuality: 4,
				lessonLearned: "Momentum confirmation was key",
			}),
		});
		const results = gradeTradeReview(trial, task);
		expect(results.some((r) => r.kind === "fail")).toBe(false);
		expect(results.some((r) => r.kind === "score" && r.score === 4)).toBe(true);
	});

	test("fails on invalid outcome", () => {
		const trial = makeTrial({
			output: JSON.stringify({
				outcome: "neutral",
				reasoningQuality: 3,
				lessonLearned: "Something",
			}),
		});
		const results = gradeTradeReview(trial, task);
		expect(results.some((r) => r.kind === "fail")).toBe(true);
	});

	test("fails on reasoningQuality outside 1-5", () => {
		const trial = makeTrial({
			output: JSON.stringify({
				outcome: "loss",
				reasoningQuality: 6,
				lessonLearned: "Oops",
			}),
		});
		const results = gradeTradeReview(trial, task);
		expect(results.some((r) => r.kind === "fail")).toBe(true);
	});

	test("fails on empty lessonLearned", () => {
		const trial = makeTrial({
			output: JSON.stringify({
				outcome: "breakeven",
				reasoningQuality: 3,
				lessonLearned: "",
			}),
		});
		const results = gradeTradeReview(trial, task);
		expect(results.some((r) => r.kind === "fail")).toBe(true);
	});

	test("skips when trial has error", () => {
		const trial = makeTrial({ error: "API timeout" });
		const results = gradeTradeReview(trial, task);
		expect(results.some((r) => r.kind === "skip")).toBe(true);
	});
});
