# Phase 1 Observation Checklist

**Duration:** 1 week (5 trading days) after deploy
**Deploy date:** 2026-02-16
**Earliest Phase 2 start:** 2026-02-23

## 1. Guardian Reliability

### Heartbeat emails
- [ ] Receiving 07:00 heartbeat email every weekday
- [ ] If one is missed by 07:15, the system is down — investigate immediately

### Position price updates
Prices should refresh every 60s during market hours:
```bash
ssh deploy@46.225.127.44 'docker run --rm -v docker_trader-data:/data alpine sh -c "apk add --no-cache sqlite >/dev/null 2>&1 && sqlite3 /data/trader.db \"SELECT symbol, current_price, updated_at FROM positions ORDER BY updated_at DESC LIMIT 5\""'
```
- [ ] `updated_at` timestamps are within the last 60s during market hours
- [ ] No positions stuck with stale prices (>5 min old while market is open)

### Guardian logs
```bash
ssh deploy@46.225.127.44 'docker run --rm -v docker_trader-data:/data alpine sh -c "apk add --no-cache sqlite >/dev/null 2>&1 && sqlite3 /data/trader.db \"SELECT level, message, created_at FROM agent_logs WHERE phase='"'"'guardian'"'"' ORDER BY created_at DESC LIMIT 10\""'
```
- [ ] Guardian entries present (price updates, post-market cleanup)
- [ ] No repeated error entries

### Post-market cleanup
- [ ] At least one "unfilled order expired" or "Post-market cleanup" log by end of week (only appears if there were SUBMITTED orders at close)

## 2. Risk Gates

### Trade rejections
```bash
ssh deploy@46.225.127.44 "docker compose -f ~/trader/docker/docker-compose.yml logs trader --no-color | grep -i 'rejected\|risk gate'"
```
- [ ] If trades were attempted: at least one rejection log exists (proves gates are wired)
- [ ] If zero trades attempted: not a Phase 1 issue, but note it for Phase 2 (agent may be too cautious)

### Volume and sector checks
```bash
ssh deploy@46.225.127.44 "docker compose -f ~/trader/docker/docker-compose.yml logs trader --no-color | grep -i 'volume\|sector.*portfolio'"
```
- [ ] Volume checks are running (Yahoo quote fetched during risk check)
- [ ] No persistent "Yahoo Finance quote unavailable" errors

## 3. Three-Tier Architecture Flow

### Pre-filter reasons
```bash
ssh deploy@46.225.127.44 "docker compose -f ~/trader/docker/docker-compose.yml logs trader --no-color | grep -i 'Pre-filter'"
```
- [ ] Pre-filter is generating reasons (positions to monitor, price moves, research signals)
- [ ] Not every tick is empty — at least some notable changes detected

### Haiku scans
```bash
ssh deploy@46.225.127.44 'docker run --rm -v docker_trader-data:/data alpine sh -c "apk add --no-cache sqlite >/dev/null 2>&1 && sqlite3 /data/trader.db \"SELECT message, created_at FROM agent_logs WHERE message LIKE '"'"'%Quick scan%'"'"' ORDER BY created_at DESC LIMIT 10\""'
```
- [ ] Haiku scans are running regularly
- [ ] Most scans are *not* escalating (cost control working)

### Sonnet escalations
```bash
ssh deploy@46.225.127.44 "docker compose -f ~/trader/docker/docker-compose.yml logs trader --no-color | grep -i 'Escalating to full Sonnet'"
```
- [ ] At least a few Sonnet escalations over the week (system isn't dead)
- [ ] Not escalating every single tick (would indicate Haiku scan is broken)

## 4. Operational Fixes

### Daily summary emails
- [ ] Receiving daily summary emails at 17:00
- [ ] Email includes API cost line at the bottom
- [ ] Email includes stale PR section if any improvement PRs are open >7 days

### Score decay
```bash
ssh deploy@46.225.127.44 'docker run --rm -v docker_trader-data:/data alpine sh -c "apk add --no-cache sqlite >/dev/null 2>&1 && sqlite3 /data/trader.db \"SELECT symbol, score, last_researched_at, active FROM watchlist ORDER BY score DESC LIMIT 15\""'
```
- [ ] Scores are not all identical — decay is differentiating stale vs fresh
- [ ] Any symbols with score <10 have been deactivated (`active = 0`)

### Trade reviewer
- [ ] If any trades were filled or cancelled: trade reviews exist in `trade_reviews` table
- [ ] Cancelled/expired orders are reviewed (not just filled trades)

### Wilson score pause
- [ ] Auto-pause has NOT false-triggered (trading is still active)
- [ ] If it did trigger: check the Wilson lower bound calculation was correct

### Catch-up tick
- [ ] If the container restarted mid-session: check for "Catch-up tick" in logs
- [ ] If no restarts: this is fine, the feature just wasn't needed

## 5. Stability

### Error rate
```bash
ssh deploy@46.225.127.44 "docker compose -f ~/trader/docker/docker-compose.yml logs trader --no-color | grep '\"level\":50' | wc -l"
```
- [ ] Error count is low (< 10 per day)
- [ ] No repeating error patterns (same error every tick = bug)

### Uptime
- [ ] Heartbeat email uptime should be ~24h+ (not restarting every few hours)
- [ ] No unhandled rejection storms in logs

### Container health
```bash
ssh deploy@46.225.127.44 "docker compose -f ~/trader/docker/docker-compose.yml ps"
```
- [ ] Both `ib-gateway` and `trader` containers are `Up` with healthy status

## 6. Cost Tracking

```bash
ssh deploy@46.225.127.44 'docker run --rm -v docker_trader-data:/data alpine sh -c "apk add --no-cache sqlite >/dev/null 2>&1 && sqlite3 /data/trader.db \"SELECT job, ROUND(SUM(estimated_cost_usd), 3) as cost, COUNT(*) as calls FROM token_usage WHERE created_at > date('"'"'now'"'"', '"'"'-7 days'"'"') GROUP BY job ORDER BY cost DESC\""'
```
- [ ] Daily cost is roughly $0.50-$3 (depends on escalation frequency)
- [ ] Haiku scans are cheap (~$0.02 each)
- [ ] Sonnet escalations are the main cost driver (~$1.70 each)
- [ ] No single job is unexpectedly expensive

---

## Red Flags (Delay Phase 2)

- Guardian crashing or not updating prices
- Risk gates never reached (code path dead)
- Repeated boot failures or rejection storms
- Cost runaway (>$5/day consistently)
- Daily summary emails not arriving
- Persistent Yahoo Finance or IBKR connection errors

## Green Light for Phase 2

- [ ] 5 clean weekdays with no crashes
- [ ] Guardian reliably updating prices
- [ ] At least one post-market cleanup logged
- [ ] Haiku scans running + at least one Sonnet escalation
- [ ] Daily cost within expected range ($0.50-$3)
- [ ] Receiving heartbeat + daily summary emails consistently
- [ ] No red flags above

## What Phase 2 Adds

Phase 2 is purely additive — it makes the agent *smarter* but doesn't change the safety architecture:

1. **Technical indicator engine** — RSI, SMA, MACD, Bollinger Bands, ATR (pure math, zero AI cost)
2. **Expert prompt rewrite** — 5-factor scoring framework replacing vague "analyze this stock"
3. **ATR-based position sizing** — 2x ATR stops instead of fixed 3%, 1% portfolio risk per trade

The bar for starting Phase 2 is simply: **Phase 1 is stable and not broken.**
