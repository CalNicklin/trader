# Gap Resolution Plan

> Addresses all 29 gaps identified in `docs/agentic-process-audit.md` with a cost increase of ~$1.40/month.

---

## Table of Contents

1. [Core Architectural Change: Position Guardian](#1-core-architectural-change-position-guardian)
2. [Zero-Cost Fixes (Code Changes Only)](#2-zero-cost-fixes)
3. [Low-Cost Context Enrichments](#3-low-cost-context-enrichments)
4. [Small Additional AI Calls](#4-small-additional-ai-calls)
5. [Process & Operational Fixes](#5-process--operational-fixes)
6. [Cost Summary](#6-cost-summary)

---

## 1. Core Architectural Change: Position Guardian

The most critical gaps (stop-loss execution, fill tracking, real-time P&L) don't need AI — they need a fast, dumb loop running on IBKR's streaming data that we're already paying for.

### Architecture

```
Current:
  Every 20 min → [Pre-filter] → [Haiku] → [Sonnet]

Proposed addition:
  Every 60s   → [Position Guardian]  ← pure code, zero AI cost
                  │
                  ├─ Stop-loss breach? → immediate SELL (no AI)
                  ├─ Price move >3%?   → flag for next Haiku scan
                  ├─ Order filled?     → update state
                  └─ Order expired?    → log for review
```

The Position Guardian subscribes to IBKR streaming quotes for held positions (already connected, this is free) and acts on hard rules. It doesn't think — it executes mechanical stops and flags events for the AI to consider at the next tick.

### Guardian Responsibilities

```
Position Guardian (every 60s):

  1. STOP-LOSS ENFORCEMENT [fixes A4]
     For each position where stopLossPrice is set:
       Get streaming quote (IBKR subscription, not snapshot)
       If last price ≤ stopLossPrice:
         → Place MARKET SELL order immediately
         → Log to agent_logs (level: ACTION, "stop-loss triggered")
         → No AI deliberation — this is mechanical

  2. FILL TRACKER [fixes C1]
     Check order monitoring callbacks:
       If order FILLED → update position, log
       If order CANCELLED/EXPIRED → log, flag for review

  3. PRICE ALERT ACCUMULATOR [fixes B3]
     Track streaming prices for top watchlist symbols:
       If move >3% since last tick → add to alertQueue
       alertQueue is consumed by next orchestrator_tick
       (replaces the snapshot-based 2% check in pre-filter)

  4. REAL-TIME P&L UPDATE [fixes H1]
     Update positions.currentPrice and unrealizedPnl
     from streaming data (not just at reconciliation)

  5. UNFILLED ORDER CLEANUP [fixes C2]
     After 16:30, check for SUBMITTED orders still open:
       Log as "expired unfilled"
       Update status to CANCELLED
       Add to next day's context as "yesterday's unfilled orders"
```

**Location:** New file `src/broker/guardian.ts`, started from `src/index.ts` after scheduler.

**IBKR streaming:** Subscribe via `reqMktData` for held positions + top 10 watchlist. These are persistent subscriptions (not snapshots), so they're rate-limit friendly. IBKR allows ~100 simultaneous streaming subscriptions on a standard account.

**Gaps resolved:** A4, B3, C1, C2, G3, H1

**Cost impact: $0/month**

---

## 2. Zero-Cost Fixes

Pure code changes with no additional AI calls.

### D1 — Enforce Risk Check Before Trade Execution

**The most dangerous gap.** Currently `place_trade` trusts the agent to call `check_risk` first.

**Fix:** Call `checkTradeRisk()` inside the `place_trade` tool implementation, before submitting to IBKR. Reject with reason if not approved. The agent can still call `check_risk` for pre-flight info, but execution is gated regardless.

**Where:** `src/agent/tools.ts` — `place_trade` handler

---

### D3 — Enforce Sector Exposure Limit

`MAX_SECTOR_EXPOSURE_PCT` (30%) is defined in hard limits but never checked.

**Fix:** Add sector concentration check to `checkTradeRisk()`. Query positions table, sum market value by sector, reject if the proposed trade would push any sector above 30%.

**Where:** `src/risk/manager.ts`

---

### D4 — Enforce Volume Check

`MIN_AVG_VOLUME` (50,000) is defined but never checked.

**Fix:** Add average volume check to `checkTradeRisk()`. Fetch a fresh Yahoo Finance quote at risk-check time to get current average volume. This is one extra API call per trade (not per tick), so the frequency is very low. Using live data is better than parsing the research table's `rawData` JSON blob — that would couple the risk system to the research pipeline's internal format and the data could be days old. If the Yahoo call fails, reject with "unable to verify volume — try again."

**Where:** `src/risk/manager.ts`

---

### A5 — Enforce Wind-Down Order Rejection

Wind-down (16:25–16:30) is advisory only. Orders still execute.

**Fix:** Add market phase check in `place_trade` — reject BUY orders if current phase is `wind_down` or `post_market`.

**Where:** `src/agent/tools.ts` — `place_trade` handler

---

### A2 — Enforce Confidence Threshold

Confidence ≥ 0.7 is prompt-enforced only. The agent self-reports confidence.

**Fix:** Read `confidence` from `place_trade` input and reject if < 0.7. Now enforced in code, not just the prompt.

**Where:** `src/agent/tools.ts` — `place_trade` handler

---

### C3 — Handle Partial Fills

`PARTIALLY_FILLED` status is mapped but there's no specific logic.

**Fix:** On `PARTIALLY_FILLED`, log a warning and include in next tick's pre-filter context so the agent can decide whether to cancel the remainder or let it ride.

**Where:** `src/broker/orders.ts`

---

### E2 — Dynamic News Matching

`SYMBOL_NAMES` dict is hard-coded. New watchlist entries don't get name mappings.

**Fix:** Build the symbol→name map dynamically from the `watchlist` table (which already has `name` and `symbol` columns). Fall back to the static dict for common aliases (e.g., "M&S" for Marks & Spencer).

**Where:** `src/research/sources/news-scraper.ts`

---

### E4 — Flag Incomplete Research

If Yahoo returns null for fundamentals, the analysis runs on partial data with no warning.

**Fix:** Add a `dataQuality` field to research records: `"full"` / `"partial"` (missing fundamentals) / `"minimal"` (quote only). Surface this to the agent via `get_recent_research` so it knows how much to trust the analysis.

**Where:** `src/research/pipeline.ts`

---

### E5 — Watchlist Score Decay

With max 10 symbols researched per day, old entries go stale indefinitely. Scores mislead the agent.

**Fix:** Add score decay: reduce score by 5 points for every 7 days since last research. Symbols that fall below score 10 get set to `active = false`. Run as part of the research pipeline (daily, after research completes).

**Where:** `src/research/watchlist.ts`

---

### G4 — Accurate Token Cost Tracking

`estimatedCostUsd` doesn't account for prompt caching savings.

**Fix:** Apply cache discount to cost calculation: cache read = 10% of input cost, cache write = 25%. Track `cacheReadTokens` and `cacheWriteTokens` separately from the API response.

**Where:** `src/utils/token-tracker.ts`

---

### B2 — Pre-Filter Vestigial

Acknowledged as low impact. Haiku scan runs for every tick (~$0.05/day). Pre-filter reasons are informational.

**Fix:** No action needed. Cost is acceptable and Haiku decisions are valuable.

---

### G1 — Single-Job Lock

Jobs queue behind long-running ones.

**Fix:** No action needed. Acceptable for current workload. If research pipeline regularly blocks other jobs, consider splitting into a separate lock.

---

**Total cost impact: $0/month**

---

## 3. Low-Cost Context Enrichments

Marginal token increases added to existing Claude calls.

### A3 — Feed Day Plan Into Active Trading

The day plan is generated at 07:30 but never referenced by subsequent ticks.

**Fix:** Store day plan in an in-memory `currentDayPlan` variable in the orchestrator. Include a ~200-token summary in the MINI_ANALYSIS context for each Tier 3 Sonnet call: "Today's plan: [summary]".

**Cost:** +~200 input tokens × ~1–2 Sonnet calls/day ≈ +$0.002/day

**Where:** `src/agent/orchestrator.ts`

---

### H3 — Agent Memory Between Ticks

Each orchestrator tick starts fresh. The agent has no idea what it said 20 minutes ago.

**Fix:** Store the last agent response text in memory. Include in Tier 3 context: "Your last assessment (20 min ago): [text]". ~300 tokens.

**Cost:** +~300 input tokens × ~1–2 Sonnet calls/day ≈ +$0.003/day

**Where:** `src/agent/orchestrator.ts`

---

### A1 — Track Unfulfilled Intentions

If the agent says "I would buy X if it drops to Y" but doesn't call `place_trade`, the intention is lost.

**Fix:** Add a `log_intention` tool to the agent's toolset. When the agent wants to remember something for next tick — a conditional buy, a price level to watch, a planned exit — it explicitly logs it as structured data (`{ symbol, condition, action, note }`). These are stored in-memory and surfaced in the next tick's pre-filter reasons so Haiku can escalate if the condition is met.

This is more reliable than regex on free text ("plan to", "will buy if") which would be fragile and miss edge cases. Structured tool output is deterministic.

**Cost:** +~100 tokens to Haiku context ≈ +$0.001/day

**Where:** `src/agent/tools.ts` (new tool), `src/agent/orchestrator.ts` (storage + consumption)

---

### B1 — Stale Positions in Pre-Filter

If IBKR disconnects, pre-filter uses stale position data.

**Fix:** Already addressed by Position Guardian keeping positions fresh via streaming data. Pre-filter now reads live data from the DB.

**Cost:** $0 (covered by Guardian)

---

### B4 — Haiku Decides on Partial Data

If quote fetches fail, Haiku doesn't know context is incomplete.

**Fix:** Add a `dataCompleteness` note to scan context: "Quotes: 8/10 succeeded. Failed: SHEL, BP." Haiku can factor this into its escalation decision — e.g., escalate if a held position's quote is missing.

**Cost:** +~50 tokens ≈ negligible

**Where:** `src/agent/orchestrator.ts`

---

### H2 — No Portfolio-Level View

Each trade is evaluated independently. No rebalancing or concentration awareness.

**Fix:** Add a "Portfolio Composition" section to Tier 3 context: sector breakdown with % allocation, largest position %, cash %. Pre-compute from positions table. The agent can then factor portfolio balance into decisions.

**Cost:** +~150 input tokens × ~1–2 Sonnet calls/day ≈ +$0.001/day

**Where:** `src/agent/orchestrator.ts`

---

**Total cost impact: ~$0.01/day ≈ $0.20/month**

---

## 4. Small Additional AI Calls

### F1 — Review Cancelled and Expired Orders

Only FILLED trades get reviewed. Cancelled/expired orders could hold lessons (e.g., limit price too aggressive).

**Fix:** Include CANCELLED and expired (unfilled DAY) orders in the trade review job. Typically 0–3 per day.

**Cost:** +~3 Haiku calls/day × $0.005 = +$0.015/day ≈ **$0.30/month**

**Where:** `src/learning/trade-reviewer.ts`

---

### F5 — Auto-Pause on Small Sample

Win rate with 5 trades is noisy. Could false-positive pause.

**Fix:** Replace the fixed win-rate threshold with a confidence interval approach. Use a Wilson score interval on the observed win rate — this naturally accounts for sample size. With 3/10 losses the interval is wide (not significant), but 30/100 losses would be narrow (significant). Pause only when the lower bound of the 95% confidence interval falls below 40%.

Concretely:
- n=5, 2 wins → Wilson lower bound ≈ 0.12 → below 0.4 but interval is [0.12, 0.78] — too wide, **don't pause**
- n=20, 8 wins → Wilson lower bound ≈ 0.22 → below 0.4 and interval is tighter — **pause**
- n=50, 25 wins → Wilson lower bound ≈ 0.37 → borderline, approaching significance
- n=100, 50 wins → Wilson lower bound ≈ 0.40 → exactly at threshold — **don't pause**

This is a ~10-line function (Wilson score is a simple formula) and eliminates false positives on small samples while being more responsive on large samples.

**Cost:** Negligible (code change only)

**Where:** `src/self-improve/monitor.ts`

---

**Total cost impact: ~$0.30/month**

---

## 5. Process & Operational Fixes

No AI cost. Code and configuration changes only.

### D2 — Snapshot Gaps Break Loss Limits

If post-market snapshot fails, the daily/weekly loss circuit breaker uses stale data.

**Fix:** If `recordDailySnapshot()` fails, retry 3 times with 30s backoff. If still failing, carry forward yesterday's snapshot with a `stale: true` flag. When the risk pipeline reads a stale baseline, log a warning and apply a tighter loss limit (e.g., 1.5% instead of 2%) as a conservative fallback.

**Where:** `src/agent/orchestrator.ts`, `src/risk/manager.ts`

---

### F2 — Pattern Analysis Stalls in Quiet Weeks

Requires 3+ trade reviews. Quiet weeks produce nothing.

**Fix:** Lower minimum from 3 to 1 trade review. Even a single trade can yield insight. If zero trades, skip gracefully (already does).

**Where:** `src/learning/pattern-analyzer.ts`

---

### F3 — Self-Improvement PRs Never Applied

PRs accumulate in GitHub, never merged. The learning loop is broken at the last step.

**Fix:** Add PR age tracking. If a PR is >7 days old and unmerged, include it in the daily summary email under "Pending improvements awaiting review" with title + link. Makes staleness visible without requiring auto-merge.

**Where:** `src/reporting/templates/daily-summary.ts`, `src/self-improve/monitor.ts`

---

### F4 — Learning Brief Fixed-Size

Only last 5 insights and 5 reviews. Critical lessons may roll off.

**Fix:** Weight by severity: always include ALL `critical` insights regardless of count. Then fill remaining slots with `warning`, then `info`. Same total size, but critical items are never dropped.

**Where:** `src/learning/context-builder.ts`

---

### G2 — No Heartbeat Monitoring

If the process crashes overnight, nobody knows until the daily summary email is missing.

**Fix:** Add a 07:00 cron job that sends a "system alive" email (or lightweight ping). If you don't receive it by 07:15, the system is down. Alternative: use the admin `/health` endpoint with an external uptime monitor (e.g., UptimeRobot free tier, checks every 5 min).

**Where:** `src/scheduler/cron.ts`, `src/scheduler/jobs.ts`

---

### G5 — No Backfill for Missed Jobs

If the system restarts at 15:00, it doesn't run missed jobs.

**Fix:** On startup, check the last `agent_logs` entry timestamp. If last entry was >2 hours ago and we're currently in market hours, run a catch-up `orchestrator_tick` immediately. Log "catch-up run" to distinguish from scheduled runs.

**Important:** Only backfill `orchestrator_tick`, not phase-specific jobs. A day plan generated at 15:00 would be very different from one at 07:30 — stale pre-market context, missed morning moves, different remaining-time calculus. The orchestrator tick already detects the current market phase and behaves appropriately for it. Phase-specific jobs (pre_market, post_market) should only run at their scheduled times.

**Where:** `src/index.ts`

---

### E1 — FMP Screener Discovery — FIXED (Feb 20)

**Problem:** FMP `/company-screener` with `exchange=LSE` was returning HTTP 402 on free tier. Discovery was completely broken since launch — watchlist stuck at 10 seed stocks.

**Fix:** Upgraded to FMP Starter tier ($22/mo, 300 req/min). The `exchange=LSE` param still requires Premium ($59/mo), so implemented a two-step workaround:
1. Screen with `country=GB` (works on Starter) — returns US-listed UK companies
2. Resolve LSE tickers via `/search-name?query=<name>&exchange=LSE` (works on Starter)

Added pipeline observability: key events now logged to `agent_logs` table (survive container restarts). Fixed exclusions table duplication (added unique constraint on type+value).

**Where:** `src/research/sources/lse-screener.ts` (new), `src/research/sources/lse-resolver.ts` (new), `src/research/pipeline-logger.ts` (new), `src/research/pipeline.ts` (updated imports + logging), `src/research/sources/fmp.ts` (removed screenLSEStocks, exported fmpFetch).

---

### E3 — Research Staleness Uniform

All symbols go stale at the same rate. A volatile held position and an idle watchlist entry get equal priority.

**Fix:** Weight research priority: (a) held positions always first, (b) symbols with score > 50 next, (c) everything else. Ensures the most decision-relevant stocks are always fresh.

**Where:** `src/research/watchlist.ts` — `getStaleSymbols()` sort order

---

**Total cost impact: $0/month**

---

## 6. Cost Summary

### Per-Component Breakdown

| Component | Current | After Changes | Delta |
|-----------|---------|--------------|-------|
| Tier 2 Haiku (~54/day) | ~$0.05/day | ~$0.05/day | $0 |
| Tier 3 Sonnet (variable) | $0.35–1.75/day | $0.35–1.75/day | $0 |
| Pre-market Sonnet | ~$0.20/day | ~$0.20/day | $0 |
| Research pipeline | ~$0.50/day | ~$0.50/day | $0 |
| Trade reviews | ~$0.05/day | ~$0.07/day | +$0.02 |
| Pattern analysis | ~$0.01/day | ~$0.01/day | $0 |
| Self-improvement | ~$0.10/day | ~$0.10/day | $0 |
| Position Guardian | — | $0/day | $0 |

### Scenario-Based Monthly Estimates

The cost depends heavily on how active the agent is. Sonnet escalation is the main variable.

| Scenario | Sonnet Calls/Day | Daily Cost | Monthly (20 days) | Delta from Changes |
|----------|-----------------|-----------|-------------------|-------------------|
| **Quiet** (paper trading, no positions, all-HOLD) | 0–1 | ~$0.60 | ~$12 | +$0.30 |
| **Typical** (few positions, occasional trades) | 1–2 | ~$1.40–2.10 | ~$28–42 | +$0.30 |
| **Active** (multiple positions, volatile market) | 3–5 | ~$2.80 | ~$56 | +$0.30 |
| **Heavy** (high volatility, frequent escalation) | 5–8 | ~$4.50 | ~$90 | +$0.30 |

The gap resolution adds ~$0.30–0.60/month regardless of activity level, because the fixes are almost entirely code changes and small context enrichments. The main cost driver remains Sonnet escalation frequency, which is unchanged by these fixes.

### Gap Resolution Summary

| Category | Gaps | Method | Cost |
|----------|------|--------|------|
| Code-only fixes | D1, D3, D4, A2, A5, C3, E2, E4, E5, G4, B2, G1 | Enforce existing rules in code | $0 |
| Position Guardian | A4, B3, C1, C2, G3, H1 | IBKR streaming + 60s loop | $0 |
| Context enrichment | A1, A3, B1, B4, H2, H3 | Extra tokens in existing calls | $0.20/mo |
| Additional AI calls | F1, F5 | Few extra Haiku reviews/day | $0.30/mo |
| Process fixes | D2, E1, E3, F2, F3, F4, G2, G5 | Code + config changes | $0 |
| **Total** | **29 gaps** | | **+$0.30–0.60/mo** |
