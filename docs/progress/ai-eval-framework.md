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
- [llm-grader-quick-scan] `llmGradeQuickScan()` in `src/evals/graders/llm-graders.ts` — Sonnet prompt with 7 momentum principles, grades correct/overcautious/trigger_happy/dangerous_miss
- [llm-grader-trading-analyst] `llmGradeTradeAnalyst()` in `src/evals/graders/llm-graders.ts` — 4 dimensions (reasoning, signal interpretation, action appropriateness, conciseness) each 1-5, returns averaged score
- [llm-grader-research] `llmGradeResearch()` in `src/evals/graders/llm-graders.ts` — grades well_reasoned/superficial/contradictory/hallucinated with full momentum rubric
- [test-code-graders] 37 unit tests in `tests/eval-code-graders.test.ts` — covers all 5 code graders + transcript grader with passing and failing fixtures
- [harness-logging] `logEvalResults()` in `src/evals/logging.ts` — writes RunSummary to agent_logs with phase='eval', logs individual regressions
- [test-harness] 12 unit tests in `tests/eval-harness.test.ts` — trial execution, grader application, result aggregation, error handling, array grader support

- [suite-quick-scan] `quickScanSuite` in `src/evals/suites/quick-scan.ts` — code + LLM graders, Haiku trial runner, 1 regression / 3 capability trials
- [suite-trading-analyst] `tradingAnalystSuite` in `src/evals/suites/trading-analyst.ts` — code + LLM + transcript graders, uses `runTradingAnalyst()` for real Sonnet agentic loop
- [suite-research] `researchSuite` in `src/evals/suites/research.ts` — code + LLM graders, Sonnet trial runner
- [suite-news-discovery] `newsDiscoverySuite` in `src/evals/suites/news-discovery.ts` — code grader only, Haiku, 1 regression trial

## Current layer: L5
## Next todo: seed-quick-scan

## Decisions

- Used Zod discriminated union for GraderResult with 6 kinds: pass/fail/score/label/flag/skip
- Code graders return GraderResult[] (arrays); harness handles both single and array returns
- LLM grader prompts import from momentum-rubric.ts via `formatPrinciplesForPrompt()`, not inline text
- All 3 LLM graders live in a single file (`llm-graders.ts`) sharing a common `callJudge()` helper and lazy Anthropic client
- Grader naming convention: `<type>:<suite>` for code graders (e.g. `code:research`), `llm:<suite>` for LLM graders
- Lazy logger import inside harness/logging functions to avoid triggering config validation at import time
- Each code grader file has its own local Zod schema for output validation
- `void task` used in graders that receive task but don't use it (news, trade-review) to satisfy unused-param lint
- LLM graders use `require()` for config to avoid top-level side effects; client is lazily initialized
- Harness tests mock the logger module to avoid config validation during tests
