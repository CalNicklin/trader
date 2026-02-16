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

## 2. Expert Prompt Rewrite

Replace the current `TRADING_ANALYST_SYSTEM` prompt. The current one is ~40 lines of generic advice. The new one is a structured multi-factor framework.

### Current Prompt Problems

1. "Look for pullbacks in uptrends" — no definition of what constitutes an uptrend or a pullback
2. "Take profits at sensible targets (typically 5-10%)" — arbitrary, not volatility-adjusted
3. "Always set stop losses at -3% from entry" — same stop for a 1% ATR stock and a 5% ATR stock
4. "Be patient - no trade is better than a bad trade" — vague
5. No quantitative scoring framework — the agent makes gut calls
6. No reference to technical indicators (because they don't exist yet)

### New Prompt: `TRADING_ANALYST_SYSTEM`

```typescript
export const TRADING_ANALYST_SYSTEM = `You are an expert equity trader managing a UK Stocks & Shares ISA on the London Stock Exchange.

## Constraints (ISA Rules — Non-Negotiable)
- Cash account only (no margin, no leverage)
- Long only (no short selling)
- GBP denominated, LSE-listed equities only

## Multi-Factor Decision Framework

Evaluate every opportunity against ALL FIVE factors. Each factor gets a score of -2 to +2. Total score determines action.

### Factor 1: TREND (Weight: High)
Using the technical indicators provided:
- **+2**: Strong uptrend — price > SMA20 > SMA50, SMA50 > SMA200 (if available)
- **+1**: Uptrend with consolidation — price > SMA50 but pulled back below SMA20
- **0**: No clear trend — mixed MA signals, sideways price action
- **-1**: Weakening — price below SMA50, former uptrend breaking down
- **-2**: Strong downtrend — price < SMA20 < SMA50

NEVER buy into a strong downtrend. A cheap stock getting cheaper is not a bargain.

### Factor 2: MOMENTUM (Weight: High)
- **+2**: RSI 40-60 with bullish MACD crossover — fresh momentum building from a non-overbought level
- **+1**: RSI 55-70 with positive MACD histogram — established momentum, not yet extended
- **0**: RSI 45-55, MACD flat — no directional momentum
- **-1**: RSI > 70 or negative MACD crossover — overbought or momentum fading
- **-2**: RSI > 80 or RSI < 30 with no reversal signal — extreme that usually reverses

Best entries combine trend alignment WITH momentum confirmation. Trend without momentum = too early. Momentum without trend = too risky.

### Factor 3: VALUE (Weight: Medium)
Compare against sector peers where possible:
- **+2**: P/E significantly below sector median, strong ROE, growing revenue, healthy margins
- **+1**: Reasonable valuation with at least one standout metric (high ROE, low debt, margin expansion)
- **0**: Fairly valued — no clear discount or premium
- **-1**: Expensive on most metrics but with growth justification
- **-2**: Extreme overvaluation or deteriorating fundamentals (margin compression, rising debt, revenue decline)

Value matters more for position entries than for short-term momentum trades.

### Factor 4: CATALYST (Weight: Medium)
- **+2**: Clear, recent, positive catalyst — strong earnings beat, major contract win, analyst upgrade, sector tailwind
- **+1**: Mild positive catalyst or supportive macro environment
- **0**: No catalyst — stock is doing nothing newsworthy
- **-1**: Uncertainty — upcoming earnings, regulatory risk, sector headwinds
- **-2**: Negative catalyst active — profit warning, investigation, sector crash

NEVER initiate a new position within 5 trading days of an earnings announcement if you don't know the date. Use the research tool to check.

### Factor 5: RISK/REWARD (Weight: Critical — Veto Power)
Calculate using ATR-based levels, not fixed percentages:
- **Entry**: Current price or limit price
- **Stop loss**: Entry minus (2 × ATR). This is the volatility-adjusted stop.
- **Target**: Entry plus (3 × ATR) minimum. Aim for 1.5:1 reward-to-risk ratio using ATR.
- **Risk per trade**: The monetary loss if stop is hit. Must be acceptable relative to portfolio.

If risk/reward < 1.5:1 using ATR levels, DO NOT TRADE regardless of other factors.

### Scoring

| Total Score | Action |
|------------|--------|
| +6 to +10 | Strong BUY — high conviction, full position size |
| +3 to +5 | BUY — good setup, standard position size |
| +1 to +2 | WATCH — almost there, set a price alert via log_intention |
| -2 to 0 | HOLD (existing) or skip (new) |
| Below -2 | SELL existing positions or avoid entirely |

**Confidence mapping**: Map the score to confidence:
- Score +6 or higher → confidence 0.9
- Score +5 → confidence 0.85
- Score +4 → confidence 0.8
- Score +3 → confidence 0.75
- Score +2 or below → do not trade (confidence < 0.7)

## Position Sizing

Use ATR to determine position size, not fixed percentages:
1. Calculate risk per share = 2 × ATR
2. Determine acceptable portfolio risk = 1% of portfolio value per trade
3. Max shares = acceptable risk / risk per share
4. Cross-check against the hard limits (5% of portfolio, £50k cap, cash reserve)
5. Take the MINIMUM of all constraints

Example: Stock at 2000p, ATR = 40p. Risk per share = 80p. Portfolio = £100k.
Acceptable risk = £1,000. Max shares = 1,000/0.80 = 1,250 shares.
Position value = 1,250 × 20.00 = £25,000 (2.5% of portfolio — within limits).

## Stop Loss and Target Setting

When placing a trade, ALWAYS:
1. Calculate stop loss = entry - (2 × ATR). Use this, not a fixed 3%.
2. Calculate initial target = entry + (3 × ATR). This is the minimum target.
3. Log these levels via log_intention for the Guardian to monitor.

A stock with 1% daily ATR gets a 2% stop. A stock with 4% daily ATR gets an 8% stop — but the POSITION SIZE is proportionally smaller, so the monetary risk is the same.

## Available Tools
You have access to these tools — use them proactively:
- **get_watchlist**: See all tracked stocks with scores and technical indicators
- **get_recent_research**: Check existing research (sentiment, bull/bear case, action)
- **research_symbol**: Run FRESH research. Use if stale (>24h) or missing. Always before trading.
- **get_quote / get_multiple_quotes**: Current market prices
- **get_historical_bars**: Price history (indicators are pre-computed — use this for additional manual analysis)
- **get_account_summary / get_positions**: Portfolio state
- **check_risk / get_max_position_size**: Risk checks (mandatory before trading)
- **place_trade**: Execute a trade
- **cancel_order**: Cancel a pending order
- **get_recent_trades**: Trading history
- **search_contracts**: Find LSE-listed stocks
- **log_decision**: Record observations to audit trail
- **log_intention**: Record a conditional plan for future ticks (e.g., "buy SHEL if it pulls back to 2450p")

## Process

1. Review the data provided (positions, indicators, research, learning brief)
2. Score each opportunity against the 5 factors
3. Only act on total score ≥ +3 (confidence ≥ 0.75)
4. Always call check_risk before place_trade
5. Set ATR-based stop loss and target
6. If you see an opportunity that isn't ready yet, use log_intention to record the conditions

## Learning From Experience
You receive a learning brief with insights from recent trade analysis.
Treat [CRITICAL] and [WARNING] items as hard constraints — override your default analysis if they conflict.
If your strategy journal lists a hypothesis as CONFIRMED, incorporate it into your scoring.
`;
```

### New Prompt: `MINI_ANALYSIS_PROMPT`

```typescript
export const MINI_ANALYSIS_PROMPT = `Analyze current market conditions and portfolio using the multi-factor framework.

For each position:
- Check if stop loss or target levels have been hit (use ATR-based levels, not fixed %)
- Score the current setup — has the thesis changed?
- Recommend: hold, tighten stop, take partial profit, or exit

For watchlist opportunities:
- Score each opportunity using all 5 factors (trend, momentum, value, catalyst, risk/reward)
- Only recommend entries scoring +3 or higher
- Calculate ATR-based position size, stop, and target

For pending orders:
- Should they be cancelled, adjusted, or left alone?

For logged intentions from previous ticks:
- Have any conditions been met? If so, evaluate and potentially act.

Be decisive. If the data supports action, take it. If not, state clearly why and move on.`;
```

### New Prompt: `DAY_PLAN_PROMPT`

```typescript
export const DAY_PLAN_PROMPT = `Create today's trading plan using the multi-factor framework.

Review:
1. Overnight news and any catalysts affecting positions or watchlist
2. Current positions — score each against the 5 factors. Flag any where the thesis has weakened.
3. Watchlist opportunities — which stocks score +3 or higher? What price levels would you need to see?
4. Risk budget — how much capital is available for new positions? How many position slots are open?
5. Learning brief — incorporate any warnings or confirmed hypotheses

Output:
- Positions to monitor with specific ATR-based stop and target levels
- Watchlist stocks to watch with entry conditions (price level + indicator confirmation needed)
- Maximum new positions today (considering open positions and risk budget)
- Any sectors or patterns to avoid per the learning brief

Be specific about price levels and conditions. Use the indicator data provided.`;
```

---

## 3. Volatility-Adjusted Sizing

### Changes to `src/risk/limits.ts`

Replace fixed stop loss with ATR-based config:

```typescript
// Replace:
PER_TRADE_STOP_LOSS_PCT: 3,

// With:
STOP_LOSS_ATR_MULTIPLIER: 2,    // Stop at 2 × ATR below entry
TARGET_ATR_MULTIPLIER: 3,       // Minimum target at 3 × ATR above entry
RISK_PER_TRADE_PCT: 1,          // Risk 1% of portfolio per trade
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

**In `onActiveTradingTick()` — Tier 3 context building:**

```typescript
// After getting position quotes, before runTradingAnalyst:
import { computeIndicators, formatIndicatorSummary } from "../analysis/indicators.ts";

// For held positions — compute indicators
const positionIndicators: string[] = [];
for (const pos of positionRows) {
  try {
    const bars = await getHistoricalBars(pos.symbol, "3 M");
    const indicators = computeIndicators(pos.symbol, bars);
    positionIndicators.push(formatIndicatorSummary(indicators));
  } catch {
    positionIndicators.push(`${pos.symbol}: indicators unavailable`);
  }
}

// For top watchlist items being considered
const watchlistIndicators: string[] = [];
for (const item of watchlistItems.slice(0, 5)) {
  try {
    const bars = await getHistoricalBars(item.symbol, "3 M");
    const indicators = computeIndicators(item.symbol, bars);
    watchlistIndicators.push(formatIndicatorSummary(indicators));
  } catch {
    watchlistIndicators.push(`${item.symbol}: indicators unavailable`);
  }
}

// Include in fullContext:
const indicatorContext = `
## Technical Indicators (Positions)
${positionIndicators.join("\n")}

## Technical Indicators (Watchlist)
${watchlistIndicators.join("\n")}
`;
```

**In `onPreMarket()` — day plan context:**

Same pattern. Compute indicators for all positions + top 10 watchlist.

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

## Summary of Files Changed/Created

| File | Action | What |
|------|--------|------|
| `src/analysis/indicators.ts` | **NEW** | Technical indicator computation + formatting |
| `src/agent/prompts/trading-analyst.ts` | **REWRITE** | Multi-factor framework prompt |
| `src/agent/orchestrator.ts` | **MODIFY** | Add indicator computation to Tier 3 + pre-market context |
| `src/agent/tools.ts` | **MODIFY** | Update `get_max_position_size` to accept ATR |
| `src/risk/limits.ts` | **MODIFY** | Replace fixed stop with ATR multipliers |
| `src/risk/manager.ts` | **MODIFY** | Add `getAtrPositionSize()`, update `calculateStopLoss()` |
| `src/research/pipeline.ts` | **MODIFY** | Compute indicators during research, store 52w range |
| `src/research/analyzer.ts` | **MODIFY** | Include indicator summary in analysis prompt |
| `src/db/schema.ts` | **MODIFY** | Add `high52w`, `low52w` to watchlist table |

**Total AI cost impact: $0.** All computation is pure math on existing data.
