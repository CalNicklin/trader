import { fmpFetch } from "./fmp.ts";

export interface USScreenerResult {
	symbol: string;
	companyName: string;
	marketCap: number;
	sector: string;
	industry: string;
	country: string;
	price: number;
	volume: number;
	exchange: string;
	exchangeShortName: string;
	isEtf: boolean;
	isFund: boolean;
	isActivelyTrading: boolean;
}

export interface USScreenerDeps {
	fetchScreener: () => Promise<USScreenerResult[] | null>;
}

export interface USCandidate {
	symbol: string;
	name: string;
	sector: string;
	exchange: "NASDAQ" | "NYSE";
}

/** Build production USScreenerDeps from fmpFetch. */
export async function createUSScreenerDeps(): Promise<USScreenerDeps> {
	const params: Record<string, string> = {
		exchange: "NASDAQ,NYSE",
		isActivelyTrading: "true",
		limit: "50",
		volumeMoreThan: "500000",
		marketCapMoreThan: "1000000000",
	};

	return {
		fetchScreener: () => fmpFetch<USScreenerResult[]>("/company-screener", params),
	};
}

/** Screen for US-listed stocks via FMP. No two-step resolver needed — FMP returns real tickers. */
export async function screenUSStocks(deps: USScreenerDeps): Promise<USCandidate[]> {
	const results = await deps.fetchScreener();
	if (!results?.length) return [];

	return results
		.filter((r) => !r.isEtf && !r.isFund)
		.map((r) => ({
			symbol: r.symbol,
			name: r.companyName,
			sector: r.sector,
			exchange: r.exchangeShortName as "NASDAQ" | "NYSE",
		}));
}
