# Eval Run 3 — Tightened LLM Graders

**Date**: 2026-03-01 21:49–22:02 UTC
**Duration**: 730s (~12 min)
**Trigger**: Manual (`POST /jobs/ai_evals`)
**Change**: LLM graders now fail on bad grades (contradictory/hallucinated research, dangerous_miss quick scan, score <2.0 trading analyst)

## Summary

| Suite | Tasks | Pass Rate | Regressions | Duration |
|---|---|---|---|---|
| Quick Scan | 20 | **15%** (3 pass) | 17 | 100s |
| Trading Analyst | 6 | **14%** (1 pass) | 6 | 374s |
| Research | 15 | **40%** (6 pass) | 9 | 250s |
| News Discovery | 4 | **100%** (4 pass) | 0 | 6s |

**Suites passed**: 1/4 (News Discovery only)

---

## Quick Scan — 15% pass

**Failure pattern**: All 17 regressions fail on the same code grader check — reason length exceeds 200 chars. The LLM judge grades nearly all decisions as "correct" (the Haiku is making good triage decisions, just being too verbose).

| Task | Code Grader | LLM Grade | Reason Length |
|---|---|---|---|
| qs-5042 | FAIL: 268 chars | correct | Too verbose |
| qs-4767 | FAIL: 222 chars | correct | Too verbose |
| qs-4757 | FAIL: 257 chars | correct | Too verbose |
| qs-3478 | FAIL: 260 chars | correct | Too verbose |
| qs-3467 | FAIL: 225 chars | correct | Too verbose |
| qs-3456 | FAIL: 235 chars | correct | Too verbose |
| qs-3445 | FAIL: 436 chars | correct | Too verbose |
| qs-3423 | FAIL: 325 chars | overcautious | HSBA passed gates but not escalated |
| qs-3412 | FAIL: 414 chars | correct | Too verbose |
| qs-3401 | FAIL: 316 chars | correct | Too verbose |
| qs-3390 | FAIL: 274 chars | correct | Too verbose |
| qs-3379 | FAIL: 261 chars | correct | Too verbose |
| qs-3368 | FAIL: 273 chars | correct | Too verbose |
| qs-3346 | FAIL: 394 chars | correct | Too verbose |
| qs-3129 | FAIL: ? | correct | Too verbose |
| qs-3118 | FAIL: ? | correct | Too verbose |
| qs-3107 | FAIL: ? | correct | Too verbose |

**Root cause**: The quick scan prompt tells Haiku to respond with `{"escalate": true/false, "reason": "brief explanation"}` but doesn't enforce a character limit. The model consistently produces reasons of 200-440 chars.

**Fix options**:
1. Add `max 200 characters` to the quick scan system prompt
2. Relax the grader limit to 300 chars (the decisions are correct, just verbose)
3. Both — tighten the prompt AND relax slightly to 250 chars

---

## Trading Analyst — 14% pass

**Failure pattern**: 5/6 tasks fail the LLM judge with scores below 2.0/5. The agent is making poor momentum decisions — value-investing bias, ignoring signals, not following momentum principles.

| Task | Code Grader | LLM Score | LLM Summary |
|---|---|---|---|
| ta-5604 | PASS | 1.3 | FAIL (<2.0) |
| ta-5569 | PASS | ? | FAIL (<2.0) |
| ta-5136 | PASS | 2.5 | PASS |
| ta-5103 | PASS | ? | FAIL (<2.0) |
| ta-5165 | PASS | ? | FAIL (<2.0) |
| ta-5166 | PASS | ? | FAIL (<2.0) |

**Root cause**: The trading analyst prompt lacks momentum trading principles. It makes structurally correct decisions (valid JSON, tool calls within limits) but the reasoning quality and signal interpretation are poor when judged against momentum criteria.

**Fix**: Implement the momentum-aware research refinement plan — specifically the trading analyst prompt improvements and momentum hard rules.

---

## Research — 40% pass

**Failure pattern**: 9/15 tasks graded "contradictory" by the LLM judge. Consistent theme: **value-investing bias applied to momentum setups**.

### Passing tasks (6/15)
res-127, res-129, res-131, res-132, res-134, res-136

### Failing tasks with LLM judge reasoning

**res-124**: "The agent correctly identifies the momentum signal (52w high + 2x volume) but then contradicts momentum principles by issuing HOLD instead of BUY. The core error is applying value-investor bias ('P/B 136 suggests overvaluation') to a momentum trade."

**res-125**: "The analysis contradicts momentum principles by recommending HOLD despite strong momentum signals (52w high breakout, 215% volume surge, trend alignment). The bearish reasoning centers on fundamental value concerns (debt, declining revenue) which are irrelevant to momentum trading."

**res-126**: "The agent identifies a 'technical breakout near 52-week high' and 'positive catalyst' but recommends HOLD instead of BUY. This contradicts momentum trading principles: price within 1.4% of 52w high + volume 10% above average + positive price action = clear BUY signal."

**res-128**: "The agent correctly identifies strong momentum signals (2.86% gain, volume confirmation, breakout above $150, institutional accumulation) but concludes HOLD instead of BUY. The 'wait for pullback' recommendation directly conflicts with momentum methodology."

**res-130**: "The agent identifies a 'technical breakout near 52-week high' and strong volume but then contradicts momentum principles by calling it 'overbought' and choosing HOLD. With SMA trend alignment implied, this is a classic momentum BUY setup."

**res-133**: "The agent applies value-investing bias to a momentum setup. AZN is near 52-week highs (+2.86% with volume), yet the agent concludes HOLD citing 'overvalued' metrics (P/B, forward PE). Momentum trading buys high/sells higher."

**res-135**: (contradictory — similar pattern)

**res-137**: (contradictory — similar pattern)

**res-138**: (contradictory — similar pattern)

### Consistent failure themes

1. **Value-investing bias**: Agent penalizes stocks for being "near 52-week highs" or "overvalued" when momentum principles say this is a BUY signal
2. **Missing momentum indicators**: No SMA20/SMA50 trend alignment check, no RSI/MACD context, no volume ratio analysis
3. **Contradictory reasoning**: Agent identifies positive momentum signals in the data but then recommends HOLD based on fundamental concerns
4. **"Wait for pullback" bias**: Agent recommends waiting for dips instead of buying strength — antithetical to momentum trading

**Fix**: Implement the momentum-aware research refinement plan — inject momentum hard rules into the analyzer prompt, add `momentum_assessment` field, penalize value-investing bias.

---

## News Discovery — 100% pass

All 4 live RSS headline batches correctly extracted stock tickers with valid JSON, correct exchanges, uppercase symbols, no duplicates. This suite is healthy.

---

## Comparison across runs

| Suite | Run 1 (broken) | Run 2 (fixed seeders) | Run 3 (tightened graders) |
|---|---|---|---|
| Quick Scan | 0 tasks | 20 tasks, 15% | 20 tasks, **15%** |
| Trading Analyst | 17% | 100% | **14%** |
| Research | 0% | 100% | **40%** |
| News Discovery | 0% | 100% | **100%** |

Run 2's 100% pass rates on Trading Analyst and Research were hollow — the LLM judges were detecting problems but not gating pass/fail. Run 3 is the honest baseline.

---

## Next steps

1. **Quick Scan**: Add character limit to prompt or relax grader — decisions are correct, just verbose
2. **Research + Trading Analyst**: Implement momentum-aware research refinement plan to address value-investing bias at the prompt level
3. **Re-run evals** after momentum plan to measure improvement against this baseline
