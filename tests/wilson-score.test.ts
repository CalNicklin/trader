import { expect, test } from "bun:test";
import { wilsonLower } from "../src/utils/stats.ts";

test("small sample does not trigger pause — 0 wins out of 2 trades", () => {
	const bound = wilsonLower(0, 2);
	expect(bound).toBeLessThan(0.1);
});

test("large losing sample triggers pause — 5 wins out of 20 trades", () => {
	const bound = wilsonLower(5, 20);
	expect(bound).toBeLessThan(0.4); // Below PAUSE_WIN_RATE_THRESHOLD
});

test("zero trades returns zero", () => {
	expect(wilsonLower(0, 0)).toBe(0);
});
