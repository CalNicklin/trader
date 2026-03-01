import { describe, expect, test } from "bun:test";
import { computeFingerprint } from "../src/agent/fingerprint.ts";
import type { Quote } from "../src/broker/market-data.ts";

function makeQuote(last: number | null): Quote {
	return {
		symbol: "",
		bid: null,
		ask: null,
		last,
		volume: null,
		high: null,
		low: null,
		close: null,
		timestamp: new Date(),
	};
}

describe("computeFingerprint", () => {
	test("same state in different insertion order produces identical hash", () => {
		const quotes = new Map<string, Quote>([
			["SHEL", makeQuote(25.05)],
			["AAPL", makeQuote(180.2)],
		]);

		const a = computeFingerprint({
			positions: [
				{ symbol: "SHEL", quantity: 100 },
				{ symbol: "AAPL", quantity: 50 },
			],
			pendingOrderIds: [3, 1, 2],
			researchSignals: [
				{ symbol: "AAPL", action: "BUY" },
				{ symbol: "SHEL", action: "HOLD" },
			],
			quotes,
		});

		const b = computeFingerprint({
			positions: [
				{ symbol: "AAPL", quantity: 50 },
				{ symbol: "SHEL", quantity: 100 },
			],
			pendingOrderIds: [2, 3, 1],
			researchSignals: [
				{ symbol: "SHEL", action: "HOLD" },
				{ symbol: "AAPL", action: "BUY" },
			],
			quotes,
		});

		expect(a).toBe(b);
	});

	test("different positions produce different hash", () => {
		const quotes = new Map<string, Quote>();

		const a = computeFingerprint({
			positions: [{ symbol: "SHEL", quantity: 100 }],
			pendingOrderIds: [],
			researchSignals: [],
			quotes,
		});

		const b = computeFingerprint({
			positions: [{ symbol: "SHEL", quantity: 200 }],
			pendingOrderIds: [],
			researchSignals: [],
			quotes,
		});

		expect(a).not.toBe(b);
	});

	test("quote jitter within 1% band does not change fingerprint", () => {
		const a = computeFingerprint({
			positions: [],
			pendingOrderIds: [],
			researchSignals: [],
			quotes: new Map([["SHEL", makeQuote(25.05)]]),
		});

		const b = computeFingerprint({
			positions: [],
			pendingOrderIds: [],
			researchSignals: [],
			quotes: new Map([["SHEL", makeQuote(25.1)]]),
		});

		expect(a).toBe(b);
	});

	test("quote move beyond 1% band changes fingerprint", () => {
		const a = computeFingerprint({
			positions: [],
			pendingOrderIds: [],
			researchSignals: [],
			quotes: new Map([["SHEL", makeQuote(25.0)]]),
		});

		const b = computeFingerprint({
			positions: [],
			pendingOrderIds: [],
			researchSignals: [],
			quotes: new Map([["SHEL", makeQuote(25.5)]]),
		});

		expect(a).not.toBe(b);
	});

	test("research signal action change produces different hash", () => {
		const quotes = new Map<string, Quote>();

		const a = computeFingerprint({
			positions: [],
			pendingOrderIds: [],
			researchSignals: [{ symbol: "SHEL", action: "HOLD" }],
			quotes,
		});

		const b = computeFingerprint({
			positions: [],
			pendingOrderIds: [],
			researchSignals: [{ symbol: "SHEL", action: "BUY" }],
			quotes,
		});

		expect(a).not.toBe(b);
	});

	test("empty state produces a consistent hash", () => {
		const quotes = new Map<string, Quote>();
		const input = {
			positions: [],
			pendingOrderIds: [],
			researchSignals: [],
			quotes,
		};

		expect(computeFingerprint(input)).toBe(computeFingerprint(input));
	});
});
