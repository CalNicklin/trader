import { expect, test } from "bun:test";
import { getActiveLimits } from "../src/risk/limits.ts";

test("live mode returns concentrated position limits", () => {
	const limits = getActiveLimits("live");
	expect(limits.MAX_POSITIONS).toBe(5);
	expect(limits.MAX_POSITION_PCT).toBe(15);
	expect(limits.MIN_CASH_RESERVE_PCT).toBe(10);
});

test("paper mode loosens circuit breakers and cash reserve", () => {
	const limits = getActiveLimits("paper");
	expect(limits.MIN_CASH_RESERVE_PCT).toBe(5);
	expect(limits.DAILY_LOSS_LIMIT_PCT).toBe(5);
	expect(limits.WEEKLY_LOSS_LIMIT_PCT).toBe(10);
});

test("paper mode preserves position concentration from live", () => {
	const limits = getActiveLimits("paper");
	expect(limits.MAX_POSITIONS).toBe(5);
	expect(limits.MAX_POSITION_PCT).toBe(15);
});
