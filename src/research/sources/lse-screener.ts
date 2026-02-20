import { type FMPSearchResult, pickLSESymbol } from "./lse-resolver.ts";

interface ScreenerResult {
	symbol: string;
	companyName: string;
	marketCap: number;
	sector: string;
	industry: string;
	country: string;
	price: number;
	volume: number;
	exchange: string;
	isEtf: boolean;
	isFund: boolean;
	isActivelyTrading: boolean;
}

export interface ScreenerDeps {
	fetchScreener: () => Promise<ScreenerResult[] | null>;
	searchName: (query: string) => Promise<FMPSearchResult[] | null>;
}

export interface LSECandidate {
	symbol: string;
	name: string;
	sector: string;
}

const SECTOR_ROTATION: Record<number, { sector?: string; label: string }> = {
	1: { sector: "Technology", label: "Technology" },
	2: { sector: "Healthcare", label: "Healthcare" },
	3: { label: "Small-caps (all sectors)" },
	4: { sector: "Financial Services", label: "Financial Services" },
	5: { sector: "Consumer Cyclical", label: "Consumer Cyclical" },
};

/** Build production ScreenerDeps from fmpFetch. Lazy import avoids pulling config at module load. */
export async function createFMPScreenerDeps(): Promise<ScreenerDeps> {
	const { fmpFetch } = await import("./fmp.ts");
	const { createChildLogger } = await import("../../utils/logger.ts");
	const log = createChildLogger({ module: "lse-screener" });

	const dayOfWeek = new Date().getDay();
	const rotation = SECTOR_ROTATION[dayOfWeek] ?? { label: "all sectors" };

	const params: Record<string, string> = {
		country: "GB",
		isActivelyTrading: "true",
		limit: "50",
	};

	if (!rotation.sector) {
		params.marketCapMoreThan = "50000000";
		params.marketCapLessThan = "2000000000";
		params.volumeMoreThan = "100000";
	} else {
		params.sector = rotation.sector;
		params.marketCapMoreThan = "100000000";
		params.volumeMoreThan = "50000";
	}

	log.info({ rotation: rotation.label, day: dayOfWeek }, "Screening LSE stocks");

	return {
		fetchScreener: () => fmpFetch<ScreenerResult[]>("/company-screener", params),
		searchName: (query: string) =>
			fmpFetch<FMPSearchResult[]>("/search-name", { query, exchange: "LSE" }),
	};
}

/**
 * Screen for LSE-listed UK companies using a two-step approach:
 * 1. FMP company-screener with country=GB (returns US-listed tickers)
 * 2. FMP search-name to resolve the LSE ticker for each candidate
 */
export async function screenLSEStocks(deps: ScreenerDeps): Promise<LSECandidate[]> {
	const screenerResults = await deps.fetchScreener();
	if (!screenerResults || screenerResults.length === 0) return [];

	const seen = new Set<string>();
	const candidates: LSECandidate[] = [];

	for (const result of screenerResults) {
		if (result.isEtf || result.isFund) continue;

		const searchResults = await deps.searchName(result.companyName);
		if (!searchResults) continue;

		const lseSymbol = pickLSESymbol(searchResults);
		if (!lseSymbol) continue;
		if (seen.has(lseSymbol)) continue;

		seen.add(lseSymbol);
		candidates.push({ symbol: lseSymbol, name: result.companyName, sector: result.sector });
	}

	return candidates;
}
