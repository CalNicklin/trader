import { expect, test } from "bun:test";
import { HARD_LIMITS } from "../src/risk/limits.ts";
import { calculateStopLoss } from "../src/risk/manager.ts";

test("hard limits are correctly defined", () => {
	expect(HARD_LIMITS.MAX_POSITION_PCT).toBe(15);
	expect(HARD_LIMITS.MAX_POSITION_GBP).toBe(50_000);
	expect(HARD_LIMITS.MIN_CASH_RESERVE_PCT).toBe(10);
	expect(HARD_LIMITS.PER_TRADE_STOP_LOSS_PCT).toBe(3);
	expect(HARD_LIMITS.DAILY_LOSS_LIMIT_PCT).toBe(2);
	expect(HARD_LIMITS.WEEKLY_LOSS_LIMIT_PCT).toBe(5);
	expect(HARD_LIMITS.MAX_POSITIONS).toBe(5);
	expect(HARD_LIMITS.MAX_TRADES_PER_DAY).toBe(10);
	expect(HARD_LIMITS.ISA_NO_SHORTING).toBe(true);
	expect(HARD_LIMITS.ISA_NO_MARGIN).toBe(true);
});

test("stop loss calculation falls back to 3% without ATR", () => {
	const stopLoss = calculateStopLoss(100);
	expect(stopLoss).toBe(97); // 100 * (1 - 3/100)

	const stopLoss2 = calculateStopLoss(250.5);
	expect(stopLoss2).toBeCloseTo(242.985, 2);
});

test("stop loss uses ATR when provided", () => {
	// 2000p price, ATR 40p → stop at 2000 - (40 * 2) = 1920
	const stopLoss = calculateStopLoss(2000, 40);
	expect(stopLoss).toBe(1920);
});

test("ATR-related limits are defined", () => {
	expect(HARD_LIMITS.STOP_LOSS_ATR_MULTIPLIER).toBe(2);
	expect(HARD_LIMITS.TARGET_ATR_MULTIPLIER).toBe(3);
	expect(HARD_LIMITS.RISK_PER_TRADE_PCT).toBe(1);
	expect(HARD_LIMITS.TRAILING_STOP_ATR_MULTIPLIER).toBe(2);
});
