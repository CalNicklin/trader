import { describe, expect, test } from "bun:test";
import { detectPhantomPositions } from "../src/broker/phantom-detection.ts";

describe("detectPhantomPositions", () => {
	test("flags positions with negative quantity as phantoms", () => {
		const positions = [
			{
				id: 1,
				symbol: "SHEL",
				exchange: "LSE",
				quantity: 100,
				marketValue: 2500,
				unrealizedPnl: 50,
			},
			{
				id: 2,
				symbol: "DGE",
				exchange: "LSE",
				quantity: -2200,
				marketValue: -5000,
				unrealizedPnl: -200,
			},
			{
				id: 3,
				symbol: "AAPL",
				exchange: "NASDAQ",
				quantity: 50,
				marketValue: 9000,
				unrealizedPnl: 100,
			},
		];

		const phantoms = detectPhantomPositions(positions);

		expect(phantoms).toHaveLength(1);
		expect(phantoms[0]!.id).toBe(2);
		expect(phantoms[0]!.symbol).toBe("DGE");
		expect(phantoms[0]!.quantity).toBe(-2200);
	});

	test("returns empty array when all positions are valid", () => {
		const positions = [
			{
				id: 1,
				symbol: "SHEL",
				exchange: "LSE",
				quantity: 100,
				marketValue: 2500,
				unrealizedPnl: 50,
			},
			{
				id: 2,
				symbol: "AAPL",
				exchange: "NASDAQ",
				quantity: 50,
				marketValue: 9000,
				unrealizedPnl: 100,
			},
		];

		expect(detectPhantomPositions(positions)).toHaveLength(0);
	});

	test("treats zero quantity as valid (not phantom)", () => {
		const positions = [
			{ id: 1, symbol: "SHEL", exchange: "LSE", quantity: 0, marketValue: 0, unrealizedPnl: 0 },
		];

		expect(detectPhantomPositions(positions)).toHaveLength(0);
	});

	test("detects multiple phantoms", () => {
		const positions = [
			{
				id: 1,
				symbol: "DGE",
				exchange: "LSE",
				quantity: -2200,
				marketValue: -5000,
				unrealizedPnl: -200,
			},
			{
				id: 2,
				symbol: "SGRO",
				exchange: "LSE",
				quantity: -5000,
				marketValue: -10000,
				unrealizedPnl: -500,
			},
			{
				id: 3,
				symbol: "TSCO",
				exchange: "LSE",
				quantity: -8000,
				marketValue: -20000,
				unrealizedPnl: -1000,
			},
		];

		const phantoms = detectPhantomPositions(positions);
		expect(phantoms).toHaveLength(3);
		expect(phantoms.map((p) => p.symbol)).toEqual(["DGE", "SGRO", "TSCO"]);
	});
});
