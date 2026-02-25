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

## Needs Live IBKR Verification (post-deploy)

These items require the deployed IBKR gateway and will be verified as part of todo 6:

- [ ] IBKR contract resolution for AAPL/NASDAQ returns valid contract
- [ ] IBKR quote fetch for US stock returns price data
- [ ] IBKR historical bars for US stock returns bar data
- [ ] Guardian fetches quotes for mixed LSE/US positions without error
- [ ] Stop-loss sell for US position passes correct exchange
- [ ] Reconciliation matches positions on (symbol, exchange) composite key
- [ ] US discovery pipeline finds US candidates on next research run
- [ ] Mixed-exchange orchestrator ticks produce no exchange/currency errors
