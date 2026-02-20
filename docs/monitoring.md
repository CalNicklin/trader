# Monitoring & Observability Guide

## 1. Quick Commands (SSH cheat sheet)

All commands below assume you SSH in first:
```bash
ssh deploy@46.225.127.44
cd ~/trader
```

### Live logs (streaming)
```bash
# Trader agent logs (pretty-printed)
docker compose -f docker/docker-compose.yml logs -f trader --tail 50

# IB Gateway logs
docker compose -f docker/docker-compose.yml logs -f ib-gateway --tail 50

# Both
docker compose -f docker/docker-compose.yml logs -f --tail 50
```

### Container health
```bash
docker compose -f docker/docker-compose.yml ps
```

### Restart
```bash
docker compose -f docker/docker-compose.yml restart trader
# Or full restart:
docker compose -f docker/docker-compose.yml down && docker compose -f docker/docker-compose.yml up -d
```

---

## 2. Database Queries (SQLite)

The database is inside a Docker volume. The trader container does **not** have `sqlite3` installed.

**Trigger a job manually:**
```bash
ssh deploy@46.225.127.44 'docker exec docker-trader-1 bun -e "const r = await fetch(\"http://localhost:3847/jobs/research_pipeline\", {method:\"POST\"}); console.log(await r.json())"'
```
Valid jobs: `orchestrator_tick`, `mini_analysis`, `pre_market`, `post_market`, `daily_summary`, `weekly_summary`, `research_pipeline`, `self_improvement`, `trade_review`, `mid_week_analysis`, `end_of_week_analysis`

**Browse visually (Drizzle Studio):**
```bash
bun run db:studio   # pulls DB locally, opens https://local.drizzle.studio
```

**One-off SQL query via SSH:**
```bash
ssh deploy@46.225.127.44 'docker run --rm -v docker_trader-data:/data alpine sh -c "apk add --no-cache sqlite >/dev/null 2>&1 && sqlite3 /data/trader.db \"<SQL>\""'
```

### Useful queries

**Today's trades:**
```sql
SELECT id, symbol, side, quantity, fill_price, status, reasoning, created_at
FROM trades WHERE date(created_at) = date('now') ORDER BY created_at DESC;
```

**Open positions:**
```sql
SELECT symbol, quantity, avg_cost, current_price, unrealized_pnl, market_value
FROM positions WHERE quantity > 0;
```

**Agent decisions (last 20):**
```sql
SELECT level, phase, message, created_at
FROM agent_logs ORDER BY created_at DESC LIMIT 20;
```

**Daily P&L history:**
```sql
SELECT date, portfolio_value, daily_pnl, daily_pnl_percent, total_pnl, trades_count, wins_count, losses_count
FROM daily_snapshots ORDER BY date DESC LIMIT 14;
```

**Win rate:**
```sql
SELECT
  COUNT(*) as total_trades,
  SUM(CASE WHEN pnl > 0 THEN 1 ELSE 0 END) as wins,
  SUM(CASE WHEN pnl <= 0 THEN 1 ELSE 0 END) as losses,
  ROUND(100.0 * SUM(CASE WHEN pnl > 0 THEN 1 ELSE 0 END) / COUNT(*), 1) as win_rate_pct,
  ROUND(SUM(pnl), 2) as total_pnl
FROM trades WHERE status = 'FILLED' AND pnl IS NOT NULL;
```

**Watchlist scores:**
```sql
SELECT symbol, name, sector, score, last_researched_at
FROM watchlist WHERE active = 1 ORDER BY score DESC;
```

**Risk config:**
```sql
SELECT key, value, description FROM risk_config ORDER BY key;
```

**Research sentiment:**
```sql
SELECT symbol, source, sentiment, suggested_action, confidence, created_at
FROM research ORDER BY created_at DESC LIMIT 20;
```

---

## 3. Automatic Reports

| Report | When | What |
|--------|------|------|
| **Heartbeat** | 07:00 weekdays | System alive confirmation with hostname and uptime |
| **Trade alert** | On each fill | Symbol, side, price, quantity, reasoning |
| **Daily summary** | 17:00 weekdays | Portfolio value, P&L, trades, positions, win rate, stale PR alerts |
| **Weekly summary** | 17:30 Friday | Week-by-week breakdown, Sharpe ratio, drawdown |

---

## 4. Crash & Disconnect Alerts

Critical failure emails are sent automatically via `src/utils/alert.ts`:

- **Uncaught exception** — alert sent before shutdown
- **Boot failure** — alert sent before process exits
- **IBKR disconnect** — alert sent once per disconnect (no spam on reconnect attempts)

Subject line format: `[TRADER ALERT] <description>`

---

## 5. Database Backup (cron)

Add a daily backup on the server:

```bash
# Add to deploy user's crontab
crontab -e
# Add this line:
0 3 * * * docker compose -f /home/deploy/trader/docker/docker-compose.yml exec -T trader cp /app/data/trader.db /app/data/backup-$(date +\%Y\%m\%d).db
```

---

## 6. Verification Checklist

1. SSH in and run `docker compose logs -f trader` — confirm logs are streaming
2. Run a SQLite query to confirm DB is accessible
3. Kill the trader container, verify alert email arrives
4. Check backup file exists after cron runs
