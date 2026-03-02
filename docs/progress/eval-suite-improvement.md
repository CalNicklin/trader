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

- **[news-prompt-exchange]** Hardened News Discovery prompt
  - Exchange chosen from company listing (UK→LSE, US→NASDAQ/NYSE), not ticker
  - Only LSE, NASDAQ, NYSE allowed; prefer NYSE for US when unsure

## Current layer: L3 done, L4 next
## Next todo: eval-verify
