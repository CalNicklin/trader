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
	changePercentage?: number;
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

const SCREENING_STRATEGY: Record<number, { label: string; smallCap: boolean }> = {
	0: { label: "Weekend (no screen)", smallCap: false },
	1: { label: "Momentum — all sectors", smallCap: false },
	2: { label: "Momentum — all sectors", smallCap: false },
	3: { label: "Momentum + small-caps", smallCap: true },
	4: { label: "Momentum — all sectors", smallCap: false },
	5: { label: "Momentum — all sectors", smallCap: false },
	6: { label: "Weekend (no screen)", smallCap: false },
};

const MOMENTUM_PARAMS: Record<string, string> = {
	country: "GB",
	isActivelyTrading: "true",
	limit: "50",
	marketCapMoreThan: "100000000",
	volumeMoreThan: "100000",
};

const SMALL_CAP_PARAMS: Record<string, string> = {
	country: "GB",
	isActivelyTrading: "true",
	limit: "25",
	marketCapMoreThan: "50000000",
	marketCapLessThan: "2000000000",
	volumeMoreThan: "100000",
};

/** Build production ScreenerDeps from fmpFetch. Lazy import avoids pulling config at module load. */
export async function createFMPScreenerDeps(): Promise<ScreenerDeps> {
	const { fmpFetch } = await import("./fmp.ts");
	const { createChildLogger } = await import("../../utils/logger.ts");
	const log = createChildLogger({ module: "lse-screener" });

	const dayOfWeek = new Date().getDay();
	const strategy = SCREENING_STRATEGY[dayOfWeek] ?? {
		label: "Momentum — all sectors",
		smallCap: false,
	};

	log.info({ strategy: strategy.label, day: dayOfWeek }, "Screening LSE stocks");

	return {
		fetchScreener: async () => {
			const momentum = await fmpFetch<ScreenerResult[]>("/company-screener", MOMENTUM_PARAMS);
			if (!strategy.smallCap) return momentum;

			const smallCap = await fmpFetch<ScreenerResult[]>("/company-screener", SMALL_CAP_PARAMS);
			const combined = [...(momentum ?? []), ...(smallCap ?? [])];
			return combined.length > 0 ? combined : null;
		},
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

	const sorted = [...screenerResults].sort(
		(a, b) => (b.changePercentage ?? 0) - (a.changePercentage ?? 0),
	);

	const seen = new Set<string>();
	const candidates: LSECandidate[] = [];

	for (const result of sorted) {
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
