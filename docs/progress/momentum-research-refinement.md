# Momentum-Aware Research Refinement — Progress

## Completed

- **[adx-indicators]** Added ADX computation and MACD histogram trend to `src/analysis/indicators.ts`
  - `adx()` — Wilder's smoothing ADX with 14-period default
  - `classifyAdx()` — >40 strong, >25 trending, <=25 weak
  - `classifyMacdHistogramTrend()` — compares last 3 histogram absolute values: expanding/contracting/flat
  - New fields on `TechnicalIndicators`: `adx14`, `adxTrend`, `macdHistogramTrend`
  - `formatIndicatorSummary()` now includes ADX and MACD histogram trend lines
  - Tests: 7 new assertions across 4 test cases in `tests/indicators.test.ts`

## Current layer: L2

## Next todo: expand-gate, analyzer-prompt, trade-reviewer, self-improve-prompt (parallel)

## Decisions

- ADX needs `period * 2 + 1` bars minimum (29 for period=14), plus another `period` DX values for smoothing — effectively ~43+ bars
- MACD histogram trend compares absolute values of last 3 histogram readings with 0.01 threshold for flat classification
- Choppy sideways data (sine wave + noise) produces weak ADX as expected
