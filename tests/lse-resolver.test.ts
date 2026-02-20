import { describe, expect, test } from "bun:test";
import { pickLSESymbol } from "../src/research/sources/lse-resolver.ts";

describe("pickLSESymbol", () => {
	test("picks primary LSE equity from mixed results", () => {
		const results = [
			{ symbol: "HPEM.L", name: "HSBC ETFS PLC", currency: "USD", exchange: "LSE" },
			{ symbol: "HSBA.L", name: "HSBC Holdings plc", currency: "GBp", exchange: "LSE" },
			{ symbol: "HSPX.L", name: "HSBC S&P 500 UCITS ETF", currency: "GBp", exchange: "LSE" },
		];

		expect(pickLSESymbol(results)).toBe("HSBA");
	});

	test("filters out leveraged ETCs with numeric-prefix symbols", () => {
		const results = [
			{
				symbol: "3LAZ.L",
				name: "GraniteShares 3x Long AstraZeneca Daily ETC",
				currency: "GBp",
				exchange: "LSE",
			},
			{
				symbol: "3SAZ.L",
				name: "GraniteShares 3x Short AstraZeneca Daily ETC",
				currency: "GBp",
				exchange: "LSE",
			},
			{ symbol: "AZN.L", name: "AstraZeneca PLC", currency: "GBp", exchange: "LSE" },
		];

		expect(pickLSESymbol(results)).toBe("AZN");
	});

	test("returns null when all results are ETFs or non-GBp", () => {
		const results = [
			{ symbol: "HPEM.L", name: "HSBC ETFS PLC", currency: "USD", exchange: "LSE" },
			{ symbol: "HSPX.L", name: "HSBC S&P 500 UCITS ETF", currency: "GBp", exchange: "LSE" },
		];

		expect(pickLSESymbol(results)).toBeNull();
	});

	test("returns null for empty results", () => {
		expect(pickLSESymbol([])).toBeNull();
	});
});
