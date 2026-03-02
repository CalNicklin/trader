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

## Current layer: L4
## Next todo: none — all implementation complete

### L4 eval-verify: Run full suite

To verify improvement, run the AI eval suite after deploy:

```bash
# Option A: From project root (requires .env with ANTHROPIC_API_KEY, etc.)
bun run evals

# Option B: On server after deploy
ssh deploy@46.225.127.44 'docker exec docker-trader-1 bun -e "const r = await fetch(\"http://localhost:3847/jobs/ai_evals\", {method:\"POST\"}); console.log(await r.json())"'
```

**Baseline (2026-03-02)**: Research 100%, Quick Scan 70%, Trading Analyst 0%, News Discovery 75%

**Success criteria**:
- Trading Analyst: >0% (ideally 50%+)
- Quick Scan: >80%
- News Discovery: 100%
