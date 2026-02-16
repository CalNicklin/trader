# Verdict: Can This System Achieve Its Goals?

> Assessment of the 9 stated goals against the current system + gap resolution plan. Honest evaluation of what's achievable, what's not, and what the critical path looks like.

---

## TL;DR

The gap resolution plan fixes the **plumbing** — risk enforcement, stop losses, operational reliability. That's necessary but not sufficient. The system's actual weakness is **trading intelligence**: a beginner-level strategy prompt, no computed indicators, and an agent that flies blind on technical analysis. No amount of safety plumbing makes a bad strategy profitable.

The system is well-engineered infrastructure wrapped around a weak trading brain. The infrastructure is ~85% there after the gap plan. The brain is ~30% there.

---

## Goal-by-Goal Verdict

### Goal 5: Risk and exclusions — WILL BE ACHIEVED

The gap plan fully solves this. D1 (enforced risk gate), D3/D4 (sector + volume checks wired in), A4 (stop-loss execution via Guardian), A2/A5 (confidence + wind-down enforcement). After implementation, every defined limit is enforced in code, not just prompts.

**Confidence: 95%.** This is the strongest part of the plan.

---

### Goal 3: Weekly self-modification — ACHIEVED (with known limitation)

Working today. Sunday job proposes changes, creates PRs. The scope is deliberately narrow (prompts + scoring weights) which is correct during paper trading. F3 adds staleness alerts for unreviewed PRs.

The limitation is real — PRs require manual merge, so the loop has human latency. But this is a feature, not a bug, while the agent is learning. The scope can expand once there's confidence in the agent's judgment.

**Confidence: 85%.** Works as designed. The manual merge bottleneck is the right trade-off for now.

---

### Goal 6: Cost efficiency — MOSTLY ACHIEVED

Three-tier architecture already keeps costs in the $6–18/day range. Gap plan adds accurate cost tracking (G4). The infrastructure is cost-efficient.

The missing piece — agent cost-awareness — is a small addition. Inject monthly API spend and a break-even target into the trading context. This is ~50 tokens of extra context, effectively free.

But there's a harder truth: at $174/month typical costs, the agent needs to generate ~£140/month (~£1,680/year) in profit just to break even. On a £20K ISA, that's an 8.4% annual return just to cover API costs. That's achievable but not trivial — it's roughly the long-term equity market average. The agent needs to be *good*, not just functional.

**Confidence: 70%.** Costs are managed. Whether returns cover them depends entirely on trading intelligence (Goal 9).

---

### Goal 4: Active research — MOSTLY ACHIEVABLE

Good foundation. FMP screening, 8 RSS feeds, news-driven discovery, on-demand research tool. Gap plan improves matching (E2), priority (E3), and decay (E5).

The missing pieces (intraday news, earnings calendar, macro context) are additive — they don't require architectural changes. An earnings calendar is a data source addition. Intraday news is a second pipeline run. Macro context is a few lines injected into the prompt.

These are worth doing but they're enhancements, not blockers. The system can trade adequately without knowing about BOE rate decisions. It just can't trade *expertly*.

**Confidence: 75%.** Solid foundation, gaps are tractable.

---

### Goal 1: Learning from decisions — PARTIALLY ACHIEVABLE

The existing loop (trade review → pattern analysis → learning brief → day plan) works for *trades that happen*. The gap plan extends this to cancelled/expired orders (F1) and improves brief quality (F4).

Two significant holes remain:

**Learning from inaction.** The agent says "HOLD" 90%+ of the time. These decisions are never reviewed. If the agent passes on a stock that rallies 15%, it never learns "I should have been more aggressive." Conversely, if it correctly avoids a stock that drops, it never gets positive reinforcement for good avoidance.

**Missed opportunity detection.** No mechanism compares "what the agent decided" against "what actually happened." This is the foundation of any backtesting or strategy improvement system.

Both of these are solvable. A "decision scorer" job that runs daily:
1. Pull all HOLD/WATCH decisions from `agent_logs` where level = DECISION
2. For each, get the stock's price movement over the next 1–5 days
3. Score: was the inaction correct? (Stock flat/down = good HOLD. Stock up 5%+ = missed opportunity)
4. Feed into the existing pattern analysis pipeline

This would be a Haiku call per scored decision. Maybe 5–10 decisions/day at $0.02 each = $0.10–0.20/day. Not free, but the learning value is high.

**Confidence: 55%.** The loop works for trades but is blind to 90%+ of the agent's decisions. The decision scorer closes this gap affordably.

---

### Goal 2: Strategy evolution — NOT YET ACHIEVABLE

This is the gap between "records what happened" and "evolves how it thinks."

The current system has a static trading philosophy baked into the prompt: "look for pullbacks in uptrends, 5-10% targets, 3% stops." The self-improvement system can modify prompt wording, but it has no mechanism to say "momentum stopped working in financials this quarter, switch to mean reversion" based on data.

What's needed is a **strategy journal** — a structured document the agent maintains:

```
Strategy hypotheses:
  1. "Momentum works well in technology sector"
     Evidence: 8/12 wins (67%) in tech momentum trades
     Status: ACTIVE

  2. "Avoid buying after 3+ consecutive green days"
     Evidence: 2/7 wins (29%) in extended rally entries
     Status: CONFIRMED — incorporated into decision framework

  3. "Healthcare has poor risk/reward in February"
     Evidence: 1/4 wins, avg loss 2x avg win
     Status: MONITORING — small sample
```

The self-improvement system would update this journal weekly based on pattern analysis data. The trading prompt would reference it. This creates a structured feedback loop between observed results and decision-making.

Implementation is moderate: a new DB table (`strategy_hypotheses`), a section in the pattern analysis prompt that proposes hypothesis updates, and inclusion of active hypotheses in the trading context. Cost is near-zero since it piggybacks on existing analysis jobs.

**Confidence: 35%.** The infrastructure for learning exists but doesn't produce strategy evolution yet. The strategy journal is the missing link.

---

### Goal 8: Agentic architecture — PARTIALLY ACHIEVABLE

The orchestrator pattern works well. The three-tier escalation is smart. The tool-use loop is functional.

The goals-vs-reality doc correctly identifies that it's a single-agent architecture. One Sonnet agent does everything: research assessment, risk evaluation, portfolio thinking, and trade execution. This creates two problems:

1. **Wasted iterations.** The agent often makes 10+ tool calls before concluding "no action." It researches, checks risk, gets quotes, and then decides to hold — spending $1.70 to say "nothing to do."

2. **No specialisation.** The same prompt tries to be a research analyst, risk manager, and portfolio manager simultaneously. Jack of all trades.

The multi-agent pattern proposed in the goals doc is the right direction:

```
Current:  Sonnet (all-in-one, 10 tool iterations, ~$1.70)

Proposed: Haiku (research brief, 1 call, ~$0.02)
          → Haiku (risk assessment, 1 call, ~$0.02)
          → Sonnet (portfolio decision, 1-3 tool calls, ~$0.50-0.80)
```

Two cheap Haiku calls pre-digest the research and risk context. Sonnet gets a focused brief and makes a decision in fewer iterations. Total cost per escalation drops from ~$1.70 to ~$0.55–0.85, and decision quality improves because each model gets a focused task.

This is a meaningful refactor of `src/agent/planner.ts` and the prompt structure, but it doesn't change the broader architecture. The orchestrator, guardian, scheduler, and risk system are all unchanged.

**Confidence: 60%.** The current architecture is decent. Multi-agent would be better and cheaper, but it's an optimisation, not a blocker.

---

### Goal 7: Paper → live transition — NOT ADDRESSED

No go-live criteria exist. No documented benchmarks. No recalibration plan for real account sizes.

This is a documentation and planning task, not an engineering one. It needs:

1. **Performance criteria:** e.g., "Positive P&L for 8 of the last 12 weeks, Sharpe > 0.8, max drawdown < 8%, minimum 50 trades completed"
2. **Account recalibration:** Paper account is £1M, real ISA is £20K/year. Position sizing, cash reserves, and risk limits need recalculating
3. **Parallel period:** Run paper and live simultaneously for 2 weeks, compare fills and slippage
4. **Rollback plan:** If live performance diverges from paper by >X%, auto-pause and revert

Not urgent during paper trading, but should be documented before any live transition is considered.

**Confidence: N/A.** Not a technical problem. Needs a document and decision criteria.

---

### Goal 9: Expert trader — NOT ACHIEVABLE IN CURRENT STATE

This is the hardest truth. The system has expert-grade infrastructure wrapped around a novice trading brain.

**What an expert trader has that this agent doesn't:**

| Capability | Status | Impact |
|-----------|--------|--------|
| Technical indicators (RSI, MACD, MAs, Bollinger, ATR) | Not computed | Agent can't identify overbought/oversold, trend strength, volatility regime |
| Multi-timeframe analysis | Only daily bars | Can't see weekly trend context or intraday momentum |
| Relative valuation | No peer comparison | Can't say "this is cheap vs sector" — only "P/E is 15" in isolation |
| Volatility-adjusted sizing | Not implemented | Every trade gets same risk regardless of stock volatility |
| Correlation awareness | Not implemented | Could load up on 5 correlated stocks thinking it's diversified |
| Market regime detection | Not implemented | Same strategy in bull markets, bear markets, and sideways chop |
| Earnings/events awareness | Not implemented | Buys before earnings with no idea it's happening |
| Bid-ask spread analysis | Not implemented | Could buy illiquid stocks with 5% spreads |

**What this means concretely:** The agent gets raw OHLCV bars and a Yahoo fundamentals dump. It has to manually reason about whether a stock is in an uptrend, whether RSI is overbought, whether the moving average is supportive. It usually doesn't — it sees numbers and makes a gut call based on its training data. That's not expert trading; it's LLM pattern matching on raw data.

**The fix is not expensive.** Computing technical indicators is pure math — zero AI cost:

```
For each symbol in context:
  Compute from historical bars:
    - RSI(14)
    - SMA(20), SMA(50), SMA(200) + alignment
    - MACD(12,26,9) + signal line
    - Bollinger Bands(20,2) + %B position
    - ATR(14) for volatility-adjusted sizing
    - Volume trend (20-day avg vs current)

  Inject as structured data:
    "SHEL: RSI=62 (neutral), Price>SMA50>SMA200 (uptrend aligned),
     MACD bullish crossover 3 days ago, ATR=45p (2.1% of price),
     Volume 120% of 20d avg"
```

This is ~20 lines of code per indicator, using the daily bars already fetched. It adds ~100 tokens per symbol to the context but transforms the agent from "looking at raw numbers" to "looking at analysed signals." The prompt then needs rewriting to reference these signals in a multi-factor framework instead of "look for pullbacks in uptrends."

**Confidence: 25% currently. 65% with indicators + prompt rewrite.** The infrastructure is there but the analytical layer is missing. Adding it is straightforward and cheap, but it's a meaningful block of work.

---

## Overall Achievability

| Goal | Confidence | Blocker |
|------|-----------|---------|
| 5. Risk & exclusions | 95% | None — gap plan covers it |
| 3. Self-modification | 85% | Manual PR review (by design) |
| 4. Active research | 75% | Missing data sources (tractable) |
| 6. Cost efficiency | 70% | Returns must cover $174/mo (depends on Goal 9) |
| 8. Agentic architecture | 60% | Single-agent pattern (optimisation, not blocker) |
| 1. Learning from decisions | 55% | Blind to inaction (decision scorer needed) |
| 2. Strategy evolution | 35% | No strategy journal or hypothesis testing |
| 9. Expert trading | 25% | No indicators, beginner prompt, no quant methods |
| 7. Paper → live | N/A | Needs criteria document |

**Weighted overall: ~55%.** The system will be operationally sound after the gap plan, but won't reliably generate returns.

---

## Critical Path to Success

The goals are not equally important. There's a dependency chain:

```
                     ┌──────────────────────────────────┐
                     │ FOUNDATION (Gap Resolution Plan)  │
                     │ Risk enforcement, stop losses,    │
                     │ operational reliability            │
                     │ Status: Planned, ready to build   │
                     └──────────────┬───────────────────┘
                                    │
                     ┌──────────────▼───────────────────┐
                     │ TRADING INTELLIGENCE              │
                     │ Technical indicators, expert       │
                     │ prompt, volatility sizing          │
                     │ Status: Not started               │
                     └──────────────┬───────────────────┘
                                    │
              ┌─────────────────────┼─────────────────────┐
              │                     │                     │
   ┌──────────▼──────────┐  ┌──────▼──────────┐  ┌──────▼──────────┐
   │ LEARNING DEPTH      │  │ MULTI-AGENT     │  │ COST-AWARENESS  │
   │ Decision scorer,    │  │ Research/Risk/  │  │ Break-even      │
   │ strategy journal    │  │ Portfolio split  │  │ injection       │
   │ Status: Not started │  │ Status: Future  │  │ Status: Trivial │
   └─────────┬───────────┘  └──────┬──────────┘  └──────┬──────────┘
             │                     │                     │
             └─────────────────────┼─────────────────────┘
                                   │
                     ┌─────────────▼───────────────────┐
                     │ GO-LIVE READINESS                │
                     │ Criteria doc, recalibration,     │
                     │ parallel period                  │
                     │ Status: Future                   │
                     └─────────────────────────────────┘
```

### Phase 1: Foundation (Gap Resolution Plan)

What: Implement all 29 fixes from the gap resolution plan.
Why: Can't trade safely without enforced risk checks and stop losses.
Cost: ~$1.50/month additional.
Effort: Medium. Mostly wiring up existing code.
**This is table stakes. Do this first.**

### Phase 2: Trading Intelligence

What: Three workstreams, all zero AI cost.

**2a. Technical indicator engine.** Compute RSI, MAs, MACD, Bollinger, ATR from existing daily bars. Inject into agent context as structured signals. ~200 lines of pure math code in a new `src/analysis/indicators.ts`.

**2b. Expert prompt rewrite.** Replace "look for pullbacks in uptrends, 5-10% targets" with a multi-factor evaluation framework:
- Trend: MA alignment + price position
- Momentum: RSI regime + MACD signal
- Value: P/E vs sector median (requires sector P/E data)
- Quality: ROE, debt/equity, margin trend
- Catalyst: Recent news, earnings proximity
- Volatility: ATR-based position sizing (replace fixed 3% stop with ATR-multiple stop)

**2c. Volatility-adjusted sizing.** Use ATR to set stop distances and position sizes instead of a fixed 3% stop and 5% position cap. A volatile stock gets a smaller position; a stable stock gets a larger one. Risk per trade stays constant but adapts to the instrument.

Why: This is the difference between "functional" and "profitable." The agent currently has no analytical edge.
Cost: $0 additional AI spend. Pure code.
Effort: Medium-high. The indicators are straightforward math but the prompt rewrite needs careful testing.
**This is the highest-leverage work after Phase 1.**

### Phase 3: Learning Depth

What: Two additions.

**3a. Decision scorer.** Daily job (after trade review, ~17:30) that scores all HOLD/WATCH decisions from today against the stock's subsequent 1-day price movement. Were the HOLDs correct? Were there missed opportunities? Feed results into pattern analysis. Cost: ~$0.10–0.20/day (5–10 Haiku calls).

**3b. Strategy journal.** New DB table. Pattern analysis (Wed/Fri) proposes hypothesis updates. Active hypotheses included in trading context. Self-improvement system can modify hypothesis weights.

Why: Without this, the agent never improves its strategy — only its process. It will keep making the same types of decisions with no data-driven feedback on whether its *reasoning framework* works.
Cost: ~$4/month additional.
Effort: Medium.

### Phase 4: Architecture and Polish

What: Multi-agent pattern, cost-awareness injection, earnings calendar, intraday news, go-live criteria doc.

These are genuine improvements but they're optimisations. The system can function and potentially profit without them. Do them once Phase 1–3 are solid.

---

## The Honest Bottom Line

After the gap resolution plan alone, the system will be **safe but probably not profitable**. It will respect risk limits, execute stop losses, track costs accurately, and learn from its trades. That's necessary but insufficient.

After Phase 2 (trading intelligence), the system has a **realistic shot at profitability**. Computed indicators + an expert prompt + volatility-adjusted sizing give the agent an actual analytical framework instead of vibes-based pattern matching.

After Phase 3 (learning depth), the system can **improve over time**. The decision scorer closes the feedback loop on inaction, and the strategy journal creates structured hypothesis testing.

The question isn't "can we build all of this?" — the architecture supports it and the costs are manageable. The question is **sequencing**: Phase 1 makes it safe, Phase 2 makes it smart, Phase 3 makes it adaptive. Skip to Phase 3 without Phase 2 and you have an adaptive system that evolves a bad strategy. Skip Phase 1 and the whole thing is unsafe to run.

Build in order. Phase 1 first.

---

## Cost Philosophy: Optimise for Quality, Not Cheapness

**Decision made 2026-02-16.** This is a binding principle for the project.

During paper trading, the system spent Day 1 driving AI costs from $200/day down to ~$6/day. This was a 97% reduction achieved by:
- Downgrading Sonnet to Haiku for analysis jobs
- Reducing tick frequency from 5 min to 20 min
- Adding a pre-filter that skips Claude entirely on quiet ticks
- Using Haiku ($0.02) as the primary triage model

The result: a cost-efficient system that confidently does nothing. The agent ran all day producing "NO TRADES" decisions. Cost savings are meaningless if the system doesn't trade.

### The Principle

**Do not optimise for cost during paper trading. Optimise for decision quality.**

Paper trading costs real API money but fake trading money. This is exactly the phase where spending more on AI is justified — we need to learn what level of intelligence produces good decisions before we can determine the minimum viable spend.

### What This Means Concretely

1. **The three-tier architecture stays.** Pre-filter → triage → full analysis is good engineering regardless of which models fill each tier. The architecture is about separation of concerns, not just cost.

2. **Model tiers should be set for quality during paper trading.** After Phase 2 is complete (indicators + expert prompt), run the triage tier with Sonnet at 10-minute intervals. This is ~$25/day. If it produces better decisions than Haiku triage, that's the signal. If it produces the same "NO TRADES," the model tier isn't the bottleneck.

3. **Cost optimisation happens after we know the revenue side.** Once the agent is making trades and we can measure returns, we can calculate: "Does each additional dollar of AI cost generate more than a dollar in returns?" Only then should we downgrade models or reduce frequency.

4. **One good trade covers weeks of cost difference.** A 5% gain on a £1,000 position is £50 — enough to pay for 30 Sonnet calls. Missing that trade because Haiku didn't spot it costs more than the savings.

5. **The break-even target is real.** At $160/month (~£130), the agent needs ~8% annual returns on a £20K ISA just to cover costs. At $500/month (~£400), it needs ~24%. The optimal point is somewhere between — where spending more produces proportionally more returns. We find that point through experimentation, not by minimising the numerator.

### Revisit Points

- **After Phase 2 completion:** Run Sonnet triage for 1 week. Compare decision quality and trade frequency against Haiku triage. Measure cost per trade, not cost per tick.
- **After first profitable month:** Calculate actual cost-per-return ratio. Determine if model downgrades are warranted.
- **Before go-live:** Set the final cost tier based on paper trading data. Live trading should use whatever model configuration produced the best risk-adjusted returns during paper testing.

### What We Will NOT Do

- Downgrade model tiers to save money before measuring the impact on returns
- Reduce tick frequency below 10 minutes during market hours
- Skip the triage tier entirely (it's valuable for escalation logic even with Sonnet)
- Make cost the primary decision factor for any architectural choice during paper trading
