export interface FMPSearchResult {
	symbol: string;
	name: string;
	currency: string;
	exchange: string;
}

/**
 * Pick the best LSE equity symbol from FMP search-name results.
 * Filters out ETFs/ETCs, non-GBp currencies, and leveraged products.
 * Returns the bare symbol (without .L suffix) or null if none found.
 */
export function pickLSESymbol(results: ReadonlyArray<FMPSearchResult>): string | null {
	const candidates = results.filter((r) => {
		if (r.exchange !== "LSE") return false;
		if (r.currency !== "GBp") return false;
		if (/^\d/.test(r.symbol)) return false;
		const nameLower = r.name.toLowerCase();
		if (nameLower.includes("etf") || nameLower.includes("etc")) return false;
		return true;
	});

	if (candidates.length === 0) return null;

	candidates.sort((a, b) => a.symbol.length - b.symbol.length);
	return candidates[0]!.symbol.replace(".L", "");
}
