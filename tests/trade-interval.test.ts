import { expect, test } from "bun:test";
import { getTradeIntervalMin } from "../src/risk/limits.ts";

test("paper mode uses 2-minute trade interval", () => {
	expect(getTradeIntervalMin("paper")).toBe(2);
});

test("live mode uses 15-minute trade interval", () => {
	expect(getTradeIntervalMin("live")).toBe(15);
});
