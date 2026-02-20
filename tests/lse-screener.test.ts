import { describe, expect, test } from "bun:test";
import type { FMPSearchResult } from "../src/research/sources/lse-resolver.ts";
import { screenLSEStocks } from "../src/research/sources/lse-screener.ts";

describe("screenLSEStocks", () => {
	test("resolves LSE symbols from country=GB screener results via name search", async () => {
		const mockFetchScreener = async () => [
			{
				symbol: "AZN",
				companyName: "AstraZeneca PLC",
				marketCap: 200e9,
				sector: "Healthcare",
				industry: "Pharma",
				country: "GB",
				price: 100,
				volume: 1e6,
				exchange: "NYSE",
				isEtf: false,
				isFund: false,
				isActivelyTrading: true,
			},
			{
				symbol: "GSK",
				companyName: "GSK plc",
				marketCap: 80e9,
				sector: "Healthcare",
				industry: "Pharma",
				country: "GB",
				price: 40,
				volume: 2e6,
				exchange: "NYSE",
				isEtf: false,
				isFund: false,
				isActivelyTrading: true,
			},
		];

		const mockSearchName = async (query: string): Promise<FMPSearchResult[] | null> => {
			if (query === "AstraZeneca PLC") {
				return [
					{ symbol: "AZN.L", name: "AstraZeneca PLC", currency: "GBp", exchange: "LSE" },
					{
						symbol: "3LAZ.L",
						name: "GraniteShares 3x Long AstraZeneca",
						currency: "GBp",
						exchange: "LSE",
					},
				];
			}
			if (query === "GSK plc") {
				return [{ symbol: "GSK.L", name: "GSK plc", currency: "GBp", exchange: "LSE" }];
			}
			return null;
		};

		const results = await screenLSEStocks({
			fetchScreener: mockFetchScreener,
			searchName: mockSearchName,
		});

		expect(results).toEqual([
			{ symbol: "AZN", name: "AstraZeneca PLC", sector: "Healthcare" },
			{ symbol: "GSK", name: "GSK plc", sector: "Healthcare" },
		]);
	});

	test("deduplicates when multiple US tickers resolve to the same LSE symbol", async () => {
		const mockFetchScreener = async () => [
			{
				symbol: "AZN",
				companyName: "AstraZeneca PLC",
				marketCap: 200e9,
				sector: "Healthcare",
				industry: "Pharma",
				country: "GB",
				price: 100,
				volume: 1e6,
				exchange: "NYSE",
				isEtf: false,
				isFund: false,
				isActivelyTrading: true,
			},
			{
				symbol: "AZNCF",
				companyName: "AstraZeneca PLC",
				marketCap: 200e9,
				sector: "Healthcare",
				industry: "Pharma",
				country: "GB",
				price: 100,
				volume: 500,
				exchange: "OTC",
				isEtf: false,
				isFund: false,
				isActivelyTrading: true,
			},
		];

		const mockSearchName = async (_query: string): Promise<FMPSearchResult[] | null> => [
			{ symbol: "AZN.L", name: "AstraZeneca PLC", currency: "GBp", exchange: "LSE" },
		];

		const results = await screenLSEStocks({
			fetchScreener: mockFetchScreener,
			searchName: mockSearchName,
		});

		expect(results).toHaveLength(1);
		expect(results[0]!.symbol).toBe("AZN");
	});

	test("skips candidates when search-name returns no LSE match", async () => {
		const mockFetchScreener = async () => [
			{
				symbol: "ROIV",
				companyName: "Roivant Sciences Ltd.",
				marketCap: 19e9,
				sector: "Healthcare",
				industry: "Pharma",
				country: "GB",
				price: 50,
				volume: 1e6,
				exchange: "NASDAQ",
				isEtf: false,
				isFund: false,
				isActivelyTrading: true,
			},
		];

		const mockSearchName = async (_query: string): Promise<FMPSearchResult[] | null> => [];

		const results = await screenLSEStocks({
			fetchScreener: mockFetchScreener,
			searchName: mockSearchName,
		});

		expect(results).toHaveLength(0);
	});

	test("returns empty when screener returns null", async () => {
		const results = await screenLSEStocks({
			fetchScreener: async () => null,
			searchName: async () => null,
		});

		expect(results).toEqual([]);
	});
});
