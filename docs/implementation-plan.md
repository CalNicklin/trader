# Implementation Plan

> Step-by-step build order for all three phases. Each step is a single commit. Deploy after each phase and observe for at least one trading week before starting the next.
>
> Reference docs:
> - [Agentic Process Audit](./agentic-process-audit.md) — full system audit and gap IDs (A1–H3)
> - [Gap Resolution Plan](./gap-resolution-plan.md) — Phase 1 fixes
> - [Phase 2: Trading Intelligence](./phase2-trading-intelligence.md) — indicators, prompt, sizing
> - [Phase 3: Learning Depth](./phase3-learning-depth.md) — decision scorer, strategy journal
> - [Verdict](./verdict.md) — overall assessment and cost philosophy

---

## Phase 1: Foundation

**Goal:** Make the system safe and operationally reliable.
**Estimated effort:** 2–3 sessions.
**Deploy, then observe for 1 trading week before Phase 2.**

### Step 1.1 — Enforce risk check inside `place_trade`

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

### Step 1.2 — Wire sector exposure and volume into risk pipeline

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

### Step 1.3 — Position Guardian

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

### Step 1.4 — `log_intention` tool

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

### Step 1.5 — Context enrichments

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

### Step 1.6 — Operational fixes

**Gaps:** D2 (snapshot retry), F1 (review cancelled orders), F2 (lower pattern minimum), F3 (PR staleness alerts), F4 (severity-weighted brief), F5 (Wilson score pause), G2 (heartbeat), G5 (missed job backfill), E2 (dynamic news matching), E4 (research data quality), E5 (score decay), E3 (research priority), G4 (cost tracking accuracy)

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

**Goal:** Give the agent an analytical framework that can actually generate returns.
**Estimated effort:** 2–3 sessions.
**Deploy, then observe for 1–2 trading weeks. Compare decision quality and trade frequency against Phase 1 baseline.**

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

### Step 2.3 — Integrate indicators into orchestrator

**Reference:** [Phase 2 doc, Section 4](./phase2-trading-intelligence.md#4-integration-points)

**Files:** `src/agent/orchestrator.ts`

**What to do:**
- Import `getIndicatorsForSymbol`, `formatIndicatorSummary` from `src/analysis/indicators.ts`
- In `onActiveTradingTick()` Tier 3, after deciding to escalate:
  - Compute indicators for all held positions (up to 10, using `"3 M"` duration)
  - Compute indicators for top 5 watchlist symbols
  - Add indicator summaries to `fullContext` under "## Technical Indicators"
- In `onPreMarket()`:
  - Compute indicators for all positions + top 10 watchlist
  - Add to day plan context

At this point the agent sees indicators but the prompt still says "look for pullbacks." That's fine — Claude understands indicator data from its training. This step validates the data pipeline before the prompt changes.

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

### Step 2.5 — ATR-based position sizing

**Reference:** [Phase 2 doc, Section 3](./phase2-trading-intelligence.md#3-volatility-adjusted-sizing)

**Files:** `src/risk/limits.ts`, `src/risk/manager.ts`, `src/agent/tools.ts`

**What to do:**
- In `limits.ts`: add `STOP_LOSS_ATR_MULTIPLIER: 2`, `TARGET_ATR_MULTIPLIER: 3`, `RISK_PER_TRADE_PCT: 1`. Keep `PER_TRADE_STOP_LOSS_PCT: 3` as fallback.
- In `manager.ts`: add `getAtrPositionSize(price, atr)` function. Update `calculateStopLoss(entryPrice, atr?)` to use ATR when available, fallback to fixed 3%.
- In `tools.ts`: update `get_max_position_size` input schema to accept optional `atr` parameter. Route to `getAtrPositionSize` when ATR is provided, else use existing `getMaxPositionSize`.

**Test:** Unit test: stock at 2000p, ATR 40p → stop at 1920p, target at 2120p. Portfolio £100k → max risk £1000 → max shares 1250.

---

### Step 2.6 — Expert prompt rewrite

**Reference:** [Phase 2 doc, Section 2](./phase2-trading-intelligence.md#2-expert-prompt-rewrite)

**Files:** `src/agent/prompts/trading-analyst.ts`

**What to do:**
- Replace `TRADING_ANALYST_SYSTEM` with the multi-factor framework prompt from the Phase 2 doc
- Replace `MINI_ANALYSIS_PROMPT` with the version that references ATR-based levels and factor scoring
- Replace `DAY_PLAN_PROMPT` with the version that references indicators and risk budgeting
- Add `log_intention` to the tool list in the prompt text

**This is the highest-impact change.** Do it last in Phase 2 so everything it references (indicators, ATR sizing) is already live. Watch decision quality closely for the first week.

---

## Phase 3: Learning Depth

**Goal:** Close the feedback loop on inaction and build an evolving strategy.
**Estimated effort:** 1–2 sessions.
**Deploy, then observe for 2+ trading weeks — this phase needs trades to produce data.**

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

### Step 3.3 — Decision scorer

**Reference:** [Phase 3 doc, Section 1](./phase3-learning-depth.md#1-decision-scorer)

**Files:** New file `src/learning/decision-scorer.ts`, modify `src/scheduler/cron.ts`, `src/scheduler/jobs.ts`

**What to do:**
- Implement `runDecisionScorer()`:
  1. Query today's DECISION-level `agent_logs` entries
  2. Batch all decision texts. Send to Haiku with extraction prompt → get structured `{ symbols: [{ symbol, statedAction, reason }] }` per decision
  3. For each extracted symbol with action HOLD/WATCH/PASS:
     - Get price at decision time (from `agent_logs.data` JSON) or fallback to today's opening price
     - Get closing price (from `getHistoricalBars(symbol, "1 M")` last bar, or post-market quote)
     - Calculate `changePct`
     - Score using `scoreDecision()` logic
  4. For `missed_opportunity` scores: send to Haiku for brief assessment
  5. Insert all results into `decision_scores` table
- Register as `decision_scorer` job in `jobs.ts`
- Add cron: `30 17 * * 1-5` (17:30 weekdays) in `cron.ts`

**Test:** Mock agent_logs with a HOLD decision on a symbol. Mock the closing price 6% higher. Verify it scores as `missed_opportunity` and triggers the Haiku assessment.

---

### Step 3.4 — Feed decision scores into pattern analysis

**Reference:** [Phase 3 doc, Section 1 — Integration with Pattern Analysis](./phase3-learning-depth.md#integration-with-pattern-analysis)

**Files:** `src/learning/pattern-analyzer.ts`

**What to do:**
- In `runPatternAnalysis()`, after existing data gathering:
  - Query `decision_scores` from the last 7 days
  - Calculate: missed opportunities count, good avoids count, good holds count, caution ratio
  - Append a "Decision Quality" section to the prompt
- The pattern analyzer now has both trade outcomes AND decision quality to reason about

---

### Step 3.5 — Strategy journal: hypothesis management

**Reference:** [Phase 3 doc, Section 2](./phase3-learning-depth.md#2-strategy-journal)

**Files:** `src/learning/prompts.ts`, `src/learning/pattern-analyzer.ts`

**What to do:**
- Extend `PATTERN_ANALYZER_SYSTEM` prompt with the hypothesis management instructions (propose, evaluate, reject)
- Change the expected output format to include both `insights` array and `hypotheses` array
- In `runPatternAnalysis()`:
  - Query existing `strategy_hypotheses` (non-rejected) and include in the prompt as context
  - After parsing insights, also parse hypothesis updates from the response
  - Handle `propose` (insert new), `update` (modify status/evidence), `reject` (set rejected + reason)

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

### Step 3.7 — Self-improvement integration

**Files:** `src/self-improve/monitor.ts`

**What to do:**
- In the self-improvement job, query `strategy_hypotheses` where status = `confirmed` AND `sampleSize >= 30`
- Include these in the self-improvement prompt as "candidates for codification"
- The self-improvement agent can then propose PRs that embed confirmed hypotheses into the trading prompt permanently

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
- [ ] Verify research records include indicator data
- [ ] Confirm agent references specific indicator values in its decisions (RSI, trend alignment, etc.)
- [ ] Watch for ATR-based stop/target levels in trade reasoning

**Phase 3:**
- [ ] Check `decision_scores` table is being populated after 17:30
- [ ] Verify pattern analysis includes "Decision Quality" section
- [ ] After 1-2 weeks, check `strategy_hypotheses` table for proposed entries
- [ ] Confirm learning brief includes active hypotheses
