# AI Eval Framework — Progress

## Completed

- [types] Core eval types (EvalTask, EvalTrial, GraderResult, EvalResult, SuiteConfig, Suite, RunSummary) with Zod schemas in `src/evals/types.ts`
- [momentum-rubric] 10 momentum principles as structured constant in `src/evals/graders/momentum-rubric.ts`. Exports `MOMENTUM_PRINCIPLES` and `formatPrinciplesForPrompt()`.
- [code-grader-quick-scan] `gradeQuickScan()` in `src/evals/graders/code-graders-quick-scan.ts` — validates JSON shape, reason length, stop-loss escalation, routine tick suppression
- [code-grader-trading-analyst] `gradeTradeAnalyst()` in `src/evals/graders/code-graders-trading-analyst.ts` — word count, tool-call consistency, gate override flagging, iteration limit, log_decision length
- [transcript-grader] `gradeTranscript()` in `src/evals/graders/transcript-grader.ts` — token usage vs median, iteration count, duplicate tool calls
- [code-grader-research] `gradeResearch()` in `src/evals/graders/code-graders-research.ts` — schema validation, confidence range, quality-action consistency, LSE conviction threshold
- [code-grader-news] `gradeNewsDiscovery()` in `src/evals/graders/code-graders-news.ts` — schema validation, uppercase symbols, no .L suffix, no duplicates
- [code-grader-trade-review] `gradeTradeReview()` in `src/evals/graders/code-graders-trade-review.ts` — schema validation, reasoning quality score, outcome label
- [harness-runner] `runSuite()` and `runSuites()` in `src/evals/harness.ts` — loads tasks, runs N trials, applies graders (handles arrays), aggregates results, error handling

## Current layer: L3
## Next todo: llm-grader-quick-scan

## Decisions

- Used Zod discriminated union for GraderResult with 6 kinds: pass/fail/score/label/flag/skip
- Code graders return GraderResult[] (arrays); harness handles both single and array returns
- LLM grader prompts will import from momentum-rubric.ts, not inline text
- Grader naming convention: `<type>:<suite>` (e.g. `code:research`, `quick_scan_code`, `trading_analyst_code`)
- Lazy logger import inside harness functions to avoid triggering config validation at import time
- Each code grader file has its own local Zod schema for output validation
- `void task` used in graders that receive task but don't use it (news, trade-review) to satisfy unused-param lint
