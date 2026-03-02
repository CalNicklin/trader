# Eval Suite Improvement — Progress

## Completed

- **[ta-grader-sync]** Aligned Trading Analyst grader with agent config
  - Added `maxIterations` to task metadata in `loadTradingAnalystTasks()` (from `getConfig().MAX_AGENT_ITERATIONS`)
  - Bumped word limits: 300→500 (total response), 100→150 (log_decision)
  - Tests: 4 new/updated tests in `tests/eval-code-graders.test.ts`

## Current layer: L2
## Next todo: qs-grader-buffer
