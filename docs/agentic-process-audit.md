# Agentic Process Flow Audit

> Generated 2026-02-16. Complete audit of every automated process, decision path, and data flow in the Trader Agent platform.

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Startup & Lifecycle](#2-startup--lifecycle)
3. [Schedule — Every Job](#3-schedule--every-job)
4. [The Orchestrator Tick (Core Trading Loop)](#4-the-orchestrator-tick)
5. [Three-Tier Decision Architecture](#5-three-tier-decision-architecture)
6. [AI Agent — Prompts, Tools & Decision Format](#6-ai-agent--prompts-tools--decision-format)
7. [Trade Execution Pipeline](#7-trade-execution-pipeline)
8. [Risk Management Pipeline](#8-risk-management-pipeline)
9. [Research Pipeline](#9-research-pipeline)
10. [Learning & Self-Improvement Loop](#10-learning--self-improvement-loop)
11. [Reporting & Notifications](#11-reporting--notifications)
12. [Data Model (All Tables)](#12-data-model)
13. [External Dependencies & Failure Modes](#13-external-dependencies--failure-modes)
14. [Identified Gaps & Potential Failure Points](#14-identified-gaps--potential-failure-points)

---

## 1. System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        TRADER AGENT                             │
│                                                                 │
│  ┌───────────┐  ┌──────────────┐  ┌───────────┐  ┌──────────┐  │
│  │ Scheduler │→ │ Orchestrator │→ │ AI Agent  │→ │  Broker  │  │
│  │ (10 cron) │  │ (state machine)│ │ (Claude)  │  │  (IBKR)  │  │
│  └───────────┘  └──────────────┘  └───────────┘  └──────────┘  │
│        ↕              ↕                ↕               ↕        │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                    SQLite Database                         │  │
│  │  trades | positions | research | watchlist | agent_logs   │  │
│  │  daily_snapshots | trade_reviews | weekly_insights | ...  │  │
│  └───────────────────────────────────────────────────────────┘  │
│        ↕              ↕                ↕                        │
│  ┌──────────┐  ┌──────────────┐  ┌───────────┐                 │
│  │  Email   │  │   Research   │  │  Learning  │                 │
│  │ (Resend) │  │ (Yahoo/FMP)  │  │  (Reviews) │                 │
│  └──────────┘  └──────────────┘  └───────────┘                 │
└─────────────────────────────────────────────────────────────────┘
```

**Stack:** Bun + TypeScript + SQLite (Drizzle ORM) + IBKR (@stoqey/ib) + Claude API + Resend

**Goal:** Autonomously trade UK stocks in an ISA (long-only, cash-only, GBP/LSE) with AI-driven decisions, continuous learning, and strict risk controls.

---

## 2. Startup & Lifecycle

**Entry point:** `src/index.ts`

```
Boot Sequence:
  1. Parse & validate environment (Zod schema)
  2. Open SQLite DB + run migrations (idempotent)
  3. Seed database (risk config defaults, exclusions)
  4. Connect to IBKR (5 retries, 3s backoff, 15s timeout each)
  5. Fetch & log account summary (verify connection)
  6. Start scheduler (10 cron tasks registered)
  7. Start admin HTTP server (127.0.0.1:3847)
  8. Ready — waiting for cron ticks or HTTP triggers

Graceful Shutdown (SIGINT/SIGTERM):
  1. Stop admin server
  2. Stop all cron tasks
  3. Disconnect IBKR
  4. Close SQLite
  5. process.exit(0)

Crash Protection:
  - Unhandled rejection storm: ≥10 in 60s → critical alert email + exit
  - Uncaught exceptions → alert email + exit
```

---

## 3. Schedule — Every Job

All times **Europe/London**. Weekdays only unless noted.

| Time | Job | Cron Pattern | What It Does |
|------|-----|-------------|--------------|
| **07:30** | `pre_market` | `30 7 * * 1-5` | Sync account, reconcile positions, generate day plan via Sonnet |
| **07:40–16:40** | `orchestrator_tick` | `*/20 7-16 * * 1-5` | Three-tier analysis: pre-filter → Haiku scan → Sonnet agent |
| **16:35** | `post_market` | `35 16 * * 1-5` | Reconcile positions, record daily snapshot |
| **17:00** | `daily_summary` | `0 17 * * 1-5` | Email daily performance report |
| **17:15** | `trade_review` | `15 17 * * 1-5` | Claude reviews each filled trade (lessons learned) |
| **17:30 Fri** | `weekly_summary` | `30 17 * * 5` | Email weekly performance report |
| **18:00** | `research_pipeline` | `0 18 * * 1-5` | Discover stocks, scrape news, deep-research stale symbols |
| **19:00 Wed** | `mid_week_analysis` | `0 19 * * 3` | Pattern analysis (confidence calibration, sector, timing) |
| **19:00 Fri** | `end_of_week_analysis` | `0 19 * * 5` | Full-week pattern analysis |
| **20:00 Sun** | `self_improvement` | `0 20 * * 0` | Performance eval, auto-pause if bad, propose code changes via PR |

### Daily Timeline Visualization

```
05:00 UTC  IB Gateway cold restart
           │
07:30      PRE-MARKET ─── Day plan generated (Sonnet)
           │              Positions reconciled
08:00      ┌─ MARKET OPEN ──────────────────────────────────┐
08:00      │  orchestrator_tick (every 20 min)               │
08:20      │  orchestrator_tick                              │
08:40      │  orchestrator_tick                              │
  ...      │  ... (roughly 25 ticks total) ...               │
16:00      │  orchestrator_tick (last)                       │
16:25      │  WIND-DOWN — no new orders                     │
16:30      └─ MARKET CLOSE ─────────────────────────────────┘
16:35      POST-MARKET ─── Reconcile, snapshot
17:00      DAILY SUMMARY ─── Email sent
17:15      TRADE REVIEW ─── Each trade analyzed for lessons
17:30 Fri  WEEKLY SUMMARY ─── Email sent
18:00      RESEARCH PIPELINE ─── Discover + analyze stocks
19:00 W/F  PATTERN ANALYSIS ─── Confidence/sector/timing insights
20:00 Sun  SELF-IMPROVEMENT ─── Performance eval + code PRs
```

### Job Execution Safeguards

- **Single-job concurrency lock:** Only one job runs at a time. If a previous job is still running, the next is skipped.
- **IBKR dependency:** 6 jobs require broker connection (`orchestrator_tick`, `mini_analysis`, `pre_market`, `post_market`, `daily_summary`). They skip silently if disconnected.
- **No cascading failures:** Each job catches its own errors, logs to DB, releases lock.

---

## 4. The Orchestrator Tick

**File:** `src/agent/orchestrator.ts`

The orchestrator is a **state machine** that detects the current market phase and dispatches the appropriate handler.

```
Market Phase Detection (src/utils/clock.ts):
  07:30–08:00  →  pre_market
  08:00–16:25  →  active_trading
  16:25–16:30  →  wind_down
  16:30–17:00  →  post_market
  18:00–22:00  →  research
  Otherwise    →  idle

State: idle | pre_market | active_trading | wind_down | post_market | research | paused
```

### Phase Handlers

**`onPreMarket()`** — Runs once at 07:30
1. `getAccountSummary()` from IBKR
2. `reconcilePositions()` — sync DB positions with IBKR
3. Load top 20 watchlist items (by score)
4. `buildLearningBrief()` — compile last 5 weekly insights + 5 trade review lessons
5. Call `runTradingAnalyst(DAY_PLAN_PROMPT)` — Sonnet generates a day plan
6. Log plan to `agent_logs`

**`onActiveTradingTick()`** — Runs every 20 min during market hours
→ See [Section 5: Three-Tier Decision Architecture](#5-three-tier-decision-architecture)

**`onWindDown()`** — 16:25–16:30
- Logs "wind-down" message
- No new orders allowed (enforced at agent level)

**`onPostMarket()`** — 16:30–17:00
1. `reconcilePositions()` — final position sync
2. `recordDailySnapshot()`:
   - Get account value
   - Calculate daily P&L vs yesterday's snapshot
   - Count today's trades (wins/losses)
   - Store to `daily_snapshots` table

---

## 5. Three-Tier Decision Architecture

**Purpose:** Cut Claude API costs ~95% by filtering out routine ticks before invoking expensive models.

```
Every 20 min during market hours:

┌──────────────────────────────────────────────────────┐
│ TIER 1: Code Pre-Filter (FREE)                       │
│                                                      │
│  Check: Open positions? → reason                     │
│  Check: Pending orders? → reason                     │
│  Check: Quotes for top 10 watchlist                  │
│  Check: >2% price move? → reason                     │
│  Check: Actionable research (24h)?                   │
│         BUY signals always; SELL only if held         │
│                                                      │
│  Result: reasons[] array                             │
│  If empty → RETURN (skip Tiers 2+3)                  │
└──────────────────────────┬───────────────────────────┘
                           │ reasons exist
                           ▼
┌──────────────────────────────────────────────────────┐
│ TIER 2: Haiku Quick Scan (~$0.02)                    │
│                                                      │
│  Model: claude-haiku-4-5-20251001                    │
│  Max tokens: 256                                     │
│  No tools — JSON response only                       │
│                                                      │
│  Input: reasons, positions, pending orders,          │
│         quotes, recent research                      │
│                                                      │
│  Decision: { escalate: boolean, reason: string }     │
│                                                      │
│  If NOT escalate → log & RETURN                      │
└──────────────────────────┬───────────────────────────┘
                           │ escalate = true
                           ▼
┌──────────────────────────────────────────────────────┐
│ TIER 3: Full Sonnet Agent Loop (~$1.70)              │
│                                                      │
│  Model: claude-sonnet-4-5-20250929                   │
│  Max tokens: 4096                                    │
│  Full tool access (17 tools)                         │
│  Up to 10 agentic iterations                         │
│                                                      │
│  Context: account summary, positions, watchlist,     │
│           research, recent trades, learning brief    │
│                                                      │
│  Can: place orders, cancel orders, research symbols, │
│       check risk, log decisions                      │
│                                                      │
│  Returns: text response + tool call log              │
└──────────────────────────────────────────────────────┘
```

### Cost Model

| Scenario | Daily Cost | Monthly Cost (20 days) |
|----------|-----------|----------------------|
| Without tiering (25 Sonnet calls/day) | ~$42.50 | ~$850 |
| With tiering (typical) | ~$1.78 | ~$36 |
| Tier 1 only (quiet day, no escalation) | ~$0.00 | ~$0 |

---

## 6. AI Agent — Prompts, Tools & Decision Format

### System Prompts

**File:** `src/agent/prompts/trading-analyst.ts`

| Prompt | Used By | Model | Purpose |
|--------|---------|-------|---------|
| `TRADING_ANALYST_SYSTEM` | Active trading + day plan | Sonnet | Full trading analyst persona |
| `QUICK_SCAN_SYSTEM` | Tier 2 quick scan | Haiku | Escalation filter |
| `DAY_PLAN_PROMPT` | Pre-market | Sonnet | Generate daily trading plan |
| `MINI_ANALYSIS_PROMPT` | Active trading Tier 3 | Sonnet | Analyze and potentially act |
| `RISK_REVIEWER_SYSTEM` | Risk review (unused?) | — | Risk assessment |
| `SELF_IMPROVEMENT_SYSTEM` | Sunday self-improvement | Sonnet | Propose code changes |
| `TRADE_REVIEW_PROMPT` | Daily trade review | Haiku | Analyze completed trades |
| `PATTERN_ANALYSIS_PROMPT` | Mid/end-week analysis | Haiku | Identify patterns |

### Key Prompt Rules (TRADING_ANALYST_SYSTEM)

- ISA constraints: long-only, cash-only, GBP/LSE only
- Trading philosophy: 5–10% profit targets, 3% stop losses
- **Always call `get_recent_research` before trading**
- Research older than 24h → must call `research_symbol` for fresh data
- Confidence ≥ 0.7 required to act
- Risk/reward ratio ≥ 2:1
- 5-step evaluation: Research → Fundamentals → Technical → Risk → Decision

### Agent Tools (17 total)

**File:** `src/agent/tools.ts`

| Category | Tool | Description |
|----------|------|-------------|
| **Market Data** | `get_quote` | Single stock quote (bid/ask/last/volume/high/low/close) |
| | `get_multiple_quotes` | Batch parallel quotes |
| | `get_historical_bars` | Daily OHLCV bars (default 1 month) |
| **Account** | `get_account_summary` | Net liquidation, cash, buying power |
| | `get_positions` | Open positions with qty, avgCost |
| | `get_watchlist` | Active watchlist sorted by score |
| **Research** | `get_recent_research` | Last 5 research records for a symbol |
| | `research_symbol` | Run full fresh research pipeline for a symbol |
| **Trade History** | `get_recent_trades` | Last N trades (default 20) |
| **Risk** | `check_risk` | Pre-trade risk validation (10-step pipeline) |
| | `get_max_position_size` | Calculate max allowed quantity for a price |
| **Execution** | `place_trade` | Submit order (LIMIT/MARKET, BUY/SELL) |
| | `cancel_order` | Cancel pending order by trade ID |
| **Discovery** | `search_contracts` | Find LSE-listed contracts by pattern |
| **Audit** | `log_decision` | Write to agent_logs audit trail |

### Agent Loop Mechanics

**File:** `src/agent/planner.ts` — `runAgent()`

```
1. Build messages array: [system prompt (cached)] + [user message with context]
2. Call Claude API with tools
3. If stop_reason === "tool_use":
   a. For each tool call in response:
      - Execute via executeTool()
      - Log tool call + result to agent_logs (level: ACTION)
      - Collect result
   b. Append assistant message + tool_result messages
   c. Call Claude again (loop)
4. If stop_reason !== "tool_use" (i.e., "end_turn"):
   - Extract final text
   - Log decision to agent_logs (level: DECISION)
   - Return { text, toolCalls[], tokensUsed }
5. Max 10 iterations (hard cap)
```

### Decision Format

The agent's final text response contains:
- **Action:** BUY / SELL / HOLD / WATCH
- **Symbol** (if acting)
- **Confidence:** 0.0–1.0
- **Reasoning:** Why this action
- **Risk:** What could go wrong

Actual trades happen via `place_trade` tool calls during the loop, not from parsing the final text.

---

## 7. Trade Execution Pipeline

```
Agent calls place_trade tool
        │
        ▼
┌─────────────────────────────────────────────┐
│ 1. CREATE TRADE RECORD                       │
│    Insert into trades table: PENDING          │
│    Fields: symbol, side, qty, orderType,      │
│            limitPrice, reasoning, confidence   │
└──────────────────────┬──────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────┐
│ 2. BUILD IBKR CONTRACT                       │
│    lseStock(symbol) → {STK, LSE, GBP}       │
└──────────────────────┬──────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────┐
│ 3. BUILD IBKR ORDER                          │
│    Action: BUY/SELL                          │
│    Type: LMT/MKT                             │
│    TIF: DAY (hardcoded — dies at close)      │
│    Transmit: true (immediate)                │
└──────────────────────┬──────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────┐
│ 4. SUBMIT TO IBKR                            │
│    api.placeNewOrder(contract, order)         │
│    Returns: ibOrderId (number)               │
│    Update trade: status → SUBMITTED          │
└──────────────────────┬──────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────┐
│ 5. MONITOR ORDER (async subscription)        │
│    Subscribe to api.getOpenOrders()          │
│    Watch for status changes:                 │
│      Submitted → SUBMITTED                   │
│      PreSubmitted → SUBMITTED                │
│      Filled → FILLED (capture commission)    │
│      Cancelled → CANCELLED                   │
│      Inactive → ERROR                        │
│    Auto-unsubscribe: 1 hour or terminal      │
└─────────────────────────────────────────────┘
```

### Trade Status Flow

```
PENDING → SUBMITTED → FILLED
                   → PARTIALLY_FILLED
                   → CANCELLED
                   → ERROR
```

### Order Types

- **LIMIT** — Agent specifies `limitPrice`. Most common.
- **MARKET** — Immediate execution at best available.
- **Time-in-Force:** Always "DAY" (order expires at market close).

---

## 8. Risk Management Pipeline

**Files:** `src/risk/manager.ts`, `src/risk/limits.ts`, `src/risk/exclusions.ts`

### Pre-Trade Risk Check (`check_risk` tool)

Called by the agent **before** every `place_trade`. Returns `{ approved: boolean, reasons: string[] }`.

```
TradeProposal { symbol, side, quantity, estimatedPrice, sector? }
        │
        ▼
┌─ CHECK 1: SELL? ─────────────────────────────────────────────┐
│  SELL orders always approved (risk-reducing)                  │
└──────────────────────────────────────────────────────────────┘
        │ BUY
        ▼
┌─ CHECK 2: EXCLUSIONS ────────────────────────────────────────┐
│  Symbol excluded? (tobacco, weapons, gambling, etc.)         │
│  Sector excluded?                                            │
│  Source: exclusions table (cached in memory)                 │
└──────────────────────────────────────────────────────────────┘
        │
        ▼
┌─ CHECK 3: PRICE ─────────────────────────────────────────────┐
│  Price ≥ £0.10? (penny stock protection)                     │
└──────────────────────────────────────────────────────────────┘
        │
        ▼
┌─ CHECK 4: POSITION SIZING ───────────────────────────────────┐
│  Trade value ≤ 5% of portfolio?                              │
│  Trade value ≤ £50,000?                                      │
└──────────────────────────────────────────────────────────────┘
        │
        ▼
┌─ CHECK 5: CASH RESERVE ─────────────────────────────────────┐
│  (cash - trade value) / net liq ≥ 20%?                      │
└──────────────────────────────────────────────────────────────┘
        │
        ▼
┌─ CHECK 6: POSITION COUNT ───────────────────────────────────┐
│  Current positions < 10? (or adding to existing)            │
└──────────────────────────────────────────────────────────────┘
        │
        ▼
┌─ CHECK 7: DAILY TRADE FREQUENCY ────────────────────────────┐
│  Today's BUY trades < 10?                                   │
└──────────────────────────────────────────────────────────────┘
        │
        ▼
┌─ CHECK 8: TRADE INTERVAL ───────────────────────────────────┐
│  Last trade > 15 minutes ago?                               │
└──────────────────────────────────────────────────────────────┘
        │
        ▼
┌─ CHECK 9: DAILY LOSS LIMIT ─────────────────────────────────┐
│  Daily P&L > -2%? (circuit breaker)                         │
│  Blocks ALL trades if breached                              │
└──────────────────────────────────────────────────────────────┘
        │
        ▼
┌─ CHECK 10: WEEKLY LOSS LIMIT ───────────────────────────────┐
│  Weekly P&L > -5%? (ultimate circuit breaker)               │
│  Blocks ALL trades if breached                              │
└──────────────────────────────────────────────────────────────┘
        │
        ▼
  { approved: true/false, reasons: [...all failures...] }
```

### Hard Limits (Cannot Be Overridden by Agent)

| Limit | Value | Purpose |
|-------|-------|---------|
| ISA cash only | true | No margin, no shorting |
| Max position % | 5% | Single-stock concentration |
| Max position £ | £50,000 | Hard GBP cap |
| Cash reserve | 20% | Always keep cash buffer |
| Stop loss | 3% | Per-trade loss limit |
| Daily loss | 2% | Daily circuit breaker |
| Weekly loss | 5% | Weekly circuit breaker |
| Max positions | 10 | Portfolio diversification |
| Max trades/day | 10 | Frequency cap |
| Trade interval | 15 min | Cooldown between trades |
| Max sector | 30% | Sector concentration |
| Min price | £0.10 | No penny stocks |
| Min volume | 50,000 | Liquidity requirement |
| Pause threshold | <40% win rate for 2 weeks | Auto-pause |

---

## 9. Research Pipeline

**File:** `src/research/pipeline.ts`

**When:** Daily at 18:00 (after market close)

### Stage 1: Universe Screening (FMP)

```
Sector Rotation Schedule:
  Monday:    Technology (>£100M market cap)
  Tuesday:   Healthcare (>£100M market cap)
  Wednesday: Small-caps all sectors (£50M–£2B)
  Thursday:  Financial Services (>£100M market cap)
  Friday:    Consumer Cyclical (>£100M market cap)

→ Up to 5 new candidates added to watchlist per session
→ Exclusion check before adding
```

### Stage 2: News Discovery

```
8 RSS feeds:
  BBC Business, Financial Times, Yahoo Finance UK,
  Yahoo Finance FTSE, Proactive Investors UK,
  MarketWatch, CNBC World, Investing.com UK

→ Match articles to watchlist symbols (name/ticker matching)
→ Unmatched articles → Claude (Haiku) extracts LSE tickers
→ Verify via FMP profile → add to watchlist (max 3/run)
```

### Stage 3: Deep Research (up to 10 symbols)

```
For each stale symbol (not researched in 24h):

  1. Yahoo Finance quote + fundamentals
  2. IBKR historical bars (1 month, if connected)
  3. News items for symbol
         │
         ▼
  Claude (Haiku) Analysis
         │
         ▼
  Output:
    - sentiment: -1.0 to 1.0
    - action: BUY / SELL / HOLD / WATCH
    - confidence: 0–1
    - bullCase, bearCase, analysis
         │
         ▼
  Store to research table
  Update watchlist score
```

### Watchlist Scoring Algorithm

```
score = sentimentScore + confidenceScore + actionBonus

  sentimentScore  = (sentiment + 1) / 2 × 100 × 0.30   (30% weight)
  confidenceScore = confidence × 100 × 0.20              (20% weight)
  actionBonus     = BUY → +20, WATCH → +5, HOLD/SELL → 0

  Clamped to [0, 100]
```

### Data Sources Summary

| Source | What | Rate Limit | Fallback |
|--------|------|-----------|----------|
| IBKR | Real-time quotes, bars, account, orders | 40 req/sec | FMP |
| Yahoo Finance | Quotes, fundamentals | None explicit | Graceful null |
| FMP | Screener, profiles, quotes | 5 req/min (free tier) | Skip |
| RSS (8 feeds) | News articles | 15 feeds/min | Skip |

---

## 10. Learning & Self-Improvement Loop

### Layer 1: Trade Reviews (Daily, 17:15)

**File:** `src/learning/trade-reviewer.ts`

```
For each FILLED trade today (not yet reviewed):

  Gather context:
    - 3 most recent research records for symbol
    - Agent decisions within ±30 min of trade
    - Trade details (side, price, P&L)

  Claude (Haiku) Review → trade_reviews table:
    - outcome: win / loss / breakeven
    - reasoningQuality: sound / partial / flawed
    - lessonLearned: 1-sentence takeaway
    - tags: 1–4 descriptors (e.g., "momentum-entry", "stop-loss-hit")
    - shouldRepeat: boolean
```

### Layer 2: Pattern Analysis (Wed 19:00 + Fri 19:00)

**File:** `src/learning/pattern-analyzer.ts`

```
Input (7-day window):
  - Trade reviews with outcomes
  - Confidence calibration: win rate by bucket (0.7–0.8, 0.8–0.9, 0.9–1.0)
  - Sector breakdown: win rate + avg P&L by sector
  - Tag frequency: which tags appear in wins vs losses
  - Daily snapshots: portfolio trajectory

Claude (Haiku) → weekly_insights table (up to 5 insights):
  - category: confidence_calibration | sector_performance | timing | risk_management | general
  - insight: observation (max 200 chars)
  - actionable: guidance (max 200 chars)
  - severity: info | warning | critical
  - data: JSON supporting metrics
```

### Layer 3: Learning Brief (Pre-Market, 07:30)

```
buildLearningBrief():
  - Last 5 weekly insights
  - Last 5 trade review lessons
  - Critical/warning items flagged

→ Injected into DAY_PLAN_PROMPT
→ Agent sees warnings before market open
```

### Layer 4: Self-Improvement (Sunday 20:00)

**File:** `src/self-improve/monitor.ts`

```
1. Performance Pause Check:
   if win rate < 40% for 2+ consecutive weeks:
     → setPaused(true)
     → Send alert email
     → Require manual restart

2. Gather: 2 weeks trades, reviews, insights, metrics (7d + 90d)

3. Claude (Sonnet) Self-Improvement:
   - Analyze performance data
   - Propose 1–2 code changes (max 2/week)

4. Whitelist of modifiable files ONLY:
   ✅ src/agent/prompts/*.ts (system prompts, frameworks)
   ✅ src/research/watchlist.ts (scoring weights)
   ✅ Risk config table values
   ❌ Core trading logic
   ❌ Broker code
   ❌ Database schema
   ❌ Risk manager hard limits
   ❌ Order execution code

5. For each proposal:
   → generateCodeChange() via Claude
   → Create GitHub PR automatically
   → Store to improvement_proposals table
```

### Learning Loop Diagram

```
              ┌──────────────┐
              │   TRADING    │
              │  (executes   │
              │   trades)    │
              └──────┬───────┘
                     │ fills
                     ▼
              ┌──────────────┐
              │ TRADE REVIEW │ ← 17:15 daily
              │ (lesson per  │
              │  trade)      │
              └──────┬───────┘
                     │ reviews
                     ▼
              ┌──────────────┐
              │   PATTERN    │ ← Wed/Fri 19:00
              │  ANALYSIS    │
              │ (insights)   │
              └──────┬───────┘
                     │ insights
                     ▼
              ┌──────────────┐
              │   LEARNING   │ ← 07:30 daily
              │    BRIEF     │
              │ (fed to agent│
              │  at pre-mkt) │
              └──────┬───────┘
                     │ brief
                     ▼
              ┌──────────────┐
              │   DAY PLAN   │ ← 07:30 daily
              │ (adjusted    │
              │  strategy)   │
              └──────┬───────┘
                     │ influences
                     ▼
              ┌──────────────┐
              │   TRADING    │ ← loop repeats
              └──────────────┘

Sunday branch:
  Self-Improvement
    → Analyzes all of the above
    → Proposes prompt/scoring changes
    → Creates PRs on GitHub
```

---

## 11. Reporting & Notifications

### Email Reports

**File:** `src/reporting/`

| Report | When | Content |
|--------|------|---------|
| **Daily Summary** | 17:00 weekdays | Portfolio value, daily P&L, 30-day metrics (win rate, Sharpe, drawdown), today's trades, open positions, API costs |
| **Weekly Summary** | 17:30 Friday | Weekly P&L, daily breakdown table, all-time stats, sector breakdown |

**Email subject format:** `+£X.XX | Daily Trading Summary 2026-02-16` (color-coded positive/negative)

### Alert Emails

| Trigger | Content | Cooldown |
|---------|---------|----------|
| IBKR disconnect | "IBKR disconnected" + auto-reconnect note | 30 min |
| Unhandled rejection storm (≥10 in 60s) | Critical crash alert | None |
| Uncaught exception | Critical crash alert | None |
| Auto-pause (win rate < 40%) | Performance warning | None |

### Metrics Calculated

| Metric | Source |
|--------|--------|
| Win rate | trades (FILLED with P&L) |
| Avg win / avg loss | trades (FILLED) |
| Profit factor | avg win / avg loss |
| Sharpe ratio | (avg daily return / std dev) × √252 |
| Max drawdown | Peak-to-trough from daily_snapshots |
| Total P&L | Portfolio value - initial |
| Daily/Weekly P&L | Snapshot comparisons |
| API costs | token_usage table |

---

## 12. Data Model

### All Tables

| Table | Purpose | Key Fields | Records Created By |
|-------|---------|------------|-------------------|
| `trades` | Order execution log | symbol, side, qty, status, ibOrderId, pnl, reasoning, confidence | `place_trade` tool |
| `positions` | Open holdings | symbol, qty, avgCost, currentPrice, unrealizedPnl, stopLoss, target | Reconciliation |
| `research` | Stock analysis | symbol, sentiment, action, confidence, bullCase, bearCase | Research pipeline |
| `watchlist` | Stock universe | symbol, name, sector, score, active | Discovery + pipeline |
| `dailySnapshots` | EOD portfolio | date, portfolioValue, dailyPnl, tradesCount, wins, losses | Post-market |
| `agentLogs` | Audit trail | level, phase, message, data (JSON) | All jobs + agent |
| `tradeReviews` | Trade lessons | tradeId, outcome, reasoningQuality, lessonLearned, tags | Trade review job |
| `weeklyInsights` | Pattern discoveries | category, insight, actionable, severity, data | Pattern analysis |
| `tokenUsage` | API cost tracking | job, inputTokens, outputTokens, estimatedCostUsd | Every Claude call |
| `improvementProposals` | Self-improvement PRs | title, description, filesChanged, prUrl, status | Self-improvement |
| `riskConfig` | Configurable risk params | key, value, description | Seed (editable) |
| `exclusions` | Blocked symbols/sectors | type, value, reason | Seed + manual |

---

## 13. External Dependencies & Failure Modes

| Dependency | Used For | Failure Mode | Recovery |
|------------|----------|-------------|----------|
| **IBKR Gateway** | Quotes, orders, account | Cold restart at 05:00 UTC; random disconnects | Auto-reconnect (5s), alert email (30min cooldown) |
| **Claude API** | All AI decisions | Rate limit / outage | Logged error, job skipped, no cascading |
| **Yahoo Finance** | Fundamentals, quotes | API changes / rate limits | Returns null, research continues without |
| **FMP** | Stock screening, fallback quotes | 5 req/min limit / key invalid | Graceful skip, discovery halted |
| **RSS Feeds** | News articles | Feed down / format change | Individual feed failure OK, others continue |
| **Resend** | Email notifications | API error | Logged, non-critical |
| **GitHub API** | Self-improvement PRs | Token invalid | PR creation fails, proposal still logged |
| **SQLite** | All persistence | Corruption / disk full | Critical — app cannot function |

### IBKR-Specific Edge Cases

- **IB Gateway restarts at 05:00 UTC** — Connection lost, auto-reconnect kicks in before 07:30 pre-market
- **Market data gaps** — Quote timeout (10s) → FMP fallback → null if both fail
- **Order monitoring** — 1-hour auto-unsubscribe prevents subscription leaks
- **Commission filtering** — Values > 1e9 ignored (IBKR sentinel values)

---

## 14. Identified Gaps & Potential Failure Points

### A. Decision Quality

| # | Gap | Impact | Severity |
|---|-----|--------|----------|
| A1 | **Agent decisions are not parsed programmatically** — the final text response is logged but BUY/SELL/HOLD actions happen only through tool calls during the loop. If the agent decides to act but doesn't call `place_trade` (e.g., "I would buy X but let me wait"), there's no mechanism to track unfulfilled intentions. | Missed opportunities go undetected | Medium |
| A2 | **Confidence threshold (0.7) is prompt-enforced only** — the risk system doesn't verify confidence. The agent self-reports confidence when calling `place_trade`. Nothing prevents it from inflating confidence to bypass the soft threshold. | Agent could override its own guardrail | Low-Medium |
| A3 | **Day plan is generated but never referenced again** — the plan is logged to `agent_logs` at 07:30, but subsequent orchestrator ticks don't retrieve or reference it. The active trading context doesn't include "today's plan." | Plan is wasted effort; agent doesn't track its own intentions | Medium |
| A4 | **No stop-loss execution mechanism** — stop losses are stored in `positions.stopLossPrice` and logged as alerts, but there is no automated sell when price breaches stop loss. The agent must notice during a tick and decide to sell. With 20-minute tick intervals, a fast drop could blow through a stop. | Losses can exceed 3% target before agent reacts | High |
| A5 | **Wind-down is advisory only** — the system logs "wind-down" but `place_trade` doesn't reject orders during 16:25–16:30. If the agent calls `place_trade` in wind-down, it would execute. | ISA day-order timing risk | Low |

### B. Three-Tier Architecture

| # | Gap | Impact | Severity |
|---|-----|--------|----------|
| B1 | **Tier 1 pre-filter SELL signals require position match** — correct for ISA (long-only), but if position reconciliation is stale (IBKR disconnect), the pre-filter could miss SELL signals for positions it doesn't know about. | May not exit positions when research says SELL | Medium |
| B2 | **Tier 1 always escalates during market hours** — the code runs Haiku scan for every tick (removed pre-filter gate per commit `086807e`). This means ~25 Haiku calls/day at $0.02 = $0.50/day, which is fine cost-wise, but the Tier 1 pre-filter reasons are still built and logged. The "escalation reasons" are informational only now. | Pre-filter is vestigial — cost savings depend entirely on Haiku's judgment | Low |
| B3 | **20-minute tick interval** — market-moving events (earnings, news, crashes) could happen between ticks. No real-time event-driven triggers exist. The agent only sees the world every 20 minutes. | Slow reaction to sudden market events | Medium |
| B4 | **Haiku quick scan has no tools** — it can only assess what's in the context string. If context is incomplete (e.g., quotes failed), Haiku decides on partial data. | Incorrect escalation/non-escalation decisions | Low-Medium |

### C. Trade Execution

| # | Gap | Impact | Severity |
|---|-----|--------|----------|
| C1 | **No fill confirmation feedback to agent** — the agent calls `place_trade` and gets back `{tradeId, ibOrderId, status: SUBMITTED}`. It doesn't wait for or receive fill confirmation. The order monitor runs asynchronously. If the order doesn't fill (LIMIT too far from market), the agent isn't aware until next tick. | Agent may think it acted but the order sits unfilled | Medium |
| C2 | **DAY orders expire silently** — TIF is hardcoded to "DAY". Unfilled limit orders die at market close. The system tracks this via order monitoring, but there's no next-day follow-up to re-evaluate. | Intended positions never opened; no retry logic | Medium |
| C3 | **No partial fill handling** — `PARTIALLY_FILLED` status is mapped but there's no specific logic for managing partial fills (e.g., cancel remainder, adjust position). | Partial positions may not match intended sizing | Low |
| C4 | **Order monitoring subscription leaks** — while there's a 1-hour auto-unsubscribe, if many orders are placed, subscriptions accumulate. No cleanup on shutdown for in-flight subscriptions beyond IBKR disconnect. | Resource leak during high-activity days | Low |

### D. Risk Management

| # | Gap | Impact | Severity |
|---|-----|--------|----------|
| D1 | **Risk check happens at agent's discretion** — the `check_risk` tool is available but the prompt says "always check risk before trading." If the agent skips it and calls `place_trade` directly, the trade executes without risk checks. There's no enforced gate in `place_trade` that requires a prior `check_risk` call. | Agent could bypass risk system entirely | High |
| D2 | **Daily/weekly loss limits use snapshots** — if `recordDailySnapshot()` fails (e.g., IBKR disconnected at post-market), the baseline for loss calculations is stale. The circuit breaker might not trigger when it should. | Loss limits could be ineffective after snapshot gaps | Medium |
| D3 | **Sector exposure check missing from risk pipeline** — `MAX_SECTOR_EXPOSURE_PCT` (30%) is defined in hard limits but the 10-step risk pipeline doesn't include a sector concentration check. The limit exists but isn't enforced. | Could over-concentrate in one sector | Medium |
| D4 | **Volume check missing from risk pipeline** — `MIN_AVG_VOLUME` (50,000) is defined but not checked in the risk pipeline. Low-liquidity stocks could be traded. | Liquidity risk on entry/exit | Medium |

### E. Research Pipeline

| # | Gap | Impact | Severity |
|---|-----|--------|----------|
| E1 | **FMP free tier (5 req/min)** — severely limits discovery. Only ~5 new stocks per session. If FMP key expires or is invalid, discovery stops entirely with a silent skip. | Universe growth is very slow; may miss opportunities | Medium |
| E2 | **News matching is hard-coded** — `SYMBOL_NAMES` dict maps tickers to company names for news matching. Any stock not in this dict won't match news articles. New watchlist additions don't automatically get name mappings. | News signals missed for newer watchlist entries | Medium |
| E3 | **Research staleness threshold is fixed at 24h** — all symbols go stale at the same rate. A volatile stock and a stable blue-chip are researched with equal priority. No urgency weighting. | Research effort not optimized for where it matters most | Low |
| E4 | **Research quality depends on Yahoo Finance data** — if Yahoo returns null for fundamentals (happens for some LSE stocks), the Claude analysis works with incomplete data. No warning flag is set on the research record. | Agent trades on incomplete research without knowing | Medium |
| E5 | **Max 10 symbols researched per day** — with a growing watchlist (hundreds of symbols), most go stale and are never re-researched. Score decay over time is not implemented. | Watchlist bloat; old scores mislead the agent | Medium |

### F. Learning & Self-Improvement

| # | Gap | Impact | Severity |
|---|-----|--------|----------|
| F1 | **Trade reviews only happen for FILLED trades** — if an order was CANCELLED or expired (DAY order unfilled), no review happens. Missed trades could contain important lessons (e.g., limit price too aggressive). | Learning blind spot for non-executed trades | Medium |
| F2 | **Pattern analysis requires 3+ trade reviews** — in quiet weeks with few trades, no pattern analysis runs. The learning loop stalls. | Learning momentum lost during low-activity periods | Low |
| F3 | **Self-improvement PRs are never auto-merged** — they require manual review. If ignored, improvements accumulate but are never applied. No tracking of PR merge status. | Learning loop is broken at the "apply changes" step | Medium |
| F4 | **Learning brief is fixed-size (5+5)** — only last 5 insights and 5 reviews. In active periods, important older lessons roll off. No importance weighting. | Critical lessons may be forgotten | Low |
| F5 | **Auto-pause threshold (40% win rate, 2 weeks)** — requires consistent trading. If the agent rarely trades (low escalation), the sample size is tiny and win rate is noisy. Could pause on 2/5 trades being losses. | False positive pause on small sample | Low-Medium |

### G. Operational

| # | Gap | Impact | Severity |
|---|-----|--------|----------|
| G1 | **Single-job concurrency lock** — if the research pipeline runs long (10 symbols × API calls), it blocks the self-improvement job or any manually triggered job. No priority system. | Important jobs delayed by long-running ones | Low |
| G2 | **No heartbeat monitoring** — the admin server has `/health` but nothing external checks it. If the process crashes between IB Gateway restart (05:00) and pre-market (07:30), nobody knows until daily summary email is missing. | Silent outage during overnight window | Medium |
| G3 | **Position reconciliation is periodic, not event-driven** — positions sync at pre-market and post-market. During the trading day, positions come from the DB (potentially stale if manual IBKR trading occurs). | Stale position data during trading hours | Low |
| G4 | **Token usage tracking doesn't capture cache savings** — `estimatedCostUsd` calculates based on input/output tokens but prompt caching reduces actual costs. Reported costs are higher than reality. | Misleading cost data in reports | Low |
| G5 | **No backfill for missed jobs** — if the system is down during market hours and comes back at 15:00, it doesn't retroactively run missed ticks or the pre-market plan. It just picks up from wherever the clock says. | Missed opportunities on restart days | Medium |

### H. Architecture

| # | Gap | Impact | Severity |
|---|-----|--------|----------|
| H1 | **No position-level P&L tracking in real-time** — `unrealizedPnl` in positions table is updated during reconciliation (pre/post-market). During trading hours, the agent must call `get_positions` + `get_quote` to estimate current P&L. This is not pre-computed. | Agent makes decisions without real-time P&L context unless it asks | Medium |
| H2 | **No portfolio-level optimization** — each trade is evaluated independently. There's no rebalancing logic, correlation analysis, or portfolio-level risk optimization. The agent thinks stock-by-stock. | Portfolio could drift into suboptimal allocations | Medium |
| H3 | **Agent context window is per-tick** — each orchestrator tick starts a fresh Claude conversation. There's no memory of what the agent said/decided 20 minutes ago beyond what's in the DB context. The "recent context" is limited to last 3 trades + warnings. | Agent can't maintain complex multi-tick strategies | Medium |

---

### Severity Summary

| Severity | Count | Key Items |
|----------|-------|-----------|
| **High** | 2 | A4 (no stop-loss execution), D1 (risk check not enforced) |
| **Medium** | 16 | A1, A3, B1, B3, C1, C2, D2, D3, D4, E1, E2, E4, E5, F1, F3, G2, G5, H1, H2, H3 |
| **Low-Medium** | 4 | A2, B4, F5 |
| **Low** | 7 | A5, B2, C3, C4, E3, F2, F4, G1, G3, G4 |

### Top Priority Items

1. **D1 — Risk check not enforced before trade execution.** The `place_trade` tool should internally call `checkTradeRisk()` and reject if not approved, rather than trusting the agent to call `check_risk` first.

2. **A4 — No automated stop-loss execution.** Stop losses exist in the database but nothing sells when price breaches them. Consider IBKR bracket orders (attached stop-loss), or a dedicated stop-loss monitor running more frequently than 20 minutes.

3. **D3/D4 — Sector exposure and volume checks defined but not enforced.** The limits exist in `HARD_LIMITS` but the risk pipeline doesn't check them. Wire them into `checkTradeRisk()`.

4. **A3 — Day plan is orphaned.** Generate it, but also feed it back into active trading context so the agent follows its own plan.

5. **F3 — Self-improvement PRs never applied.** The learning loop proposes changes but they accumulate in GitHub. Consider auto-merge for prompt-only changes with a rollback mechanism, or at minimum track and alert on unmerged PRs.
