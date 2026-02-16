# Research & Learning System: Limitations Audit

**Date**: 2026-02-16 (Day 1 of live operation)
**Purpose**: Identify gaps between the intended self-evolving vision and the current implementation. To be revisited after 1 week of live data to form an improvement plan.

---

## 1. System Overview

### What exists today

| Component | Schedule | Purpose |
|---|---|---|
| `research_pipeline` | 18:00 weekdays | Universe screening, news fetch, deep analysis |
| `trade_review` | 17:15 weekdays | Claude reviews each filled trade for lessons |
| `pattern_analyzer` (mid-week) | 19:00 Wednesday | Finds patterns in trade reviews |
| `pattern_analyzer` (end-of-week) | 19:00 Friday | Same, end-of-week |
| `self_improvement` | 20:00 Sunday | Proposes code changes as PRs |

### What's connected

- **Data sources**: Yahoo Finance (quotes + fundamentals), FMP (profiles + fallback quotes), IBKR (historical bars), 8 RSS feeds (news)
- **Analysis**: Claude analyses each stock with quote + fundamentals + news + price history
- **Learning loop**: trade reviews -> pattern analysis -> weekly insights -> self-improvement PRs -> prompt/config changes

---

## 2. Critical Limitations

### 2.1 Universe Discovery is Broken

**The core problem**: `screenUKStocks()` does:
```typescript
const result = await yf.search("LSE stocks", { quotesCount: 50 });
```

This is a text search on Yahoo Finance for the literal string "LSE stocks". It returns the same ~50 mega-caps every time. There is no:
- Sector-based screening
- Market cap tiering (mid-cap, small-cap, AIM)
- Volume/momentum-based screening
- Fundamental filtering (P/E, growth, yield)
- Rotation or randomisation to explore different parts of the market

**Impact**: The watchlist is frozen at 10 FTSE 100 blue chips. The agent will never organically discover a mid-cap breakout, a sector rotation opportunity, or a compelling small-cap. The "thousands of LSE companies" are invisible.

**Additionally**: Discovery is capped at 5 new additions per pipeline run. Even if screening improved, the rate of exploration is very slow.

### 2.2 Research Pipeline Has Never Run

As of Day 1:
- `research` table: **0 rows**
- `watchlist.lastResearchedAt`: **NULL for all 10 symbols**
- No fundamentals, no sentiment scores, no bull/bear cases exist yet

The pipeline is scheduled for 18:00, so it will run tonight. But until it does, the trading agent is making decisions with zero research backing — purely from technical analysis of historical bars.

### 2.3 News Discovery is Passive, Not Proactive

The news scraper fetches from 8 RSS feeds but only **filters for symbols already on the watchlist**. It cannot:
- Discover new companies mentioned in news (e.g. "Rolls-Royce wins £2B defence contract" won't surface RR. unless it's already on the watchlist)
- Detect sector-wide themes (e.g. "UK housebuilders rally on interest rate cut") and map them to stocks
- React to breaking news between pipeline runs (pipeline only runs once at 18:00)
- Weight news by recency, source credibility, or market impact

The `SYMBOL_NAMES` mapping in the news scraper covers ~30 well-known tickers, but this is hardcoded and won't grow as the watchlist expands to less well-known companies.

### 2.4 Watchlist Scoring is Incomplete

The scoring formula in `updateScore()` uses only:
- Sentiment (30% weight)
- Confidence (20% weight)
- Action bonus (BUY=+20, WATCH=+5)

It ignores the declared weights for `fundamentalWeight` (25%), `momentumWeight` (15%), and `liquidityWeight` (10%) — these are defined in `SCORING_WEIGHTS` but never used in the calculation. Scores are therefore based entirely on the Claude analysis sentiment/confidence, not on actual fundamental or technical data.

**Also**: The current scores (60-80) appear to be seed values, not computed from research. They'll be overwritten once the pipeline runs, but right now they're meaningless.

### 2.5 Self-Improvement Scope is Narrow

The self-improvement system can only modify 4 files:
```
src/agent/prompts/trading-analyst.ts
src/agent/prompts/risk-reviewer.ts
src/agent/prompts/self-improvement.ts
src/research/watchlist.ts
```

It **cannot** modify:
- The screening function (`src/research/sources/yahoo-finance.ts`)
- The news scraper or its feed list
- The research pipeline logic
- Risk parameters in code (only prompt text and DB config)
- Its own discovery mechanisms

This means the agent can learn to trade better with what it knows, but it cannot learn to look harder or look differently. The exploration strategy is outside its reach.

### 2.6 Learning Loop Requires Trade Data That Doesn't Exist Yet

The learning components have minimum data requirements:
- **Trade review**: Needs filled trades with PnL — none exist yet
- **Pattern analyzer**: Needs >= 3 trade reviews — won't fire until multiple trades complete
- **Self-improvement**: Needs 2 weeks of trade data, reviews, and insights
- **Performance pause**: Needs >= 10 daily snapshots and >= 5 trades

The full feedback loop won't engage for at least 1-2 weeks assuming trades actually start filling. Until then, the agent is flying blind without any learning signal.

### 2.7 No Proactive Research Triggers

Research only runs on a fixed schedule (18:00 daily). There's no mechanism to:
- Research a stock that just appeared in breaking news
- Deep-dive on a stock where the price moved significantly
- Re-research a stock before placing an order (the agent trades on stale or non-existent research)
- Prioritise research on stocks the agent is actively considering buying

The trading agent (running every 5 mins) and the research pipeline (running once daily) are essentially decoupled. The agent doesn't request research; it just uses whatever stale data exists.

### 2.8 FMP Rate Limiting Constrains Discovery

FMP free tier is limited to 5 requests/minute. The `getFMPProfile()` call is used during discovery to get company info for new watchlist additions. With 5 new additions per session and rate limiting, this isn't a bottleneck now — but if screening improves to surface 50+ candidates, the rate limit will become a chokepoint.

### 2.9 Single-Threaded Job Execution

```typescript
if (jobRunning) {
    log.debug({ job: name }, "Skipping - previous job still running");
    return;
}
```

Only one job can run at a time. If the research pipeline takes 30 minutes (10 symbols x Claude analysis), it blocks all other jobs. Today the agent got stuck on a Claude API call for over an hour, blocking everything. There's no timeout or circuit breaker on the agent's Claude calls during analysis.

---

## 3. What's Actually Good

To be fair, the architecture has strong foundations:

- **Trade review -> pattern analysis -> self-improvement pipeline** is a genuine closed-loop learning system. Once trade data flows, this will produce real insights.
- **The self-improvement PR mechanism** is clever — the agent proposes changes but a human reviews them. Safe and auditable.
- **News scraper** covers 8 diverse sources with rate limiting and error handling.
- **Stock analyzer** uses Claude with structured JSON output — easy to extend.
- **Performance auto-pause** is a good safety net.
- **Exclusion system** (by symbol, sector, or SIC code) provides ethical/risk guardrails.

---

## 4. Gap Analysis: Vision vs Reality

| Intended Behaviour | Current Reality |
|---|---|
| Discover opportunities across the full LSE | Searches Yahoo for "LSE stocks", gets same 50 mega-caps |
| Reactively research stocks from news | Only filters news for existing watchlist symbols |
| Proactively identify sector rotations | No sector-level analysis or screening |
| Learn what types of stocks to look for | Self-improvement can't modify screening logic |
| Deepen research before trading | Trading agent doesn't trigger research; uses stale/no data |
| Adapt screening criteria from performance | Screening function is static, outside learning scope |
| Explore AIM, mid-caps, thematic plays | Yahoo search only surfaces large-caps |
| React to intraday news | Research runs once daily at 18:00 |

---

## 5. Data to Collect This Week

Before forming an improvement plan, we should observe:

1. **Does the research pipeline complete successfully tonight?** Check for errors, rate limits, and how long it takes for 10 symbols.
2. **Do any limit orders fill?** The agent has SHEL@2850p and DGE@1810p pending. If they fill, the trade review loop can start.
3. **What does the agent do with research data once it exists?** Does having sentiment/bull-bear cases change its trading decisions?
4. **How many Claude API tokens does each pipeline run consume?** Budget implications for scaling to 50+ symbols.
5. **Does the self-improvement job run on Sunday?** It needs trade data to be useful — with no trades, what does it propose?
6. **How stale does research get?** With 10 symbols and 1 run/day, each symbol gets refreshed daily. At 50 symbols it'd be every 5 days.
7. **Agent hang frequency** — did today's stuck Claude call indicate a systemic issue? Monitor for repeats.

---

## 6. Potential Improvement Areas (For Planning in 1 Week)

These are not proposals yet — just areas to explore based on the limitations above:

### Discovery & Screening
- Replace `yf.search()` with proper screener API (FMP `/stock-screener`, or Yahoo `screener` module)
- Screen by market cap tiers (large/mid/small), sector, and fundamental criteria
- Add AIM market coverage
- Rotate screening criteria to explore different corners of the market each day
- Allow the self-improvement system to influence screening parameters

### Proactive Research
- Let news drive discovery: scan all news for company mentions, add promising ones to watchlist
- Trigger research when price moves >3% on a watchlist stock
- Research before trading: agent requests research on a symbol before placing an order
- Intraday news check (lighter weight, more frequent than full pipeline)

### Watchlist Management
- Implement the unused scoring weights (fundamentals, momentum, liquidity)
- Auto-demote stale or underperforming watchlist entries
- Dynamic watchlist sizing (grow as the system proves itself)
- Sector diversity enforcement in the watchlist

### Learning Scope
- Add screening config files to the self-improvement allowed list
- Let pattern analysis influence which sectors/market caps to screen
- Store "what I wish I'd known" insights that feed back into discovery

### Resilience
- Add timeouts/circuit breakers on Claude API calls during jobs
- Allow concurrent non-conflicting jobs (e.g. research can run alongside reporting)
- Better monitoring: alert if research pipeline fails or produces no results

---

## 7. Questions to Answer Before Planning

1. How many stocks should the watchlist eventually hold? (20? 50? 100?)
2. Should we pay for better data APIs (FMP premium, or alternatives)?
3. How much Claude API budget per day is acceptable for research?
4. Should the agent be able to trade AIM stocks, or LSE Main Market only?
5. How much autonomy should the self-improvement system have over screening?
6. Should research be event-driven (news, price moves) or purely scheduled?
