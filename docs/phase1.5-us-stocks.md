# Phase 1.5: US Stock Support

> Proposal to open the trading universe to US-listed equities alongside existing LSE support.
> This is the single highest-impact change for return potential: friction per trade drops ~6–9x.

---

## Why This Matters

| Metric | LSE Only | LSE + US |
|--------|----------|----------|
| Stamp duty per buy | 0.50% | 0% (US), 0.50% (LSE) |
| Typical bid-ask spread | 0.10–0.30% | 0.01–0.05% (US large cap) |
| IBKR commission | £3–5 | ~$1 fixed (US) |
| Round-trip friction | ~0.70–1.00% | ~0.05–0.15% (US) |
| Break-even annual return (£20K) | 5–9% | 1.5–2% (US-heavy) |
| FMP screener compatibility | Workaround (country=GB + search-name) | Native (exchange=NASDAQ/NYSE) |
| Yahoo Finance data quality | Partial (`.L` suffix, some gaps) | Full (native US support) |
| AI training data coverage | Limited UK market knowledge | Deep US market knowledge |
| Tradeable universe | ~1,500 stocks | ~4,000 US + ~1,500 UK |

The platform's infrastructure (three-tier architecture, Guardian, risk pipeline, learning loop) is exchange-agnostic. The LSE coupling is entirely in the data layer: contract construction, symbol resolution, quote fetching, and screening. This proposal replaces those LSE-specific paths with exchange-aware alternatives.

---

## Design Principle: Exchange as First-Class Concept

Currently, symbols are bare strings (`"SHEL"`, `"AZN"`) and every code path assumes LSE/GBP. The core change is making **exchange** an explicit property that flows through the system.

```
Before:  symbol → lseStock(symbol) → IBKR
After:   symbol + exchange → getContract(symbol, exchange) → IBKR
```

Every table that stores a symbol gets an `exchange` column. Every function that builds a contract, fetches a quote, or checks risk receives exchange context.

### Exchange Values

Use IBKR's `primaryExch` values as the canonical identifiers:

| Exchange | IBKR primaryExch | Currency | Stamp Duty | Yahoo Suffix |
|----------|-----------------|----------|------------|-------------|
| LSE | `"LSE"` | GBP | 0.5% (main market), 0% (AIM) | `.L` |
| NASDAQ | `"NASDAQ"` | USD | 0% | none |
| NYSE | `"NYSE"` | USD | 0% | none |

Type definition:

```typescript
type Exchange = "LSE" | "NASDAQ" | "NYSE";
```

---

## Step-by-Step Implementation

### Step 1.5.1 — Exchange-aware contract building

**Files:** `src/broker/contracts.ts`

**What to do:**
- Keep `lseStock()` as-is (existing callers still work during migration)
- Add `usStock(symbol: string, exchange: "NASDAQ" | "NYSE")`:
  ```typescript
  export function usStock(symbol: string, exchange: "NASDAQ" | "NYSE"): Contract {
    return {
      symbol,
      secType: SecType.STK,
      exchange: "SMART",
      primaryExch: exchange,
      currency: "USD",
    };
  }
  ```
- Add dispatcher `getContract(symbol: string, exchange: Exchange)`:
  ```typescript
  export function getContract(symbol: string, exchange: Exchange): Contract {
    if (exchange === "LSE") return lseStock(symbol);
    return usStock(symbol, exchange);
  }
  ```
- Update `searchContracts()` to accept an optional `exchange` parameter (default `"LSE"` for backwards compatibility). When searching US, use `currency: "USD"` and appropriate `primaryExch`.

**Test:** Build contracts for AAPL/NASDAQ, MSFT/NYSE, SHEL/LSE. Verify each has correct currency and primaryExch.

---

### Step 1.5.2 — Schema changes

**Files:** `src/db/schema.ts`

**What to do:**
- Add `exchange` column to `watchlist`:
  ```typescript
  exchange: text("exchange").notNull().default("LSE"),
  ```
- Add `exchange` column to `trades`:
  ```typescript
  exchange: text("exchange").notNull().default("LSE"),
  ```
- Add `exchange` column to `positions`:
  ```typescript
  exchange: text("exchange").notNull().default("LSE"),
  ```
- Add `currency` column to `positions` (for P&L display in correct currency):
  ```typescript
  currency: text("currency").notNull().default("GBP"),
  ```
- Run `bun run db:generate` and `bun run db:migrate`

The `default("LSE")` ensures all existing data migrates cleanly — current rows are all LSE.

**Watchlist unique constraint:** Currently `symbol` is unique. Change to composite unique on `(symbol, exchange)` — the same ticker could theoretically exist on multiple exchanges (rare but possible).

---

### Step 1.5.3 — Exchange-aware quote fetching

**Files:** `src/broker/market-data.ts`, `src/research/sources/yahoo-finance.ts`, `src/research/sources/fmp.ts`

**What to do:**

**IBKR quotes (`market-data.ts`):**
- Change `getIbkrQuote(symbol)` signature to `getIbkrQuote(symbol, exchange: Exchange)`
- Replace `lseStock(symbol)` with `getContract(symbol, exchange)`
- Update `getQuote(symbol, exchange)` and `getQuotes(symbols, ...)` to accept exchange. For batch quotes where symbols may span exchanges, accept `Array<{ symbol: string; exchange: Exchange }>` or maintain a lookup.

**Yahoo Finance (`yahoo-finance.ts`):**
- Update `getYahooQuote(symbol, exchange)`:
  ```typescript
  function toYahooSymbol(symbol: string, exchange: Exchange): string {
    if (exchange === "LSE") return symbol.endsWith(".L") ? symbol : `${symbol}.L`;
    return symbol; // US symbols are bare
  }
  ```
- Update `getYahooFundamentals()` similarly

**FMP (`fmp.ts`):**
- Update `getFMPQuotes(symbols, exchange)`:
  ```typescript
  function toFmpSymbol(symbol: string, exchange: Exchange): string {
    if (exchange === "LSE") return `${symbol}.L`;
    return symbol; // US symbols are bare
  }
  ```

**Fallback chain is unchanged:** IBKR → Yahoo → FMP. Only the symbol formatting differs per exchange.

**Test:** Fetch quotes for AAPL (NASDAQ) via Yahoo — verify no `.L` suffix appended. Fetch SHEL (LSE) — verify `.L` suffix still works.

---

### Step 1.5.4 — Exchange-aware trade execution

**Files:** `src/broker/orders.ts`

**What to do:**
- Add `exchange` to `TradeRequest` interface:
  ```typescript
  interface TradeRequest {
    symbol: string;
    exchange: Exchange; // NEW
    side: "BUY" | "SELL";
    // ... rest unchanged
  }
  ```
- Replace `lseStock(req.symbol)` with `getContract(req.symbol, req.exchange)`
- Store `exchange` in the trades table insert
- Order construction (Action, TIF, etc.) is identical for both exchanges — no change needed

**Guardian stop-loss sells:** The Guardian reads positions from DB. Since positions now have an `exchange` column, pass it through to `placeTrade()`.

---

### Step 1.5.5 — Exchange-aware risk pipeline

**Files:** `src/risk/limits.ts`, `src/risk/manager.ts`

**What to do:**

**limits.ts:**
- Remove `ISA_GBP_ONLY: true` and `ISA_LSE_ONLY: true`
- Add:
  ```typescript
  ISA_ALLOWED_EXCHANGES: ["LSE", "NASDAQ", "NYSE"] as readonly Exchange[],
  ISA_ALLOWED_CURRENCIES: ["GBP", "USD"] as readonly string[],
  ```
- Rename `MIN_PRICE_GBP` → `MIN_PRICE`:
  ```typescript
  MIN_PRICE: { GBP: 0.10, USD: 1.00 } as Record<string, number>,
  ```
  (US penny stock threshold at $1 is standard)
- Rename `MAX_POSITION_GBP` → `MAX_POSITION_VALUE: 50_000` (in GBP equivalent)
- Add stamp duty config:
  ```typescript
  STAMP_DUTY: { LSE: 0.005, NASDAQ: 0, NYSE: 0 } as Record<Exchange, number>,
  ```

**manager.ts — `checkTradeRisk()`:**
- Check 2 (Exclusions): No change — works on symbol + sector
- Check 3 (Price): Use `MIN_PRICE[currency]` instead of `MIN_PRICE_GBP`
- Check 4 (Position sizing): Convert USD position value to GBP for limit comparison. Use IBKR's account summary which reports in base currency (GBP for ISA).
- Check 5 (Cash reserve): Account summary already reports in GBP — no change
- Check 7 (Sector): No change — sectors are exchange-agnostic
- Check 8 (Volume): Yahoo volume check needs exchange parameter for correct symbol formatting
- Add new check: **Exchange allowed** — verify exchange is in `ISA_ALLOWED_EXCHANGES`

**FX conversion utility:**
- Add `getExchangeRate(from: string, to: string): Promise<number>` using IBKR's forex data or a simple Yahoo Finance FX quote
- Cache for 1 hour (FX rates don't change fast enough to matter for position sizing)
- Used for: converting USD position values to GBP for risk limit checks

**Test:** Check risk for a $50 AAPL position (NASDAQ) with mock GBP/USD rate of 1.25. Verify position value is compared against limits in GBP (£40 equivalent).

---

### Step 1.5.6 — US stock screening

**Files:** New file `src/research/sources/us-screener.ts`, modify `src/research/pipeline.ts`

**What to do:**

**New file `us-screener.ts`:**
- US screening is much simpler than LSE — FMP works natively for US exchanges
- No two-step resolver needed (FMP returns real tickers directly)

```typescript
interface USScreenerDeps {
  fetchScreener: () => Promise<ScreenerResult[] | null>;
}

const US_SECTOR_ROTATION: Record<number, { label: string; sector?: string }> = {
  1: { label: "Technology", sector: "Technology" },
  2: { label: "Healthcare", sector: "Healthcare" },
  3: { label: "Consumer Discretionary", sector: "Consumer Cyclical" },
  4: { label: "Financial Services", sector: "Financial Services" },
  5: { label: "Growth (all sectors)" }, // Friday: high-growth screen
};

export async function createUSScreenerDeps(): Promise<USScreenerDeps> {
  const { fmpFetch } = await import("./fmp.ts");
  const dayOfWeek = new Date().getDay();
  const rotation = US_SECTOR_ROTATION[dayOfWeek] ?? { label: "all sectors" };

  const params: Record<string, string> = {
    exchange: "NASDAQ,NYSE",
    isActivelyTrading: "true",
    limit: "50",
    volumeMoreThan: "500000",
    marketCapMoreThan: "1000000000", // $1B+ (liquid names)
  };

  if (rotation.sector) {
    params.sector = rotation.sector;
  }

  return {
    fetchScreener: () => fmpFetch<ScreenerResult[]>("/company-screener", params),
  };
}

export async function screenUSStocks(deps: USScreenerDeps): Promise<USCandidate[]> {
  const results = await deps.fetchScreener();
  if (!results?.length) return [];

  return results
    .filter((r) => !r.isEtf && !r.isFund)
    .map((r) => ({
      symbol: r.symbol,
      name: r.companyName,
      sector: r.sector,
      exchange: r.exchangeShortName as "NASDAQ" | "NYSE",
    }));
}
```

Note: FMP Starter tier supports `exchange=NASDAQ,NYSE` filtering — no Premium needed.

**Modify `pipeline.ts` — `discoverNewStocks()`:**
- Run both LSE and US discovery:
  ```typescript
  async function discoverNewStocks(): Promise<void> {
    await discoverLSEStocks(); // existing logic, extracted
    await discoverUSStocks();  // new
  }
  ```
- US discovery adds up to 5 candidates per session (same as LSE)
- Max 10 total new watchlist additions per day (5 LSE + 5 US)

**Modify news-driven discovery:**
- Update the Haiku extraction prompt to also extract US tickers:
  ```
  "Extract stock tickers mentioned in these headlines.
   For UK companies, return the LSE ticker.
   For US companies, return the NASDAQ or NYSE ticker.
   Return JSON: [{ symbol, name, exchange }]"
  ```
- Verify US candidates via FMP `/profile` (works natively for US symbols)

**Test:** Mock FMP returning AAPL, MSFT, GOOGL from US screener. Verify they're added to watchlist with correct exchange.

---

### Step 1.5.7 — Exchange-aware position reconciliation

**Files:** `src/agent/orchestrator.ts`, `src/broker/account.ts`

**What to do:**

**`account.ts` — `getPositions()`:**
- IBKR returns contract info with each position, including `primaryExch` and `currency`
- Extract these and include in the returned position data:
  ```typescript
  positions.push({
    accountId,
    symbol: pos.contract.symbol ?? "UNKNOWN",
    exchange: pos.contract.primaryExch ?? "LSE",
    currency: pos.contract.currency ?? "GBP",
    quantity: pos.pos ?? 0,
    avgCost: pos.avgCost ?? 0,
  });
  ```

**`orchestrator.ts` — `reconcilePositions()`:**
- Match on `(symbol, exchange)` instead of just `symbol`
- Store `exchange` and `currency` when inserting new positions

---

### Step 1.5.8 — Exchange-aware Guardian

**Files:** `src/broker/guardian.ts`

**What to do:**
- When fetching quotes, pass exchange from the position/watchlist row
- Group symbols by exchange for efficient batching:
  ```typescript
  const lseSymbols = allSymbols.filter(s => s.exchange === "LSE");
  const usSymbols = allSymbols.filter(s => s.exchange !== "LSE");
  ```
- Stop-loss enforcement: pass `exchange` through to `placeTrade()`
- Price alert accumulator: no change (percentage moves are exchange-agnostic)

**Market hours consideration:** The Guardian currently only runs during LSE hours (08:00–16:30 UK). US market hours are 14:30–21:00 UK time. After this change, the Guardian needs to run during the **union** of both market sessions: 08:00–21:00 UK time.

Update `getMarketPhase()` in `src/utils/clock.ts`:
- LSE: 08:00–16:30
- US: 14:30–21:00
- Open if **either** market is open
- Add `getExchangePhase(exchange: Exchange)` for exchange-specific checks (e.g., wind-down only applies to the relevant exchange)

---

### Step 1.5.9 — Extended trading hours

**Files:** `src/utils/clock.ts`, `src/scheduler/cron.ts`

**What to do:**

**clock.ts:**
- Add `getExchangePhase(exchange)`:
  ```typescript
  export function getExchangePhase(exchange: Exchange): MarketPhase {
    if (exchange === "LSE") return getLSEPhase(); // existing logic
    return getUSPhase(); // 14:30-21:00 UK time
  }
  ```
- `getMarketPhase()` returns the most active phase across all exchanges:
  - If any exchange is `open` → `open`
  - If any exchange is `wind-down` → `wind-down` (for that exchange's symbols)
  - If all are `closed` → `closed`

**cron.ts — Orchestrator ticks:**
- Current: `*/10 8-16 * * 1-5` (08:00–16:50)
- New: `*/10 8-20 * * 1-5` (08:00–20:50)
- Morning-only ticks (08:00–14:30): LSE symbols only
- Afternoon overlap (14:30–16:30): Both LSE and US
- Evening-only ticks (16:30–21:00): US symbols only

**Pre/post market:**
- LSE pre-market: 07:30 (unchanged)
- US pre-market context: included in afternoon ticks (agent sees US positions from 14:30)
- LSE post-market: 16:35 (unchanged, handles LSE reconciliation)
- US post-market: new job at 21:05 (reconcile US positions, snapshot US P&L)

**Wind-down enforcement:**
- `place_trade` Gate 1 checks `getExchangePhase(trade.exchange)` instead of global `getMarketPhase()`
- LSE BUY orders blocked after 16:25
- US BUY orders blocked after 20:55

---

### Step 1.5.10 — Prompt updates

**Files:** `src/agent/prompts/trading-analyst.ts`, `src/agent/prompts/quick-scan.ts`

**What to do:**

Replace LSE-only language with multi-exchange context:

```
## Constraints (ISA Rules)
- Cash account only (no margin, no leverage)
- Long only (no short selling)
- LSE and US (NASDAQ/NYSE) listed equities
- No derivatives, no CFDs

## Exchange Considerations
- LSE stocks: priced in GBp (pence), 0.5% stamp duty on buys (AIM exempt)
- US stocks: priced in USD, no stamp duty, ~0.002% FX conversion cost
- Prefer US stocks for shorter-duration trades (lower friction)
- Prefer LSE stocks when you have strong UK-specific conviction
- All position limits are evaluated in GBP equivalent
```

Tool description updates:
- `get_quote`: "Get current market quote for a stock" (drop "LSE-listed")
- `get_multiple_quotes`: "Get market quotes for multiple stocks at once"
- `search_contracts`: "Search for stock contracts matching a pattern (LSE and US exchanges)"
- `place_trade`: Add `exchange` to input schema (required)
- `get_max_position_size`: Add `exchange` and `currency` to input schema

---

### Step 1.5.11 — Agent tool schema updates

**Files:** `src/agent/tools.ts`

**What to do:**

Add `exchange` parameter to tools that need it:

- `get_quote`: add optional `exchange` (default `"LSE"` for backward compat, but agent should always specify)
- `get_multiple_quotes`: accept `Array<{ symbol, exchange }>`
- `place_trade`: add required `exchange` field
- `check_risk`: add required `exchange` field
- `get_max_position_size`: add optional `exchange` for currency-aware sizing
- `research_symbol`: add optional `exchange`
- `search_contracts`: add optional `exchange` (default searches all)
- `log_intention`: add optional `exchange`

---

### Step 1.5.12 — US-focused news feeds

**Files:** `src/research/sources/news-scraper.ts`

**What to do:**

Add US-focused RSS feeds alongside existing UK feeds:

```typescript
// US-focused (NEW)
{ name: "CNBC Markets", url: "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=20910258" },
{ name: "Yahoo Finance US", url: "https://finance.yahoo.com/rss/topstories" },
{ name: "Seeking Alpha", url: "https://seekingalpha.com/market_currents.xml" },
{ name: "Reuters Business", url: "https://www.reutersagency.com/feed/?best-topics=business-finance&post_type=best" },
```

Tag each feed with its primary market (`"UK"`, `"US"`, `"global"`) so the news-driven discovery knows which exchange to check first.

---

## What Does NOT Change

These systems are already exchange-agnostic and need no modification:

- **Three-tier decision architecture** — pre-filter, Haiku scan, Sonnet agent loop
- **Learning loop** — trade reviews, pattern analysis, weekly insights, self-improvement
- **Risk pipeline structure** — 12-step check sequence (just parameterised by exchange)
- **Agent loop mechanics** — `runAgent()`, tool execution, iteration limits
- **Email reporting** — daily/weekly summaries (display both GBP and USD P&L)
- **Database structure** — `agent_logs`, `trade_reviews`, `weekly_insights`, `token_usage`, `improvement_proposals`
- **Cost tracking** — `token_usage` table unchanged
- **Scheduler architecture** — cron registration, job locking, catch-up tick logic

---

## FX Handling

### Approach: Let IBKR Handle It

IBKR ISAs can hold multi-currency positions. When the agent buys a US stock:
1. IBKR auto-converts GBP → USD at market rate (~0.002% fee)
2. Position is held in USD
3. When sold, USD proceeds sit in the account
4. IBKR can auto-convert back to GBP, or the system can hold USD for next US trade

**For risk calculations:** IBKR's account summary reports `NetLiquidation` in GBP (the ISA base currency), already converting USD holdings at the current rate. So all portfolio-level checks (cash reserve, daily P&L, position limits) work in GBP without additional FX logic.

**For position-level display:** Store the position's native currency. The Guardian updates `currentPrice` in native currency, and `unrealizedPnl` can be calculated in native currency or converted to GBP using the cached FX rate.

### FX Rate Cache

```typescript
let gbpUsdRate: { rate: number; fetchedAt: number } | null = null;
const FX_CACHE_TTL = 60 * 60 * 1000; // 1 hour

export async function getGbpUsdRate(): Promise<number> {
  if (gbpUsdRate && Date.now() - gbpUsdRate.fetchedAt < FX_CACHE_TTL) {
    return gbpUsdRate.rate;
  }
  // Fetch from Yahoo Finance (GBP=X) or IBKR forex data
  const rate = await fetchFxRate("GBPUSD");
  gbpUsdRate = { rate, fetchedAt: Date.now() };
  return rate;
}
```

---

## Stamp Duty Modelling

Currently missing entirely. This phase adds it:

```typescript
export function getStampDuty(exchange: Exchange, _isAIM?: boolean): number {
  if (exchange !== "LSE") return 0;
  if (_isAIM) return 0;
  return 0.005; // 0.5%
}
```

Injected into the agent's context so it can factor friction into trade decisions. Also used by the cost model when calculating effective risk/reward.

Eventually, the `isAIM` flag should come from the watchlist (populated during discovery by checking the market segment). For now, default to main market (conservative — assumes stamp duty applies).

---

## Migration Strategy

All schema changes use `default("LSE")` and `default("GBP")`, so existing data migrates without manual intervention. The rollout is:

1. Deploy schema changes — all existing rows get `exchange = "LSE"`, `currency = "GBP"`
2. Deploy code changes — existing LSE functionality works identically
3. US screening starts discovering US stocks on next research pipeline run (18:00)
4. Agent sees US stocks in watchlist and can begin trading them

No data migration scripts needed. No breaking changes to existing behaviour.

---

## Extended Daily Schedule

```
05:00 UTC  IB Gateway cold restart
07:00      HEARTBEAT
07:30      PRE-MARKET (LSE) — day plan, reconcile
08:00      ┌─ LSE MARKET OPEN ────────────────────────────────┐
08:00-14:20│  Orchestrator ticks (LSE symbols)                 │
           │  Guardian: LSE positions + watchlist               │
14:30      │  ┌─ US MARKET OPEN ─────────────────────────────┐ │
14:30-16:20│  │  Orchestrator ticks (LSE + US symbols)        │ │
           │  │  Guardian: all positions + watchlist           │ │
16:25      │  │  LSE WIND-DOWN — no new LSE BUY orders        │ │
16:30      └──│─ LSE MARKET CLOSE ────────────────────────────┘ │
16:35         │  LSE POST-MARKET — reconcile LSE, snapshot      │
16:40-20:50   │  Orchestrator ticks (US symbols only)           │
20:55         │  US WIND-DOWN — no new US BUY orders            │
21:00         └─ US MARKET CLOSE ────────────────────────────────┘
21:05         US POST-MARKET — reconcile US, snapshot
17:00      DAILY SUMMARY (covers LSE session; US still open — partial)
17:15      TRADE REVIEW (LSE trades; US reviewed next day or at 21:15)
18:00      RESEARCH PIPELINE (LSE + US discovery)
19:00 W/F  PATTERN ANALYSIS
20:00 Sun  SELF-IMPROVEMENT
```

**Open question:** The daily summary currently runs at 17:00, but US market is still open until 21:00. Options:
1. Send two summaries: one at 17:00 (LSE), one at 21:15 (full day including US)
2. Move daily summary to 21:15 (single report, but later)
3. Keep at 17:00 with a note "US session still active" — then the next day's pre-market report covers the full previous day

**Recommendation:** Option 3 for simplicity. The pre-market job at 07:30 already reconciles everything. A missed US session summary for a few hours isn't critical. Can upgrade to option 1 later if needed.

---

## Cost Impact

| Item | Monthly Cost Change |
|------|-------------------|
| AI costs | ~$0 (same tier architecture; more symbols in context but marginal) |
| IBKR data | May need US market data subscription (~$4.50/month for US bundled) |
| FMP API | Same tier — US screening uses same endpoints, within 300 req/min |
| Trading commissions | Lower per trade (~$1 vs £3-5) |
| Stamp duty saved | £500–1,000/year on trades that would have been LSE |
| FX conversion | ~0.002% per conversion (negligible) |
| **Net impact** | **Saves £40–80/month in friction** |

---

## Risk Considerations

### FX Exposure
USD positions are exposed to GBP/USD movements. A 5% GBP appreciation wipes 5% from USD-denominated gains. Mitigation: position sizing already limits max 5% per position. FX risk is diversification, not concentration — it's acceptable for a multi-currency portfolio.

### US Market Hours
Orchestrator ticks running until 21:00 UK time means the system is active for ~13 hours instead of ~8.5. AI costs scale roughly linearly with tick count — budget ~50% more ticks per day. However, the three-tier architecture means most extra ticks are Haiku-only ($0.001 each). Expected additional cost: ~$0.03/day.

### Regulatory
UK ISA rules permit holding US-listed equities. IBKR handles W-8BEN (US withholding tax on dividends reduced to 15%). Since the strategy targets capital gains, dividend withholding is a minor factor.

### Paper Trading
US stocks work on IBKR paper accounts identically to LSE. No special configuration needed beyond SMART routing (which is already used).

---

## Testing Checklist

- [ ] `getContract("AAPL", "NASDAQ")` returns correct contract (SMART, NASDAQ, USD)
- [ ] `getContract("SHEL", "LSE")` returns correct contract (SMART, LSE, GBP) — regression
- [ ] Yahoo quote for US symbol (no `.L` suffix)
- [ ] Yahoo quote for LSE symbol (`.L` suffix) — regression
- [ ] FMP quote for US symbol (no `.L` suffix)
- [ ] Risk check: US stock at $0.50 → rejected (min price $1)
- [ ] Risk check: US stock at $150 → approved, position limit in GBP equivalent
- [ ] Risk check: exchange not in allowed list → rejected
- [ ] US stock discovery via FMP screener
- [ ] Watchlist unique constraint on (symbol, exchange)
- [ ] Guardian fetches quotes for mixed LSE/US positions
- [ ] Stop-loss sell for US position passes correct exchange to `placeTrade()`
- [ ] Wind-down enforcement: LSE BUY blocked at 16:26, US BUY still allowed
- [ ] Wind-down enforcement: US BUY blocked at 20:56

---

## Sequencing

This phase slots between Phase 1 (foundation, deployed) and Phase 2 (trading intelligence):

```
Phase 1:   Foundation (safety, risk, Guardian)      ✓ DEPLOYED
Phase 1.5: US Stock Support (this proposal)         ← HERE
Phase 2:   Trading Intelligence (indicators, ATR)
Phase 3:   Learning Depth (decision scorer, journal)
```

Phase 1.5 should be done **before** Phase 2 because:
1. Phase 2's indicator engine and prompt rewrite need to be exchange-aware from the start
2. Building Phase 2 LSE-only and then retrofitting US support doubles the prompt/integration work
3. The friction reduction is immediately valuable even with the current "beginner" prompt

**Estimated effort:** 2–3 sessions. Schema + contracts + quotes in session 1. Risk + screening + pipeline in session 2. Hours/prompts/testing in session 3.

**Observation period:** 1 week after deploy. Verify US quotes flowing, discovery working, mixed-exchange Guardian stable. No need for extended observation since the safety architecture (Phase 1) is unchanged.

---

## Files Changed/Created Summary

| File | Action | What |
|------|--------|------|
| `src/broker/contracts.ts` | MODIFY | Add `usStock()`, `getContract()` dispatcher |
| `src/db/schema.ts` | MODIFY | Add `exchange` and `currency` columns |
| `src/broker/market-data.ts` | MODIFY | Exchange-aware quote fetching |
| `src/broker/orders.ts` | MODIFY | Use `getContract()` instead of `lseStock()` |
| `src/broker/account.ts` | MODIFY | Extract exchange/currency from IBKR positions |
| `src/broker/guardian.ts` | MODIFY | Exchange-aware quotes, extended hours |
| `src/risk/limits.ts` | MODIFY | Multi-exchange limits, stamp duty config |
| `src/risk/manager.ts` | MODIFY | Currency-aware checks, FX conversion |
| `src/research/sources/us-screener.ts` | NEW | US stock discovery via FMP |
| `src/research/pipeline.ts` | MODIFY | Run both LSE and US discovery |
| `src/research/sources/yahoo-finance.ts` | MODIFY | Exchange-aware symbol formatting |
| `src/research/sources/fmp.ts` | MODIFY | Exchange-aware symbol formatting |
| `src/research/sources/news-scraper.ts` | MODIFY | Add US feeds, multi-exchange extraction |
| `src/utils/clock.ts` | MODIFY | Multi-exchange market phases |
| `src/utils/fx.ts` | NEW | FX rate cache utility |
| `src/scheduler/cron.ts` | MODIFY | Extended tick hours, US post-market job |
| `src/agent/prompts/trading-analyst.ts` | MODIFY | Multi-exchange language |
| `src/agent/prompts/quick-scan.ts` | MODIFY | Multi-exchange language |
| `src/agent/tools.ts` | MODIFY | Add `exchange` to tool schemas |
| `src/agent/orchestrator.ts` | MODIFY | Exchange-aware reconciliation, context |
