import { describe, expect, test } from "bun:test";
import {
	computeTrailingStopUpdate,
	type TrailingStopPosition,
} from "../src/broker/trailing-stops.ts";

describe("computeTrailingStopUpdate", () => {
	test("updates high water mark when price rises", () => {
		const pos: TrailingStopPosition = {
			id: 1,
			symbol: "SHEL",
			quantity: 100,
			highWaterMark: 2000,
			trailingStopPrice: 1920,
			atr14: 40,
			currentPrice: 2100,
		};
		const result = computeTrailingStopUpdate(pos, 2);
		expect(result).not.toBeNull();
		expect(result!.highWaterMark).toBe(2100);
		// New trailing stop: 2100 - (40 * 2) = 2020
		expect(result!.trailingStopPrice).toBe(2020);
		expect(result!.triggered).toBe(false);
	});

	test("never moves trailing stop down", () => {
		const pos: TrailingStopPosition = {
			id: 1,
			symbol: "SHEL",
			quantity: 100,
			highWaterMark: 2100,
			trailingStopPrice: 2020,
			atr14: 40,
			currentPrice: 2050, // below high but above trailing stop
		};
		const result = computeTrailingStopUpdate(pos, 2);
		expect(result).not.toBeNull();
		expect(result!.highWaterMark).toBe(2100); // unchanged
		// Recalculated: 2100 - 80 = 2020, same as before
		expect(result!.trailingStopPrice).toBe(2020);
		expect(result!.triggered).toBe(false);
	});

	test("triggers sell when price drops below trailing stop", () => {
		const pos: TrailingStopPosition = {
			id: 1,
			symbol: "SHEL",
			quantity: 100,
			highWaterMark: 2100,
			trailingStopPrice: 2020,
			atr14: 40,
			currentPrice: 2010, // below trailing stop
		};
		const result = computeTrailingStopUpdate(pos, 2);
		expect(result).not.toBeNull();
		expect(result!.triggered).toBe(true);
	});

	test("returns null when no ATR data", () => {
		const pos: TrailingStopPosition = {
			id: 1,
			symbol: "SHEL",
			quantity: 100,
			highWaterMark: null,
			trailingStopPrice: null,
			atr14: null,
			currentPrice: 2000,
		};
		const result = computeTrailingStopUpdate(pos, 2);
		expect(result).toBeNull();
	});
});
