import { expect, test } from "bun:test";
import {
	findStopLossBreaches,
	type QuoteLike,
	type StopLossPosition,
} from "../src/broker/stop-loss.ts";

function makeQuote(last: number): QuoteLike {
	return { last, bid: last - 1 };
}

test("stop-loss breach detected when price falls below stop", () => {
	const positions: StopLossPosition[] = [
		{ id: 1, symbol: "SHEL", quantity: 100, stopLossPrice: 2400 },
	];
	const quotes = new Map<string, QuoteLike>([["SHEL", makeQuote(2350)]]);

	const breaches = findStopLossBreaches(positions, quotes);

	expect(breaches).toHaveLength(1);
	expect(breaches[0]!.symbol).toBe("SHEL");
	expect(breaches[0]!.quantity).toBe(100);
});

test("no breach when price is above stop-loss", () => {
	const positions: StopLossPosition[] = [
		{ id: 1, symbol: "SHEL", quantity: 100, stopLossPrice: 2400 },
	];
	const quotes = new Map<string, QuoteLike>([["SHEL", makeQuote(2500)]]);

	const breaches = findStopLossBreaches(positions, quotes);

	expect(breaches).toHaveLength(0);
});

test("position without stop-loss is ignored", () => {
	const positions: StopLossPosition[] = [
		{ id: 1, symbol: "SHEL", quantity: 100, stopLossPrice: null },
	];
	const quotes = new Map<string, QuoteLike>([["SHEL", makeQuote(100)]]);

	const breaches = findStopLossBreaches(positions, quotes);

	expect(breaches).toHaveLength(0);
});
