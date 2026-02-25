import { createChildLogger } from "./logger.ts";

const log = createChildLogger({ module: "fx" });

const FX_CACHE_TTL = 60 * 60 * 1000; // 1 hour

let gbpUsdCache: { rate: number; fetchedAt: number } | null = null;

/** Fetch GBP/USD rate from Yahoo Finance. Cached for 1 hour. */
export async function getGbpUsdRate(): Promise<number> {
	if (gbpUsdCache && Date.now() - gbpUsdCache.fetchedAt < FX_CACHE_TTL) {
		return gbpUsdCache.rate;
	}

	try {
		const response = await fetch(
			"https://query1.finance.yahoo.com/v8/finance/chart/GBPUSD=X?interval=1d&range=1d",
		);
		if (!response.ok) throw new Error(`Yahoo FX HTTP ${response.status}`);

		const data = (await response.json()) as {
			chart?: { result?: Array<{ meta?: { regularMarketPrice?: number } }> };
		};
		const rate = data.chart?.result?.[0]?.meta?.regularMarketPrice;
		if (!rate || rate <= 0) throw new Error("Invalid FX rate from Yahoo");

		gbpUsdCache = { rate, fetchedAt: Date.now() };
		log.info({ rate }, "GBP/USD rate fetched");
		return rate;
	} catch (error) {
		log.warn({ error }, "FX rate fetch failed, using fallback 1.27");
		return gbpUsdCache?.rate ?? 1.27;
	}
}

/** Convert a value between GBP and USD. */
export async function convertCurrency(
	amount: number,
	from: "GBP" | "USD",
	to: "GBP" | "USD",
): Promise<number> {
	if (from === to) return amount;
	const rate = await getGbpUsdRate();
	if (from === "GBP") return amount * rate;
	return amount / rate;
}

/** Reset the FX cache (for testing). */
export function resetFxCache(): void {
	gbpUsdCache = null;
}
