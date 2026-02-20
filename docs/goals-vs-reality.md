# Goals vs Reality Analysis

> Generated 2026-02-16. Updated 2026-02-20 (Phase 1 deployed).
>
> Maps the stated project goals against current system capabilities and the gap resolution plan. Identifies what's covered, what's partially addressed, and what's missing entirely.

---

## Stated Goals

1. An agentic learning system that learns from its decisions
2. Notes down thinking behind each decision; reviews what was successful over time to build an evolving strategy
3. Weekly self-modification — agent has license to update its own code
4. Actively looking at news and stocks to inform decisions and predict outcomes
5. Respects exclusion lists and risk boundaries
6. Doesn't burn money — must generate enough to cover running costs
7. Paper trading now, real money later — there is a real goal it must succeed at
8. Aware of agentic coding principles — orchestrator pattern, sub-team pattern, effective agency
9. Expert trader — smart, aware of trading principles, has the entire wealth of the internet's knowledge

---

## Goal-by-Goal Assessment

### 1. Agentic learning system that learns from decisions

| Aspect                             | Status      | Detail                                                                                                                                                                                                                                     |
| ---------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Trade outcome reviews              | Working     | Trade reviewer analyses each filled trade daily (17:15)                                                                                                                                                                                    |
| Pattern recognition                | Working     | Mid-week and end-of-week pattern analysis extracts insights                                                                                                                                                                                |
| Learning brief injection           | Working     | Pre-market day plan includes last 5 insights + 5 lessons                                                                                                                                                                                   |
| Learning from inaction             | **Missing** | The agent logs "NO TRADES — all HOLD" every tick but these decisions are never reviewed. The trade reviewer only processes FILLED trades. Gap plan F1 adds CANCELLED/EXPIRED orders but still doesn't cover "chose not to trade" decisions |
| Learning from missed opportunities | **Missing** | If the agent passes on a stock that then rallies 10%, there's no mechanism to detect this and learn from it. No retrospective "what would have happened if I'd acted?" analysis                                                            |
| Feedback loop speed                | Slow        | Full loop is: trade → review (same day) → pattern analysis (Wed/Fri) → self-improvement (Sunday) → PR review (manual) → merge. Minimum 1 week from trade to applied learning. Often longer if PRs aren't reviewed                          |

**Gap plan coverage:** Partial. F1, F2, F4 improve the learning pipeline but don't address learning from inaction or missed opportunities.

**What's needed:** A "decision reviewer" that runs daily on ALL logged decisions (not just trades), scoring them against subsequent market data. "Agent said HOLD on GSK at 2180p. GSK is now 2300p. Was HOLD correct?"

---

### 2. Notes thinking, reviews success, builds evolving strategy

| Aspect             | Status   | Detail                                                                                                                                                                                                                      |
| ------------------ | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Decision logging   | Working  | Every tool call and final decision logged to `agent_logs` with reasoning                                                                                                                                                    |
| Thinking recorded  | Working  | Agent's `log_decision` tool captures detailed analysis                                                                                                                                                                      |
| Strategy evolution | **Weak** | The self-improvement system proposes prompt changes, but the actual "strategy" is just a static prompt ("look for pullbacks in uptrends, 5-10% targets, 3% stops"). There's no quantitative strategy that evolves from data |
| Success tracking   | Partial  | Win rate, Sharpe ratio, drawdown calculated in metrics. But not attributed to specific strategies or conditions                                                                                                             |

**Gap plan coverage:** A3 (day plan memory), H3 (inter-tick memory), A1 (intention tracking) help with continuity. But strategy evolution is not addressed.

**What's needed:** The agent needs a "strategy journal" — a living document of hypotheses ("momentum works in financials", "avoid buying after 3 consecutive up days") that gets updated based on evidence. The self-improvement system could modify this journal, and the trading prompt would reference it.

---

### 3. Weekly self-modification via code PRs

| Aspect                  | Status                | Detail                                                                                                            |
| ----------------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------- |
| PR creation             | Working               | Sunday 20:00 job proposes changes and creates PRs                                                                 |
| Scope                   | **Narrow**            | Can only modify 4 files: trading-analyst prompt, risk-reviewer prompt, self-improvement prompt, watchlist scoring |
| Cannot modify           | Listed                | Screening logic, news scraper, research pipeline, risk parameters, broker code, schema                            |
| PR review               | **Manual bottleneck** | PRs require human merge. Gap plan F3 adds staleness alerts but doesn't solve the delay                            |
| Code generation quality | Unknown               | Uses Sonnet to generate code changes. No automated testing of proposed changes before PR creation                 |

**Gap plan coverage:** F3 (PR staleness alerts) is the only improvement. Scope expansion is deferred.

**What's needed (short term):** Nothing — narrow scope is correct for safety during paper trading.

**What's needed (longer term):** Expand allowed files to include screening parameters, research pipeline configuration, and risk config. Add automated test runs on proposed changes before PR creation (run `bun test` on the branch). Consider auto-merge for prompt-only changes that pass tests.

---

### 4. Actively looking at news and stocks

| Aspect                    | Status      | Detail                                                                              |
| ------------------------- | ----------- | ----------------------------------------------------------------------------------- |
| Stock screening           | Working     | FMP screener with daily sector rotation, 5 new candidates/day                       |
| News scraping             | Working     | 8 RSS feeds, filtered for watchlist symbols                                         |
| News-driven discovery     | Working     | Haiku extracts tickers from unmatched headlines                                     |
| On-demand research        | Working     | `research_symbol` tool lets agent research before trading                           |
| Proactive news monitoring | **Missing** | News only checked during the 18:00 pipeline run. No intraday news awareness         |
| Earnings calendar         | **Missing** | Agent has no awareness of upcoming earnings, ex-dividend dates, or scheduled events |
| Macro awareness           | **Missing** | No interest rate data, GDP, inflation, or central bank calendar                     |
| Sector-level analysis     | **Missing** | Agent analyses stocks individually. No "financials sector is rotating in" awareness |

**Gap plan coverage:** E2 (dynamic news matching), E3 (research priority), E5 (score decay) improve the pipeline. Position Guardian adds real-time price alerts.

**What's needed:** An earnings/events calendar data source. A lightweight intraday news check (separate from the full 18:00 pipeline). Macro context injection into the trading prompt (even just "BOE rate decision tomorrow" level awareness).

---

### 5. Respects exclusion lists and risk boundaries

| Aspect               | Status               | Detail                                                                                                   |
| -------------------- | -------------------- | -------------------------------------------------------------------------------------------------------- |
| Symbol exclusions    | Working     | Checked during research discovery                                                                        |
| Sector exclusions    | Working     | Checked during research discovery                                                                        |
| Risk limits defined  | Working     | 12 hard limits in `HARD_LIMITS`                                                                          |
| Risk limits enforced | **Fixed**   | D1, D3, D4 all deployed Feb 20 — risk check mandatory inside `place_trade`, sector + volume enforced     |
| Stop-loss execution  | **Fixed**   | A4 — Guardian runs every 60s, places MARKET SELL when price breaches stop-loss                            |

**Status:** All gaps resolved and deployed (Feb 20). Trade gates enforce confidence >= 0.7, market phase, and full risk pipeline before any BUY order reaches IBKR.

---

### 6. Doesn't burn money — must cover running costs

| Aspect               | Status      | Detail                                                                                                                                                   |
| -------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cost tracking        | Working     | `token_usage` table, daily summary email includes API costs                                                                                              |
| Cost reduction       | Achieved    | Three-tier architecture reduced from ~$200/day to ~$6-18/day                                                                                             |
| Agent cost awareness | **Missing** | The agent doesn't know what it costs. It can't factor running costs into its decisions. It doesn't know "I need to make $174/month to break even"        |
| Revenue target       | **Missing** | No concept of a performance threshold tied to operating costs. The auto-pause checks win rate but not absolute P&L vs costs                              |
| Cost optimisation    | Partial     | G4 (accurate cost tracking) in the plan. But no mechanism to reduce costs during losing streaks (e.g., reduce tick frequency if the agent isn't trading) |

**Gap plan coverage:** G4 fixes cost tracking accuracy. Cost itself is well-managed by the tiered architecture. But cost-awareness for the agent is not addressed.

**What's needed:** Inject a "cost context" into the agent's prompt: "Today's API spend: $X. This month: $Y. You need to generate $Z/month in returns to justify your existence." This would make the agent cost-conscious — potentially avoiding expensive research_symbol calls when it's not going to trade, or being more decisive when opportunities appear.

---

### 7. Paper trading now, real money later

| Aspect                 | Status      | Detail                                                                                                                                                            |
| ---------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Paper trading mode     | Working     | `PAPER_TRADING=true` in env, uses paper account                                                                                                                   |
| Transition plan        | **Missing** | No documented criteria for when to switch to live trading                                                                                                         |
| Performance benchmarks | **Missing** | No target for "we go live when X" (e.g., positive P&L for 4 consecutive weeks, Sharpe > 1, drawdown < 5%)                                                         |
| Live trading safety    | Partial     | Risk limits would apply. But position sizes are currently calibrated for a £1M paper account — real ISA allowance is £20K/year                                    |
| Data continuity        | **Missing** | When switching from paper to live, all historical data (trades, reviews, insights) is from paper trading. Is it transferable? Different fills, different slippage |

**Gap plan coverage:** Not addressed. This is a future concern but needs thought before the switch happens.

**What's needed:** A "go-live checklist" document with performance criteria, account recalibration (£1M → actual balance), and a parallel-run period where the agent's paper decisions are compared against what would have happened live.

---

### 8. Aware of agentic coding principles

| Aspect                        | Status      | Detail                                                                                                                                                              |
| ----------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Orchestrator pattern          | Working     | State machine with phase detection, tiered escalation                                                                                                               |
| Sub-team / specialist pattern | **Missing** | Everything is a single Sonnet agent. No separation of concerns at the AI level (e.g., research analyst, risk analyst, portfolio manager as separate personas/calls) |
| Effective agency              | Partial     | Tool use is well-structured. But the agent often wastes iterations (22 tool calls to reach "NO TRADES"). No efficiency pressure                                     |
| Self-reflection               | **Missing** | Agent doesn't evaluate its own process quality. Doesn't ask "am I being thorough enough?" or "am I being too cautious?"                                             |
| Escalation / delegation       | Partial     | Haiku → Sonnet escalation exists. But Sonnet can't delegate sub-tasks (e.g., "research these 3 stocks in parallel then decide")                                     |

**Gap plan coverage:** Not addressed. The plan focuses on safety and plumbing, not agentic architecture improvements.

**What's needed:** Consider a multi-agent pattern for trading decisions:

- **Research analyst** (Haiku): "Here are the 3 best opportunities today and why"
- **Risk analyst** (Haiku): "Here are the risks with each and position sizing"
- **Portfolio manager** (Sonnet): "Given the research, risks, current portfolio, and today's plan — what do we do?"

This would be cheaper than the current single-Sonnet loop (two cheap Haiku calls + one focused Sonnet call with pre-digested context) and would produce better decisions through specialisation.

---

### 9. Expert trader with internet's knowledge

| Aspect                     | Status              | Detail                                                                                                                                            |
| -------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Trading knowledge in model | Available           | Claude has extensive financial knowledge in its training data                                                                                     |
| Prompted to use it         | **Weak**            | The system prompt says "look for pullbacks in uptrends" and "5-10% profit targets". This is a beginner-level strategy, not expert trading         |
| Technical analysis         | **Missing in code** | No computed indicators (RSI, MACD, Bollinger Bands, moving averages). Agent gets raw OHLCV bars and has to manually calculate. It usually doesn't |
| Fundamental analysis       | Partial             | Yahoo fundamentals are available (P/E, revenue growth, margins). But no DCF, no peer comparison, no relative valuation                            |
| Quantitative methods       | **Missing**         | No Kelly criterion for sizing, no volatility adjustment, no correlation analysis, no momentum scoring                                             |
| Market microstructure      | **Missing**         | No bid-ask spread analysis, no volume profile, no order book depth                                                                                |
| Multi-timeframe            | **Missing**         | Only daily bars available. No weekly trends, no intraday patterns                                                                                 |

**Gap plan coverage:** Not addressed at all. The plan fixes plumbing; this is about decision quality.

**What's needed:** This is the biggest gap between goals and reality. Options:

1. **Compute technical indicators in code** and inject them into the agent's context. RSI, 20/50/200 day moving averages, MACD, Bollinger Bands, ATR. These are cheap to compute (no AI cost) and would dramatically improve the data quality the agent reasons about.

2. **Enrich the trading prompt** with expert-level frameworks. Not "look for pullbacks" but "evaluate using a multi-factor model: trend (MA alignment), momentum (RSI regime), value (P/E vs sector median), quality (ROE, debt/equity), catalyst (news, earnings)."

3. **Add a quantitative scoring layer** that pre-computes a composite score for each watchlist stock using the indicators above. Feed this to the agent alongside the raw data. The agent then has both quantitative signals and qualitative analysis to work with.

---

## Summary Matrix

| Goal                        | Pre-Phase 1 | Post-Phase 1 (Feb 20) | Remaining Gap                                           |
| --------------------------- | ----------- | --------------------- | ------------------------------------------------------- |
| 1. Learning from decisions  | Partial     | Improved              | Learning from inaction, missed opportunities            |
| 2. Strategy evolution       | Weak        | Slightly improved     | No quantitative strategy, no strategy journal           |
| 3. Weekly self-modification | Working     | Working + alerts      | Scope narrow (by design for now)                        |
| 4. Active research          | Good        | Better                | No intraday news, no events calendar, no macro          |
| 5. Risk and exclusions      | Broken      | **Fixed**             | None                                                    |
| 6. Cost efficiency          | Good        | Better                | Agent not cost-aware                                    |
| 7. Paper → live transition  | Not planned | Not planned           | No criteria, no checklist, no recalibration             |
| 8. Agentic architecture     | Basic       | Basic                 | No multi-agent pattern, no self-reflection              |
| 9. Expert trading           | **Weak**    | **Weak**              | No indicators, no quantitative methods, beginner prompt |

## Priority Actions Beyond the Gap Plan

1. **Compute technical indicators** (RSI, MAs, MACD, ATR) and inject into agent context. Zero AI cost, high decision quality impact.
2. **Rewrite the trading prompt** as an expert multi-factor framework, not a beginner checklist.
3. **Add cost context** to the agent so it knows its running costs and break-even target.
4. **Add a "decision review" job** that scores ALL logged decisions (not just trades) against subsequent market data.
5. **Consider multi-agent architecture** for trading decisions: research analyst → risk analyst → portfolio manager.
6. **Document go-live criteria** with specific performance benchmarks.
