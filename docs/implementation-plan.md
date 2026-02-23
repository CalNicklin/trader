# Implementation Plan

> Step-by-step build order for all four phases. Each step is a single commit. Deploy after each phase and observe for at least one trading week before starting the next.
>
> **Strategy framework:** [strategy-framework.md](./strategy-framework.md) — Adaptive Signal Architecture (ADOPTED). Defines the KPI framework, measurement windows, and rollout discipline that apply across all phases.
>
> Reference docs:
> - [Strategy Framework](./strategy-framework.md) — signal architecture, KPIs, rollout discipline
> - [Agentic Process Audit](./agentic-process-audit.md) — full system audit and gap IDs (A1–H3)
> - [Gap Resolution Plan](./gap-resolution-plan.md) — Phase 1 fixes
> - [Phase 1.2: Profit Optimisation](./phase1.2-profit-optimisation.md) — quality filter, signal-driven scoring
> - [Phase 1.5: US Stocks](./phase1.5-us-stocks.md) — multi-exchange support
> - [Phase 2: Trading Intelligence](./phase2-trading-intelligence.md) — indicators, momentum gate, contextual judgment, trailing stops
> - [Phase 3: Learning Depth](./phase3-learning-depth.md) — decision scorer with signal attribution, champion/challenger journal
> - [Phase 4: Autonomy Escalation](./phase4-autonomy-escalation.md) — rollout ladder, rollback triggers, governance
> - [Verdict](./verdict.md) — overall assessment and cost philosophy

---

## Phase 1: Foundation — COMPLETE

**Goal:** Make the system safe and operationally reliable.
**Deployed:** 2026-02-20 (commit `51747de`). 17 files, 740 insertions, 26 new tests.
**Observation period:** Feb 20–27 minimum. See `phase1-observation-checklist.md`.

### Step 1.1 — Enforce risk check inside `place_trade` ✓

**Gaps:** D1 (risk check not enforced), A2 (confidence threshold), A5 (wind-down rejection)

**Files:** `src/agent/tools.ts`, `src/utils/clock.ts`

**What to do:**
- In the `place_trade` case of `executeTool()`, before calling `placeTrade()`:
  1. Check `getMarketPhase()` — reject BUY orders if phase is `wind-down` or `post-market`
  2. Check `input.confidence` — reject if < 0.7
  3. Call `checkTradeRisk()` with the trade details — reject if not approved
- Return the rejection reasons as the tool result so the agent sees why it was blocked
- The agent can still call `check_risk` separately for pre-flight info, but execution is now gated regardless

**Test:** Unit test that calls `executeTool("place_trade", ...)` with confidence 0.5 and verifies rejection. Test with a wind-down timestamp.

---

### Step 1.2 — Wire sector exposure and volume into risk pipeline ✓

**Gaps:** D3 (sector exposure), D4 (volume check)

**Files:** `src/risk/manager.ts`

**What to do:**
- Add sector concentration check to `checkTradeRisk()`:
  - Query `positions` table, join with `watchlist` for sector info
  - Sum `marketValue` by sector, add the proposed trade value
  - Reject if any sector would exceed `HARD_LIMITS.MAX_SECTOR_EXPOSURE_PCT` (30%)
- Add volume check:
  - Fetch a fresh Yahoo Finance quote for the symbol (`getYahooQuote`)
  - Check `avgVolume` against `HARD_LIMITS.MIN_AVG_VOLUME` (50,000)
  - If Yahoo call fails, reject with "unable to verify volume"
- Import `getYahooQuote` from `src/research/sources/yahoo-finance.ts`

**Test:** Unit test with mocked positions showing 28% sector exposure + a new trade in the same sector → rejected.

---

### Step 1.3 — Position Guardian ✓

**Gaps:** A4 (stop-loss execution), B3 (event-driven triggers), C1 (fill tracking), C2 (unfilled order cleanup), G3 (stale positions), H1 (real-time P&L)

**Files:** New file `src/broker/guardian.ts`, modify `src/index.ts`

**What to do:**
- Create `src/broker/guardian.ts` with:
  - `startGuardian()` / `stopGuardian()` lifecycle functions
  - A `setInterval` loop running every 60 seconds during market hours
  - **Stop-loss monitor:** For each position with `stopLossPrice` set, fetch streaming quote. If `last <= stopLossPrice`, place an immediate MARKET SELL via `placeTrade()`. Log to `agent_logs` with level ACTION.
  - **Position price updater:** Update `positions.currentPrice`, `unrealizedPnl`, `marketValue` from quotes.
  - **Price alert accumulator:** Track prices for top 10 watchlist symbols. If any move >3% since last orchestrator tick, add to an exported `alertQueue` array. The orchestrator's `shouldRunAnalysis()` consumes this queue.
  - **Post-market cleanup (after 16:30):** Query `trades` with status SUBMITTED. Update to CANCELLED, log as "expired unfilled".
- In `src/index.ts`: call `startGuardian()` after `startScheduler()`, and `stopGuardian()` in shutdown.
- Use IBKR snapshot quotes (existing `getQuote`/`getQuotes`) rather than streaming subscriptions initially. Simpler, and 60-second polling on 10-15 symbols is well within the 40 req/sec limit. Can upgrade to streaming later if latency matters.

**Test:** Integration test: insert a position with `stopLossPrice: 100`, mock `getQuote` returning `last: 95`, verify a SELL trade is created.

---

### Step 1.4 — `log_intention` tool ✓

**Gap:** A1 (track unfulfilled intentions)

**Files:** `src/agent/tools.ts`, `src/agent/orchestrator.ts`

**What to do:**
- Add a `log_intention` tool definition:
  ```
  name: "log_intention"
  input: { symbol, condition, action, note }
  ```
- In `executeTool`, store intentions in an in-memory array (module-level in orchestrator, exported).
- In `shouldRunAnalysis()`, check pending intentions against current quotes. If a condition is met (e.g., "SHEL drops below 2450p" and current quote is 2430p), add it to the escalation reasons.
- Clear fulfilled intentions after they trigger escalation.
- Clear all intentions at end of day (post-market).

**Test:** Log an intention "buy SHEL if < 2450", then call `shouldRunAnalysis()` with a quote of 2430 → verify it appears in reasons.

---

### Step 1.5 — Context enrichments ✓

**Gaps:** A3 (day plan memory), H3 (inter-tick memory), B4 (data completeness), H2 (portfolio composition)

**Files:** `src/agent/orchestrator.ts`

**What to do:**
- Add module-level variables: `let currentDayPlan: string | null = null` and `let lastAgentResponse: string | null = null`
- In `onPreMarket()`: store the day plan response text in `currentDayPlan`
- In `onActiveTradingTick()` Tier 3 context building:
  1. Include `Today's plan: ${currentDayPlan?.substring(0, 500)}` (~200 tokens)
  2. Include `Your last assessment: ${lastAgentResponse?.substring(0, 800)}` (~300 tokens)
  3. Add data completeness note: count successful vs failed quotes, list failed symbols
  4. Add portfolio composition: calculate sector breakdown from positions table, include as "Portfolio: Tech 25%, Financials 15%, Cash 60%"
- After `runTradingAnalyst()` returns, store `response.text` in `lastAgentResponse`
- Reset both to null at end of day (post-market)

---

### Step 1.6 — Operational fixes (partially complete)

**Gaps:** D2 (snapshot retry), F1 (review cancelled orders), F2 (lower pattern minimum), F3 (PR staleness alerts), F4 (severity-weighted brief), F5 (Wilson score pause), G2 (heartbeat), G5 (missed job backfill), E2 (dynamic news matching), E4 (research data quality), E5 (score decay), E3 (research priority), G4 (cost tracking accuracy)

**Implemented in this batch:** D2 (snapshot retry ✓), F5 (Wilson score ✓), G5 (catch-up tick ✓). Remaining items (F1, F2, F3, F4, G4, E2, E4, E5, E3) were previously implemented or are deferred to observation — see `agentic-process-audit.md` Section 14 for full status.

**Files:** Multiple — each is a small, independent edit.

These can be done in any order. Group into sub-commits by file if preferred:

**`src/agent/orchestrator.ts`:**
- D2: Wrap `recordDailySnapshot()` in a retry loop (3 attempts, 30s backoff). On failure, carry forward previous snapshot.

**`src/learning/trade-reviewer.ts`:**
- F1: Extend the query to include `trades.status IN ('FILLED', 'CANCELLED')` and trades where `filledAt IS NULL AND createdAt < today` (expired DAY orders). Adjust the review prompt to handle "trade did not execute" context.

**`src/learning/pattern-analyzer.ts`:**
- F2: Change minimum trade reviews from 3 to 1.

**`src/reporting/templates/daily-summary.ts`:**
- F3: Query `improvement_proposals` where status = `PR_CREATED` and `createdAt < 7 days ago`. If any, add a "Pending Improvements" section to the email with title + PR link.

**`src/learning/context-builder.ts`:**
- F4: In `buildLearningBrief()`, sort insights by severity (critical first, then warning, then info). Always include all critical items. Fill remaining slots from warning, then info.

**`src/self-improve/monitor.ts`:**
- F5: Replace fixed win-rate threshold with Wilson score lower bound:
  ```typescript
  function wilsonLower(wins: number, total: number, z: number = 1.96): number {
    if (total === 0) return 0;
    const p = wins / total;
    const denominator = 1 + z * z / total;
    const centre = p + z * z / (2 * total);
    const spread = z * Math.sqrt((p * (1 - p) + z * z / (4 * total)) / total);
    return (centre - spread) / denominator;
  }
  ```
  Pause only when `wilsonLower(wins, total) < HARD_LIMITS.PAUSE_WIN_RATE_THRESHOLD`.

**`src/scheduler/cron.ts` + `src/scheduler/jobs.ts`:**
- G2: Add a `heartbeat` job at 07:00 weekdays. Implementation: send a simple email "Trader Agent alive — {hostname}, uptime: {process.uptime()}s". If you don't get it by 07:15, the system is down.

**`src/index.ts`:**
- G5: After scheduler starts, check last `agent_logs` entry. If last entry > 2 hours old AND current phase is `open` (active trading), run `runJobs("orchestrator_tick")` immediately. Log "catch-up tick" to distinguish from scheduled. Do NOT backfill pre_market or other phase-specific jobs.

**`src/research/sources/news-scraper.ts`:**
- E2: Replace static `SYMBOL_NAMES` dict with a dynamic loader. At the start of `filterNewsForSymbols()`, query `watchlist` table for all active entries with `name`. Build the name map from DB + static fallbacks for aliases (M&S, etc.).

**`src/research/pipeline.ts`:**
- E4: After gathering data in `researchSymbol()`, compute `dataQuality`: "full" if both quote and fundamentals exist, "partial" if one is missing, "minimal" if only quote. Store in the `research.rawData` JSON blob as a top-level field. Surface in `get_recent_research` tool output.

**`src/research/watchlist.ts`:**
- E5: Add `decayScores()` function. For each active watchlist entry, calculate days since `lastResearchedAt`. Reduce score by 5 points per 7 days stale. Deactivate if score falls below 10. Call from `runResearchPipeline()` at the start, before research.
- E3: In `getStaleSymbols()`, sort by: (a) symbols in `positions` table first, (b) score descending, (c) lastResearchedAt ascending. Ensures held positions are always researched first.

**`src/utils/token-tracker.ts`:**
- G4: Update cost calculation to apply cache discounts. If `cacheReadTokens` is provided, charge at 10% of input rate. If `cacheWriteTokens`, charge at 25%.

---

## Phase 2: Trading Intelligence

**Goal:** Give the agent a signal-based analytical framework with momentum gate, contextual AI judgment, and trailing stops.
**Estimated effort:** 2–3 sessions.
**Deploy, then observe for 1–2 trading weeks. Shadow evaluation: gate-only vs gate+AI. Compare decision quality and trade frequency against Phase 1 baseline.**
**KPIs:** Gate pass rate, AI approval rate, Sonnet call reduction, signal-level win/loss by regime. See [strategy-framework.md](./strategy-framework.md) for measurement windows.

### Step 2.1 — Technical indicator engine

**Reference:** [Phase 2 doc, Section 1](./phase2-trading-intelligence.md#1-technical-indicator-engine)

**Files:** New file `src/analysis/indicators.ts`

**What to do:**
- Implement all indicator functions: `sma()`, `ema()`, `rsi()`, `macd()`, `atr()`, `bollingerBands()`
- Implement classification helpers: `classifyTrend()`, `classifyRsi()`, `detectMacdCrossover()`, `classifyVolumeTrend()`
- Implement `computeIndicators(symbol, bars)` → `TechnicalIndicators`
- Implement `formatIndicatorSummary(indicators)` → human-readable one-liner
- Implement `getIndicatorsForSymbol(symbol, duration)` with 1-hour in-memory cache
- All pure math. No imports from broker or DB.

**Test:** Unit tests with known OHLCV data. Use a well-known stock's historical bars and verify RSI/MACD/SMA match values from a reference source (e.g., TradingView). Test edge cases: fewer bars than required period → null values.

---

### Step 2.2 — Schema change for 52-week range

**Reference:** [Phase 2 doc, Section 1 — New Watchlist Column](./phase2-trading-intelligence.md#new-watchlist-column)

**Files:** `src/db/schema.ts`

**What to do:**
- Add `high52w: real("high_52w")` and `low52w: real("low_52w")` to the `watchlist` table
- Run `bun run db:generate` to create the migration
- Run `bun run db:migrate`

---

### Step 2.3 — Integrate indicators into orchestrator + momentum gate

**Reference:** [Phase 2 doc, Section 4](./phase2-trading-intelligence.md#4-integration-points)

**Files:** `src/agent/orchestrator.ts`, new `src/analysis/momentum-gate.ts`

**What to do:**
- Import `getIndicatorsForSymbol`, `formatIndicatorSummary` from `src/analysis/indicators.ts`
- **NEW: Implement momentum gate at Tier 2.** Create `src/analysis/momentum-gate.ts` with configurable gate parameters (trendAlignment, rsiRange, minVolumeRatio, excludeOverbought). Gate config loaded from versioned file (`config/momentum-gate.json`).
- In `onActiveTradingTick()` Tier 2:
  - For each watchlist candidate, compute indicators and evaluate against momentum gate
  - **Gate fail = no Sonnet call.** Log signal state and skip.
  - **Gate pass = escalate to Tier 3** with full indicator context
  - Every gate evaluation (pass or fail) logs full signal state for Phase 3
- In `onPreMarket()`:
  - Compute indicators for all positions + top 10 watchlist (no gate filtering for day plan)
  - Add to day plan context

This step validates both the indicator pipeline and the gate filtering before the prompt changes.

---

### Step 2.4 — Integrate indicators into research pipeline

**Reference:** [Phase 2 doc, Section 4](./phase2-trading-intelligence.md#4-integration-points)

**Files:** `src/research/pipeline.ts`, `src/research/analyzer.ts`

**What to do:**
- In `researchSymbol()`: after fetching historical bars, call `computeIndicators()`. Pass the result to `analyzeStock()`.
- For pipeline runs (not on-demand): fetch `"1 Y"` bars instead of `"1 M"`. Compute 52-week high/low. Update `watchlist.high52w` and `watchlist.low52w`.
- In `analyzeStock()`: if indicators are provided, append `formatIndicatorSummary()` to the analysis prompt.
- Update the `analyzeStock` data parameter type to include optional `indicators`.

---

### Step 2.5 — ATR-based position sizing + trailing stops

**Reference:** [Phase 2 doc, Section 3](./phase2-trading-intelligence.md#3-volatility-adjusted-sizing--trailing-stops)

**Files:** `src/risk/limits.ts`, `src/risk/manager.ts`, `src/agent/tools.ts`, `src/broker/guardian.ts`, `src/db/schema.ts`

**What to do:**
- In `limits.ts`: add `STOP_LOSS_ATR_MULTIPLIER: 2`, `TARGET_ATR_MULTIPLIER: 3`, `RISK_PER_TRADE_PCT: 1`, `TRAILING_STOP_ATR_MULTIPLIER: 2`. Keep `PER_TRADE_STOP_LOSS_PCT: 3` as fallback.
- In `manager.ts`: add `getAtrPositionSize(price, atr)` function. Update `calculateStopLoss(entryPrice, atr?)` to use ATR when available, fallback to fixed 3%.
- In `tools.ts`: update `get_max_position_size` input schema to accept optional `atr` parameter. Route to `getAtrPositionSize` when ATR is provided, else use existing `getMaxPositionSize`.
- **NEW: Trailing stops.** Add `highWaterMark` and `trailingStopPrice` columns to `positions` table. In `guardian.ts`, add `updateTrailingStops()`: trail stop at 2×ATR below highest close since entry. Never move stop down, only up. Trigger sell when price <= trailing stop.
- On position entry: set `highWaterMark = entryPrice`, `trailingStopPrice = entryPrice - (2 × ATR)`.

**Test:** Unit test: stock at 2000p, ATR 40p → stop at 1920p, target at 2120p. Portfolio £100k → max risk £1000 → max shares 1250. Trailing stop test: price rises to 2100p → trailing stop moves to 2020p. Price drops to 2010p → sell triggered.

---

### Step 2.6 — Contextual judgment prompt (replaces multi-factor scoring)

**Reference:** [Phase 2 doc, Section 2](./phase2-trading-intelligence.md#2-contextual-judgment-prompt-replaces-multi-factor-scoring)

**Files:** `src/agent/prompts/trading-analyst.ts`

**What to do:**
- Replace `TRADING_ANALYST_SYSTEM` with the contextual judgment prompt. The AI receives pre-computed signals + research and evaluates: (1) SUSTAINABILITY — is this momentum real? (2) RISK EVENTS — anything indicators can't see? (3) POSITION CONTEXT — portfolio fit?
- Replace `MINI_ANALYSIS_PROMPT` with the version that references trailing stops and gate-qualified candidates
- Replace `DAY_PLAN_PROMPT` with the version that focuses on what indicators can't tell you
- Add AI override attribution logging: when AI passes on a gate-qualified candidate, log `override_reason` as structured field for Phase 3 measurement

**This is the highest-impact change.** Do it last in Phase 2 so everything it references (indicators, gate, ATR sizing, trailing stops) is already live. Run shadow evaluation for 1-2 weeks: gate-only vs gate+AI. AI override must show non-negative value before full reliance.

---

## Phase 3: Learning Depth

**Goal:** Close the feedback loop on inaction and build an evolving strategy with signal attribution and champion/challenger governance.
**Estimated effort:** 1–2 sessions.
**Deploy, then observe for 2+ trading weeks — this phase needs trades to produce data.**
**KPIs:** Decision quality ratio, per-signal win rate by regime, AI override value-add, hypothesis throughput. See [strategy-framework.md](./strategy-framework.md) for measurement windows.

### Step 3.1 — Schema changes

**Reference:** [Phase 3 doc, Sections 1 and 2](./phase3-learning-depth.md)

**Files:** `src/db/schema.ts`

**What to do:**
- Add `decisionScores` table (symbol, decisionTime, statedAction, reason, priceAtDecision, priceNow, changePct, score, genuineMiss, lesson, tags, createdAt)
- Add `strategyHypotheses` table (hypothesis, evidence, actionable, category, status, supportingTrades, winRate, sampleSize, proposedAt, lastEvaluatedAt, statusChangedAt, rejectionReason)
- Run `bun run db:generate` and `bun run db:migrate`

---

### Step 3.2 — Attach quote data to decisions

**Files:** `src/agent/orchestrator.ts`

**What to do:**
- In `onActiveTradingTick()`, after `runTradingAnalyst()` returns, log the current quotes for all symbols the agent mentioned in its response. Store as JSON in the `agent_logs.data` field alongside the existing token usage data.
- This gives the decision scorer a "price at decision time" reference for each symbol.

---

### Step 3.3 — Decision scorer with signal attribution

**Reference:** [Phase 3 doc, Section 1](./phase3-learning-depth.md#1-decision-scorer--signal-attribution)

**Files:** New file `src/learning/decision-scorer.ts`, modify `src/scheduler/cron.ts`, `src/scheduler/jobs.ts`

**What to do:**
- Implement `runDecisionScorer()`:
  1. Query today's DECISION-level `agent_logs` entries
  2. Batch all decision texts. Send to Haiku with extraction prompt → get structured `{ symbols: [{ symbol, statedAction, reason }] }` per decision
  3. For each extracted symbol with action HOLD/WATCH/PASS:
     - Get price at decision time (from `agent_logs.data` JSON) or fallback to today's opening price
     - Get closing price (from `getHistoricalBars(symbol, "1 M")` last bar, or post-market quote)
     - **NEW: Attach signal state** from gate evaluation logs (Phase 2 data). Include `signalState`, `gateResult`, `aiOverrideReason` in the decision score record.
     - Calculate `changePct`
     - Score using `scoreDecision()` logic
  4. For `missed_opportunity` scores: send to Haiku for brief assessment
  5. Insert all results into `decision_scores` table (with signal attribution fields)
- Register as `decision_scorer` job in `jobs.ts`
- Add cron: `30 17 * * 1-5` (17:30 weekdays) in `cron.ts`

**Test:** Mock agent_logs with a HOLD decision on a symbol. Mock the closing price 6% higher. Verify it scores as `missed_opportunity`, includes signal state, and triggers the Haiku assessment.

---

### Step 3.4 — Feed signal-tagged decision scores into pattern analysis

**Reference:** [Phase 3 doc, Section 1 — Integration with Pattern Analysis](./phase3-learning-depth.md#integration-with-pattern-analysis)

**Files:** `src/learning/pattern-analyzer.ts`

**What to do:**
- In `runPatternAnalysis()`, after existing data gathering:
  - Query `decision_scores` from the last 7 days (now includes signal state)
  - Calculate: missed opportunities count, good avoids count, good holds count, caution ratio
  - **NEW: Per-signal effectiveness.** Group decisions by signal regime (e.g., `trend_alignment=strong_up`) and calculate win/loss stats per regime. Include in the prompt.
  - **NEW: AI override hit rate.** For gate-qualified stocks where AI passed, was the pass correct? Include in the prompt.
  - Append a "Decision Quality + Signal Effectiveness" section to the prompt
- The pattern analyzer now has trade outcomes, decision quality, AND signal-level data to reason about

---

### Step 3.5 — Strategy journal: champion/challenger hypothesis management

**Reference:** [Phase 3 doc, Section 2](./phase3-learning-depth.md#2-strategy-journal--championchallenger)

**Files:** `src/learning/prompts.ts`, `src/learning/pattern-analyzer.ts`

**What to do:**
- Extend `PATTERN_ANALYZER_SYSTEM` prompt with champion/challenger hypothesis management instructions
- Hypotheses can target gate parameters (`targetType: "gate_param"`) as well as prompt text
- Change the expected output format to include both `insights` array and `hypotheses` array (with champion/challenger comparison fields)
- In `runPatternAnalysis()`:
  - Query existing `strategy_hypotheses` (non-rejected) and include in the prompt as context
  - After parsing insights, also parse hypothesis updates from the response
  - Handle `propose` (insert new with targetType), `update` (modify status/evidence with champion/challenger metrics), `reject` (set rejected + reason)
  - **Promotion gate enforcement:** ACTIVE → CONFIRMED only when ALL thresholds met: n>=30, Wilson significance (z=1.645, reuse `wilsonLower()` from `src/self-improve/monitor.ts`), expectancy guard, drawdown constraint ≤ champion × 1.2. No auto-promotion — CONFIRMED means "ready for PR."

---

### Step 3.6 — Feed hypotheses into trading decisions

**Reference:** [Phase 3 doc, Section 2 — Feeding Hypotheses Into Trading Decisions](./phase3-learning-depth.md#feeding-hypotheses-into-trading-decisions)

**Files:** `src/learning/context-builder.ts`

**What to do:**
- In `buildLearningBrief()`:
  - Query `strategy_hypotheses` where status is `active` or `confirmed`, ordered by sample size descending
  - Append a "Strategy Journal" section with each hypothesis, its actionable guidance, evidence summary, and sample size
  - [CONFIRMED] hypotheses are prefixed as hard modifiers
- In `buildRecentContext()` (used by Tier 3):
  - Include only `confirmed` hypotheses (lighter context for mini-analysis)

---

### Step 3.7 — Self-improvement integration (gate config + prompt)

**Files:** `src/self-improve/monitor.ts`

**What to do:**
- In the self-improvement job, query `strategy_hypotheses` where status = `confirmed` AND `sampleSize >= 30`
- Include these in the self-improvement prompt as "candidates for codification"
- **NEW: Gate config as target.** For hypotheses with `targetType: "gate_param"`, the self-improvement agent proposes PRs that modify `config/momentum-gate.json`. For `targetType: "prompt"`, it modifies the trading analyst prompt (existing behavior).
- Add `config/momentum-gate.json` to the self-improvement allowed-files list
- The self-improvement agent can then propose PRs that embed confirmed hypotheses into gate config or prompt permanently

---

## Phase 4: Autonomy Escalation

**Goal:** Graduate from paper trading to live trading with proper governance, rollback triggers, and reporting.
**Reference:** [Phase 4 doc](./phase4-autonomy-escalation.md)
**Estimated effort:** 1–2 sessions.
**KPIs:** Operating mode progression, rollback frequency, governance report quality. See [strategy-framework.md](./strategy-framework.md) for measurement windows.

### Step 4.1 — Rollout ladder

**Reference:** [Phase 4 doc, Section 1](./phase4-autonomy-escalation.md#1-rollout-ladder)

**Files:** New `config/operating-mode.json`, `src/risk/limits.ts`, `src/agent/orchestrator.ts`

**What to do:**
- Create `config/operating-mode.json` with initial mode `"paper"`
- Add `loadOperatingMode()` utility that reads the config
- In `limits.ts`: add `CONSTRAINED_LIMITS` override set (3 positions, 10% max, 30% cash reserve, tighter circuit breakers). `getActiveLimits()` returns constrained limits when mode is `constrained_live`.
- In `orchestrator.ts`: check operating mode at start of each tick. Log current mode. Enforce mode-specific behavior (e.g., shadow logging in `shadow_live`).

### Step 4.2 — Rollback triggers

**Reference:** [Phase 4 doc, Section 2](./phase4-autonomy-escalation.md#2-rollback-triggers)

**Files:** `src/risk/manager.ts`, `src/broker/guardian.ts`, `src/agent/orchestrator.ts`

**What to do:**
- Add `categorizeRejection(reason)` to `manager.ts` — classify rejections as strategy vs infrastructure
- In `guardian.ts`: track consecutive rejections by category. Fire rollback trigger when threshold hit (3+ consecutive strategy rejections → revert mode + config; 3+ infrastructure → pause + alert, no config revert).
- Add daily/weekly loss circuit breakers that trigger mode reversion
- Log all rollback events to `agent_logs` with structured data

### Step 4.3 — Governance reporting

**Reference:** [Phase 4 doc, Section 3](./phase4-autonomy-escalation.md#3-governance-reporting)

**Files:** New `src/reporting/governance-report.ts`, `src/scheduler/cron.ts`, `src/scheduler/jobs.ts`

**What to do:**
- Implement `generateGovernanceReport()`: policy changes, attributable impact, operating mode status, rollback events, upcoming evaluations
- Send via existing Resend email infrastructure
- Register as job: Friday 18:00 (`0 18 * * 5`)
- Report uses rolling windows from strategy-framework.md (20-trade for signal KPIs, 4-week for calendar KPIs)

---

## Verification Checklist

Run after each phase before deploying:

```bash
bun run typecheck     # No type errors
bun run lint          # Biome passes
bun test              # All tests pass
```

After deploying each phase, verify in production:

**Phase 1:**
- [ ] Place a test trade with confidence 0.5 → rejected by `place_trade`
- [ ] Check agent_logs for Guardian entries (stop-loss checks, price updates)
- [ ] Verify daily summary email includes any PR staleness alerts
- [ ] Trigger a manual `orchestrator_tick` and confirm context includes day plan + last assessment

**Phase 2:**
- [ ] Check agent_logs for indicator summaries in Tier 3 context
- [ ] Verify momentum gate evaluations logged (both pass and fail) with full signal state
- [ ] Confirm gate-failed candidates do NOT trigger Sonnet calls
- [ ] Verify research records include indicator data
- [ ] Confirm agent references specific indicator values in its decisions (RSI, trend alignment, etc.)
- [ ] Watch for ATR-based stop/target levels in trade reasoning
- [ ] Verify trailing stops updating on Guardian ticks (highWaterMark, trailingStopPrice)
- [ ] Run shadow evaluation for 1-2 weeks: compare gate-only vs gate+AI outcomes
- [ ] **Exit gate:** AI override shows non-negative value. All signal states logged. Trailing stops operating.

**Phase 3:**
- [ ] Check `decision_scores` table is being populated after 17:30 (with signal attribution fields)
- [ ] Verify pattern analysis includes "Decision Quality + Signal Effectiveness" section
- [ ] Verify per-signal win/loss stats generating with rolling 20-trade windows
- [ ] After 1-2 weeks, check `strategy_hypotheses` table for proposed entries (with targetType)
- [ ] Confirm learning brief includes active hypotheses
- [ ] Verify at least one hypothesis reaches ACTIVE status with challenger shadow-running
- [ ] Verify promotion gates enforced: no CONFIRMED without n>=30, Wilson significance, expectancy guard
- [ ] **Exit gate:** Signal-tagged data flowing 2+ weeks. Champion/challenger comparison data flowing. No auto-promotion.

**Phase 4:**
- [ ] Verify operating mode config loads correctly
- [ ] Test mode-specific limit overrides (constrained_live limits tighter than full)
- [ ] Verify rejection categorization (strategy vs infrastructure) working correctly
- [ ] Test rollback trigger: simulate 3 consecutive strategy rejections → mode reversion
- [ ] Test rollback trigger: simulate infrastructure failure → alert only, no config revert
- [ ] Verify governance report generates and sends via email
- [ ] **Exit gate:** System in `constrained_live` 4+ weeks with positive expectancy. Zero unplanned rollbacks in final 2 weeks. `full_live` requires Q's sign-off.
