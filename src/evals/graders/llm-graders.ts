import Anthropic from "@anthropic-ai/sdk";

import type { EvalTask, EvalTrial, GraderResult } from "../types.ts";
import { formatPrinciplesForPrompt } from "./momentum-rubric.ts";

let _client: Anthropic | null = null;

function getClient(): Anthropic {
	if (!_client) {
		const { getConfig } = require("../../config.ts") as typeof import("../../config.ts");
		_client = new Anthropic({ apiKey: getConfig().ANTHROPIC_API_KEY, maxRetries: 1 });
	}
	return _client;
}

function getJudgeModel(): string {
	const { getConfig } = require("../../config.ts") as typeof import("../../config.ts");
	return getConfig().CLAUDE_MODEL;
}

async function callJudge(system: string, userContent: string): Promise<string> {
	const client = getClient();
	const response = await client.messages.create({
		model: getJudgeModel(),
		max_tokens: 1024,
		system,
		messages: [{ role: "user", content: userContent }],
	});

	return response.content
		.filter((b): b is Anthropic.TextBlock => b.type === "text")
		.map((b) => b.text)
		.join("");
}

function extractJson(text: string): unknown {
	const match = text.match(/\{[\s\S]*\}/);
	if (!match) throw new Error("No JSON found in judge response");
	return JSON.parse(match[0]) as unknown;
}

// ---------------------------------------------------------------------------
// Quick Scan LLM Grader
// ---------------------------------------------------------------------------

const QUICK_SCAN_SYSTEM = `You are an expert momentum trading evaluator. You will be given a market scan context and the agent's escalation decision. Grade whether the escalation decision was appropriate.

## Momentum Trading Principles (use these for grading)

${formatPrinciplesForPrompt([1, 3, 4, 6, 7, 8, 9])}

## Grading Criteria

Given the market state, would a competent momentum trader want a deeper look?

Consider:
- RSI 45-75 with confirmed trend alignment (SMA20 > SMA50) → escalation warranted (momentum building)
- RSI > 75 (overbought) or RSI < 30 (oversold) → consider reversal risk
- Volume ratio below 0.8 → momentum lacks confirmation, BUY escalation premature
- MACD bullish crossover with rising ADX → strong momentum signal, suppressing = miss
- "Routine monitoring" but held position has RSI divergence → escalation warranted (deceleration signal)
- Death cross forming (SMA20 approaching SMA50 from above) → escalation warranted
- Bollinger Band squeeze with trend alignment → escalation warranted (explosive move likely)

## Output Format

Respond with a JSON object:
{
  "grade": "correct" | "overcautious" | "trigger_happy" | "dangerous_miss",
  "reasoning": "brief explanation (1-2 sentences)"
}

- correct: escalation decision was appropriate for the market state
- overcautious: agent escalated when it shouldn't have (wasting money on unnecessary Sonnet calls)
- trigger_happy: agent escalated on weak or ambiguous signals
- dangerous_miss: agent failed to escalate when momentum signals clearly warranted deeper analysis`;

export async function llmGradeQuickScan(trial: EvalTrial, task: EvalTask): Promise<GraderResult> {
	const grader = "llm:quick_scan";

	if (trial.error) {
		return { kind: "skip", grader, reason: `trial errored: ${trial.error}` };
	}

	const context =
		typeof task.input.context === "string" ? task.input.context : JSON.stringify(task.input);
	const output = typeof trial.output === "string" ? trial.output : JSON.stringify(trial.output);

	const userContent = `## Scan Context\n${context}\n\n## Agent Decision\n${output}`;

	try {
		const response = await callJudge(QUICK_SCAN_SYSTEM, userContent);
		const parsed = extractJson(response) as { grade?: string; reasoning?: string };
		const grade = typeof parsed.grade === "string" ? parsed.grade : "unknown";
		const reasoning = typeof parsed.reasoning === "string" ? parsed.reasoning : "";

		if (grade === "dangerous_miss") {
			return { kind: "fail", grader, detail: `dangerous_miss: ${reasoning}` };
		}

		return {
			kind: "label",
			grader,
			label: grade,
			detail: reasoning,
		};
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : String(err);
		return { kind: "fail", grader, detail: `LLM judge failed: ${message}` };
	}
}

// ---------------------------------------------------------------------------
// Trading Analyst LLM Grader
// ---------------------------------------------------------------------------

const TRADING_ANALYST_SYSTEM = `You are an expert momentum trading evaluator. You will be given the full context of a trading analyst session (positions, quotes, research, indicators) and the agent's response. Grade the decision quality across 4 dimensions.

## Momentum Trading Principles (use these for grading)

${formatPrinciplesForPrompt()}

## Grading Dimensions (each 1-5)

### 1. Reasoning Quality
Is the analysis sound? Does it consider risk, catalyst, position context?
- 5: Thorough analysis considering multiple factors, risk-aware, well-structured
- 3: Adequate but misses some factors or is somewhat superficial
- 1: Shallow, ignores obvious risks, or contradicts itself

### 2. Momentum Signal Interpretation
Does the agent correctly read the technical signals?
- Respects trend alignment (SMA20 > SMA50) as primary filter
- Uses RSI correctly: 45-75 building, >75 overbought, <30 oversold
- Considers volume confirmation
- Recognises MACD crossover significance
- Does NOT fight confirmed strong trends ("buy high, sell higher")
- Does NOT reject stocks near 52w highs if momentum confirms
- Identifies deceleration signals (ADX declining, RSI divergence, MACD histogram shrinking)
- Understands Bollinger Band context in trending markets
- Triangulates across multiple indicators

### 3. Action Appropriateness
Given the market state, was the action (or inaction) reasonable?
- BUY on gate-qualified with catalyst + volume = good
- BUY on overbought RSI (>75) without catalyst = bad
- BUY on LSE where expected move < 2% = bad (stamp duty)
- BUY into death cross = bad unless extraordinary justification
- HOLD when momentum aligned and profitable = good
- HOLD when trailing stop close and momentum decelerating = should have exited
- HOLD losing position as long as winning = bad (cut losers quicker)
- EXIT on RSI divergence = good (momentum exhaustion)

### 4. Conciseness
Did it avoid repeating ISA rules, rehashing known facts?
- 5: Focused, every sentence adds value
- 3: Some repetition or unnecessary detail
- 1: Verbose, repeats ISA rules, rehashes context

## Output Format

Respond with a JSON object:
{
  "reasoning_quality": <1-5>,
  "signal_interpretation": <1-5>,
  "action_appropriateness": <1-5>,
  "conciseness": <1-5>,
  "overall": "brief summary (1-2 sentences)"
}`;

function buildTradingAnalystContext(task: EvalTask): string {
	const parts: string[] = [];

	if (task.input.context) parts.push(`## Context\n${String(task.input.context)}`);
	if (task.input.quotes) parts.push(`## Quotes\n${JSON.stringify(task.input.quotes, null, 2)}`);
	if (task.input.gateStates)
		parts.push(`## Gate States\n${JSON.stringify(task.input.gateStates, null, 2)}`);
	if (task.input.positions)
		parts.push(`## Positions\n${JSON.stringify(task.input.positions, null, 2)}`);
	if (task.input.research)
		parts.push(`## Research\n${JSON.stringify(task.input.research, null, 2)}`);
	if (task.input.conclusion) parts.push(`## Conclusion\n${String(task.input.conclusion)}`);

	return parts.join("\n\n");
}

export async function llmGradeTradeAnalyst(
	trial: EvalTrial,
	task: EvalTask,
): Promise<GraderResult> {
	const grader = "llm:trading_analyst";

	if (trial.error) {
		return { kind: "skip", grader, reason: `trial errored: ${trial.error}` };
	}

	const context = buildTradingAnalystContext(task);
	const output = typeof trial.output === "string" ? trial.output : JSON.stringify(trial.output);
	const toolCallSummary = trial.toolCalls
		? trial.toolCalls.map((tc) => `${tc.name}(${JSON.stringify(tc.input)})`).join("\n")
		: "No tool calls";

	const userContent = `${context}\n\n## Agent Response\n${output}\n\n## Tool Calls\n${toolCallSummary}`;

	try {
		const response = await callJudge(TRADING_ANALYST_SYSTEM, userContent);
		const parsed = extractJson(response) as Record<string, unknown>;

		const dimensions: Record<string, number> = {};
		for (const key of [
			"reasoning_quality",
			"signal_interpretation",
			"action_appropriateness",
			"conciseness",
		]) {
			const val = parsed[key];
			dimensions[key] = typeof val === "number" ? val : 0;
		}

		const avgScore = Object.values(dimensions).reduce((a, b) => a + b, 0) / 4;
		const roundedScore = Math.round(avgScore * 10) / 10;
		const overall = typeof parsed.overall === "string" ? parsed.overall : "";

		if (roundedScore < 2.0) {
			return {
				kind: "fail",
				grader,
				detail: `score ${roundedScore}/5 below minimum threshold (2.0): ${overall}`,
			};
		}

		return {
			kind: "score",
			grader,
			score: roundedScore,
			dimensions,
			detail: overall,
		};
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : String(err);
		return { kind: "fail", grader, detail: `LLM judge failed: ${message}` };
	}
}

// ---------------------------------------------------------------------------
// Research Analyzer LLM Grader
// ---------------------------------------------------------------------------

const RESEARCH_SYSTEM = `You are an expert momentum trading evaluator. You will be given raw research data (fundamentals, news, price history) and the agent's analysis. Grade whether the conclusion is well-supported.

## Momentum Trading Principles (use these for grading)

${formatPrinciplesForPrompt()}

## Grading Criteria

Momentum-specific evaluation:
- Does the research correctly identify whether the stock is in a momentum phase (trending) vs range-bound?
- Is the action consistent with momentum signals? BUY should align with uptrend + building RSI + volume
- Does it identify potential momentum catalysts vs noise?
- Does it flag momentum exhaustion risks (overbought RSI, declining volume, bearish divergence)?
- Does it avoid value-investing bias? Near 52w highs with confirmed momentum = BUY candidate, not "overvalued"
- For LSE stocks: does it account for stamp duty friction (0.5%)? Expected move must exceed ~2%
- For US stocks: does it recognise lower friction makes shorter momentum plays practical?
- Does it consider momentum survival expectations? Positive momentum ~4 months average
- Does it distinguish time-series vs cross-sectional momentum?

## Output Format

Respond with a JSON object:
{
  "grade": "well_reasoned" | "superficial" | "contradictory" | "hallucinated",
  "reasoning": "brief explanation (1-2 sentences)"
}

- well_reasoned: analysis is thorough, consistent with data, momentum-aware
- superficial: covers basics but misses key momentum signals or nuances
- contradictory: conclusion conflicts with the data or internal logic is inconsistent
- hallucinated: references data not present in the input or makes claims unsupported by evidence`;

export async function llmGradeResearch(trial: EvalTrial, task: EvalTask): Promise<GraderResult> {
	const grader = "llm:research";

	if (trial.error) {
		return { kind: "skip", grader, reason: `trial errored: ${trial.error}` };
	}

	const rawData = task.input.rawData ? JSON.stringify(task.input.rawData, null, 2) : "No raw data";
	const output = typeof trial.output === "string" ? trial.output : JSON.stringify(trial.output);

	const userContent = `## Raw Research Data\n${rawData}\n\n## Agent Analysis\n${output}`;

	try {
		const response = await callJudge(RESEARCH_SYSTEM, userContent);
		const parsed = extractJson(response) as { grade?: string; reasoning?: string };
		const grade = typeof parsed.grade === "string" ? parsed.grade : "unknown";
		const reasoning = typeof parsed.reasoning === "string" ? parsed.reasoning : "";

		const failGrades = new Set(["contradictory", "hallucinated"]);
		if (failGrades.has(grade)) {
			return { kind: "fail", grader, detail: `${grade}: ${reasoning}` };
		}

		return {
			kind: "label",
			grader,
			label: grade,
			detail: reasoning,
		};
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : String(err);
		return { kind: "fail", grader, detail: `LLM judge failed: ${message}` };
	}
}
