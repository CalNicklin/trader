import { expect, test } from "bun:test";
import { HARD_LIMITS } from "../src/risk/limits.ts";
import { calculateStopLoss } from "../src/risk/manager.ts";

test("hard limits are correctly defined", () => {
	expect(HARD_LIMITS.MAX_POSITION_PCT).toBe(5);
	expect(HARD_LIMITS.MAX_POSITION_GBP).toBe(500);
	expect(HARD_LIMITS.MIN_CASH_RESERVE_PCT).toBe(20);
	expect(HARD_LIMITS.PER_TRADE_STOP_LOSS_PCT).toBe(3);
	expect(HARD_LIMITS.DAILY_LOSS_LIMIT_PCT).toBe(2);
	expect(HARD_LIMITS.WEEKLY_LOSS_LIMIT_PCT).toBe(5);
	expect(HARD_LIMITS.MAX_POSITIONS).toBe(10);
	expect(HARD_LIMITS.MAX_TRADES_PER_DAY).toBe(10);
	expect(HARD_LIMITS.ISA_NO_SHORTING).toBe(true);
	expect(HARD_LIMITS.ISA_NO_MARGIN).toBe(true);
});

test("stop loss calculation is correct", () => {
	const stopLoss = calculateStopLoss(100);
	expect(stopLoss).toBe(97); // 100 * (1 - 3/100)

	const stopLoss2 = calculateStopLoss(250.5);
	expect(stopLoss2).toBeCloseTo(242.985, 2);
});
