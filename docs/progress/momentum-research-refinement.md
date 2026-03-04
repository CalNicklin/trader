# Momentum-Aware Research Refinement — Progress

## Completed

- **[adx-indicators]** Added ADX computation and MACD histogram trend to `src/analysis/indicators.ts`
  - `adx()` — Wilder's smoothing ADX with 14-period default
  - `classifyAdx()` — >40 strong, >25 trending, <=25 weak
  - `classifyMacdHistogramTrend()` — compares last 3 histogram absolute values: expanding/contracting/flat
  - New fields on `TechnicalIndicators`: `adx14`, `adxTrend`, `macdHistogramTrend`
  - `formatIndicatorSummary()` now includes ADX and MACD histogram trend lines
  - Tests: 7 new assertions across 4 test cases in `tests/indicators.test.ts`

- **[expand-gate]** Expanded momentum gate with MACD/Bollinger checks and ADX in signal state
  - `MomentumGateConfig` — added optional `requireBullishMacd` (default false) and `maxBollingerPercentB` (default null)
  - MACD gate: fails when bearish crossover + contracting histogram + requireBullishMacd enabled
  - Bollinger gate: fails when %B exceeds max, except strong_up trend (riding the band)
  - `signalState` now includes `adx14`, `adxTrend`, `macdHistogramTrend`
  - Tests: 5 new test cases in `tests/momentum-gate.test.ts`

- **[analyzer-prompt]** Rewrote research analyzer prompt with momentum principles
  - Imported `formatPrinciplesForPrompt()` from rubric into system prompt
  - Added HARD RULES (death cross, RSI>75, LSE stamp duty)
  - Added GUIDANCE section (volume, triangulation, Bollinger context)
  - Demoted fundamentals to secondary quality filter
  - Added `momentum_assessment` field to `AnalysisResult`

- **[trade-reviewer]** Enhanced trade reviewer with momentum review dimensions
  - Added `entrySignalQuality` and `exitTiming` to `ReviewResult`
  - Extracted `parseReviewResult()` with defaults for backward compat
  - Updated `TRADE_REVIEWER_SYSTEM` prompt with momentum review criteria
  - Tests: 5 tests in `tests/trade-reviewer.test.ts`

- **[self-improve-prompt]** Added momentum analysis framework to self-improvement prompt
  - 5 dimensions: compliance rate, holding period asymmetry, gate override accuracy, signal triangulation, LSE stamp duty awareness
  - Updated output format to reference momentum principles

- **[wire-decay]** Wired decayScores() into pipeline, improved watchlist scoring
  - `decayScores()` called at start of `runResearchPipeline()` before discovery
  - `momentum_assessment` stored in research rawData
  - `computeScore()` uses momentum_assessment when available (strong=1.0, building=0.8, neutral=0.5, decelerating=0.2, exhausted=0)
  - Falls back to changePercentage proxy when no assessment
  - Tests: 4 new scoring tests in `tests/watchlist-scoring.test.ts`

- **[pattern-analyzer]** Added momentum categories to pattern analyzer + enriched learning context
  - Exported `InsightCategory` type with `"momentum_compliance"` and `"holding_asymmetry"` added
  - Updated `PATTERN_ANALYZER_SYSTEM` prompt with momentum-specific pattern guidance
  - Updated `weekly_insights` DB schema enum to include new categories
  - Enriched `buildLearningBrief()` with momentum compliance summary (against-momentum entry count + loss rate)
  - Tests: 3 tests in `tests/pattern-analyzer.test.ts`

- **[quick-scan-prompt]** Added 200-char limit to quick scan reason
  - Added "Your reason must be under 200 characters." to QUICK_SCAN_BASE prompt
  - Primary fix for Quick Scan eval: 17/20 failures were solely due to reason length

- **[verify]** Final verification and eval run complete

## Eval Results (2026-03-01, Run 4 — post momentum refinement)

| Suite | Baseline | Target | Result | Delta |
|---|---|---|---|---|
| Quick Scan | 15% | >80% | **80%** | +65pp |
| Trading Analyst | 14% | >60% | **17%** | +3pp |
| Research | 40% | >75% | **67%** | +27pp |
| News Discovery | 100% | maintain | **100%** | 0 |

### Quick Scan (80%, target met)
- 16/20 pass. 3 failures are LLM judge "dangerous_miss" (agent doesn't escalate when gate-passing stocks exist). 1 failure is still reason length (210 chars).
- The char limit fix resolved 16/17 original failures. Remaining failures are behavioral (not escalating on gate-passing stocks).

### Research (67%, target not met but +27pp improvement)
- 10/15 pass. 5 failures still show value-investing bias contaminating momentum decisions:
  - res-141: Identifies "textbook momentum" then recommends HOLD citing valuation
  - res-136: Acknowledges building momentum but lets debt ratios override
  - res-135: Labels volume breakdown as "distribution" instead of SELL signal
  - res-139: Contradicts itself with death cross + building momentum simultaneously
  - res-138: Miscalculates price position in 52w range
- The prompt rewrite eliminated 4 of the original 9 contradictory failures. Remaining 5 need further prompt iteration.

### Trading Analyst (17%, target not met)
- 1/6 pass. 5 failures are "analysis paralysis" — agent hits max iterations gathering data without executing decisions. This is NOT a momentum problem — it's a tool-use efficiency / iteration budget issue unrelated to this plan's scope.

#### Post-fix: Iteration bump (5→8) + safety-net final response
- `MAX_AGENT_ITERATIONS` raised from 5 to 8 (commit `403c001`)
- Added forced text-only final call when iterations exhaust (safety net, not a nudge)
- Added 15s timeout to `getHistoricalBars` which had none and was hanging indefinitely (commit `9ebe31f`)
- Partial eval run (3/6 tasks, IBKR down on Sunday night):
  - ta-5904: 6 iterations, score 2.3 (failed — IBKR connectivity)
  - ta-5690: **8 iterations, score 4.8 — PASSED** (full gather→research→size→trade→stop cycle)
  - ta-5683: 8 iterations, score 5.0 (failed — just below threshold, all failures were IBKR timeouts)
- Agent behavior dramatically improved: proper momentum reasoning, stop losses, intentions logged. Previous run returned "Max iterations reached" strings. Need to re-run during market hours for a fair comparison.

### News Discovery (100%, maintained)
- 4/4 pass. No regression.

---

## Research Eval Improvement (67% → 75%+ target)

- **[indicators-verdict]** Added `classifyMomentumVerdict()` to `src/analysis/indicators.ts`
  - Triangulates trend alignment, RSI, MACD crossover, ADX, volume, MACD histogram trend
  - Produces `MomentumVerdictResult` with verdict (strong_buy/buy/neutral/sell/strong_sell), signals list, conflicts list
  - Trend is primary signal (weight 2-3); contradicting indicators (e.g. bullish RSI in bearish trend) register as conflicts but don't offset trend
  - Weak ADX dampens conviction; volume < 0.8x dampens score
  - Enriched `formatIndicatorSummary()` with 52w range position (0-100%) and momentum verdict line
  - Tests: 6 new tests in `tests/indicators.test.ts` (classifyMomentumVerdict describe block)

- **[analyzer-prompt]** Hardened ANALYSIS_BASE in `src/research/analyzer.ts`
  - Added 2 new HARD RULES: momentum verdict override prevention, death cross / building momentum mutual exclusivity
  - Added CONSISTENCY CHECK section: 4-point verification the model must perform before finalizing
  - Vocabulary constraint: momentum terms only (breakout/continuation/exhaustion/reversal), not value-investing terms

- **[pipeline-rawdata]** Fixed eval/production parity gap
  - `src/research/pipeline.ts`: persists `indicatorSummary` in rawData so future eval tasks include pre-computed indicators
  - `src/evals/suites/research.ts`: extracts `indicatorSummary` from rawData and appends as `Technical Indicators:` line, matching production behavior

## Eval Run (2026-03-02 post-deploy)

**Research suite: 67% pass** (10/15, 5 regressions) — unchanged from baseline.

Same 5 failures: res-135, res-136, res-138, res-139, res-141. The eval tasks are seeded from the 15 most recent research rows; those rows were created *before* our deployment (no `indicatorSummary` in rawData). The pipeline ran after deploy and added 10 new rows with enriched rawData, but the eval loaded the 15 most recent by `createdAt` — the mix may still include older rows without indicators.

**Next steps to improve:**
1. Re-run research pipeline to ensure more rows have `indicatorSummary`
2. Consider re-seeding eval tasks to prefer rows with `indicatorSummary` when available
3. The prompt hardening and momentum verdict are in place; they should help once tasks include the pre-computed indicators

## Current layer: L4 complete

## Decisions

- ADX needs `period * 2 + 1` bars minimum (29 for period=14), plus another `period` DX values for smoothing — effectively ~43+ bars
- MACD histogram trend compares absolute values of last 3 histogram readings with 0.01 threshold for flat classification
- Choppy sideways data (sine wave + noise) produces weak ADX as expected
- `parseReviewResult()` defaults: entrySignalQuality="adequate", exitTiming="n/a" for backward compat
- momentum_assessment stored in research rawData so watchlist scoring can use it
- MOMENTUM_MULTIPLIERS map used in computeScore to convert assessment to 0-100 scale
