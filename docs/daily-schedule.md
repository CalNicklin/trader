# Daily Schedule

All times are London (Europe/London). Weekdays only unless noted.

## Morning

| Time | Job | What it does | Email? |
|------|-----|-------------|--------|
| 07:00 | `heartbeat` | Sends alive confirmation with uptime | Yes |
| 07:30 | `pre_market` | Syncs account, reconciles positions, generates internal day plan | No |

## Market Hours (08:00 - 21:00)

| Time | Job | What it does | Email? |
|------|-----|-------------|--------|
| Every 60s | Guardian | Stop-loss checks, position price updates, trailing stops, price alerts | No |
| */10 08:00-20:50 | `orchestrator_tick` | Three-tier analysis: pre-filter → Haiku scan → Sonnet (if escalated) | No |
| 08:00-14:30 | LSE only | Morning ticks cover LSE symbols | No |
| 14:30-16:25 | LSE + US | Overlap — both exchanges active | No |
| 16:25-16:30 | LSE wind-down | No new LSE BUY orders. US still trading | No |
| 16:30-20:55 | US only | Evening ticks cover US symbols | No |
| 20:55-21:00 | US wind-down | No new US BUY orders | No |

## Post-Market

| Time | Job | What it does | Email? |
|------|-----|-------------|--------|
| 21:00+ | Guardian cleanup | Expires unfilled SUBMITTED orders, marks as CANCELLED | No |
| 21:05 | `post_market` | Reconciles positions with IBKR, records daily snapshot, clears intentions | No |
| 17:00 | `daily_summary` | Portfolio value, P&L, trades, positions, API costs, stale PRs (US still active) | Yes |
| 17:15 | `trade_review` | AI reviews today's filled, cancelled, and expired trades | No |

## Evening / Weekly

| Time | Job | What it does | Email? |
|------|-----|-------------|--------|
| 18:00 | `research_pipeline` | Score decay, stock discovery (LSE + US), news scan, deep research | No |
| 19:00 Wed | `mid_week_analysis` | Pattern analysis on recent trade reviews | No |
| 19:00 Fri | `end_of_week_analysis` | End-of-week pattern analysis | No |
| 17:30 Fri | `weekly_summary` | Weekly performance summary | Yes |
| 20:00 Sun | `self_improvement` | Reviews performance, creates PRs (whitelisted files) or issues (any file) | No |

## Emails You Should Receive

| When | Subject pattern |
|------|----------------|
| 07:00 weekdays | `Heartbeat: Trader Agent alive — uptime Xh` |
| 17:00 weekdays | `+£X.XX \| Daily Trading Summary YYYY-MM-DD` |
| 17:30 Fridays | Weekly summary |
| On pause trigger | `ALERT: Trading Paused - Poor Performance` |

## Market Phases (from clock.ts)

Per-exchange phases:
```
LSE:  07:30-08:00 pre-market → 08:00-16:25 open → 16:25-16:30 wind-down → 16:30-17:00 post-market
US:   14:30-20:55 open → 20:55-21:00 wind-down → 21:00-21:15 post-market
```

Global phase (union of both):
```
07:30 - 08:00   pre-market    Day plan generation
08:00 - 21:00   open          Active trading (varies by exchange)
21:00 - 21:15   post-market   Reconciliation, snapshots
18:00 - 22:00   research      Research pipeline window (overlaps with US session)
All other times  closed        Nothing runs (except Guardian skips)
```
