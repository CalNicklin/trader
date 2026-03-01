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

## Current layer: L3

## Next todo: quick-scan-prompt

## Decisions

- ADX needs `period * 2 + 1` bars minimum (29 for period=14), plus another `period` DX values for smoothing — effectively ~43+ bars
- MACD histogram trend compares absolute values of last 3 histogram readings with 0.01 threshold for flat classification
- Choppy sideways data (sine wave + noise) produces weak ADX as expected
- `parseReviewResult()` defaults: entrySignalQuality="adequate", exitTiming="n/a" for backward compat
- momentum_assessment stored in research rawData so watchlist scoring can use it
- MOMENTUM_MULTIPLIERS map used in computeScore to convert assessment to 0-100 scale
