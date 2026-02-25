# Phase 1.5 Verification Checklist

Date: 2026-02-25
Gate: `bun run typecheck` ✅ | `bun run lint` ✅ | `bun test` ✅ (204 pass, 0 fail)

## Unit-Tested Items (from phase1.5-us-stocks.md Testing Checklist)

| # | Check | Test File | Result |
|---|-------|-----------|--------|
| 1 | `getContract("AAPL", "NASDAQ")` returns correct contract (SMART, NASDAQ, USD) | `contracts.test.ts` | ✅ |
| 2 | `getContract("SHEL", "LSE")` returns correct contract (SMART, LSE, GBP) | `contracts.test.ts` | ✅ |
| 3 | Yahoo quote for US symbol (no `.L` suffix) | `exchange-aware.test.ts` | ✅ |
| 4 | Yahoo quote for LSE symbol (`.L` suffix) — regression | `exchange-aware.test.ts` | ✅ |
| 5 | FMP quote for US symbol (no `.L` suffix) | `exchange-aware.test.ts` | ✅ |
| 6 | Risk check: MIN_PRICE has GBP ($0.10) and USD ($1.00) thresholds | `exchange-aware.test.ts` | ✅ |
| 7 | Risk check: ISA_ALLOWED_EXCHANGES includes LSE, NASDAQ, NYSE | `exchange-aware.test.ts` | ✅ |
| 8 | Stamp duty: 0.5% LSE, 0% US, 0% AIM | `exchange-aware.test.ts` | ✅ |
| 9 | US stock discovery via FMP screener | `us-screener.test.ts` | ✅ |
| 10 | Wind-down enforcement: LSE BUY blocked at 16:26 | `trade-gates.test.ts` | ✅ |
| 11 | Wind-down enforcement: US BUY blocked at 20:56 | `trade-gates.test.ts` | ✅ |
| 12 | Market phase: open at 16:26 (US open, LSE wind-down) | `clock.test.ts` | ✅ |
| 13 | FX conversion: USD→GBP for risk sizing | `risk-fx.test.ts` | ✅ |
| 14 | ATR position sizing: exchange-aware | `risk-fx.test.ts` | ✅ |

## Phase 1.5 Gap-Fix Verification (todos 1-4)

| # | Gap Fixed | Test File | Result |
|---|-----------|-----------|--------|
| 1 | `getStaleSymbols()` returns `{ symbol, exchange }` | `exchange-propagation.test.ts` | ✅ |
| 2 | Pipeline passes exchange to `researchSymbol()` | Type-checked (compiler enforced) | ✅ |
| 3 | Orchestrator uses `getQuotesGroupedByExchange()` | `multi-exchange-quotes.test.ts` | ✅ |
| 4 | News discovery parses exchange from LLM output | `news-discovery.test.ts` | ✅ |
| 5 | News discovery defaults to LSE when exchange missing | `news-discovery.test.ts` | ✅ |
| 6 | `get_max_position_size` schema includes exchange | `tool-exchange-parity.test.ts` | ✅ |
| 7 | `research_symbol` tool forwards exchange | `tool-exchange-parity.test.ts` | ✅ |
| 8 | Decision scorer parses exchange from LLM output | `exchange-propagation.test.ts` | ✅ |
| 9 | `getHistoricalBars` called with exchange in scorer | Code review (wired in decision-scorer.ts) | ✅ |

## Live IBKR Verification (post-deploy, 2026-02-25 22:08 UTC)

Deployed commit `bc7937e`. CI passed. Container started cleanly.

| # | Check | Result |
|---|-------|--------|
| 1 | Container startup — no errors | ✅ Clean startup, IBKR connected, 4 positions fetched |
| 2 | Position fetch includes exchange/currency | ✅ All 4 positions: `exchange: "LSE"`, `currency: "GBP"` |
| 3 | Contract resolution: AAPL/NASDAQ | ✅ `{symbol:"AAPL", secType:"STK", exchange:"SMART", primaryExch:"NASDAQ", currency:"USD"}` |
| 4 | Contract resolution: IBM/NYSE | ✅ `{symbol:"IBM", secType:"STK", exchange:"SMART", primaryExch:"NYSE", currency:"USD"}` |
| 5 | Contract resolution: SHEL/LSE (regression) | ✅ `{symbol:"SHEL", secType:"STK", exchange:"SMART", primaryExch:"LSE", currency:"GBP"}` |
| 6 | Quote fetch: AAPL/NASDAQ via Yahoo fallback | ✅ $274.23 (market closed; Yahoo fallback worked) |
| 7 | Quote fetch: SHEL/LSE via Yahoo fallback | ✅ 3011p (market closed; Yahoo fallback worked) |
| 8 | DB schema: positions has exchange + currency cols | ✅ `exchange TEXT NOT NULL DEFAULT 'LSE'`, `currency TEXT NOT NULL DEFAULT 'GBP'` |
| 9 | DB schema: watchlist has exchange col | ✅ All active watchlist items have `exchange = LSE` |
| 10 | Orchestrator tick (market closed) | ✅ Exits correctly in 1ms (market closed gate) |

### Deferred to Next Trading Day (market closed at verification time)

These paths require active market hours and will be validated during the next session (2026-02-26 08:00+ UTC):

- [ ] Guardian fetches quotes for mixed LSE/US positions during market hours
- [ ] Orchestrator ticks exercise exchange-grouped quote paths
- [ ] Historical bars for US stocks via IBKR (requires live market connection)
- [ ] US discovery pipeline finds US candidates on next research pipeline run (18:00 UTC)
- [ ] Wind-down enforcement active during live trading (16:25 LSE, 20:55 US)
- [ ] Mixed-exchange stability over full trading day (no exchange/currency mix-ups in logs)
