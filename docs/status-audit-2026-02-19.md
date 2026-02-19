# Status Audit — 19 February 2026

## System Health

| Component | Status | Notes |
|-----------|--------|-------|
| ib-gateway | Up (healthy) | Running 9h, VNC on 5900, healthcheck on 4004 |
| trader | Up (~1h) | Restarted after today's deploys |
| IBKR connection | Degraded | Error 354 on paper account — no real-time data, Yahoo fallback active |
| Database | OK | 12 trades (all cancelled), 10 watchlist symbols active |

## Architecture (Current)

```
07:30  Pre-market day plan ──── Sonnet (1x/day, ~$0.15-0.25)
08-16  Orchestrator tick ─────── Haiku agent loop (hourly, ~$0.08-0.14/run)
18:00  Research pipeline ─────── Haiku (daily)
17:00  Daily summary email ──── No AI cost
```

**Cron**: `0 8-16 * * 1-5` = 9 ticks/day during market hours
**Quick scan gate**: Removed — Haiku agent runs directly every tick
**Estimated daily cost**: ~$0.90-1.30/day (at actual Haiku pricing)

### Known pricing bug in token tracker
`token_usage.estimated_cost_usd` still uses **Sonnet rates** ($3/M input) for `trading_analyst_fast` which actually runs **Haiku** ($1/M input). DB costs are ~3x overstated for active trading ticks. Total reported spend ($55.13) is inflated.

## Quote Data Flow

```
IBKR real-time (pence) ──[error 354]──> Yahoo fallback (pence) ──> FMP fallback (pence)
```

All sources return **pence** (GBp). Confirmed empirically: GSK=2249p, ULVR=5320p, RIO=7133p.

## The Pence Bug — Fixed But Untested

**Problem**: Agent saw prices like 5325 (pence), mentally converted to £53.25, placed limit orders in pounds. All 12 orders were ~100x too low and never filled.

**Fix deployed** (commit `04d0959`):
1. Prompt explicitly states "all prices are in PENCE"
2. Tool description says "Limit price in PENCE (e.g. 5325 for £53.25)"
3. Runtime sanity check rejects limit prices >90% below market

**Status**: Fix is live but **no orders placed since deploy** — credit ran out at 14:20, then daily trade limit (10) hit at 15:00. First real test will be tomorrow morning.

## Trade History

| Metric | Value |
|--------|-------|
| Total orders placed | 12 |
| Filled | 0 |
| Cancelled | 12 |
| Open positions | 0 |
| P&L | £0 |

Every order was placed in pounds instead of pence, never filled, then cancelled by the agent on the next tick. The pence fix should break this cycle tomorrow.

## Cost History

| Day | Reported | Real (est.) | Main driver |
|-----|----------|-------------|-------------|
| Feb 16 (Sun) | $46.68 | ~$3-4 | 28 Sonnet runs on non-market day (first boot) |
| Feb 17 (Mon) | $0.95 | ~$0.20 | 1 Sonnet run (pre-market only) |
| Feb 18 (Tue) | $3.07 | ~$0.80 | 3 Sonnet runs + 24 Haiku scans |
| Feb 19 (Wed) | $4.33 | ~$1.50 | Mixed: Sonnet early, Haiku after switch |
| **Total** | **$55.13** | **~$6-7** | DB massively overstated (Opus then Sonnet rates for Haiku) |

*Note: "Real (est.)" accounts for the fact that actual models used were Sonnet/Haiku, not Opus, and the token tracker has been progressively fixed.*

## Phase 1 Checklist Status

| Item | Status | Notes |
|------|--------|-------|
| Guardian heartbeat emails | Untested | Need to check inbox |
| Guardian price updates | Partial | Yahoo fallback working; no positions to monitor |
| Risk gates wired | Yes | Daily trade limit (10) correctly blocked orders at 15:00 |
| Orders fill correctly | **NOT YET** | Pence fix deployed, untested — first test tomorrow |
| Haiku gate working | Removed | Replaced with simple hourly cron |
| Daily cost in range | Yes | ~$0.90-1.30/day projected with current setup |
| Daily summary emails | Untested | Should fire at 17:00 today |
| 5 clean weekdays | **Not started** | Clock resets tomorrow — pence fix is a fundamental change |

### Phase 1 blockers
1. **Pence fix must produce a filled trade** — until an order fills, the system is unvalidated
2. **Daily trade limit** reached at 10 — agent churns orders. May need to count only filled trades or raise the limit

## 20-Min vs 60-Min Cron Question

| | 20-min (Haiku) | 60-min (Haiku) |
|---|---|---|
| Ticks/day | ~24 | ~9 |
| Est. cost/day | ~$2.50-3.50 | ~$0.90-1.30 |
| Est. cost/month | ~£60-80 | ~£20-30 |
| Responsiveness | Reacts to fills/moves in 20 min | Up to 60 min lag |
| On £200 capital | 30-40% annual cost/capital | 10-15% annual cost/capital |

**Recommendation**: Stay at 60-min for now. The agent isn't filling trades yet — faster ticks won't help until the pence fix is proven. Revisit once orders are filling and there's actual P&L to optimise around. If responsiveness matters (stop-loss reaction time), Guardian already monitors prices every 60s independently.
