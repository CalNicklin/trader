import type { Quote } from "../../broker/market-data.ts";
import { getConfig } from "../../config.ts";
import { createChildLogger } from "../../utils/logger.ts";
import { RateLimiter } from "../../utils/rate-limiter.ts";

const log = createChildLogger({ module: "research-fmp" });
const rateLimiter = new RateLimiter(300, 60000); // Starter tier: 300 requests per minute

const BASE_URL = "https://financialmodelingprep.com/stable";

export async function fmpFetch<T>(
	path: string,
	params?: Record<string, string>,
): Promise<T | null> {
	const config = getConfig();
	if (!config.FMP_API_KEY) {
		log.debug("FMP API key not configured, skipping");
		return null;
	}

	await rateLimiter.acquire();

	const searchParams = new URLSearchParams({ ...params, apikey: config.FMP_API_KEY });
	const url = `${BASE_URL}${path}?${searchParams}`;

	try {
		const response = await fetch(url);
		if (!response.ok) {
			log.warn({ status: response.status, path }, "FMP API error");
			return null;
		}
		return (await response.json()) as T;
	} catch (error) {
		log.error({ path, error }, "FMP fetch failed");
		return null;
	}
}

export interface FMPProfile {
	symbol: string;
	companyName: string;
	sector: string;
	industry: string;
	mktCap: number;
	marketCap: number;
	description: string;
	country: string;
	exchange: string;
	price: number;
	volume: number;
	change: number;
	changePercentage: number;
	range: string;
	lastDividend: number;
}

/** Get company profile from FMP */
export async function getFMPProfile(symbol: string): Promise<FMPProfile | null> {
	const result = await fmpFetch<FMPProfile[]>("/profile", { symbol: `${symbol}.L` });
	return result?.[0] ?? null;
}

/** Get real-time quotes from FMP for multiple LSE symbols via /profile endpoint */
export async function getFMPQuotes(symbols: string[]): Promise<Map<string, Quote>> {
	const quotes = new Map<string, Quote>();
	if (symbols.length === 0) return quotes;

	const results = await Promise.all(
		symbols.map(async (symbol) => {
			const profile = await fmpFetch<FMPProfile[]>("/profile", { symbol: `${symbol}.L` });
			return { symbol, profile: profile?.[0] ?? null };
		}),
	);

	for (const { symbol, profile } of results) {
		if (!profile) continue;
		quotes.set(symbol, {
			symbol,
			bid: null,
			ask: null,
			last: profile.price,
			volume: profile.volume,
			high: null,
			low: null,
			close: null,
			timestamp: new Date(),
		});
	}

	return quotes;
}
