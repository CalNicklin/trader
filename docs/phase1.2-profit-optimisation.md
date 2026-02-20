# Phase 1.2: Profit Optimisation (Quick Wins)

> Changes that can be deployed now, during the Phase 1 observation period, without affecting the phased rollout. No new infrastructure, no schema changes, no architectural shifts — just configuration and prompt tuning to stop leaving money on the table.

---

## Why Now

These are changes to **how the system uses existing infrastructure**, not changes to the infrastructure itself. Phase 1's safety architecture (trade gates, Guardian, risk pipeline, learning loop) is unchanged. Phase 1.5 (US stocks) and Phase 2 (indicators) proceed as planned. These changes make the system more profitable within its current capabilities.

---

## Step 1.2.1 — Kill sector rotation, screen for momentum daily

**Files:** `src/research/sources/lse-screener.ts`

**Current behaviour:**
```typescript
const SECTOR_ROTATION: Record<number, { sector?: string; label: string }> = {
  1: { sector: "Technology", label: "Technology" },
  2: { sector: "Healthcare", label: "Healthcare" },
  3: { label: "Small-caps (all sectors)" },
  4: { sector: "Financial Services", label: "Financial Services" },
  5: { sector: "Consumer Cyclical", label: "Consumer Cyclical" },
};
```

This guarantees 4 out of 5 days are locked into a single sector regardless of market conditions. If tech is rallying all week, the system only sees it on Monday.

**Change to:**
- Remove the day-of-week sector rotation
- Screen **all sectors every day**, sorted by recent performance
- Use FMP screener with `volumeMoreThan: 100000` and `marketCapMoreThan: 100000000`
- Add a **momentum filter**: sort candidates by `changePercentage` descending (FMP returns this)
- Keep the small-cap Wednesday screen as a **secondary** screen (run after the main momentum screen, not instead of it)
- Still cap at 5 new watchlist additions per session

```typescript
const SCREENING_STRATEGY: Record<number, { label: string; screens: ScreenConfig[] }> = {
  0: { label: "Weekend (no screen)", screens: [] },
  1: { label: "Momentum + all sectors", screens: [momentumScreen()] },
  2: { label: "Momentum + all sectors", screens: [momentumScreen()] },
  3: { label: "Momentum + small-caps", screens: [momentumScreen(), smallCapScreen()] },
  4: { label: "Momentum + all sectors", screens: [momentumScreen()] },
  5: { label: "Momentum + all sectors", screens: [momentumScreen()] },
};
```

The momentum screen fetches all sectors and sorts by price change. Whatever is moving, that's what gets discovered. Wednesday adds a small-cap screen as a secondary pass for higher-volatility names.

**Test:** Mock FMP returning 50 results across sectors. Verify they're sorted by price change, not filtered by sector.

---

## Step 1.2.2 — Concentrate positions

**Files:** `src/risk/limits.ts`

**Current limits:**
```typescript
MAX_POSITION_PCT: 5,
MAX_POSITION_GBP: 50_000,
MIN_CASH_RESERVE_PCT: 20,
MAX_POSITIONS: 10,
```

On a £20K ISA this means: max £1K per position, max 10 positions, minimum £4K cash. Effective max deployment: £10K (50%). This is a closet index tracker — too many small bets to generate meaningful returns.

**Change to:**
```typescript
MAX_POSITION_PCT: 15,
MAX_POSITION_GBP: 50_000,
MIN_CASH_RESERVE_PCT: 10,
MAX_POSITIONS: 5,
```

On a £20K ISA: max £3K per position, max 5 positions, minimum £2K cash. Effective max deployment: £15K (75%).

**Impact:**
- A 10% winner goes from £100 (on £1K) to £300 (on £3K)
- Fewer positions means more attention per position — each one gets researched more thoroughly
- 10% cash reserve still covers 3 full stop-loss exits at 3% each before needing to sell a winner

**Safety check:** The Guardian's stop-loss enforcement, daily/weekly circuit breakers, and sector concentration limits all still apply. The downside is capped — a single position can't lose more than £90 at a 3% stop on a £3K position. That's 0.45% of the portfolio. The current 2% daily loss limit would trigger after ~4 consecutive stop-outs, which is the same resilience as before proportionally.

**Note:** The 30% max sector exposure now binds more tightly with fewer, larger positions. Two positions in the same sector at 15% each = 30% = at the limit. This naturally forces diversification across at least 3 sectors, which is sufficient for a 5-position portfolio.

**Test:** Existing risk pipeline test with updated limits. Verify: a £3K position on a £20K portfolio → approved. A 6th position → rejected.

---

## Step 1.2.3 — Upgrade research analysis to Sonnet

**Files:** `src/research/analyzer.ts`

**Current behaviour:**
```typescript
const response = await client.messages.create({
  model: config.CLAUDE_MODEL_STANDARD,
  // ...
});
```

`CLAUDE_MODEL_STANDARD` likely resolves to Sonnet, but the audit doc and cost analysis describe research running on Haiku. Verify which model is actually being used and ensure it's Sonnet.

**What to do:**
- Confirm `CLAUDE_MODEL_STANDARD` is Sonnet (`claude-sonnet-4-5-20250929` or equivalent)
- If it's Haiku, change to the Sonnet model
- The research pipeline runs on 10 symbols/day after market close — this is not latency-sensitive

**Cost impact:** 10 analyses/day × ($0.35 - $0.005) = ~$3.45/day additional = ~$69/month. One good trade from better research insight covers months of the cost difference.

**Also improve the analysis prompt while we're here.** The current prompt is:

```
"You are a stock analyst specializing in LSE-listed UK equities.
 Analyze the provided data and give a clear, structured assessment."
```

Replace with a structured evaluation framework:

```typescript
const ANALYSIS_BASE = `You are a senior equity analyst. Evaluate the provided stock data using this framework.

Score each dimension 1-5 and provide a brief justification:

**Growth (1-5):**
- Revenue trend: growing, stable, or declining?
- Is the growth rate accelerating or decelerating?
- How does growth compare to the broader market?

**Quality (1-5):**
- ROE above 15% = strong. Below 10% = weak.
- Are margins expanding or compressing?
- Debt/equity: below 0.5 = healthy, above 1.5 = concerning
- Is free cash flow positive and growing?

**Momentum (1-5):**
- Is the price above or below its recent trend?
- Volume: is recent volume above or below the 20-day average?
- Has the stock been making higher highs, or lower lows?

**Risk (1-5, where 5 = lowest risk):**
- Is there an earnings announcement within 10 days?
- Are there sector headwinds or regulatory risks?
- How liquid is the stock (volume vs position size)?
- How volatile is the stock (daily range as % of price)?

**Total:** Sum of all four dimensions (max 20).
- 16-20: Strong BUY candidate
- 12-15: WATCH — close to actionable
- 8-11: HOLD — no compelling case
- Below 8: Avoid

Always respond in valid JSON with these fields:
- sentiment: number from -1 (very bearish) to 1 (very bullish)
- action: "BUY" | "SELL" | "HOLD" | "WATCH"
- confidence: number from 0 to 1
- bullCase: string (max 200 chars)
- bearCase: string (max 200 chars)
- analysis: string (max 500 chars)
- scores: { growth: number, quality: number, momentum: number, risk: number }`;
```

This forces the model to evaluate systematically rather than produce vibes. The `scores` field also provides structured data that the scoring algorithm can use later (see Step 1.2.4).

**Test:** Run the new prompt on a known stock (e.g., SHEL) with real Yahoo data. Verify the response includes all four dimension scores and the total maps correctly to the action recommendation.

---

## Step 1.2.4 — Fix the watchlist scoring algorithm

**Files:** `src/research/watchlist.ts`

**Current problem:** Three of five declared scoring weights are dead code:

```typescript
export const SCORING_WEIGHTS = {
  sentimentWeight: 0.3,    // USED
  confidenceWeight: 0.2,   // USED
  fundamentalWeight: 0.25, // DEAD CODE
  momentumWeight: 0.15,    // DEAD CODE
  liquidityWeight: 0.1,    // DEAD CODE
};
```

The actual score is just `sentiment × 0.3 + confidence × 0.2 + action_bonus`. A stock with terrible fundamentals but positive sentiment scores the same as one with excellent fundamentals.

**What to do:**

With Step 1.2.3 adding `scores` to the analysis output, we can now use the full scoring weights. Update `updateScore()`:

```typescript
export async function updateScore(symbol: string): Promise<number> {
  const db = getDb();
  const latestResearch = await db
    .select()
    .from(research)
    .where(eq(research.symbol, symbol))
    .orderBy(desc(research.createdAt))
    .limit(1);

  if (latestResearch.length === 0) return 0;

  const r = latestResearch[0]!;
  const sentimentScore = (((r.sentiment ?? 0) + 1) / 2) * 100;
  const confidenceScore = (r.confidence ?? 0) * 100;

  // Parse dimension scores from analysis data if available
  let fundamentalScore = 50; // neutral default
  let momentumScore = 50;
  let liquidityScore = 50;

  try {
    const rawData = r.rawData ? JSON.parse(r.rawData) : null;
    if (rawData?.scores) {
      // Dimension scores are 1-5, normalize to 0-100
      fundamentalScore = ((rawData.scores.quality ?? 3) / 5) * 100;
      momentumScore = ((rawData.scores.momentum ?? 3) / 5) * 100;
      liquidityScore = ((rawData.scores.risk ?? 3) / 5) * 100;
    }
  } catch { /* use defaults */ }

  const actionBonus =
    r.suggestedAction === "BUY" ? 20 :
    r.suggestedAction === "WATCH" ? 5 : 0;

  const score =
    sentimentScore * SCORING_WEIGHTS.sentimentWeight +
    confidenceScore * SCORING_WEIGHTS.confidenceWeight +
    fundamentalScore * SCORING_WEIGHTS.fundamentalWeight +
    momentumScore * SCORING_WEIGHTS.momentumWeight +
    liquidityScore * SCORING_WEIGHTS.liquidityWeight +
    actionBonus;

  const clampedScore = Math.max(0, Math.min(100, score));

  await db
    .update(watchlist)
    .set({ score: clampedScore, lastResearchedAt: new Date().toISOString() })
    .where(eq(watchlist.symbol, symbol));

  return clampedScore;
}
```

**Store the dimension scores.** The analysis output's `scores` object needs to persist so the scoring algorithm can use it. Add it to the `rawData` JSON blob in `researchSymbol()`:

```typescript
// In pipeline.ts researchSymbol(), update the research insert:
rawData: JSON.stringify({
  quote,
  fundamentals,
  newsCount: newsItems.length,
  scores: analysis.scores ?? null, // NEW — dimension scores from analyzer
}),
```

**Test:** Mock research with scores `{growth: 4, quality: 5, momentum: 3, risk: 4}`. Verify the composite score is higher than the same stock with `{growth: 2, quality: 2, momentum: 2, risk: 2}`.

---

## Step 1.2.5 — Richer Yahoo fundamentals

**Files:** `src/research/sources/yahoo-finance.ts`

**Current:** Fetches `financialData`, `defaultKeyStatistics`, `assetProfile` modules.

**Missing data that's available with one line change:**

```typescript
const result = await yf.quoteSummary(yahooSymbol, {
  modules: [
    "financialData",
    "defaultKeyStatistics",
    "assetProfile",
    "earningsTrend",     // NEW — forward estimates, earnings growth
    "calendarEvents",    // NEW — next earnings date
  ],
});
```

Extract the new fields:

```typescript
const earnings = result.earningsTrend;
const calendar = result.calendarEvents;

return {
  // ...existing fields...
  forwardPE: result.defaultKeyStatistics?.forwardPE ?? null,
  pegRatio: result.defaultKeyStatistics?.pegRatio ?? null,
  priceToBook: result.defaultKeyStatistics?.priceToBook ?? null,
  enterpriseToEbitda: result.defaultKeyStatistics?.enterpriseToEbitda ?? null,
  earningsGrowth: earnings?.trend?.[0]?.earningsEstimate?.growth ?? null,
  revenueGrowthEstimate: earnings?.trend?.[0]?.revenueEstimate?.growth ?? null,
  nextEarningsDate: calendar?.earnings?.earningsDate?.[0] ?? null,
};
```

The `nextEarningsDate` is particularly valuable — it enables the agent to avoid (or target) earnings events. Surface it in the research output and the agent's context.

**Update `YahooFundamentals` interface** to include the new fields.

**Test:** Fetch fundamentals for a well-covered stock (e.g., AZN). Verify `forwardPE`, `pegRatio`, and `nextEarningsDate` are populated.

---

## Step 1.2.6 — Reduce paper trading conservatism

**Files:** `src/risk/limits.ts`, `src/agent/prompts/trading-mode.ts`

The paper account exists to generate data for the learning loop. Currently, paper mode has lower confidence thresholds (0.5 vs 0.7) but identical risk limits. Paper should be more aggressive:

**limits.ts — add paper-specific overrides:**

The hard limits file should expose a helper that returns the active limits based on trading mode. For paper:

```typescript
export function getActiveLimits() {
  const base = HARD_LIMITS;
  if (getConfig().PAPER_TRADING) {
    return {
      ...base,
      MAX_POSITIONS: 5,         // same as new concentrated default
      MAX_POSITION_PCT: 15,     // same as new concentrated default
      MIN_CASH_RESERVE_PCT: 5,  // lower for paper — more capital deployed
      DAILY_LOSS_LIMIT_PCT: 5,  // wider for paper — let strategies run
      WEEKLY_LOSS_LIMIT_PCT: 10, // wider for paper
      MIN_TRADE_INTERVAL_MIN: 2, // already lower for paper
    };
  }
  return base;
}
```

This lets paper trading explore more of the strategy space while live mode stays conservative. The learning loop gets more data, faster.

**trading-mode.ts — update paper context:**

```
- Take trades when the thesis is reasonable
+ Lean into high-momentum setups. The learning value of an executed trade far exceeds the value of another WATCH decision.
+ When you see momentum confirmation (price > SMA20, volume above average, RSI 50-70), act on it.
+ Aim for 3-5 active positions. Sitting in cash with zero positions is a failure state during paper trading.
```

**Test:** Verify `getActiveLimits()` returns paper overrides when `PAPER_TRADING` is true and base limits when false.

---

## What Does NOT Change

- **Phase structure**: 1 → 1.2 → 1.5 → 2 → 3 (1.2 slots in during observation)
- **Three-tier architecture**: Pre-filter → Haiku → Sonnet (unchanged)
- **Guardian**: Stop-loss enforcement, price updates, alerts (unchanged)
- **Trade execution pipeline**: Gates, order placement, monitoring (unchanged)
- **Learning loop**: Trade reviews, pattern analysis, insights (unchanged)
- **Schema**: No database changes required
- **Phase 1 observation checklist**: Still valid — these changes are observed alongside it

---

## Deployment Order

These steps are independent and can be deployed individually:

```
Step 1.2.1  Kill sector rotation       — 1 file, low risk
Step 1.2.2  Concentrate positions      — 1 file, config change only
Step 1.2.3  Upgrade research prompt    — 1 file, prompt + model change
Step 1.2.4  Fix scoring algorithm      — 2 files, depends on 1.2.3
Step 1.2.5  Richer fundamentals        — 1 file, additive data
Step 1.2.6  Paper trading aggression   — 2 files, paper-only changes
```

**Recommended order:** 1.2.2 and 1.2.6 first (config changes, immediate effect on trading behaviour), then 1.2.1 (screening), then 1.2.5 + 1.2.3 + 1.2.4 together (research quality stack).

---

## Expected Impact

| Change | Mechanism | Estimated Annual Impact |
|--------|-----------|------------------------|
| Concentrated positions | 3× absolute return per winning trade | +5-8% on same win rate |
| Momentum screening | Better opportunity sourcing | +2-3% from higher-quality pipeline |
| Sonnet research | Better signal → higher win rate | +1-2% from fewer bad entries |
| Full scoring weights | Higher-quality watchlist ranking | +1% from better prioritisation |
| Richer fundamentals | Earnings awareness, deeper analysis | +1-2% from avoiding traps |
| Paper aggression | More trades → faster learning | Indirect: faster path to proven edge |

**Combined: ~10-15% annual improvement** over the current configuration, using the same infrastructure. These gains stack on top of Phase 1.5 (US stocks, ~5-7%) and Phase 2 (indicators + ATR sizing, ~3-5%).

---

## Files Changed Summary

| File | Action | What |
|------|--------|------|
| `src/research/sources/lse-screener.ts` | MODIFY | Replace sector rotation with momentum screening |
| `src/risk/limits.ts` | MODIFY | Concentrated positions, paper overrides |
| `src/research/analyzer.ts` | MODIFY | Structured analysis prompt, confirm Sonnet model |
| `src/research/watchlist.ts` | MODIFY | Use all 5 scoring weights |
| `src/research/pipeline.ts` | MODIFY | Pass dimension scores to rawData |
| `src/research/sources/yahoo-finance.ts` | MODIFY | Additional fundamentals + earnings date |
| `src/agent/prompts/trading-mode.ts` | MODIFY | More aggressive paper context |

**Total: 7 files modified, 0 new files, 0 schema changes.**
