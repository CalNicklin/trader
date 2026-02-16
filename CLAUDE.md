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
- **Server**: `ssh deploy@46.225.127.44`, project at `~/trader`
- **Runtime**: Docker Compose (`docker/docker-compose.yml`) — two containers: `ib-gateway` (gnzsnz/ib-gateway) + `trader`
- **DB in container**: `/app/data/trader.db` (persisted via `trader-data` volume)
- **IB Gateway**: cold restart at 05:00, VNC on port 5900
- **Logs**: `docker compose -f docker/docker-compose.yml logs -f trader --tail 50`
- **DB query**: `docker compose -f docker/docker-compose.yml exec trader sh -c "sqlite3 /app/data/trader.db '<SQL>'"`
- **Restart**: `docker compose -f docker/docker-compose.yml restart trader`
- See `docs/monitoring.md` for full SSH cheat sheet and useful queries

## Conventions
- Bun auto-loads `.env` files - no dotenv needed
- Use `Bun.file` over `node:fs` where possible
- All broker interactions go through `src/broker/` modules
- Risk checks are mandatory before any order submission
- All agent decisions are logged to `agent_logs` table
