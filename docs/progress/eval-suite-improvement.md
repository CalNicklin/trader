# Eval Suite Improvement — Progress

## Completed

- **[ta-grader-sync]** Aligned Trading Analyst grader with agent config
  - Added `maxIterations` to task metadata in `loadTradingAnalystTasks()` (from `getConfig().MAX_AGENT_ITERATIONS`)
  - Bumped word limits: 300→500 (total response), 100→150 (log_decision)
  - Tests: 4 new/updated tests in `tests/eval-code-graders.test.ts`

- **[qs-grader-buffer]** Relaxed Quick Scan grader, strengthened escalation rule
  - Reason char limit 200→300 in `code-graders-quick-scan.ts` (buffer for agent variance)
  - Escalation rule in `quick-scan.ts`: when stocks PASS all gates, MUST escalate
  - Tests: 299 chars passes, 301 fails in `tests/eval-code-graders.test.ts`

## Current layer: L2 done, L3 next
## Next todo: news-prompt-exchange
