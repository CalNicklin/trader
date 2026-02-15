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

## Conventions
- Bun auto-loads `.env` files - no dotenv needed
- Use `Bun.file` over `node:fs` where possible
- All broker interactions go through `src/broker/` modules
- Risk checks are mandatory before any order submission
- All agent decisions are logged to `agent_logs` table
