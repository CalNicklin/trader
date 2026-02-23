# Strategy Framework: Adaptive Signal Architecture

> **Status: ADOPTED** — Decision made 2026-02-23. Momentum-primary starting point.
>
> **Rationale:** The signal architecture decomposes decisions into independently measurable signals, enabling the Phase 3 learning loop to evolve strategy from evidence. Momentum-primary is the starting point because (a) academic evidence supports momentum as the strongest single factor, (b) it plays to the system's architectural strengths (mechanical screening + AI judgment), and (c) the learning loop can evolve away from it if the data says to.
>
> This document is the canonical reference for the system's strategy architecture. Phase docs (1.2, 1.5, 2, 3, 4) implement specific steps within this framework.

---

## The Problem With Picking a Strategy

The current roadmap embeds a strategy choice into the prompt:

- **Phase 1.2** proposes a 4-dimension research framework (Growth, Quality, Momentum, Risk — scored 1–5)
- **Phase 2** proposes a 5-factor trading framework (Trend, Momentum, Value, Catalyst, Risk/Reward — scored -2 to +2)
- The [optimising doc](./optimising-for-agentic.md) argues for momentum-primary with fundamentals as a filter

All three are reasonable. All three are static. Whichever we hard-code into the prompt, the system is stuck with until a human rewrites it.

The system already has a self-improvement loop (Phase 3: strategy journal, hypothesis lifecycle, self-improvement PRs). The scoring framework should be designed so that loop can actually _use_ it — measuring which signals predict outcomes, adjusting weights, and evolving the strategy from evidence rather than opinion.

---

## Design Principle: Decomposed, Measurable, Adjustable

Instead of a monolithic prompt that says "score these 5 things equally" or "momentum is primary," decompose the decision into **individual signals** that are:

1. **Independently measurable** — each signal is recorded at decision time
2. **Correlated with outcomes** — the decision scorer (Phase 3) can measure which signals predicted wins
3. **Adjustable** — the strategy journal can propose weight changes based on evidence

The system doesn't need the right strategy on day one. It needs the right _structure_ to discover the right strategy over weeks 2–8.

---

## The Signal Architecture

### Layer 1: Mechanical Signals (computed by code, zero AI cost)

These come from the indicator engine (Phase 2) and data pipeline. They're objective and reproducible.

| Signal                   | Source                 | Output                                                    | Available                         |
| ------------------------ | ---------------------- | --------------------------------------------------------- | --------------------------------- |
| `trend_alignment`        | SMA20/50/200           | `strong_up \| up \| neutral \| down \| strong_down`       | Phase 2                           |
| `rsi_regime`             | RSI(14)                | `overbought \| bullish \| neutral \| bearish \| oversold` | Phase 2                           |
| `macd_signal`            | MACD(12,26,9)          | `bullish_cross \| bearish_cross \| none`                  | Phase 2                           |
| `volume_confirmation`    | Volume / SMA20(vol)    | ratio (e.g. 1.4 = 140% of average)                        | Phase 2                           |
| `atr_percent`            | ATR(14) / price        | daily volatility as %                                     | Phase 2                           |
| `bollinger_position`     | %B                     | 0–1 (0 = lower band, 1 = upper band)                      | Phase 2                           |
| `price_momentum_30d`     | 30-day price change %  | number                                                    | Phase 1.2 (basic), Phase 2 (full) |
| `distance_from_52w_high` | price vs 52w high      | % below high                                              | Phase 2                           |
| `relative_volume`        | today's vol vs 20d avg | ratio                                                     | Phase 2                           |

These signals are pre-computed and injected into every AI context. The AI doesn't generate them — it reads them.

### Layer 2: Research Signals (computed by AI during research pipeline)

These come from the research analyzer (Sonnet, daily, offline). They require judgment.

| Signal               | What It Evaluates                     | Output                                                 | Available             |
| -------------------- | ------------------------------------- | ------------------------------------------------------ | --------------------- |
| `quality_pass`       | Is this a real, functioning business? | `pass \| marginal \| fail`                             | Phase 1.2             |
| `quality_flags`      | Specific concerns                     | string[] (e.g. `["high_debt", "margin_compression"]`)  | Phase 1.2             |
| `catalyst`           | Upcoming events, news sentiment       | `positive \| neutral \| negative \| earnings_imminent` | Phase 1.2             |
| `catalyst_detail`    | What the catalyst is                  | string (e.g. "earnings beat + raised guidance")        | Phase 1.2             |
| `earnings_proximity` | Days to next earnings                 | number \| null                                         | Phase 1.2 (via Yahoo) |
| `fundamental_value`  | Cheap/fair/expensive vs sector        | `undervalued \| fair \| overvalued`                    | Phase 1.2             |
| `thesis`             | Bull and bear case                    | { bull: string, bear: string }                         | Exists today          |

These are stored in `rawData` on the research table. No schema change needed.

### Layer 3: AI Judgment (computed by Sonnet during active trading)

This is where the trading analyst adds real-time contextual evaluation. It receives Layer 1 + Layer 2 signals and makes a decision.

The key shift: **the AI's job is not to score five factors. It's to evaluate whether the mechanical signals are trustworthy in context.**

The prompt gives the AI pre-computed signals and research context, then asks:

```
Given these signals, should we act?

Your job is NOT to re-evaluate what the indicators already tell you.
Your job IS to identify reasons the signals might be misleading:
- Is this momentum real or a dead-cat bounce?
- Does the research context support or contradict the signal?
- Is there an event risk the indicators can't see?
- Is the position sizing appropriate for this setup?

Output your assessment and, if acting, the trade parameters.
```

This plays to the AI's actual strength: contextual judgment, integration of heterogeneous information, identifying exceptions. It doesn't ask the AI to be a quant (computing trend scores) or a value investor (deep fundamental analysis). It asks the AI to be the sanity check on a mechanical system.

---

## How Signals Flow Through the System

```
Research Pipeline (daily, offline)
│
├─ Yahoo/FMP data ──────────────────────► Layer 2 signals
│  (fundamentals, earnings date,           (quality, catalyst, value)
│   news, price history)                   Stored in research.rawData
│
├─ Layer 2 signals ─────────────────────► Watchlist score
│  quality_pass × momentum_proxy            (for prioritization)
│
Active Trading Tick (every 10 min)
│
├─ Indicator engine ────────────────────► Layer 1 signals
│  (SMA, RSI, MACD, ATR, volume)           (mechanical, pre-computed)
│
├─ Momentum Gate (code, no AI) ─────────► Pass / Fail
│  Configurable rules, e.g.:
│  - trend_alignment ∈ {strong_up, up}
│  - rsi_regime ∈ {bullish, neutral}
│  - volume_confirmation > 0.8
│
│  If fail → log signals, no AI call (Tier 2 says "no escalation")
│  If pass → escalate to Tier 3
│
├─ Tier 3: AI Judgment ─────────────────► Act / Pass + confidence
│  Receives: Layer 1 signals + Layer 2 research context
│  Evaluates: Is this setup trustworthy?
│  Decides: trade params or skip
│
├─ Risk Manager ────────────────────────► Approved / Rejected
│  ATR sizing, stop/target, hard limits
│
└─ Trade Execution
```

---

## What the Learning Loop Measures

This is the critical part. Every decision — act or pass — is recorded with its signal state. Phase 3's decision scorer and strategy journal can then measure:

### Signal Effectiveness

For each mechanical signal, across all scored decisions:

```
trend_alignment = "strong_up" AND trade outcome = win  → 73% (n=22)
trend_alignment = "strong_up" AND trade outcome = loss → 27% (n=8)

rsi_regime = "bullish" AND trade outcome = win → 68% (n=15)
rsi_regime = "overbought" AND trade outcome = win → 31% (n=4)
```

This lets the strategy journal propose hypotheses like:

- "RSI overbought entries have 31% win rate — reduce gate threshold to exclude them"
- "Volume confirmation > 1.5 has 80% win rate — increase gate weight"

### AI Judgment Quality

For each AI override (pass on a signal-qualified candidate):

```
AI said "pass" on momentum-qualified stock → stock went up 8% → missed opportunity
AI said "pass" on momentum-qualified stock → stock went down 4% → good judgment
```

The decision scorer measures the AI's hit rate on contextual overrides. If the AI's passes are worse than the mechanical signals alone, the system learns to trust the signals more. If the AI's passes are valuable (filtering out losers), the system learns which kinds of context matter.

### Gate Calibration

The momentum gate parameters (which signals, what thresholds) are configuration, not code. The strategy journal can propose adjustments:

```
Hypothesis: "Requiring volume_confirmation > 1.0 filters out 40% of candidates
but only improves win rate by 2%. Lower threshold to 0.8."
Status: PROPOSED → test for 2 weeks → ACTIVE or REJECTED
```

This is how the system evolves its own strategy without a human rewriting the prompt.

---

## The Default Strategy (Starting Point)

The system needs a starting strategy. Based on the academic evidence for momentum and the system's architectural strengths, the default is momentum-primary:

### Momentum Gate (default parameters)

```typescript
interface MomentumGate {
  // All must pass for escalation
  trendAlignment: ("strong_up" | "up")[]; // price above SMA50
  rsiRange: [number, number]; // [45, 75] — building, not exhausted
  minVolumeRatio: number; // 0.8 — at least 80% of 20d avg
  excludeOverbought: boolean; // true — skip RSI > 75
}

const DEFAULT_GATE: MomentumGate = {
  trendAlignment: ["strong_up", "up"],
  rsiRange: [45, 75],
  minVolumeRatio: 0.8,
  excludeOverbought: true,
};
```

These parameters are stored in configuration (not hard-coded). The strategy journal can propose changes. The self-improvement system can modify them via PR.

### Research Quality Filter (default)

```
quality_pass = "fail" → exclude from watchlist (never trade)
quality_pass = "marginal" → trade only with strong momentum + AI confirmation
quality_pass = "pass" → eligible for momentum gate
```

### AI Context Prompt (default)

The trading analyst prompt instructs the AI to evaluate trustworthiness, not score factors:

```
You receive momentum-qualified candidates — stocks where mechanical
indicators confirm an uptrend with building momentum and adequate volume.

For each candidate, evaluate:

1. SUSTAINABILITY: Is this momentum driven by something real?
   - Recent catalyst (earnings beat, upgrade, sector rotation) → supports entry
   - No identifiable driver → caution, may be noise
   - Negative catalyst masked by market-wide rally → avoid

2. RISK EVENTS: Is there something the indicators can't see?
   - Earnings within 5 trading days → flag (could accelerate OR reverse)
   - Regulatory/legal risk mentioned in research → flag
   - Sector rotation away from this name → flag

3. POSITION CONTEXT: Does this trade fit the portfolio?
   - Sector concentration after this trade
   - Correlation with existing positions
   - Available risk budget

For each candidate, output:
- act: boolean — should we enter?
- confidence: 0.0–1.0
- reasoning: why act or why pass (max 200 chars)
- if acting: limitPrice, stopLoss (2×ATR), shares (from risk budget)
```

---

## What Changes in Each Phase

### Phase 1.2 (now)

| Step                        | Current Plan                                            | Under This Framework                                                                                              |
| --------------------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| 1.2.1 Momentum screening    | Kill sector rotation, screen all sectors                | **Same** — even more aligned                                                                                      |
| 1.2.2 Concentrate positions | 5 positions, 15% max                                    | **Same**                                                                                                          |
| 1.2.3 Research analyzer     | 4-dimension scoring (Growth/Quality/Momentum/Risk, 1–5) | **Simpler**: quality filter (pass/marginal/fail) + catalyst awareness + fundamental flags. No scoring dimensions. |
| 1.2.4 Watchlist scoring     | Activate 5 dead-code weights with dimension scores      | **Simpler**: `score = qualityMultiplier × momentumProxy × recencyDecay`. Kill the weight system entirely.         |
| 1.2.5 Richer fundamentals   | Add earningsTrend, calendarEvents to Yahoo              | **Same** — earnings_proximity becomes a first-class signal                                                        |
| 1.2.6 Paper aggression      | Wider limits, more aggressive prompts                   | **Same**                                                                                                          |

### Phase 2 (after observation)

| Step                            | Current Plan                                | Under This Framework                                                                                              |
| ------------------------------- | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| 2.1 Indicator engine            | Compute SMA/RSI/MACD/ATR/Bollinger          | **Same** — this becomes the primary signal source                                                                 |
| 2.2 Schema (52w range)          | Add high52w/low52w to watchlist             | **Same**                                                                                                          |
| 2.3 Integrate into orchestrator | Add indicator summaries to Tier 3 context   | **Extended**: indicators also feed the momentum gate in Tier 2 (Haiku gate becomes signal-based, not vibes-based) |
| 2.4 Integrate into research     | Compute indicators during research pipeline | **Same** — research can also score trend/momentum when bars are available                                         |
| 2.5 ATR sizing + trailing stops | ATR-based stops, 1% risk per trade          | **Extended**: add trailing stop logic to Guardian (trail at 2×ATR below highest close)                            |
| 2.6 Expert prompt rewrite       | 5-factor balanced framework, equal weights  | **Different**: contextual judgment prompt (evaluate trustworthiness, not score factors)                           |

### Phase 3 (learning depth)

| Step                            | Current Plan                             | Under This Framework                                                                                                      |
| ------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| 3.1–3.3 Decision scorer         | Score HOLD/WATCH decisions               | **Extended**: also measure signal effectiveness — which Layer 1 signals predicted wins?                                   |
| 3.4 Feed into pattern analysis  | Decision quality section                 | **Extended**: add signal correlation analysis — "RSI bullish entries: 68% WR (n=15)"                                      |
| 3.5 Strategy journal            | Propose/evaluate/confirm hypotheses      | **Critical**: hypotheses can now target gate parameters, not just prompt text. "Lower minVolumeRatio to 0.8" is testable. |
| 3.6 Feed into trading decisions | Learning brief includes hypotheses       | **Same**                                                                                                                  |
| 3.7 Self-improvement            | Codify confirmed hypotheses into prompts | **Extended**: can also codify into gate configuration, not just prompts                                                   |

---

## Why This Is Better for a Self-Improving System

The current Phase 2 framework asks the AI to score five things and sum them. This is hard to decompose:

- If a trade fails with score +5, which factor was wrong?
- If the AI consistently scores Value at +1 when it should be -1, how do you detect that?
- If momentum is the only signal that matters, the framework can't discover that — it's hard-wired to weight all five equally.

The signal architecture decomposes everything:

- Each mechanical signal is independently measurable against outcomes
- The AI's judgment layer is separately measurable (did its overrides add value?)
- Gate parameters are configuration, not code — adjustable without a prompt rewrite
- The strategy journal can propose: "increase weight of volume_confirmation" or "RSI threshold should be 40–70 not 45–75" as testable hypotheses

The system starts with momentum-primary (because the evidence supports it), but the framework doesn't lock it in. If the learning loop discovers that `fundamental_value = "undervalued"` is a strong predictor, a hypothesis can propose adding it to the gate. If it discovers that the AI's catalyst judgment is worthless, a hypothesis can propose removing that from the prompt. The strategy evolves from data, not from a human rewriting docs.

---

## The Starting Point vs. The Destination

**Day 1** (Phase 1.2 + 2 deployed):

- Momentum gate with default parameters
- AI evaluates trustworthiness
- Quality filter from research
- All signals logged with decisions

**Week 4** (Phase 3 generating data):

- Decision scorer shows: volume_confirmation > 1.5 predicts wins at 80%
- Strategy journal proposes: raise minVolumeRatio from 0.8 to 1.2
- Hypothesis status: PROPOSED

**Week 8** (hypothesis under test):

- After 20 trades with tighter volume gate: win rate improved from 55% to 64%
- Hypothesis status: ACTIVE → CONFIRMED
- Self-improvement system codifies into gate config

**Week 12+**:

- System has discovered its own edge profile through accumulated hypotheses
- Gate parameters are evidence-based, not opinion-based
- The AI's prompt has been refined based on which contextual judgments actually added value
- Strategy is unique to this system's data, not copied from a textbook

This is the destination: a system that started with a reasonable default (momentum) and evolved into something it discovered through its own trading history. The framework's job is to make that evolution possible, not to be the final answer.

---

## KPI Framework

Tracked from Phase 1.2 onward, measured against baselines from the observation period.

- **Portfolio-level:** Net return, max drawdown, hit rate, expectancy per trade
- **Process-level:** Missed-opportunity rate, bad-entry rate, AI override value-add (Phase 2+)
- **Signal-level:** Win/loss stats by signal regime with minimum sample requirements (Phase 2+)
- **Reliability-level:** Job success rate, stale data rate, reconciliation mismatches

### Measurement Windows

All KPIs are computed over explicit rolling windows so gates are deterministic and non-interpretive:

- **Trade-denominated KPIs** (signal-level, process-level): Rolling 20-trade window. Used for hit rate, expectancy, signal effectiveness, AI override value-add. Ensures measurement is activity-based, not stalled during quiet periods.
- **Calendar-denominated KPIs** (portfolio-level, reliability-level): Rolling 4-week window. Used for max drawdown, net return, job success rate, stale data rate. These are time-sensitive and need calendar measurement.
- **Exit gate evaluation**: A phase exit gate is met when ALL relevant KPIs satisfy thresholds within their current rolling window. No interpolation, no judgment calls.

---

## Rollout Discipline

- **Batch size:** Max 3 material changes per deploy, then verify against KPIs
- **Promotion ladder:** Paper validation → shadow comparison → constrained live
- **Kill-switch:** Immediate fallback to last confirmed gate/prompt config when drawdown or behavior thresholds breached
- **Config versioning:** Gate parameters and prompt versions tracked so rollback is always one step
