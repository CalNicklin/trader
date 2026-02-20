# Trader Agent

Automated trading agent for IBKR UK Stocks & Shares ISA.

## Stack
- **Runtime**: Bun (use `bun` not `node`, `bun test` not `jest`, `bun:sqlite` not `better-sqlite3`)
- **Language**: TypeScript (strict mode)
- **Broker**: IBKR TWS API via `@stoqey/ib`
- **Database**: SQLite via `bun:sqlite` + Drizzle ORM
- **AI**: Claude API via `@anthropic-ai/sdk`
- **Email**: Resend
- **Linting**: Biome

## Commands
- `bun run dev` - Run with hot reload + pretty logs
- `bun run start` - Production start
- `bun run typecheck` - TypeScript type checking
- `bun run lint` - Biome lint + format check
- `bun run lint:fix` - Auto-fix lint issues
- `bun run db:generate` - Generate Drizzle migrations
- `bun run db:migrate` - Run migrations
- `bun test` - Run tests

## Deployment
- **CI/CD**: GitHub Actions (`.github/workflows/deploy.yml`) — pushes to `main` trigger lint/typecheck/test, then SSH deploy
- **Deploy workflow**: git pull on server → `docker compose build trader` → `docker compose up -d trader`
- **Server**: `ssh deploy@46.225.127.44`, project at `~/trader`
- **Runtime**: Docker Compose (`docker/docker-compose.yml`) — two containers: `ib-gateway` (gnzsnz/ib-gateway) + `trader`
- **DB in container**: `/app/data/trader.db` (persisted via `docker_trader-data` volume)
- **IB Gateway**: cold restart at 05:00 UTC, VNC on port 5900, healthcheck on port 4004
- **Logs**: `ssh deploy@46.225.127.44 "docker compose -f ~/trader/docker/docker-compose.yml logs trader --tail 50"`
- **Container status**: `ssh deploy@46.225.127.44 "docker compose -f ~/trader/docker/docker-compose.yml ps"`
- **Restart**: `ssh deploy@46.225.127.44 "docker compose -f ~/trader/docker/docker-compose.yml restart trader"`

### Querying the database
The trader container does **not** have `sqlite3` installed. To query the DB, use a temporary Alpine container against the volume:
```bash
ssh deploy@46.225.127.44 'docker run --rm -v docker_trader-data:/data alpine sh -c "apk add --no-cache sqlite >/dev/null 2>&1 && sqlite3 /data/trader.db \"<SQL>\""'
```
Timestamps in `agent_logs` use ISO format with `T` separator (e.g. `2026-02-16T07:30:04.523Z`). Use `LIKE '"'"'2026-02-16T07:%'"'"'` for time-based queries within the SSH quoting.

### Triggering jobs manually
Run any scheduled job on demand (uses the running trader process and its IBKR connection):
```bash
ssh deploy@46.225.127.44 'docker exec docker-trader-1 bun -e "const r = await fetch(\"http://localhost:3847/jobs/<JOB_NAME>\", {method:\"POST\"}); console.log(await r.json())"'
```
Valid jobs: `orchestrator_tick`, `mini_analysis`, `pre_market`, `post_market`, `daily_summary`, `weekly_summary`, `research_pipeline`, `self_improvement`, `trade_review`, `mid_week_analysis`, `end_of_week_analysis`

- See `docs/monitoring.md` for full SSH cheat sheet and useful queries

## External Data Sources
- **FMP (Financial Modeling Prep)**: Starter tier ($22/mo). API key in `FMP_API_KEY` env var.
  - `/company-screener` with `country=GB` works (returns US-listed UK companies). `exchange=LSE` requires Premium ($59/mo) — do NOT use.
  - `/search-name` with `exchange=LSE` works — used to resolve LSE tickers from company names.
  - `/profile` with `.L` suffix works — used for quote fallback and verification.
  - `/quote` does NOT work for `.L` symbols on Starter — requires Premium for UK coverage.
  - Rate limit: 300 requests/min on Starter.
- **Yahoo Finance**: Free, no API key. Primary quote fallback when IBKR fails.
- **RSS Feeds**: 8 financial news feeds for news-driven discovery (see `src/research/sources/news-scraper.ts`).

## Module Conventions
- Max 2 function exports per module (types/interfaces excluded)
- Prefer distinct modules per function for readability
- Pure functions in separate modules from IO-heavy code (testability)
- DI for system boundaries (network, DB) so tests can inject mocks

## Conventions
- Bun auto-loads `.env` files - no dotenv needed
- Use `Bun.file` over `node:fs` where possible
- All broker interactions go through `src/broker/` modules
- Risk checks are mandatory before any order submission
- All agent decisions are logged to `agent_logs` table
- Pipeline events (discovery, research) logged to `agent_logs` for observability across container restarts
