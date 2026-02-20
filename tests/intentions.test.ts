import { beforeEach, expect, test } from "bun:test";
import {
	addIntention,
	checkIntentions,
	clearAllIntentions,
	getPendingIntentions,
} from "../src/agent/intentions.ts";

beforeEach(() => {
	clearAllIntentions();
});

test("stores an intention and retrieves it", () => {
	addIntention({
		symbol: "SHEL",
		condition: "price < 2450",
		action: "BUY",
		note: "Pullback entry",
	});

	const pending = getPendingIntentions();
	expect(pending).toHaveLength(1);
	expect(pending[0]!.symbol).toBe("SHEL");
});

test("checks intentions against quotes and returns met conditions", () => {
	addIntention({
		symbol: "SHEL",
		condition: "price < 2450",
		action: "BUY",
		note: "Pullback entry",
	});

	const quotes = new Map([["SHEL", 2430]]);
	const met = checkIntentions(quotes);

	expect(met).toHaveLength(1);
	expect(met[0]!.symbol).toBe("SHEL");
	expect(met[0]!.action).toBe("BUY");
});

test("does not flag intentions when condition is not met", () => {
	addIntention({
		symbol: "SHEL",
		condition: "price < 2450",
		action: "BUY",
		note: "Pullback entry",
	});

	const quotes = new Map([["SHEL", 2500]]);
	const met = checkIntentions(quotes);

	expect(met).toHaveLength(0);
});

test("clears all intentions", () => {
	addIntention({ symbol: "SHEL", condition: "price < 2450", action: "BUY", note: "" });
	addIntention({ symbol: "AZN", condition: "price > 12000", action: "SELL", note: "" });

	clearAllIntentions();

	expect(getPendingIntentions()).toHaveLength(0);
});

test("handles price > condition", () => {
	addIntention({
		symbol: "AZN",
		condition: "price > 12000",
		action: "SELL",
		note: "Take profit",
	});

	const quotes = new Map([["AZN", 12500]]);
	const met = checkIntentions(quotes);

	expect(met).toHaveLength(1);
});
