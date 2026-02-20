# Agentic Process Flow Audit

> Updated 2026-02-20 (Phase 1 gap closure deployed, tick frequency corrected to 10-min). Complete audit of every automated process, decision path, and data flow in the Trader Agent platform.

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
14. [Remaining Gaps & Future Work](#14-remaining-gaps--future-work)

---

## 1. System Overview

```
┌──────────────────────────────────────────────────────────────────────┐
│                         TRADER AGENT                                  │
│                                                                      │
│  ┌───────────┐  ┌──────────────┐  ┌───────────┐  ┌──────────┐       │
│  │ Scheduler │→ │ Orchestrator │→ │ AI Agent  │→ │  Broker  │       │
│  │ (12 cron) │  │(state machine)│ │ (Claude)  │  │  (IBKR)  │       │
│  └───────────┘  └──────────────┘  └───────────┘  └──────────┘       │
│        ↕              ↕                ↕               ↕             │
│  ┌──────────────────────────────────────────────────────────────┐    │
│  │ ★ Position Guardian (60s interval)                           │    │
│  │   Stop-losses │ Price updates │ Alerts │ Post-market cleanup │    │
│  └──────────────────────────────────────────────────────────────┘    │
│        ↕              ↕                ↕               ↕             │
│  ┌──────────────────────────────────────────────────────────────┐    │
│  │                    SQLite Database                            │    │
│  │  trades | positions | research | watchlist | agent_logs      │    │
│  │  daily_snapshots | trade_reviews | weekly_insights | ...     │    │
│  └──────────────────────────────────────────────────────────────┘    │
│        ↕              ↕                ↕                             │
│  ┌──────────┐  ┌──────────────┐  ┌───────────┐                      │
│  │  Email   │  │   Research   │  │  Learning  │                      │
│  │ (Resend) │  │ (Yahoo/FMP)  │  │  (Reviews) │                      │
│  └──────────┘  └──────────────┘  └───────────┘                      │
└──────────────────────────────────────────────────────────────────────┘
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
  6. Start scheduler (12 cron tasks registered)
  7. Start Position Guardian (60s interval loop)
  8. Start admin HTTP server (127.0.0.1:3847)
  9. Run catch-up tick if restarting mid-session (>2h since last activity during market hours)
  10. Ready — waiting for cron ticks, guardian loop, or HTTP triggers

Graceful Shutdown (SIGINT/SIGTERM):
  1. Stop admin server
  2. Stop Position Guardian (clears interval)
  3. Stop all cron tasks
  4. Disconnect IBKR
  5. Close SQLite
  6. process.exit(0)

Crash Protection:
  - Unhandled rejection storm: ≥10 in 60s → critical alert email + exit
  - Uncaught exceptions → alert email + exit
```

---

## 3. Schedule — Every Job

All times **Europe/London**. Weekdays only unless noted.

| Time | Job | Cron Pattern | What It Does |
|------|-----|-------------|--------------|
| **07:00** | `heartbeat` | `0 7 * * 1-5` | Sends alive-confirmation email with hostname and uptime |
| **07:30** | `pre_market` | `30 7 * * 1-5` | Sync account, reconcile positions, generate day plan via Sonnet |
| **08:00–16:50** | `orchestrator_tick` | `*/10 8-16 * * 1-5` | Three-tier analysis: pre-filter → Haiku scan → Sonnet agent |
| **16:35** | `post_market` | `35 16 * * 1-5` | Reconcile positions, record daily snapshot, clear intentions |
| **17:00** | `daily_summary` | `0 17 * * 1-5` | Email daily performance report (includes stale PR alerts) |
| **17:15** | `trade_review` | `15 17 * * 1-5` | Claude reviews each filled, cancelled, and expired trade |
| **17:30 Fri** | `weekly_summary` | `30 17 * * 5` | Email weekly performance report |
| **18:00** | `research_pipeline` | `0 18 * * 1-5` | Score decay, discover stocks, scrape news, deep-research stale symbols |
| **19:00 Wed** | `mid_week_analysis` | `0 19 * * 3` | Pattern analysis (confidence calibration, sector, timing) |
| **19:00 Fri** | `end_of_week_analysis` | `0 19 * * 5` | Full-week pattern analysis |
| **20:00 Sun** | `self_improvement` | `0 20 * * 0` | Performance eval, auto-pause if bad, propose code changes via PR |

### Daily Timeline Visualization

```
05:00 UTC  IB Gateway cold restart
           │
07:00      HEARTBEAT ─── Email: "alive, uptime Xh"
07:30      PRE-MARKET ─── Day plan generated (Sonnet)
           │              Positions reconciled
           │              Day plan stored in memory for later ticks
08:00      ┌─ MARKET OPEN ────────────────────────────────────────┐
08:00      │  orchestrator_tick (every 10 min)                     │
08:20      │  orchestrator_tick                                    │
08:40      │  orchestrator_tick                                    │
  ...      │  ...                                                  │
           │  ★ Guardian running every 60s in parallel:            │
           │    - Stop-loss enforcement (MARKET SELL)              │
           │    - Position price/PnL updates                       │
           │    - Price alert accumulator (>3% moves)              │
           │                                                       │
16:00      │  orchestrator_tick                                    │
16:10      │  orchestrator_tick                                    │
16:20      │  orchestrator_tick (last before wind-down)            │
16:25      │  WIND-DOWN — no new BUY orders (enforced in code)    │
16:30      └─ MARKET CLOSE ───────────────────────────────────────┘
           │  ★ Guardian cleanup: expire unfilled SUBMITTED orders
16:35      POST-MARKET ─── Reconcile, snapshot (retries 3x),
           │                clear intentions + inter-tick memory
17:00      DAILY SUMMARY ─── Email sent (includes stale PR alerts)
17:15      TRADE REVIEW ─── Each trade analyzed for lessons
17:30 Fri  WEEKLY SUMMARY ─── Email sent
18:00      RESEARCH PIPELINE ─── Score decay + discover + analyze
19:00 W/F  PATTERN ANALYSIS ─── Confidence/sector/timing insights
20:00 Sun  SELF-IMPROVEMENT ─── Performance eval + code PRs
```

### Job Execution Safeguards

- **Single-job concurrency lock:** Only one job runs at a time. If a previous job is still running, the next is skipped.
- **IBKR dependency:** Jobs requiring broker connection skip silently if disconnected.
- **No cascading failures:** Each job catches its own errors, logs to DB, releases lock.
- **Catch-up tick:** On restart during market hours, if last agent_logs entry is >2h old, immediately runs `orchestrator_tick`.
- **Cron alignment:** Tick crons aligned to actual LSE market phases — no wasted ticks in closed/post-market windows.

---

## 4. The Orchestrator Tick

**File:** `src/agent/orchestrator.ts`

The orchestrator is a **state machine** that detects the current market phase and dispatches the appropriate handler.

```
Market Phase Detection (src/utils/clock.ts):
  07:30–08:00  →  pre-market
  08:00–16:25  →  open
  16:25–16:30  →  wind-down
  16:30–17:00  →  post-market
  18:00–22:00  →  research
  Otherwise    →  closed

State: idle | pre_market | active_trading | wind_down | post_market | research | paused
```

### Phase Handlers

**`onPreMarket()`** — Runs once at 07:30
1. `getAccountSummary()` from IBKR
2. `reconcilePositions()` — sync DB positions with IBKR
3. Load top 20 watchlist items (by score)
4. `buildLearningBrief()` — compile last 5 weekly insights + 5 trade review lessons (sorted by severity: critical > warning > info)
5. Call `runTradingAnalyst(getDayPlanPrompt())` — Sonnet generates a day plan (mode-aware)
6. **Store day plan in `currentDayPlan` (inter-tick memory)**
7. Log plan to `agent_logs`

**`onActiveTradingTick()`** — Runs every 10 min during market hours
→ See [Section 5: Three-Tier Decision Architecture](#5-three-tier-decision-architecture)

**`onWindDown()`** — 16:25–16:30
- Logs "wind-down" message
- BUY orders are **rejected in code** by `place_trade` Gate 1 (checks market phase)

**`onPostMarket()`** — 16:30–17:00
1. `reconcilePositions()` — final position sync
2. `recordDailySnapshot()` — **retries up to 3 times** (30s backoff between attempts):
   - Get account value
   - Calculate daily P&L vs yesterday's snapshot
   - Count today's trades (wins/losses)
   - Store to `daily_snapshots` table
3. `clearIntentions()` — wipe all pending intentions
4. Clear `currentDayPlan` and `lastAgentResponse` inter-tick memory

### Inter-Tick Memory

The orchestrator maintains three pieces of state across 10-minute ticks:

| Memory | Set By | Used By | Cleared |
|--------|--------|---------|---------|
| `currentDayPlan` | Pre-market (07:30) | Tier 3 Sonnet context | Post-market |
| `lastAgentResponse` | Tier 3 Sonnet agent | Tier 3 Sonnet context (next tick) | Post-market |
| `pendingIntentions[]` | Agent via `log_intention` tool | Tier 1 pre-filter (evaluated against quotes) | Post-market (or when fulfilled) |

---

## 5. Three-Tier Decision Architecture

**Purpose:** Cut Claude API costs ~95% by filtering out routine ticks before invoking expensive models.

```
Every 10 min during market hours:

┌──────────────────────────────────────────────────────────────┐
│ TIER 1: Code Pre-Filter (FREE)                               │
│                                                              │
│  Check: Open positions? → reason                             │
│  Check: Pending orders? → reason                             │
│  Check: Quotes for top 10 watchlist                          │
│  Check: >2% price move? → reason                             │
│  Check: Guardian alerts (>3% moves between ticks) → reason   │
│  Check: Intention triggers (evaluated vs quotes) → reason    │
│  Check: Actionable research (24h)?                           │
│         BUY signals always; SELL only if held                 │
│                                                              │
│  Result: reasons[] array                                     │
│  (All reasons passed to Tier 2 regardless of count)          │
└────────────────────────────┬─────────────────────────────────┘
                             │ always runs
                             ▼
┌──────────────────────────────────────────────────────────────┐
│ TIER 2: Haiku Quick Scan (~$0.02)                            │
│                                                              │
│  Model: claude-haiku-4-5-20251001                            │
│  Max tokens: 256                                             │
│  No tools — JSON response only                               │
│                                                              │
│  Input: reasons, positions, pending orders,                  │
│         quotes, recent research, pending intentions           │
│                                                              │
│  Decision: { escalate: boolean, reason: string }             │
│                                                              │
│  If NOT escalate → log & RETURN                              │
└────────────────────────────┬─────────────────────────────────┘
                             │ escalate = true
                             ▼
┌──────────────────────────────────────────────────────────────┐
│ TIER 3: Full Sonnet Agent Loop (~$1.70)                      │
│                                                              │
│  Model: claude-sonnet-4-5-20250929                           │
│  Max tokens: 4096                                            │
│  Full tool access (19 tools)                                 │
│  Up to 10 agentic iterations                                 │
│                                                              │
│  Context: account summary, positions, watchlist,             │
│           research, recent trades, learning brief,           │
│           ★ today's day plan (first 500 chars),              │
│           ★ last agent response (first 800 chars),           │
│           ★ data completeness (missing quotes flagged),      │
│           ★ portfolio composition (sector % breakdown)       │
│                                                              │
│  Can: place orders, cancel orders, research symbols,         │
│       check risk, log decisions, log intentions              │
│                                                              │
│  Returns: text response + tool call log                      │
│  ★ Response stored as lastAgentResponse for next tick        │
└──────────────────────────────────────────────────────────────┘
```

### Guardian–Orchestrator Integration

The Position Guardian (60s loop) and the Orchestrator (20-min ticks) communicate through an **alert queue**:

```
Guardian (every 60s):
  - Fetches quotes for all positions + top 10 watchlist
  - Detects >3% price moves → pushes to alertQueue[]

Orchestrator (every 10 min):
  - Tier 1 calls drainAlerts() → consumes all queued alerts
  - Alerts become escalation reasons for Haiku
```

This means the orchestrator is aware of significant moves that happened between its 10-minute ticks, even though it only runs periodically.

### Cost Model

| Scenario | Daily Cost | Monthly Cost (20 days) |
|----------|-----------|----------------------|
| Without tiering (~54 Sonnet calls/day) | ~$91.80 | ~$1,836 |
| With tiering (typical) | ~$1.78 | ~$36 |
| Tier 1 only (quiet day, no escalation) | ~$0.50 | ~$10 |

---

## 6. AI Agent — Prompts, Tools & Decision Format

### System Prompts

**Files:** `src/agent/prompts/trading-analyst.ts`, `src/agent/prompts/quick-scan.ts`, `src/agent/prompts/trading-mode.ts`

All trading prompts are **mode-aware** — they read the `PAPER_TRADING` config flag at call time via getter functions and inject paper or live context. The central helper is `getTradingMode()` in `trading-mode.ts`.

| Prompt (getter) | Used By | Model | Purpose |
|--------|---------|-------|---------|
| `getTradingAnalystSystem()` | Active trading + day plan | Sonnet | Full trading analyst persona (mode-aware) |
| `getQuickScanSystem()` | Tier 2 quick scan | Haiku | Escalation filter (mode-aware) |
| `getDayPlanPrompt()` | Pre-market | Sonnet | Generate daily trading plan (mode-aware) |
| `getMiniAnalysisPrompt()` | Active trading Tier 3 | Sonnet | Analyze and potentially act (mode-aware) |
| `getAnalysisSystem()` | Research pipeline | Haiku | Stock analysis (mode-aware) |
| `RISK_REVIEWER_SYSTEM` | Risk review | — | Risk assessment |
| `SELF_IMPROVEMENT_SYSTEM` | Sunday self-improvement | Sonnet | Propose code changes |
| `TRADE_REVIEWER_SYSTEM` | Daily trade review | Sonnet | Analyze completed/cancelled trades |
| `PATTERN_ANALYSIS_PROMPT` | Mid/end-week analysis | Haiku | Identify patterns |

### Paper vs Live Prompt Behaviour

| Aspect | Paper | Live |
|--------|-------|------|
| Philosophy | "Take the trade, learning is real" | "No trade > bad trade" |
| Confidence to act (prompt) | >= 0.5 | >= 0.7 |
| Risk/reward (prompt) | >= 1.5:1 | >= 2:1 |
| Quick scan escalation | BUY >= 0.5, moves > 1.5%, < 3 positions | BUY >= 0.7, moves > 2% |
| Research analyzer | "Recommend BUY when thesis supported" | "Default to WATCH" |
| Mini analysis | "Lean towards acting" | "Be conservative" |
| Day plan | "Aim for 2-3 active positions" | Standard |

**Note:** Live prompts have not been tuned yet — they preserve the original conservative defaults and will be reviewed once the paper approach is validated. Code-enforced hard limits (stop losses, position sizing, risk gates) are identical in both modes.

### Key Prompt Rules (Trading Analyst)

- ISA constraints: long-only, cash-only, GBP/LSE only
- Trading philosophy: mode-dependent (see table above)
- **Always call `get_recent_research` before trading**
- Research older than 24h → must call `research_symbol` for fresh data
- Confidence threshold: mode-dependent in prompt, >= 0.7 enforced in code (Gate 2) regardless of mode
- Risk/reward ratio: mode-dependent in prompt
- 5-step evaluation: Research → Fundamentals → Technical → Risk → Decision

### Agent Tools (19 total)

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
| **Risk** | `check_risk` | Pre-trade risk validation (12-step pipeline) |
| | `get_max_position_size` | Calculate max allowed quantity for a price |
| **Execution** | `place_trade` | Submit order (LIMIT/MARKET, BUY/SELL) — **3 mandatory gates** |
| | `cancel_order` | Cancel pending order by trade ID |
| **Discovery** | `search_contracts` | Find LSE-listed contracts by pattern |
| **Intentions** | `log_intention` | Log a conditional intention ("buy SHEL if price < 2450") |
| | `get_intentions` | View all pending intentions |
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

Actual trades happen via `place_trade` tool calls during the loop, not from parsing the final text. Unfulfilled intentions can be explicitly tracked via `log_intention`.

---

## 7. Trade Execution Pipeline

```
Agent calls place_trade tool
        │
        ▼
┌─────────────────────────────────────────────┐
│ GATE 1: MARKET PHASE CHECK                   │
│   BUY during wind-down/post-market/closed?   │
│   → REJECTED immediately                     │
│   (SELLs always pass this gate)              │
└──────────────────────┬──────────────────────┘
                       │ passed
                       ▼
┌─────────────────────────────────────────────┐
│ GATE 2: CONFIDENCE THRESHOLD                 │
│   confidence < 0.7? → REJECTED              │
│   (Enforced in code, not just prompt)        │
└──────────────────────┬──────────────────────┘
                       │ passed
                       ▼
┌─────────────────────────────────────────────┐
│ GATE 3: MANDATORY RISK CHECK                 │
│   BUY orders → checkTradeRisk() called       │
│   internally (not at agent's discretion)     │
│   12-step pipeline (see Section 8)           │
│   → REJECTED if any check fails              │
│   (SELLs skip — risk-reducing)               │
└──────────────────────┬──────────────────────┘
                       │ passed
                       ▼
┌─────────────────────────────────────────────┐
│ 4. CREATE TRADE RECORD                       │
│    Insert into trades table: PENDING         │
│    Fields: symbol, side, qty, orderType,     │
│            limitPrice, reasoning, confidence  │
└──────────────────────┬──────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────┐
│ 5. BUILD IBKR CONTRACT                       │
│    lseStock(symbol) → {STK, LSE, GBP}       │
└──────────────────────┬──────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────┐
│ 6. BUILD IBKR ORDER                          │
│    Action: BUY/SELL                          │
│    Type: LMT/MKT                             │
│    TIF: DAY (hardcoded — dies at close)      │
│    Transmit: true (immediate)                │
└──────────────────────┬──────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────┐
│ 7. SUBMIT TO IBKR                            │
│    api.placeNewOrder(contract, order)         │
│    Returns: ibOrderId (number)               │
│    Update trade: status → SUBMITTED          │
└──────────────────────┬──────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────┐
│ 8. MONITOR ORDER (async subscription)        │
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
                   → CANCELLED (by agent, guardian, or market close)
                   → ERROR
```

### Order Types

- **LIMIT** — Agent specifies `limitPrice`. Most common.
- **MARKET** — Immediate execution at best available. Used by Guardian stop-loss.
- **Time-in-Force:** Always "DAY" (order expires at market close).

### Stop-Loss Execution

Stop losses are enforced by the **Position Guardian** (not the agent):

```
Guardian (every 60s):
  For each position with stopLossPrice:
    If current price <= stopLossPrice:
      → placeTrade(MARKET SELL, full quantity)
      → Log to agent_logs (phase: "guardian")
```

This runs independently of the 10-minute orchestrator ticks, providing near-real-time stop-loss protection.

---

## 8. Risk Management Pipeline

**Files:** `src/risk/manager.ts`, `src/risk/limits.ts`, `src/risk/exclusions.ts`

### Pre-Trade Risk Check (12-step pipeline)

Called **automatically inside `place_trade`** for all BUY orders (Gate 3). Also available as `check_risk` tool for the agent to pre-validate.

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
│  Price >= £0.10? (penny stock protection)                     │
└──────────────────────────────────────────────────────────────┘
        │
        ▼
┌─ CHECK 4: POSITION SIZING ───────────────────────────────────┐
│  Trade value <= 5% of portfolio?                              │
│  Trade value <= £50,000?                                      │
└──────────────────────────────────────────────────────────────┘
        │
        ▼
┌─ CHECK 5: CASH RESERVE ─────────────────────────────────────┐
│  (cash - trade value) / net liq >= 20%?                      │
└──────────────────────────────────────────────────────────────┘
        │
        ▼
┌─ CHECK 6: POSITION COUNT ───────────────────────────────────┐
│  Current positions < 10? (or adding to existing)            │
└──────────────────────────────────────────────────────────────┘
        │
        ▼
┌─ CHECK 7: SECTOR CONCENTRATION ★NEW ────────────────────────┐
│  If sector provided: sum market value for that sector        │
│  (Sector looked up via watchlist table)                      │
│  Would sector exceed 30% of portfolio? → reject              │
└──────────────────────────────────────────────────────────────┘
        │
        ▼
┌─ CHECK 8: VOLUME ★NEW ──────────────────────────────────────┐
│  Fetch fresh Yahoo Finance quote                             │
│  avgVolume < 50,000? → reject                                │
│  Yahoo unavailable? → reject (conservative)                  │
└──────────────────────────────────────────────────────────────┘
        │
        ▼
┌─ CHECK 9: DAILY TRADE FREQUENCY ────────────────────────────┐
│  Today's BUY trades < 10?                                   │
└──────────────────────────────────────────────────────────────┘
        │
        ▼
┌─ CHECK 10: TRADE INTERVAL ──────────────────────────────────┐
│  Last trade > 15 minutes ago?                               │
└──────────────────────────────────────────────────────────────┘
        │
        ▼
┌─ CHECK 11: DAILY LOSS LIMIT ────────────────────────────────┐
│  Daily P&L > -2%? (circuit breaker)                         │
│  Blocks ALL trades if breached                              │
└──────────────────────────────────────────────────────────────┘
        │
        ▼
┌─ CHECK 12: WEEKLY LOSS LIMIT ───────────────────────────────┐
│  Weekly P&L > -5%? (ultimate circuit breaker)               │
│  Blocks ALL trades if breached                              │
└──────────────────────────────────────────────────────────────┘
        │
        ▼
  { approved: true/false, reasons: [...all failures...] }
```

### Hard Limits (Cannot Be Overridden by Agent)

| Limit | Value | Enforcement |
|-------|-------|-------------|
| ISA cash only | true | No margin, no shorting |
| Max position % | 5% | Risk pipeline check 4 |
| Max position £ | £50,000 | Risk pipeline check 4 |
| Cash reserve | 20% | Risk pipeline check 5 |
| Stop loss | 3% | Guardian enforces via MARKET SELL |
| Daily loss | 2% | Risk pipeline check 11 |
| Weekly loss | 5% | Risk pipeline check 12 |
| Max positions | 10 | Risk pipeline check 6 |
| Max trades/day | 10 | Risk pipeline check 9 |
| Trade interval | 15 min | Risk pipeline check 10 |
| Max sector | 30% | Risk pipeline check 7 |
| Min price | £0.10 | Risk pipeline check 3 |
| Min volume | 50,000 | Risk pipeline check 8 (Yahoo) |
| Confidence threshold | 0.7 | `place_trade` Gate 2 |
| Wind-down BUY block | 16:25+ | `place_trade` Gate 1 |
| Pause threshold | Wilson lower bound <40% | Self-improvement check |

---

## 9. Research Pipeline

**File:** `src/research/pipeline.ts`

**When:** Daily at 18:00 (after market close)

### Stage 0: Score Decay (runs first)

```
For each active watchlist symbol:
  weeksStale = (now - lastResearchedAt) / 7 days
  decay = floor(weeksStale) × 5 points
  newScore = max(0, score - decay)
  If newScore < 10 → deactivate symbol

→ Prevents stale scores from misleading the agent
→ Naturally prunes watchlist of unmaintained symbols
```

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
→ ★ Names loaded dynamically from watchlist DB + static aliases
→ Unmatched articles → Claude (Haiku) extracts LSE tickers
→ Verify via FMP profile → add to watchlist (max 3/run)
```

### Stage 3: Deep Research (up to 10 symbols)

```
Symbol selection priority:
  1. Held positions (always researched first)
  2. Highest score (most promising first)
  3. Stalest (longest since last research)

For each selected symbol:

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
    - ★ dataQuality: "full" / "partial" / "minimal"
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
  Decayed: -5 points per week stale (deactivated at <10)
```

### Data Sources Summary

| Source | What | Rate Limit | Fallback |
|--------|------|-----------|----------|
| IBKR | Real-time quotes, bars, account, orders | 40 req/sec | FMP |
| Yahoo Finance | Quotes, fundamentals, volume check | None explicit | Graceful null |
| FMP | Screener, profiles, quotes | 5 req/min (free tier) | Skip |
| RSS (8 feeds) | News articles | 15 feeds/min | Skip |

---

## 10. Learning & Self-Improvement Loop

### Layer 1: Trade Reviews (Daily, 17:15)

**File:** `src/learning/trade-reviewer.ts`

```
For each trade today (not yet reviewed):
  ★ Includes: FILLED (with PnL), CANCELLED, and expired SUBMITTED orders

  Gather context:
    - 3 most recent research records for symbol
    - Agent decisions within ±30 min of trade
    - Trade details (side, price, P&L)
    - ★ For non-executed trades: prompt includes limit price assessment

  Claude (Sonnet) Review → trade_reviews table:
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
  - Trade reviews with outcomes (★ minimum 1 review, was 3)
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
  - Last 15 weekly insights, ★ sorted by severity (critical > warning > info)
  - Top 5 delivered to agent
  - Last 5 trade review lessons
  - Critical/warning items prioritised

→ Injected into DAY_PLAN_PROMPT
→ Agent sees warnings before market open
```

### Layer 4: Self-Improvement (Sunday 20:00)

**File:** `src/self-improve/monitor.ts`

```
1. Performance Pause Check:
   ★ Wilson score lower bound (z=1.96, 95% confidence interval)
   if wilsonLower(wins, total) < 40% AND total >= 5:
     → setPaused(true)
     → Send alert email with raw rate + Wilson bound
     → Require manual restart

2. Gather: 2 weeks trades, reviews, insights, metrics (7d + 90d)

3. Claude (Sonnet) Self-Improvement:
   - Analyze performance data
   - Propose 1–2 code changes (max 2/week)

4. Whitelist of modifiable files ONLY:
   ✅ src/agent/prompts/*.ts (system prompts, frameworks)
   ✅ src/research/watchlist.ts (scoring weights)
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
                     │ fills + cancels + expirations
                     ▼
              ┌──────────────┐
              │ TRADE REVIEW │ ← 17:15 daily
              │ (lesson per  │   ★ Reviews ALL outcomes
              │  trade)      │     not just fills
              └──────┬───────┘
                     │ reviews
                     ▼
              ┌──────────────┐
              │   PATTERN    │ ← Wed/Fri 19:00
              │  ANALYSIS    │   ★ Min 1 review (was 3)
              │ (insights)   │
              └──────┬───────┘
                     │ insights
                     ▼
              ┌──────────────┐
              │   LEARNING   │ ← 07:30 daily
              │    BRIEF     │   ★ Severity-sorted
              │ (fed to agent│
              │  at pre-mkt) │
              └──────┬───────┘
                     │ brief
                     ▼
              ┌──────────────┐
              │   DAY PLAN   │ ← 07:30 daily
              │ (adjusted    │   ★ Stored in memory
              │  strategy)   │     for later ticks
              └──────┬───────┘
                     │ influences
                     ▼
              ┌──────────────┐
              │   TRADING    │ ← loop repeats
              └──────────────┘

Sunday branch:
  Self-Improvement
    → Analyzes all of the above
    → ★ Wilson score pause check
    → Proposes prompt/scoring changes
    → Creates PRs on GitHub
```

---

## 11. Reporting & Notifications

### Email Reports

**File:** `src/reporting/`

| Report | When | Content |
|--------|------|---------|
| **Heartbeat** | 07:00 weekdays | Hostname, uptime (confirms system alive) |
| **Daily Summary** | 17:00 weekdays | Portfolio value, daily P&L, 30-day metrics (win rate, Sharpe, drawdown), today's trades, open positions, API costs, **stale PR alerts** |
| **Weekly Summary** | 17:30 Friday | Weekly P&L, daily breakdown table, all-time stats, sector breakdown |

**Email subject format:** `+£X.XX | Daily Trading Summary 2026-02-17` (color-coded positive/negative)

### Stale PR Alerts

The daily summary email includes a section highlighting self-improvement PRs that have been open for >7 days, with an amber background. This ensures improvement proposals don't accumulate unnoticed.

### Alert Emails

| Trigger | Content | Cooldown |
|---------|---------|----------|
| IBKR disconnect | "IBKR disconnected" + auto-reconnect note | 30 min |
| Unhandled rejection storm (>=10 in 60s) | Critical crash alert | None |
| Uncaught exception | Critical crash alert | None |
| Auto-pause (Wilson score <40%) | Performance warning with raw + Wilson rates | None |

### Metrics Calculated

| Metric | Source |
|--------|--------|
| Win rate | trades (FILLED with P&L) |
| Avg win / avg loss | trades (FILLED) |
| Profit factor | avg win / avg loss |
| Sharpe ratio | (avg daily return / std dev) x sqrt(252) |
| Max drawdown | Peak-to-trough from daily_snapshots |
| Total P&L | Portfolio value - initial |
| Daily/Weekly P&L | Snapshot comparisons |
| API costs | token_usage table (with cache discount) |

---

## 12. Data Model

### All Tables

| Table | Purpose | Key Fields | Records Created By |
|-------|---------|------------|-------------------|
| `trades` | Order execution log | symbol, side, qty, status, ibOrderId, pnl, reasoning, confidence | `place_trade` tool |
| `positions` | Open holdings | symbol, qty, avgCost, currentPrice, unrealizedPnl, stopLoss, target | Reconciliation + Guardian |
| `research` | Stock analysis | symbol, sentiment, action, confidence, bullCase, bearCase, dataQuality | Research pipeline |
| `watchlist` | Stock universe | symbol, name, sector, score, active | Discovery + pipeline |
| `dailySnapshots` | EOD portfolio | date, portfolioValue, dailyPnl, tradesCount, wins, losses | Post-market (with retry) |
| `agentLogs` | Audit trail | level, phase, message, data (JSON) | All jobs + agent + guardian |
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
| **Yahoo Finance** | Fundamentals, quotes, volume check | API changes / rate limits | Returns null; risk check rejects BUY on null (conservative) |
| **FMP** | Stock screening, fallback quotes | 5 req/min limit / key invalid | Graceful skip, discovery halted |
| **RSS Feeds** | News articles | Feed down / format change | Individual feed failure OK, others continue |
| **Resend** | Email notifications | API error | Logged, non-critical |
| **GitHub API** | Self-improvement PRs | Token invalid | PR creation fails, proposal still logged |
| **SQLite** | All persistence | Corruption / disk full | Critical — app cannot function |

### IBKR-Specific Edge Cases

- **IB Gateway restarts at 05:00 UTC** — Connection lost, auto-reconnect kicks in before 07:00 heartbeat
- **Market data gaps** — Quote timeout (10s) → FMP fallback → null if both fail
- **Order monitoring** — 1-hour auto-unsubscribe prevents subscription leaks
- **Commission filtering** — Values > 1e9 ignored (IBKR sentinel values)
- **Guardian during disconnect** — getQuotes fails gracefully, guardian tick skipped

---

## 14. Remaining Gaps & Future Work

### Resolved in Phase 1

| Original ID | Gap | Resolution |
|-------------|-----|------------|
| **A1** | Agent intentions not tracked | `log_intention` / `get_intentions` tools; evaluated against quotes each tick |
| **A3** | Day plan orphaned after generation | Stored in `currentDayPlan`, injected into Tier 3 context |
| **A4** | No stop-loss execution | Guardian enforces stop-losses every 60s via MARKET SELL |
| **A5** | Wind-down advisory only | `place_trade` Gate 1 rejects BUY orders during wind-down/post-market/closed |
| **D1** | Risk check at agent's discretion | `place_trade` Gate 3 runs `checkTradeRisk()` internally for all BUY orders |
| **D2** | Snapshot failure breaks loss limits | `recordDailySnapshot()` retries 3x with 30s backoff |
| **D3** | Sector exposure not enforced | Risk check 7: sector concentration from positions + watchlist |
| **D4** | Volume not checked | Risk check 8: fresh Yahoo Finance avgVolume >= 50,000 |
| **E2** | News matching hard-coded | `buildNameMap()` loads names from watchlist DB + static aliases |
| **E4** | No data quality flag on research | `dataQuality` field: "full"/"partial"/"minimal" based on data availability |
| **E5** | No score decay, watchlist bloat | -5 points per week stale, deactivate at <10 |
| **F1** | Only FILLED trades reviewed | Trade reviewer includes CANCELLED and expired orders |
| **F2** | Pattern analysis requires 3+ reviews | Minimum lowered to 1 |
| **F4** | Learning brief fixed-size, no priority | Fetches 15 insights, sorts by severity, takes top 5 |
| **F5** | Auto-pause on small sample | Wilson score lower bound with 95% CI, minimum 5 trades |
| **G2** | No heartbeat monitoring | 07:00 heartbeat email every weekday |
| **G4** | Token costs double-counting cache | Cost calculation subtracts cache tokens before adding at discounted rate |
| **G5** | No backfill for missed jobs | Catch-up tick on restart during market hours (>2h gap) |

Also resolved:
- **A2** (confidence prompt-only): Confidence >= 0.7 enforced in code via Gate 2
- **F3** (stale PRs unnoticed): Daily summary shows PRs open >7 days with amber alert
- **E3** (research priority): Held positions researched first, then by score, then stalest
- **H3** (no inter-tick memory): Day plan + last agent response persist across ticks

### Remaining Gaps

| # | Gap | Impact | Severity |
|---|-----|--------|----------|
| B1 | Tier 1 SELL signals depend on reconciliation freshness | May miss SELL if positions stale after IBKR disconnect | Medium |
| B3 | 10-minute tick interval | Slow reaction to sudden market events (guardian helps with stop-losses but not entry signals) | Medium |
| B4 | Haiku quick scan has no tools | Decides on partial data if context is incomplete | Low-Medium |
| C1 | No fill confirmation feedback to agent | Agent doesn't know if limit order filled until next tick | Medium |
| C2 | DAY orders expire silently | No next-day re-evaluation of unfilled orders | Medium |
| C3 | No partial fill handling | Partial positions may not match intended sizing | Low |
| C4 | Order monitoring subscription leaks | 1-hour auto-unsub helps but not perfect | Low |
| E1 | FMP free tier (5 req/min) | Universe growth is slow; if key expires, discovery stops | Medium |
| G1 | Single-job concurrency lock | Long research blocks other jobs; no priority system | Low |
| G3 | Position reconciliation periodic, not event-driven | During trading, DB positions may lag behind IBKR (guardian mitigates with price updates) | Low |
| H1 | No position-level P&L in real-time | Agent must call get_positions + get_quote (guardian keeps DB current every 60s) | Low |
| H2 | No portfolio-level optimization | Each trade evaluated independently; no rebalancing or correlation analysis | Medium |

### Severity Summary (Post Phase 1)

| Severity | Count | Key Items |
|----------|-------|-----------|
| **High** | 0 | All resolved |
| **Medium** | 5 | B1, B3, C1, C2, H2 |
| **Low-Medium** | 1 | B4 |
| **Low** | 6 | C3, C4, E1, G1, G3, H1 |

### Phase 2 Planned (Technical Indicators + Expert Prompts)

1. **Technical indicator engine** — RSI, SMA, MACD, Bollinger Bands, ATR (pure math, zero AI cost)
2. **Expert prompt rewrite** — 5-factor scoring framework replacing vague "analyze this stock"
3. **ATR-based position sizing** — 2x ATR stops instead of fixed 3%, 1% portfolio risk per trade
