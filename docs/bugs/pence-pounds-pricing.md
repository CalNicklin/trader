# Bug: Pence/Pounds Pricing Confusion on Limit Orders

**Status: FIXED** (2026-02-19)

## Problem
The agent placed limit orders ~100x too low:
- ULVR: limit 53.5 vs market 5325p
- GSK: limit 22.45 vs market 2245p
- RIO: limit 72.00 vs market 7200p

## Root Cause: Prompt Bug (Not Code Bug)

All quote sources (IBKR, Yahoo, FMP) return LSE prices in **pence** (GBp). The data was consistent. But the agent prompt never mentioned units, so the LLM saw "5325" and mentally converted to "£53.25", then placed a limit order at 53.5 (pounds). IBKR interpreted this as 53.5 pence.

## Fix Applied

1. **Prompt** (`trading-analyst.ts`): Added explicit section stating all prices are in pence with examples
2. **Tool description** (`tools.ts`): `place_trade.limitPrice` now says "in PENCE, e.g. 5325 for £53.25"
3. **Sanity check** (`tools.ts`): If limit price is >90% below market price, reject with helpful error suggesting `limitPrice * 100`
