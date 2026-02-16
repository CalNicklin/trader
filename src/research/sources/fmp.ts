import type { Quote } from "../../broker/market-data.ts";
import { getConfig } from "../../config.ts";
import { createChildLogger } from "../../utils/logger.ts";
import { RateLimiter } from "../../utils/rate-limiter.ts";

const log = createChildLogger({ module: "research-fmp" });
const rateLimiter = new RateLimiter(5, 60000); // 5 requests per minute (free tier)

const BASE_URL = "https://financialmodelingprep.com/stable";

async function fmpFetch<T>(path: string, params?: Record<string, string>): Promise<T | null> {
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

interface FMPScreenerResult {
	symbol: string;
	companyName: string;
	marketCap: number;
	sector: string;
	industry: string;
	country: string;
	price: number;
	volume: number;
	exchange: string;
}

/** Sector rotation schedule: different focus each weekday */
const SECTOR_ROTATION: Record<number, { sector?: string; label: string }> = {
	1: { sector: "Technology", label: "Technology" },
	2: { sector: "Healthcare", label: "Healthcare" },
	3: { label: "Small-caps (all sectors)" }, // No sector filter, small-cap focus
	4: { sector: "Financial Services", label: "Financial Services" },
	5: { sector: "Consumer Cyclical", label: "Consumer Cyclical" },
};

/** Screen LSE stocks using FMP company screener with rotating criteria */
export async function screenLSEStocks(): Promise<
	Array<{ symbol: string; name: string; sector: string }>
> {
	const dayOfWeek = new Date().getDay(); // 0=Sun, 1=Mon...
	const rotation = SECTOR_ROTATION[dayOfWeek] ?? { label: "all sectors" };

	const params: Record<string, string> = {
		exchange: "LSE",
		country: "GB",
		isActivelyTrading: "true",
		limit: "50",
	};

	// Small-cap day: focus on smaller companies across all sectors
	if (!rotation.sector) {
		params.marketCapMoreThan = "50000000"; // >£50M
		params.marketCapLessThan = "2000000000"; // <£2B
		params.volumeMoreThan = "100000";
	} else {
		params.sector = rotation.sector;
		params.marketCapMoreThan = "100000000"; // >£100M
		params.volumeMoreThan = "50000";
	}

	log.info({ rotation: rotation.label, day: dayOfWeek }, "Screening LSE stocks");

	const results = await fmpFetch<FMPScreenerResult[]>("/company-screener", params);
	if (!results || results.length === 0) {
		log.warn("FMP screener returned no results");
		return [];
	}

	return results.map((r) => ({
		symbol: r.symbol.replace(".L", ""),
		name: r.companyName,
		sector: r.sector,
	}));
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
