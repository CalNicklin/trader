import type { Quote } from "../broker/market-data.ts";

interface FingerprintInput {
	positions: ReadonlyArray<{ symbol: string; quantity: number }>;
	pendingOrderIds: ReadonlyArray<number>;
	researchSignals: ReadonlyArray<{ symbol: string; action: string | null }>;
	quotes: ReadonlyMap<string, Quote>;
}

/**
 * Bucket a price into a discrete ~1% band using logarithmic scaling.
 * Prices within ~1% of each other produce the same bucket value.
 * A 2% move will reliably cross a band boundary.
 */
function bucketPrice(price: number): number {
	if (price <= 0) return 0;
	return Math.floor(Math.log(price) * 100);
}

export function computeFingerprint(input: FingerprintInput): string {
	const positions = [...input.positions]
		.sort((a, b) => a.symbol.localeCompare(b.symbol))
		.map((p) => `${p.symbol}:${p.quantity}`);

	const orders = [...input.pendingOrderIds].sort((a, b) => a - b);

	const signals = [...input.researchSignals]
		.sort((a, b) => a.symbol.localeCompare(b.symbol))
		.map((r) => `${r.symbol}:${r.action ?? "NONE"}`);

	const quoteBuckets: string[] = [];
	const sortedSymbols = [...input.quotes.keys()].sort();
	for (const symbol of sortedSymbols) {
		const q = input.quotes.get(symbol);
		if (q?.last) {
			quoteBuckets.push(`${symbol}:${bucketPrice(q.last)}`);
		}
	}

	const canonical = JSON.stringify({ positions, orders, signals, quoteBuckets });
	const hash = Bun.hash(canonical);
	return hash.toString(36);
}
