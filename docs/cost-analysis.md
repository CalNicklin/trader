# API Cost Analysis — Feb 27, 2026

## The Problem

On Friday Feb 27, the system consumed **8 million tokens** and cost **$9.39** on the Anthropic API ($9.33 Sonnet, $0.06 Haiku) in a single trading day. At this rate, the monthly API bill would be ~$200 — unsustainable for a system managing a £1k ISA.

Our internal cost tracking reported $4.25, accounting for only ~3.4M of the 8M tokens. The remaining ~4.6M tokens are invisible to us, likely consumed by SDK retries that Anthropic bills for but our code never sees.

## How the System Works

The orchestrator runs a tick every 10 minutes during market hours (08:00–21:00 UK, weekdays only). Each tick has three tiers:

1. **Tier 1 — Pre-filter** (no AI, free): Gathers quotes, positions, pending orders, recent research. Flags anything "notable" — open positions, price moves >2%, actionable BUY/SELL signals.

2. **Tier 2 — Quick Scan** (Haiku, ~$0.002/call): Sends market state to Claude Haiku. Haiku decides whether to escalate to full analysis. If no, the tick ends here.

3. **Tier 3 — Trading Analyst** (Sonnet agentic loop, $0.25–0.44/call): Launches a multi-turn Claude Sonnet session with 15+ tools. Runs up to 10 iterations, each re-sending the full conversation history. This is where the money goes.

## Where the Tokens Go

Each Tier 3 session works like this:

- **Iteration 1**: Sonnet reads the context (~10K tokens of system prompt + tools + market state), calls 2-3 tools (get_watchlist, get_recent_trades, get_quote). Results added to conversation.
- **Iteration 2**: Sonnet re-reads everything from iteration 1 (via cache) plus new tool results. Calls more tools.
- **Iterations 3–7+**: Sonnet analyses data, writes long `log_decision` entries, checks risk, attempts trades.
- **Iteration 8–10**: Either gives a final response or hits the 10-iteration cap.

Every iteration re-sends the **entire conversation history** to the API. By iteration 7, this is a large payload. The cost per iteration breaks down as:

| Token type | Rate (Sonnet) | What it is |
|-----------|--------------|-----------|
| Cache writes | $3.75/MTok | New content added each iteration (tool results, assistant messages) |
| Cache reads | $0.30/MTok | Previously-sent content re-read from cache |
| Non-cached input | $3.00/MTok | Tokens after the last cache breakpoint |
| Output | $15.00/MTok | Sonnet's responses (tool calls, decision essays) |

Cache writes dominate the bill because every iteration adds new tool results and assistant responses to the conversation, and these must be written to cache at 1.25× the base input rate.

## What Happened on Feb 27

The Sonnet analyst was triggered on **every single tick** — 20 consecutive escalations across 6 hours. The cause was a feedback loop:

### The Phantom Positions

The positions table contained three phantom short positions (DGE -2200, SGRO -5000, TSCO -8000) left over from duplicate sell orders on previous days. These are impossible in an ISA account (long-only). They were not real positions but the system couldn't distinguish them from real data.

### The Escalation Loop

Every 10 minutes:

1. **Tier 1** flags: "5 open positions to monitor" + "Actionable research: ULVR BUY 0.78, SHEL BUY 0.78"
2. **Tier 2** (Haiku) sees illegal short positions + high-confidence unactioned BUY signals → escalates
3. **Tier 3** (Sonnet) runs 7–10 iterations:
   - Discovers phantom shorts, writes 500-word ISA compliance warning
   - Attempts corrective BUY orders to close the shorts
   - Orders rejected by trade gates (rate limit or max positions reached)
   - Analyses SHEL and ULVR BUY signals, decides to PASS (at 52-week highs, earnings risk)
   - Writes detailed decision essays for each symbol
   - Hits max iterations without resolving the underlying data issue
4. **Nothing changes.** Positions table still shows phantom shorts. BUY signals still unactioned.
5. **10 minutes later**, identical cycle begins again from step 1.

### The Numbers

| Metric | Value |
|--------|-------|
| Orchestrator ticks | ~39 (08:00–14:20 when credits exhausted) |
| Quick scans (Haiku) | 38 calls, $0.06 total |
| Trading analyst sessions (Sonnet) | 12 completed, ~8 more failed (credit exhaustion) |
| Average iterations per session | 8.2 |
| Average tool calls per session | 16.8 |
| Total tokens (Anthropic-reported) | ~8,000,000 |
| Total tokens (our tracking) | ~3,400,000 |
| Untracked tokens (SDK retries) | ~4,600,000 |
| Actual cost | $9.39 |
| Tracked cost | $4.25 |

### Cost Attribution

| Component | Est. Cost | % of Total |
|-----------|----------|-----------|
| Cache writes (new content per iteration) | ~$6.90 | 74% |
| Sonnet output (decisions, tool calls) | ~$1.13 | 12% |
| Cache reads (re-sent context) | ~$0.80 | 8% |
| Non-cached input | ~$0.50 | 5% |
| Haiku (quick scan) | ~$0.06 | 1% |

## Why Caching Doesn't Fix This

Prompt caching (deployed the same day) reduces the cost of re-reading previous content within an agentic session — cache reads cost $0.30/MTok instead of $3.00/MTok. This helps, but cannot address:

- **Cache writes**: Every iteration adds new tool results and assistant responses. These must be written to cache at $3.75/MTok. This is the single largest cost component.
- **Output tokens**: Sonnet generates verbose decision essays at $15/MTok. The agent wrote ~75K output tokens across 12 sessions.
- **The loop itself**: If the agent escalates to Sonnet for the same unresolvable issue every tick, no amount of caching makes that cheap. The problem isn't token efficiency — it's that the expensive path runs too often.

## Why Our Cost Tracking Is Wrong

Our `recordUsage` function captures `response.usage` from the Anthropic SDK after each successful API call. However:

1. **SDK retries are invisible**: The `@anthropic-ai/sdk` automatically retries on HTTP 429 (rate limit), 500, and 529 errors. Each retry re-sends the full request and Anthropic bills for the tokens processed. We only see the final successful response's usage.

2. **Failed sessions are untracked**: If the agentic loop throws an error partway through (e.g. credit exhaustion on iteration 5 of 10), the iterations that completed successfully were billed by Anthropic, but `recordUsage` only runs after the full session completes.

This explains the 2.2× gap between tracked ($4.25) and actual ($9.39) costs.

## Key Observations

- **Trading analyst is 99% of the cost.** Haiku quick scans cost $0.06/day. Research costs $0.46/day. The Sonnet agentic loop costs $8.87/day.
- **The agent escalates on every tick when positions exist.** The combination of "positions to monitor" + "actionable research signals" means Haiku almost always says escalate.
- **Identical analysis repeats every 10 minutes.** The agent discovers the same issues, writes the same warnings, attempts the same trades, and fails in the same way — 20 times in a row.
- **Retries double the real cost.** The rapid-fire agentic loop (multiple API calls seconds apart) likely triggers rate limiting, causing retries that are billed but invisible to us.
- **10 iterations is excessive for routine ticks.** Most sessions hit the max iteration cap without reaching a clean conclusion, suggesting the agent is doing too much per tick.
