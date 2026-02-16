# Research & Learning System: Limitations Audit

**Date**: 2026-02-16 (Day 1 of live operation)
**Last updated**: 2026-02-16 (end of Day 1)
**Purpose**: Identify gaps between the intended self-evolving vision and the current implementation. To be revisited after 1 week of live data to form an improvement plan.

---

## 1. System Overview

### What exists today

| Component | Schedule | Purpose |
|---|---|---|
| `orchestrator_tick` | Every 20 min (7-16 Mon-Fri UK) | Main trading agent loop (Sonnet) |
| `research_pipeline` | 18:00 weekdays | Universe screening, news fetch, deep analysis |
| `trade_review` | 17:15 weekdays | Claude reviews each filled trade for lessons |
| `pattern_analyzer` (mid-week) | 19:00 Wednesday | Finds patterns in trade reviews |
| `pattern_analyzer` (end-of-week) | 19:00 Friday | Same, end-of-week |
| `self_improvement` | 20:00 Sunday | Proposes code changes as PRs |

### What's connected

- **Data sources**: Yahoo Finance (quotes + fundamentals), FMP (profiles + fallback quotes + stock screener), IBKR (historical bars + order execution), 8 RSS feeds (news)
- **Analysis**: Claude analyses each stock with quote + fundamentals + news + price history
- **Learning loop**: trade reviews -> pattern analysis -> weekly insights -> self-improvement PRs -> prompt/config changes
- **Ad-hoc job trigger**: HTTP endpoint on port 3847 allows manual triggering of any job

---

## 2. Limitations — Status Tracker

### 2.1 Universe Discovery ~~is Broken~~ — FIXED

**Status**: Resolved (2026-02-16)

**What was wrong**: `screenUKStocks()` used `yf.search("LSE stocks")` — a text search returning the same ~50 mega-caps every time.

**What was done**:
- Replaced with FMP `/company-screener` endpoint (`screenLSEStocks()` in `src/research/sources/fmp.ts`)
- Screens by exchange (LSE), country (GB), market cap, volume, and sector
- Rotates criteria daily: Mon=Technology, Tue=Healthcare, Wed=small-caps, Thu=Financial Services, Fri=Consumer Cyclical
- Adds up to 5 new stocks per pipeline run

**Remaining gaps**:
- Only covers sectors in the rotation schedule — other sectors (Energy, Industrials, Utilities, etc.) are not screened
- No AIM-specific screening yet
- Discovery rate (5/day) is slow; watchlist will take weeks to diversify meaningfully
- FMP free tier rate limit (5 req/min) constrains throughput

### 2.2 Research Pipeline ~~Has Never Run~~ — FIXED

**Status**: Resolved (2026-02-16)

Research pipeline has been manually triggered and verified. The `research` table now has entries for all 10 watchlist symbols. Pipeline completes in ~73 seconds for 10 symbols using Haiku for analysis.

### 2.3 News Discovery ~~is Passive~~ — PARTIALLY FIXED

**Status**: Partially resolved (2026-02-16)

**What was done**:
- Added `discoverFromNews()` stage in the research pipeline
- After fetching news, unmatched articles are batched and sent to Haiku to extract company names/tickers
- Discovered tickers are verified via FMP profile before adding to watchlist (max 3 per run)

**Remaining gaps**:
- Still only runs during the 18:00 pipeline — no intraday news reaction
- No sector-wide theme detection (e.g., "UK housebuilders rally" doesn't map to individual stocks)
- No news weighting by recency, source credibility, or market impact
- The `SYMBOL_NAMES` mapping in the news scraper is still hardcoded for ~30 tickers

### 2.4 Watchlist Scoring is Incomplete

**Status**: Not yet addressed

The scoring formula in `updateScore()` uses only sentiment (30%), confidence (20%), and action bonus. The declared weights for `fundamentalWeight` (25%), `momentumWeight` (15%), and `liquidityWeight` (10%) are defined but never used.

### 2.5 Self-Improvement Scope is Narrow

**Status**: Not yet addressed (waiting for trade data)

The self-improvement system can only modify 4 files. It cannot modify screening logic, news scraper, research pipeline, or risk parameters in code.

### 2.6 Learning Loop Requires Trade Data

**Status**: Not yet addressed (waiting for trades to fill)

The learning components need filled trades with PnL. The full feedback loop won't engage for at least 1-2 weeks.

### 2.7 ~~No Proactive Research Triggers~~ — FIXED

**Status**: Resolved (2026-02-16)

**What was done**:
- Added `research_symbol` tool to the agent's toolset
- The agent can now request fresh research on any symbol before trading (runs full pipeline: Yahoo quote + fundamentals + IBKR bars + Claude analysis)
- Updated the system prompt to instruct the agent to always research before trading and to use `research_symbol` when data is stale (>24h) or missing

**Also added**:
- `cancel_order` tool — the agent can now cancel pending orders (was previously logging cancel recommendations but couldn't act on them)
- Admin HTTP endpoint (`POST /jobs/:name` on port 3847) for manual job triggering via SSH

### 2.8 FMP Rate Limiting Constrains Discovery

**Status**: Observed, not yet addressed

FMP free tier (5 req/min) causes 429 errors when multiple pipeline runs happen in quick succession. The rate limiter in code is set to 5/min but doesn't account for requests across restarts or concurrent jobs. On Day 1, heavy testing exhausted the daily quota. This will be less of an issue with scheduled-only runs.

### 2.9 Single-Threaded Job Execution

**Status**: Not yet addressed

Only one job can run at a time. Long-running agent ticks (~4 minutes each) block other jobs.

---

## 3. What's Actually Good

- **Trade review -> pattern analysis -> self-improvement pipeline** is a genuine closed-loop learning system
- **The self-improvement PR mechanism** is clever — agent proposes changes, human reviews
- **News scraper** covers 8 diverse sources with rate limiting and error handling
- **Stock analyzer** uses Claude with structured JSON output — easy to extend
- **Performance auto-pause** is a good safety net
- **Exclusion system** (by symbol, sector, or SIC code) provides ethical/risk guardrails
- **Ad-hoc job trigger** allows manual intervention without restarting the container
- **On-demand research** lets the agent gather data before making decisions

---

## 4. Gap Analysis: Vision vs Reality (Updated)

| Intended Behaviour | Day 1 Start | Day 1 End |
|---|---|---|
| Discover opportunities across the full LSE | Yahoo text search, same 50 mega-caps | FMP screener with sector rotation and market cap tiers |
| Reactively research stocks from news | Only filtered for existing symbols | Haiku extracts tickers from unmatched headlines |
| Proactively identify sector rotations | No sector-level analysis | Daily sector rotation in screener; no intraday sector analysis yet |
| Learn what types of stocks to look for | Self-improvement can't modify screening | Not yet addressed |
| Deepen research before trading | Agent used stale/no data | Agent has `research_symbol` tool for on-demand research |
| Adapt screening criteria from performance | Screening was static | Not yet addressed |
| Explore AIM, mid-caps, thematic plays | Yahoo only surfaced large-caps | FMP screener includes small-caps on Wednesdays |
| React to intraday news | Research ran once daily | News discovery in pipeline; no intraday trigger yet |
| Cancel orders when analysis changes | Agent logged recommendations but couldn't act | `cancel_order` tool added |

---

## 5. Data to Collect This Week

1. ~~Does the research pipeline complete successfully?~~ **Yes** — 73s for 10 symbols, Haiku analysis
2. **Do any limit orders fill?** Agent is recommending cancelling SHEL and DGE orders — monitor whether it does so with the new `cancel_order` tool
3. ~~What does the agent do with research data?~~ **Reviewed research, decided HOLD on all stocks** — conservative approach
4. **How many Claude API tokens does each pipeline run consume?** Need to monitor `token_usage` table
5. **Does the self-improvement job run on Sunday?** Ran on Day 1 Sunday but with no trade data — monitor next Sunday
6. **Does the FMP screener discover new stocks?** Verify tomorrow when rate limits reset
7. **Does news-driven discovery surface new tickers?** Haiku found 2 on first run but FMP rate-limited verification
8. **Does the agent use `research_symbol` before trading?** Monitor agent logs this week

---

## 6. Future Improvements

### Ready to implement (low risk, high value)

- **Lightweight intra-tick monitoring**: Add a cheap, non-Claude job that checks stop losses and significant price moves between orchestrator ticks (was `mini_analysis`, removed because it was a duplicate full Sonnet loop; should be reimplemented as a simple price-check without Claude)
- **Expand sector rotation**: Add Energy, Industrials, Utilities, Materials, Real Estate to the screening schedule
- **Price-triggered research**: Auto-research when a watchlist stock moves >3% intraday
- **Increase discovery cap**: Raise from 5 screener + 3 news additions per run as watchlist proves stable

### Wait for data (1-2 weeks)

- **Watchlist scoring**: Implement the unused fundamental/momentum/liquidity weights once we have research data to validate against
- **Self-improvement scope expansion**: Add screening config files to the allowed list once we understand which parameters matter
- **Learning loop tuning**: Needs filled trades and reviews before we can assess what to improve
- **Concurrent job execution**: Measure actual job contention before adding complexity

### Longer-term exploration

- **Event-driven research**: WebSocket news feed or polling for breaking news during market hours
- **Sector-level analysis**: Aggregate research by sector to detect rotation opportunities
- **Auto-demote watchlist entries**: Remove stale or consistently underperforming symbols
- **FMP premium tier**: If free tier rate limits prove constraining at scale

---

## 7. Questions to Answer Before Next Planning Session

1. How many stocks should the watchlist eventually hold? (20? 50? 100?)
2. Should we pay for FMP premium ($29/mo) for higher rate limits?
3. How much Claude API budget per day is acceptable for research?
4. Should the agent be able to trade AIM stocks, or LSE Main Market only?
5. How much autonomy should the self-improvement system have over screening?
6. What's the right frequency for the orchestrator tick once research is flowing?
