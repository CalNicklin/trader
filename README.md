# Trader Agent

Autonomous trading agent for an IBKR UK Stocks & Shares ISA. Uses Claude as the decision-making engine with structured risk management, automated research, and a self-improvement feedback loop.

Runs on a VPS via Docker, connecting to IB Gateway for LSE-listed equities. Currently paper trading.

## Vision and Goals

This is an **agentic learning system** that operates within the London Stock Exchange, designed to evolve its own trading strategy over time.

### Core Principles

- **Learn from every decision.** The agent logs its reasoning behind each trade. Post-market reviews assess what worked and what didn't. Pattern analysis identifies systematic biases. Over weeks and months, this feedback loop builds a strategy that improves through experience, not just rules.

- **Earn its keep.** The system must generate enough returns to cover its own running costs. Paper trading now, real money later. This is the hard constraint — the agent has a real goal it must succeed at, not just a sandbox to play in.

- **Be an expert trader.** The agent has the entire wealth of the internet's knowledge in its training data. It should reason about fundamentals, technicals, sentiment, macro conditions, and sector dynamics like a professional analyst would. It should know when to be patient and when to act decisively.

- **Actively seek information.** The agent doesn't wait for data to arrive — it reaches out. It screens stocks across sectors and market caps, scrapes financial news from multiple sources, runs on-demand research before trading, and discovers new opportunities from breaking headlines. An informed decision is a better decision.

- **Evolve its own code.** Each week, the agent reviews its performance and proposes improvements to its own prompts and configuration via GitHub PRs. A human reviews and merges. The system's intelligence is not static — it compounds.

- **Respect boundaries.** Exclusion lists, risk limits, position sizing, sector caps, and auto-pause thresholds are non-negotiable guardrails. The agent operates within ISA rules (cash-only, long-only, GBP/LSE).

### Agentic Architecture

The system uses a **tiered orchestrator pattern** for cost-effective continuous monitoring:

1. **Code pre-filter** (free) — checks if positions, orders, price moves, or research signals require attention. Skips Claude entirely on quiet ticks.
2. **Haiku quick scan** (~$0.02) — single-call triage: should we escalate to a full analysis? No tool use, just a yes/no decision.
3. **Sonnet agent loop** (~$1.70) — full agentic analysis with tool use. Fetches data, researches stocks, evaluates risk, places or cancels orders.

This means the agent monitors continuously during market hours without burning money on repetitive "nothing to do" analysis. Sonnet's reasoning power is reserved for moments that matter.

## Stack

| Layer | Technology |
|-------|-----------|
| Runtime | [Bun](https://bun.sh) |
| Language | TypeScript (strict mode) |
| Broker | IBKR TWS API via [`@stoqey/ib`](https://github.com/stoqey/ib) |
| AI | Claude API via [`@anthropic-ai/sdk`](https://github.com/anthropics/anthropic-sdk-typescript) |
| Database | SQLite via `bun:sqlite` + [Drizzle ORM](https://orm.drizzle.team) |
| Email | [Resend](https://resend.com) |
| Linting | [Biome](https://biomejs.dev) |

## Architecture

```
src/
  index.ts                    # Boot: DB migrate, IBKR connect, start scheduler
  config.ts                   # Zod-validated env config

  admin/
    server.ts                  # HTTP endpoint for ad-hoc job triggers (port 3847)

  agent/
    orchestrator.ts            # State machine: pre-market -> open -> wind-down -> post-market
    planner.ts                 # Claude agent loop with tool use
    tools.ts                   # Tools available to the trading agent
    prompts/
      trading-analyst.ts       # Main trading decision prompts
      risk-reviewer.ts         # Independent risk review prompt
      self-improvement.ts      # Weekly self-review prompt

  broker/
    connection.ts              # IBKR WebSocket connection management
    account.ts                 # Account summary, positions
    market-data.ts             # Quotes, historical bars
    orders.ts                  # Order placement and management
    contracts.ts               # LSE stock contract definitions

  db/
    client.ts                  # SQLite + Drizzle setup
    schema.ts                  # All table definitions
    seed.ts                    # Default risk config + exclusions
    migrate.ts                 # Migration runner

  learning/
    trade-reviewer.ts          # Daily post-market trade review (Claude)
    pattern-analyzer.ts        # Mid-week + end-of-week pattern analysis (Claude)
    context-builder.ts         # Builds learning briefs for trading context
    prompts.ts                 # Review and analysis system prompts

  research/
    pipeline.ts                # Orchestrates research across sources
    analyzer.ts                # Claude-powered stock analysis
    watchlist.ts               # Watchlist management and scoring
    sources/
      yahoo-finance.ts         # Quotes, fundamentals, dividends
      fmp.ts                   # Financial Modeling Prep data
      news-scraper.ts          # RSS news feeds

  reporting/
    email.ts                   # Resend email client
    metrics.ts                 # Performance calculations (P&L, Sharpe, drawdown)
    templates/
      daily-summary.ts         # Daily portfolio email
      weekly-summary.ts        # Weekly performance email
      trade-alert.ts           # Real-time trade notification

  risk/
    manager.ts                 # Pre-trade risk validation
    limits.ts                  # Hard-coded safety limits
    exclusions.ts              # Symbol/sector/SIC code exclusions

  scheduler/
    cron.ts                    # All cron job definitions
    jobs.ts                    # Job dispatcher

  self-improve/
    monitor.ts                 # Weekly performance review + PR proposals
    code-generator.ts          # Generates code changes from proposals
    github.ts                  # Creates PRs via Octokit

  utils/
    logger.ts                  # Pino structured logging
    clock.ts                   # LSE market hours and phase detection
    alert.ts                   # Critical alert emails
    rate-limiter.ts            # API rate limiting
    retry.ts                   # Retry with backoff
    token-tracker.ts           # Claude API token usage and cost tracking
```

## How It Works

### Daily Schedule (Mon-Fri, London time)

| Time | Job | Description |
|------|-----|-------------|
| 07:30 | Pre-market | Sync account, reconcile positions, generate day plan with learning brief |
| 07:00-16:00 | Orchestrator tick | Every 20 min: three-tier analysis (pre-filter -> Haiku scan -> Sonnet if needed) |
| 16:25-16:30 | Wind-down | No new orders |
| 16:35 | Post-market | Reconcile positions, record daily snapshot |
| 17:00 | Daily summary | Email with portfolio, P&L, trades, performance metrics, API costs |
| 17:15 | Trade review | Claude reviews each filled trade, extracts lessons and patterns |
| 17:30 (Fri) | Weekly summary | Week-over-week performance email |
| 18:00 | Research pipeline | Screen stocks (FMP), discover from news (Haiku), deep-analyse watchlist |
| 19:00 (Wed) | Mid-week analysis | Pattern analyzer identifies trends from accumulated trade reviews |
| 19:00 (Fri) | End-of-week analysis | Full pattern analysis feeding into Sunday self-improvement |
| 20:00 (Sun) | Self-improvement | Reviews performance + accumulated insights, proposes prompt changes via PR |

### Decision Flow

```
Cron Tick (every 20 min)
         |
  Code Pre-Filter (FREE)
  positions? orders? price moves? research signals?
         |
    [nothing changed] → skip
    [something to check] ↓
         |
  Haiku Quick Scan (~$0.02)
  "Does this need full analysis?"
         |
    [no] → log and skip
    [yes] ↓
         |
  Sonnet Trading Analyst (~$1.70)
  Full agentic loop with tool use
         |
     Proposes: BUY/SELL/HOLD/CANCEL
         |
    Risk Manager (code validation)
         |
     Order Execution (IBKR)
```

### Learning Pipeline

The agent learns from its own history through a structured feedback loop:

1. **Trade Reviewer** (daily 17:15) - Reviews each trade with its original reasoning, research context, and outcome. Produces structured assessments: outcome, reasoning quality, lesson learned, tags.

2. **Pattern Analyzer** (Wed + Fri 19:00) - Aggregates trade reviews and calculates:
   - Confidence calibration (win rate per confidence bucket)
   - Sector performance breakdown
   - Tag frequency in wins vs losses
   - Produces up to 5 actionable insights with severity levels

3. **Context Builder** - Injects accumulated insights into daily trading decisions:
   - Full learning brief for the pre-market day plan
   - Lighter recent context (warnings + recent lessons) for mini-analysis ticks

4. **Self-improvement** (Sun 20:00) - Receives accumulated insights + trade reviews alongside raw metrics, can propose prompt changes via GitHub PRs.

### Risk Management

Hard limits are defined in `src/risk/limits.ts` and enforced before every order:

- **Position sizing**: Max 5% of portfolio or GBP 500 per position
- **Stop losses**: Mandatory 3% stop on every trade
- **Daily circuit breaker**: Trading halts if daily loss exceeds 2%
- **Weekly loss limit**: 5% max weekly drawdown
- **Cash reserve**: Always maintain 20% cash
- **Diversification**: Max 30% exposure to any single sector
- **Quality filters**: No penny stocks (min GBP 0.10), min 50k avg volume
- **Auto-pause**: If win rate drops below 40% over 2 weeks, trading pauses and an alert email is sent

ISA constraints are also enforced: cash-only (no margin), long-only (no shorting), GBP/LSE only.

## Database

SQLite with Drizzle ORM. 12 tables:

| Table | Purpose |
|-------|---------|
| `trades` | All trade records with status, reasoning, PnL |
| `positions` | Current open positions with prices and stops |
| `daily_snapshots` | End-of-day portfolio snapshots |
| `watchlist` | Tracked stocks with scores and sectors |
| `research` | Analysis results per stock |
| `risk_config` | Configurable risk parameters |
| `exclusions` | Blocked symbols, sectors, SIC codes |
| `agent_logs` | All agent decisions and actions |
| `trade_reviews` | Post-trade analysis (outcome, reasoning quality, lessons) |
| `weekly_insights` | Pattern analysis insights with severity and actionability |
| `token_usage` | Claude API token counts and estimated costs per job |
| `improvement_proposals` | Self-improvement PR tracking |

Migrations run automatically on boot.

## Setup

### Prerequisites

- [Bun](https://bun.sh) v1.x
- [IBKR Trader Workstation](https://www.interactivebrokers.co.uk/en/trading/tws.php) or IB Gateway
- Claude API key
- Resend API key

### Local Development

```bash
# Install dependencies
bun install

# Create env file (see docker/.env.example)
cp docker/.env.example .env

# Generate and run migrations
bun run db:generate
bun run db:migrate

# Start with hot reload + pretty logs
bun run dev
```

### Docker (Production)

```bash
# Copy and configure env
cp docker/.env.example docker/.env
# Edit docker/.env with real credentials

# Build and start
docker compose -f docker/docker-compose.yml up -d
```

This starts two containers:
- **ib-gateway** - IB Gateway with VNC access (port 5900)
- **trader** - The trading agent

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `ANTHROPIC_API_KEY` | Yes | - | Claude API key |
| `RESEND_API_KEY` | Yes | - | Resend email API key |
| `ALERT_EMAIL_TO` | Yes | - | Email for alerts and reports |
| `ALERT_EMAIL_FROM` | No | `trader@updates.example.com` | Sender email |
| `IBKR_HOST` | No | `127.0.0.1` | IBKR TWS/Gateway host |
| `IBKR_PORT` | No | `4002` | IBKR API port |
| `IBKR_CLIENT_ID` | No | `1` | IBKR client ID |
| `CLAUDE_MODEL` | No | `claude-sonnet-4-5-20250929` | Claude model ID |
| `DB_PATH` | No | `./data/trader.db` | SQLite database path |
| `PAPER_TRADING` | No | `true` | Paper trading mode |
| `FMP_API_KEY` | No | - | Financial Modeling Prep key |
| `GITHUB_TOKEN` | No | - | For self-improvement PRs |
| `GITHUB_REPO_OWNER` | No | - | GitHub repo owner |
| `GITHUB_REPO_NAME` | No | `trader` | GitHub repo name |
| `LOG_LEVEL` | No | `info` | Pino log level |
| `NODE_ENV` | No | `development` | Environment |

## Commands

```bash
bun run dev           # Hot reload + pretty logs
bun run start         # Production start
bun run typecheck     # TypeScript type checking
bun run lint          # Biome lint + format check
bun run lint:fix      # Auto-fix lint issues
bun run db:generate   # Generate Drizzle migrations
bun run db:migrate    # Run migrations
bun run test          # Run tests
```

## Deployment

Pushes to `main` trigger a GitHub Actions workflow that:

1. Runs lint, typecheck, and tests
2. SSHs into the VPS
3. Pulls latest code
4. Rebuilds and restarts the Docker container

Migrations run automatically on container start.

## Monitoring

See [`docs/monitoring.md`](docs/monitoring.md) for live log commands, database queries, and the verification checklist.

Key commands:

```bash
# Live logs
docker compose -f docker/docker-compose.yml logs -f trader

# Database queries
docker compose -f docker/docker-compose.yml exec trader \
  bun -e "/* query here */"
```

Email reports are sent automatically:
- **Trade alerts** - Real-time on every fill
- **Daily summary** - Portfolio, P&L, trades, API costs
- **Weekly summary** - Week-over-week performance comparison
- **Critical alerts** - Crashes, disconnections, auto-pause events
