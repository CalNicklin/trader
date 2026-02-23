# Phase 2: Trading Intelligence — Detailed Design

> Implementation-ready specification. Every function, file, and integration point is defined.

---

## Table of Contents

1. [Technical Indicator Engine](#1-technical-indicator-engine)
2. [Expert Prompt Rewrite](#2-expert-prompt-rewrite)
3. [Volatility-Adjusted Sizing](#3-volatility-adjusted-sizing)
4. [Integration Points](#4-integration-points)

---

## 1. Technical Indicator Engine

### New File: `src/analysis/indicators.ts`

Takes `HistoricalBar[]` (already returned by `getHistoricalBars()` in `src/broker/market-data.ts`) and computes all indicators. Pure math — no API calls, no AI cost.

### Input Type

```typescript
// Already exists in src/broker/market-data.ts
interface HistoricalBar {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}
```

### Output Type

```typescript
export interface TechnicalIndicators {
  symbol: string;
  computed: string; // ISO timestamp of computation

  // Trend
  sma20: number | null;
  sma50: number | null;
  sma200: number | null;
  trendAlignment: "strong_up" | "up" | "neutral" | "down" | "strong_down";
  // strong_up = price > SMA20 > SMA50 > SMA200
  // up = price > SMA50, SMA20 > SMA50
  // neutral = mixed signals
  // down = price < SMA50, SMA20 < SMA50
  // strong_down = price < SMA20 < SMA50 < SMA200
  priceVsSma20Pct: number | null; // % distance from SMA20
  priceVsSma50Pct: number | null;

  // Momentum
  rsi14: number | null;
  rsiRegime: "overbought" | "bullish" | "neutral" | "bearish" | "oversold" | null;
  // overbought > 70, bullish 55-70, neutral 45-55, bearish 30-45, oversold < 30
  macdLine: number | null;
  macdSignal: number | null;
  macdHistogram: number | null;
  macdCrossover: "bullish" | "bearish" | "none";
  // bullish = MACD crossed above signal in last 3 bars
  // bearish = MACD crossed below signal in last 3 bars

  // Volatility
  atr14: number | null;
  atrPercent: number | null; // ATR as % of current price
  bollingerUpper: number | null;
  bollingerMiddle: number | null; // = SMA20
  bollingerLower: number | null;
  bollingerPercentB: number | null; // (price - lower) / (upper - lower)
  // 0 = at lower band, 0.5 = at middle, 1 = at upper band

  // Volume
  volumeSma20: number | null;
  volumeRatio: number | null; // today's volume / 20-day avg
  volumeTrend: "increasing" | "stable" | "decreasing" | null;
  // increasing = 5-day avg volume > 20-day avg by >20%

  // Price Action
  distanceFromHigh52w: number | null; // % below 52-week high
  distanceFromLow52w: number | null;  // % above 52-week low
}
```

### Computation Functions

Each function operates on a `number[]` (closing prices or relevant series).

```typescript
/** Simple Moving Average */
function sma(data: number[], period: number): number | null {
  if (data.length < period) return null;
  const slice = data.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

/** Exponential Moving Average */
function ema(data: number[], period: number): number | null {
  if (data.length < period) return null;
  const k = 2 / (period + 1);
  let result = data.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < data.length; i++) {
    result = data[i]! * k + result * (1 - k);
  }
  return result;
}

/** RSI (Wilder's smoothing) */
function rsi(closes: number[], period: number = 14): number | null {
  if (closes.length < period + 1) return null;
  let avgGain = 0;
  let avgLoss = 0;
  // First average
  for (let i = 1; i <= period; i++) {
    const change = closes[i]! - closes[i - 1]!;
    if (change > 0) avgGain += change;
    else avgLoss += Math.abs(change);
  }
  avgGain /= period;
  avgLoss /= period;
  // Smoothed average
  for (let i = period + 1; i < closes.length; i++) {
    const change = closes[i]! - closes[i - 1]!;
    avgGain = (avgGain * (period - 1) + Math.max(0, change)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(0, -change)) / period;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

/** MACD (12, 26, 9) */
function macd(closes: number[]): {
  line: number | null;
  signal: number | null;
  histogram: number | null;
} {
  if (closes.length < 35) return { line: null, signal: null, histogram: null };
  // Need to compute EMA(12) and EMA(26) for each bar, then EMA(9) of the MACD line
  // Full implementation computes the series, returns the latest values
}

/** ATR (Average True Range) */
function atr(bars: HistoricalBar[], period: number = 14): number | null {
  if (bars.length < period + 1) return null;
  // True Range = max(high-low, |high-prevClose|, |low-prevClose|)
  const trueRanges: number[] = [];
  for (let i = 1; i < bars.length; i++) {
    const tr = Math.max(
      bars[i]!.high - bars[i]!.low,
      Math.abs(bars[i]!.high - bars[i - 1]!.close),
      Math.abs(bars[i]!.low - bars[i - 1]!.close),
    );
    trueRanges.push(tr);
  }
  // Wilder's smoothing
  let result = trueRanges.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < trueRanges.length; i++) {
    result = (result * (period - 1) + trueRanges[i]!) / period;
  }
  return result;
}

/** Bollinger Bands (20, 2) */
function bollingerBands(closes: number[], period: number = 20, mult: number = 2): {
  upper: number | null;
  middle: number | null;
  lower: number | null;
  percentB: number | null;
} {
  const middle = sma(closes, period);
  if (middle === null) return { upper: null, middle: null, lower: null, percentB: null };
  const slice = closes.slice(-period);
  const variance = slice.reduce((sum, v) => sum + (v - middle) ** 2, 0) / period;
  const stdDev = Math.sqrt(variance);
  const upper = middle + mult * stdDev;
  const lower = middle - mult * stdDev;
  const currentPrice = closes[closes.length - 1]!;
  const percentB = upper !== lower ? (currentPrice - lower) / (upper - lower) : 0.5;
  return { upper, middle, lower, percentB };
}
```

### Main Function

```typescript
/**
 * Compute all technical indicators from historical bars.
 * Requires at least 200 bars for SMA200. Falls back gracefully for shorter periods.
 * For full indicators: call getHistoricalBars(symbol, "1 Y")
 * For basic indicators: getHistoricalBars(symbol, "3 M") is sufficient (no SMA200)
 */
export function computeIndicators(symbol: string, bars: HistoricalBar[]): TechnicalIndicators {
  const closes = bars.map(b => b.close);
  const volumes = bars.map(b => b.volume);
  const currentPrice = closes[closes.length - 1]!;

  const sma20Val = sma(closes, 20);
  const sma50Val = sma(closes, 50);
  const sma200Val = sma(closes, 200);

  const rsi14Val = rsi(closes, 14);
  const macdResult = macd(closes);
  const atr14Val = atr(bars, 14);
  const bbands = bollingerBands(closes, 20, 2);

  const volumeSma20Val = sma(volumes, 20);
  const volume5Avg = sma(volumes.slice(-5), 5);
  const currentVolume = volumes[volumes.length - 1]!;

  // Derived classifications
  const trendAlignment = classifyTrend(currentPrice, sma20Val, sma50Val, sma200Val);
  const rsiRegime = classifyRsi(rsi14Val);
  const macdCrossover = detectMacdCrossover(bars, closes); // check last 3 bars
  const volumeTrend = classifyVolumeTrend(volume5Avg, volumeSma20Val);

  // 52-week high/low
  const high52w = Math.max(...bars.map(b => b.high));
  const low52w = Math.min(...bars.map(b => b.low));

  return {
    symbol,
    computed: new Date().toISOString(),
    sma20: sma20Val,
    sma50: sma50Val,
    sma200: sma200Val,
    trendAlignment,
    priceVsSma20Pct: sma20Val ? ((currentPrice - sma20Val) / sma20Val) * 100 : null,
    priceVsSma50Pct: sma50Val ? ((currentPrice - sma50Val) / sma50Val) * 100 : null,
    rsi14: rsi14Val,
    rsiRegime,
    macdLine: macdResult.line,
    macdSignal: macdResult.signal,
    macdHistogram: macdResult.histogram,
    macdCrossover,
    atr14: atr14Val,
    atrPercent: atr14Val ? (atr14Val / currentPrice) * 100 : null,
    bollingerUpper: bbands.upper,
    bollingerMiddle: bbands.middle,
    bollingerLower: bbands.lower,
    bollingerPercentB: bbands.percentB,
    volumeSma20: volumeSma20Val,
    volumeRatio: volumeSma20Val ? currentVolume / volumeSma20Val : null,
    volumeTrend,
    distanceFromHigh52w: high52w > 0 ? ((high52w - currentPrice) / high52w) * 100 : null,
    distanceFromLow52w: low52w > 0 ? ((currentPrice - low52w) / low52w) * 100 : null,
  };
}
```

### Human-Readable Summary Function

The agent receives raw numbers but also a pre-formatted text summary for its context window. This keeps the prompt clean and the indicator interpretation consistent.

```typescript
/**
 * Format indicators as a concise text block for injection into agent context.
 * ~100-150 tokens per symbol.
 */
export function formatIndicatorSummary(ind: TechnicalIndicators): string {
  const parts: string[] = [`${ind.symbol}:`];

  // Trend
  if (ind.trendAlignment) {
    parts.push(`Trend: ${ind.trendAlignment.replace("_", " ")}`);
  }
  if (ind.priceVsSma50Pct !== null) {
    parts.push(`Price vs SMA50: ${ind.priceVsSma50Pct > 0 ? "+" : ""}${ind.priceVsSma50Pct.toFixed(1)}%`);
  }

  // Momentum
  if (ind.rsi14 !== null) {
    parts.push(`RSI(14): ${ind.rsi14.toFixed(0)} (${ind.rsiRegime})`);
  }
  if (ind.macdCrossover !== "none") {
    parts.push(`MACD: ${ind.macdCrossover} crossover`);
  }

  // Volatility
  if (ind.atrPercent !== null) {
    parts.push(`ATR: ${ind.atrPercent.toFixed(1)}% daily`);
  }
  if (ind.bollingerPercentB !== null) {
    const bbPos =
      ind.bollingerPercentB > 0.8 ? "near upper band" :
      ind.bollingerPercentB < 0.2 ? "near lower band" : "mid-band";
    parts.push(`BB: ${bbPos} (${(ind.bollingerPercentB * 100).toFixed(0)}%B)`);
  }

  // Volume
  if (ind.volumeRatio !== null) {
    parts.push(`Volume: ${(ind.volumeRatio * 100).toFixed(0)}% of 20d avg`);
  }

  // 52-week position
  if (ind.distanceFromHigh52w !== null) {
    parts.push(`52w: ${ind.distanceFromHigh52w.toFixed(1)}% below high`);
  }

  return parts.join(" | ");
}
```

Example output:
```
SHEL: Trend: strong up | Price vs SMA50: +3.2% | RSI(14): 62 (bullish) | ATR: 2.1% daily | BB: mid-band (58%B) | Volume: 120% of 20d avg | 52w: 4.3% below high
```

### Data Duration Requirements

| Indicator | Min Bars Needed | Recommended `getHistoricalBars` Duration |
|-----------|----------------|------------------------------------------|
| SMA(20) | 20 | `"1 M"` |
| SMA(50) | 50 | `"3 M"` |
| SMA(200) | 200 | `"1 Y"` |
| RSI(14) | 15 | `"1 M"` |
| MACD(12,26,9) | 35 | `"3 M"` |
| ATR(14) | 15 | `"1 M"` |
| Bollinger(20,2) | 20 | `"1 M"` |
| 52-week range | 252 | `"1 Y"` |

**Strategy:** Fetch `"3 M"` for active trading ticks (gives everything except SMA200 and accurate 52w). Fetch `"1 Y"` during research pipeline (where we have more time/budget). Store the 52w high/low on the watchlist table so the active tick can reference it without fetching a year of bars.

### New Watchlist Column

Add `high52w` and `low52w` columns to `watchlist` table. Updated during research pipeline when 1Y bars are fetched:

```typescript
// In schema.ts — add to watchlist table
high52w: real("high_52w"),
low52w: real("low_52w"),
```

---

## 2. Contextual Judgment Prompt (replaces multi-factor scoring)

> **Signal Architecture change:** The AI's job is NOT to score five factors. It's to evaluate whether the mechanical signals (from the momentum gate and indicator engine) are trustworthy in context. The gate handles the quantitative filtering; the AI handles the qualitative judgment. See [strategy-framework.md](./strategy-framework.md).

### Current Prompt Problems

1. "Look for pullbacks in uptrends" — no definition of what constitutes an uptrend or a pullback
2. "Take profits at sensible targets (typically 5-10%)" — arbitrary, not volatility-adjusted
3. "Always set stop losses at -3% from entry" — same stop for a 1% ATR stock and a 5% ATR stock
4. "Be patient - no trade is better than a bad trade" — vague
5. No quantitative scoring framework — the agent makes gut calls
6. No reference to technical indicators (because they don't exist yet)

### New Prompt: `TRADING_ANALYST_SYSTEM`

```typescript
export const TRADING_ANALYST_SYSTEM = `You are an expert equity trader managing a UK Stocks & Shares ISA.

## Constraints (ISA Rules — Non-Negotiable)
- Cash account only (no margin, no leverage)
- Long only (no short selling)
- LSE and US (NASDAQ/NYSE) listed equities

## Your Role

You receive **momentum-qualified candidates** — stocks where mechanical indicators confirm an uptrend with building momentum and adequate volume. The momentum gate has already filtered for:
- Trend alignment (price above SMA50, SMA20 > SMA50)
- RSI in the 45-75 range (building, not exhausted)
- Volume at least 80% of 20-day average
- Not overbought (RSI < 75)

Your job is NOT to re-evaluate what the indicators already tell you.
Your job IS to identify reasons the signals might be misleading.

## For Each Candidate, Evaluate:

### 1. SUSTAINABILITY — Is this momentum real?
- Recent catalyst (earnings beat, upgrade, sector rotation) → supports entry
- No identifiable driver → caution, may be noise
- Negative catalyst masked by market-wide rally → avoid

### 2. RISK EVENTS — Is there something the indicators can't see?
- Earnings within 5 trading days → flag (could accelerate OR reverse)
- Regulatory/legal risk mentioned in research → flag
- Sector rotation away from this name → flag

### 3. POSITION CONTEXT — Does this trade fit the portfolio?
- Sector concentration after this trade
- Correlation with existing positions
- Available risk budget

## Output For Each Candidate:
- **act**: boolean — should we enter?
- **confidence**: 0.0–1.0
- **reasoning**: why act or why pass (max 200 chars)
- **override_reason**: if passing on a gate-qualified candidate, structured reason (e.g. "earnings_imminent", "no_catalyst", "sector_concentrated", "extended_rally")
- If acting: **limitPrice**, **stopLoss** (2×ATR from indicators), **shares** (from risk budget)

## Position Management

For existing positions:
- Check if trailing stop should trigger (Guardian handles this automatically, but flag if you see reasons to exit early)
- Evaluate if the thesis has changed based on new information
- Recommend: hold, exit early, or let trailing stop manage

## Available Tools
You have access to these tools — use them proactively:
- **get_watchlist**: See all tracked stocks with scores and technical indicators
- **get_recent_research**: Check existing research (quality filter, catalyst, bull/bear case)
- **research_symbol**: Run FRESH research. Use if stale (>24h) or missing. Always before trading.
- **get_quote / get_multiple_quotes**: Current market prices
- **get_historical_bars**: Price history (indicators are pre-computed)
- **get_account_summary / get_positions**: Portfolio state
- **check_risk / get_max_position_size**: Risk checks (mandatory before trading)
- **place_trade**: Execute a trade
- **cancel_order**: Cancel a pending order
- **get_recent_trades**: Trading history
- **search_contracts**: Find stocks (LSE and US exchanges)
- **log_decision**: Record observations to audit trail
- **log_intention**: Record a conditional plan for future ticks

## Learning From Experience
You receive a learning brief with insights from recent trade analysis.
Treat [CRITICAL] and [WARNING] items as hard constraints.
If your strategy journal lists a hypothesis as CONFIRMED, incorporate it.
`;
```

### AI Override Attribution Logging

When the AI passes on a gate-qualified candidate, the override reason is logged as a structured field for Phase 3 measurement:

```typescript
interface AIOverrideLog {
  symbol: string;
  gateResult: "passed";
  aiDecision: "act" | "pass";
  overrideReason: string | null; // null if acting, structured reason if passing
  confidence: number;
  signalState: Record<string, unknown>; // full signal snapshot at decision time
  timestamp: string;
}
```

Phase 3's decision scorer measures the AI's hit rate on contextual overrides: when the AI passes on a gate-qualified stock, was the stock's subsequent performance better or worse than acting would have been?

### New Prompt: `MINI_ANALYSIS_PROMPT`

```typescript
export const MINI_ANALYSIS_PROMPT = `Analyze current market conditions and portfolio.

For each position:
- Has the thesis changed? Any new risk events?
- Is the trailing stop at an appropriate level?
- Recommend: hold, exit early, or let trailing stop manage

For gate-qualified watchlist candidates:
- Evaluate sustainability, risk events, and position context
- Only recommend entries where you see genuine conviction
- Calculate ATR-based position size, stop, and target

For pending orders:
- Should they be cancelled, adjusted, or left alone?

For logged intentions from previous ticks:
- Have any conditions been met? If so, evaluate and potentially act.

Be decisive. The gate has already filtered for momentum. Your job is the sanity check.`;
```

### New Prompt: `DAY_PLAN_PROMPT`

```typescript
export const DAY_PLAN_PROMPT = `Create today's trading plan.

Review:
1. Overnight news and any catalysts affecting positions or watchlist
2. Current positions — any thesis changes? Risk events? Let trailing stops manage or exit early?
3. Watchlist — which gate-qualified candidates look most promising? What would change your mind?
4. Risk budget — how much capital is available? How many position slots are open?
5. Learning brief — incorporate any warnings or confirmed hypotheses

Output:
- Positions to monitor with specific notes on thesis strength
- Watchlist stocks to watch with entry conditions
- Maximum new positions today (considering open positions and risk budget)
- Any sectors or patterns to avoid per the learning brief

Be specific about conditions. The indicators are provided — focus on what they can't tell you.`;
```

---

## 3. Volatility-Adjusted Sizing + Trailing Stops

> **Signal Architecture change:** Extends ATR sizing with trailing stop logic. Replaces fixed profit targets with trend-following exits. See [strategy-framework.md](./strategy-framework.md).

### Changes to `src/risk/limits.ts`

Replace fixed stop loss with ATR-based config:

```typescript
// Replace:
PER_TRADE_STOP_LOSS_PCT: 3,

// With:
STOP_LOSS_ATR_MULTIPLIER: 2,    // Stop at 2 × ATR below entry
TARGET_ATR_MULTIPLIER: 3,       // Minimum target at 3 × ATR above entry
RISK_PER_TRADE_PCT: 1,          // Risk 1% of portfolio per trade
TRAILING_STOP_ATR_MULTIPLIER: 2, // Trail stop at 2 × ATR below highest close
```

### Changes to `src/risk/manager.ts`

Add a new function for ATR-based sizing:

```typescript
export interface AtrPositionSize {
  maxQuantity: number;
  maxValue: number;
  stopLossPrice: number;
  targetPrice: number;
  riskPerShare: number;
  riskTotal: number;
}

/**
 * Calculate position size using ATR-based risk management.
 * Risk per trade = RISK_PER_TRADE_PCT of portfolio.
 * Stop distance = STOP_LOSS_ATR_MULTIPLIER × ATR.
 * Position size = risk budget / stop distance.
 * Cross-check against existing hard limits (5% max position, £50k cap, cash reserve).
 */
export async function getAtrPositionSize(
  price: number,
  atr: number,
): Promise<AtrPositionSize> {
  const account = await getAccountSummary();

  // ATR-based sizing
  const riskPerShare = atr * HARD_LIMITS.STOP_LOSS_ATR_MULTIPLIER;
  const riskBudget = (account.netLiquidation * HARD_LIMITS.RISK_PER_TRADE_PCT) / 100;
  const atrBasedQuantity = Math.floor(riskBudget / riskPerShare);
  const atrBasedValue = atrBasedQuantity * price;

  // Cross-check against existing limits
  const pctLimit = (account.netLiquidation * HARD_LIMITS.MAX_POSITION_PCT) / 100;
  const gbpLimit = HARD_LIMITS.MAX_POSITION_GBP;
  const availableCash = account.totalCashValue -
    (account.netLiquidation * HARD_LIMITS.MIN_CASH_RESERVE_PCT) / 100;

  const maxValue = Math.min(atrBasedValue, pctLimit, gbpLimit, Math.max(0, availableCash));
  const maxQuantity = Math.floor(maxValue / price);

  const stopLossPrice = price - riskPerShare;
  const targetPrice = price + atr * HARD_LIMITS.TARGET_ATR_MULTIPLIER;

  return {
    maxQuantity,
    maxValue,
    stopLossPrice,
    targetPrice,
    riskPerShare,
    riskTotal: maxQuantity * riskPerShare,
  };
}
```

### Trailing Stop Logic

> Replaces fixed profit targets with trend-following exits. The stop only moves up, never down.

**Schema change — add to `positions` table:**

```typescript
highWaterMark: real("high_water_mark"),     // highest close since entry
trailingStopPrice: real("trailing_stop_price"), // current trailing stop level
```

**Guardian integration — `src/broker/guardian.ts`:**

```typescript
/**
 * Update trailing stops during each Guardian tick.
 * For each position with ATR data:
 * 1. If current price > highWaterMark, update highWaterMark
 * 2. Recalculate trailingStopPrice = highWaterMark - (2 × ATR)
 * 3. Never move stop down — only up
 * 4. If current price <= trailingStopPrice, trigger sell
 */
async function updateTrailingStops(positions: Position[]): Promise<void> {
  for (const pos of positions) {
    if (!pos.highWaterMark || !pos.atr14) continue;

    const currentPrice = pos.currentPrice ?? 0;
    const newHighWater = Math.max(pos.highWaterMark, currentPrice);
    const newTrailingStop = newHighWater - (pos.atr14 * HARD_LIMITS.TRAILING_STOP_ATR_MULTIPLIER);

    // Never move stop down
    const effectiveStop = Math.max(newTrailingStop, pos.trailingStopPrice ?? 0);

    await db.update(positions).set({
      highWaterMark: newHighWater,
      trailingStopPrice: effectiveStop,
    }).where(eq(positions.id, pos.id));

    if (currentPrice <= effectiveStop && currentPrice > 0) {
      // Trigger trailing stop sell
      await placeTrade({
        symbol: pos.symbol,
        exchange: pos.exchange,
        side: "SELL",
        quantity: pos.quantity,
        orderType: "MKT",
        reason: `Trailing stop hit: price ${currentPrice} <= stop ${effectiveStop.toFixed(2)}`,
      });
    }
  }
}
```

**On position entry:** Set `highWaterMark = entryPrice` and `trailingStopPrice = entryPrice - (2 × ATR)`.

### Changes to `src/agent/tools.ts`

Update the `get_max_position_size` tool to accept optional ATR:

```typescript
{
  name: "get_max_position_size",
  description: "Calculate the maximum position size for a given stock price. If ATR is provided, uses volatility-adjusted sizing (recommended). Without ATR, uses fixed percentage limits.",
  input_schema: {
    type: "object" as const,
    properties: {
      price: { type: "number", description: "Current stock price in GBP" },
      atr: { type: "number", description: "14-day Average True Range (from indicators). Recommended for proper position sizing." },
    },
    required: ["price"],
  },
}
```

### Changes to `calculateStopLoss`

Replace the fixed calculation:

```typescript
// Replace:
export function calculateStopLoss(entryPrice: number): number {
  return entryPrice * (1 - HARD_LIMITS.PER_TRADE_STOP_LOSS_PCT / 100);
}

// With:
export function calculateStopLoss(entryPrice: number, atr?: number): number {
  if (atr) {
    return entryPrice - atr * HARD_LIMITS.STOP_LOSS_ATR_MULTIPLIER;
  }
  // Fallback to 3% if ATR not available
  return entryPrice * (1 - 3 / 100);
}
```

---

## 4. Integration Points

### Where Indicators Get Computed

| Context | When | Duration Fetched | What's Included |
|---------|------|-----------------|-----------------|
| **Active trading tick (Tier 3)** | Every Sonnet escalation | `"3 M"` | Full indicators minus SMA200 |
| **Research pipeline** | Daily 18:00 | `"1 Y"` | Full indicators + 52w range stored on watchlist |
| **Day plan (pre-market)** | Daily 07:30 | `"3 M"` | Full indicators for positions + top watchlist |

### Changes to `src/agent/orchestrator.ts`

> **Signal Architecture change:** Tier 2 gains a code-level momentum gate. Candidates that fail the gate are logged but never escalated to Tier 3 (Sonnet). This replaces vibes-based Haiku escalation with deterministic signal-based filtering. See [strategy-framework.md](./strategy-framework.md).

**Momentum gate at Tier 2:**

```typescript
// New file or section: src/analysis/momentum-gate.ts

interface MomentumGate {
  trendAlignment: ("strong_up" | "up")[];
  rsiRange: [number, number]; // default [45, 75]
  minVolumeRatio: number;     // default 0.8
  excludeOverbought: boolean; // default true
}

// Stored in versioned config file, not hard-coded
// Strategy journal (Phase 3) can propose changes to these parameters
const DEFAULT_GATE: MomentumGate = {
  trendAlignment: ["strong_up", "up"],
  rsiRange: [45, 75],
  minVolumeRatio: 0.8,
  excludeOverbought: true,
};

interface GateResult {
  passed: boolean;
  reasons: string[];       // why it passed or failed
  signalState: Record<string, unknown>; // full signal snapshot for Phase 3 logging
}

function evaluateGate(indicators: TechnicalIndicators, gate: MomentumGate): GateResult {
  const reasons: string[] = [];
  let passed = true;

  if (!gate.trendAlignment.includes(indicators.trendAlignment as "strong_up" | "up")) {
    reasons.push(`trend_alignment=${indicators.trendAlignment} (need ${gate.trendAlignment.join("|")})`);
    passed = false;
  }

  if (indicators.rsi14 !== null) {
    if (indicators.rsi14 < gate.rsiRange[0] || indicators.rsi14 > gate.rsiRange[1]) {
      reasons.push(`rsi=${indicators.rsi14.toFixed(0)} (need ${gate.rsiRange[0]}-${gate.rsiRange[1]})`);
      passed = false;
    }
  }

  if (indicators.volumeRatio !== null && indicators.volumeRatio < gate.minVolumeRatio) {
    reasons.push(`volume_ratio=${indicators.volumeRatio.toFixed(2)} (need >=${gate.minVolumeRatio})`);
    passed = false;
  }

  if (gate.excludeOverbought && indicators.rsiRegime === "overbought") {
    reasons.push("rsi_overbought");
    passed = false;
  }

  if (passed) {
    reasons.push("all_gates_passed");
  }

  return {
    passed,
    reasons,
    signalState: {
      trendAlignment: indicators.trendAlignment,
      rsi14: indicators.rsi14,
      rsiRegime: indicators.rsiRegime,
      volumeRatio: indicators.volumeRatio,
      macdCrossover: indicators.macdCrossover,
      atrPercent: indicators.atrPercent,
      bollingerPercentB: indicators.bollingerPercentB,
    },
  };
}
```

**Every gate evaluation (pass or fail) logs full signal state** to `agent_logs` for Phase 3 learning loop analysis. Gate fail = no Sonnet call, skip to next candidate.

**In `onActiveTradingTick()` — Tier 2 with momentum gate:**

```typescript
// For each watchlist candidate being considered for escalation:
for (const item of watchlistItems.slice(0, 10)) {
  const indicators = await getIndicatorsForSymbol(item.symbol, "3 M");
  if (!indicators) continue;

  const gateResult = evaluateGate(indicators, loadGateConfig());

  // Log signal state regardless of pass/fail (Phase 3 needs both)
  await logAgentAction("GATE_EVALUATION", {
    symbol: item.symbol,
    passed: gateResult.passed,
    reasons: gateResult.reasons,
    signalState: gateResult.signalState,
  });

  if (!gateResult.passed) continue; // No Sonnet call — skip

  // Gate passed → escalate to Tier 3 with full context
  gatePassedCandidates.push({ item, indicators });
}

// Only gate-passed candidates get Sonnet evaluation
```

**In `onPreMarket()` — day plan context:**

Same pattern. Compute indicators for all positions + top 10 watchlist. No gate filtering for day plan (agent sees everything for planning).

### Changes to `src/research/pipeline.ts`

**In `researchSymbol()`:**

```typescript
// After getting historical bars:
let indicators: TechnicalIndicators | null = null;
if (historicalBars && historicalBars.length > 0) {
  indicators = computeIndicators(symbol, historicalBars);
}

// For 1Y fetches during pipeline (not on-demand research):
// Update watchlist 52w high/low
if (historicalBars && historicalBars.length > 50) {
  const high52w = Math.max(...historicalBars.map(b => b.high));
  const low52w = Math.min(...historicalBars.map(b => b.low));
  await db.update(watchlist).set({ high52w, low52w }).where(eq(watchlist.symbol, symbol));
}

// Pass indicators to analyzer for richer analysis context
const analysis = await analyzeStock(symbol, {
  quote,
  fundamentals,
  news: newsItems,
  historicalBars,
  indicators, // NEW
});
```

### Changes to `src/research/analyzer.ts`

Update the analysis prompt to include indicator summary when available:

```typescript
const prompt = `Analyze ${symbol} (LSE) based on this data:

Quote: ${JSON.stringify(data.quote ?? "N/A")}
Fundamentals: ${JSON.stringify(data.fundamentals ?? "N/A")}
Recent News: ${JSON.stringify(data.news ?? "N/A")}
Price History: ${JSON.stringify(data.historicalBars ?? "N/A")}
${data.indicators ? `Technical Indicators: ${formatIndicatorSummary(data.indicators)}` : ""}

Provide your analysis as JSON.`;
```

### IBKR Rate Limiting Consideration

Computing indicators for 5-10 symbols requires fetching 3M of bars for each. At 40 req/sec IBKR limit, this is well within budget (each `getHistoricalBars` is 1 request). However, during Tier 3 escalation this adds ~5-10 seconds of latency.

**Mitigation:** Cache bars in memory during the trading day. A stock's 3M bars don't change minute-to-minute — the last bar updates but the history is static. Cache key: `${symbol}:${date}`. Invalidate daily.

```typescript
// In src/analysis/indicators.ts
const barsCache = new Map<string, { bars: HistoricalBar[]; fetchedAt: number }>();
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

export async function getIndicatorsForSymbol(
  symbol: string,
  duration: string = "3 M"
): Promise<TechnicalIndicators | null> {
  const cacheKey = `${symbol}:${duration}`;
  const cached = barsCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL) {
    return computeIndicators(symbol, cached.bars);
  }
  try {
    const bars = await getHistoricalBars(symbol, duration);
    barsCache.set(cacheKey, { bars, fetchedAt: Date.now() });
    return computeIndicators(symbol, bars);
  } catch {
    return null;
  }
}
```

---

## Exit Gate

Phase 2 is complete when ALL of the following are met:

- **Gate operating deterministically:** Momentum gate evaluates all watchlist candidates at Tier 2. Gate pass/fail logged with full signal state. No Sonnet calls for gate-failed candidates.
- **Shadow evaluation (1-2 weeks):** Run gate-only decisions alongside gate+AI decisions in parallel. Track:
  - Gate-only hit rate: % of gate-passed stocks that would have been profitable entries
  - Gate+AI hit rate: % of AI-approved entries that were profitable
  - AI override value-add: did the AI's passes on gate-qualified stocks avoid losses? Measured as: (gate-only expectancy) vs (gate+AI expectancy)
- **AI override non-negative:** AI override must show non-negative value before full reliance. If AI passes are worse than random (i.e., the stocks it rejected performed better than the ones it approved), reduce AI weight and investigate.
- **Signal logging:** All signal states (Layer 1 indicators + gate result + AI decision) logged for every evaluation. Phase 3 can query this data.
- **Trailing stops operating:** Positions have `highWaterMark` and `trailingStopPrice` updating on every Guardian tick. At least one trailing stop adjustment observed in production.
- **No regression:** Indicator computation completes within tick budget. No increase in Sonnet costs (gate should reduce Sonnet calls).

KPI baselines to establish:
- Gate pass rate: % of candidates that pass momentum gate (expect 20-40%)
- AI approval rate: % of gate-passed candidates the AI approves (expect 40-70%)
- Sonnet call reduction: % fewer Sonnet calls vs pre-gate baseline
- Signal-level win/loss by `trendAlignment` and `rsiRegime` (initial data for Phase 3)

---

## Summary of Files Changed/Created

| File | Action | What |
|------|--------|------|
| `src/analysis/indicators.ts` | **NEW** | Technical indicator computation + formatting |
| `src/analysis/momentum-gate.ts` | **NEW** | Momentum gate evaluation + config loading |
| `src/agent/prompts/trading-analyst.ts` | **REWRITE** | Contextual judgment prompt (replaces multi-factor scoring) |
| `src/agent/orchestrator.ts` | **MODIFY** | Momentum gate at Tier 2, indicator context, AI override logging |
| `src/agent/tools.ts` | **MODIFY** | Update `get_max_position_size` to accept ATR |
| `src/risk/limits.ts` | **MODIFY** | Replace fixed stop with ATR multipliers, add trailing stop config |
| `src/risk/manager.ts` | **MODIFY** | Add `getAtrPositionSize()`, update `calculateStopLoss()` |
| `src/broker/guardian.ts` | **MODIFY** | Add trailing stop logic (`updateTrailingStops()`) |
| `src/research/pipeline.ts` | **MODIFY** | Compute indicators during research, store 52w range |
| `src/research/analyzer.ts` | **MODIFY** | Include indicator summary in analysis prompt |
| `src/db/schema.ts` | **MODIFY** | Add `high52w`, `low52w` to watchlist; add `highWaterMark`, `trailingStopPrice` to positions |

**AI cost impact:** Gate should _reduce_ Sonnet costs by filtering candidates before Tier 3. Indicator computation is pure math ($0).
