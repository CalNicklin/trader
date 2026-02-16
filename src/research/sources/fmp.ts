import type { Quote } from "../../broker/market-data.ts";
import { getConfig } from "../../config.ts";
import { createChildLogger } from "../../utils/logger.ts";
import { RateLimiter } from "../../utils/rate-limiter.ts";

const log = createChildLogger({ module: "research-fmp" });
const rateLimiter = new RateLimiter(5, 60000); // 5 requests per minute (free tier)

const BASE_URL = "https://financialmodelingprep.com/api/v3";

async function fmpFetch<T>(path: string): Promise<T | null> {
	const config = getConfig();
	if (!config.FMP_API_KEY) {
		log.debug("FMP API key not configured, skipping");
		return null;
	}

	await rateLimiter.acquire();

	const url = `${BASE_URL}${path}${path.includes("?") ? "&" : "?"}apikey=${config.FMP_API_KEY}`;

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
	description: string;
	country: string;
	exchangeShortName: string;
}

/** Get company profile from FMP */
export async function getFMPProfile(symbol: string): Promise<FMPProfile | null> {
	const result = await fmpFetch<FMPProfile[]>(`/profile/${symbol}.L`);
	return result?.[0] ?? null;
}

export interface FMPRatios {
	peRatioTTM: number;
	pegRatioTTM: number;
	dividendYielTTM: number;
	returnOnEquityTTM: number;
	debtEquityRatioTTM: number;
	currentRatioTTM: number;
	priceToBookRatioTTM: number;
}

/** Get financial ratios from FMP */
export async function getFMPRatios(symbol: string): Promise<FMPRatios | null> {
	const result = await fmpFetch<FMPRatios[]>(`/ratios-ttm/${symbol}.L`);
	return result?.[0] ?? null;
}

interface FMPQuote {
	symbol: string;
	price: number;
	dayHigh: number;
	dayLow: number;
	previousClose: number;
	volume: number;
}

/** Get real-time quotes from FMP for multiple LSE symbols */
export async function getFMPQuotes(symbols: string[]): Promise<Map<string, Quote>> {
	const quotes = new Map<string, Quote>();
	if (symbols.length === 0) return quotes;

	const fmpSymbols = symbols.map((s) => `${s}.L`).join(",");
	const result = await fmpFetch<FMPQuote[]>(`/quote/${fmpSymbols}`);
	if (!result) return quotes;

	for (const q of result) {
		const symbol = q.symbol.replace(".L", "");
		quotes.set(symbol, {
			symbol,
			bid: null,
			ask: null,
			last: q.price,
			volume: q.volume,
			high: q.dayHigh,
			low: q.dayLow,
			close: q.previousClose,
			timestamp: new Date(),
		});
	}

	return quotes;
}

/** Get gainers/losers from LSE */
export async function getFMPGainersLosers(): Promise<{
	gainers: Array<{ symbol: string; changesPercentage: number; price: number }>;
	losers: Array<{ symbol: string; changesPercentage: number; price: number }>;
}> {
	const [gainers, losers] = await Promise.all([
		fmpFetch<Array<{ symbol: string; changesPercentage: number; price: number }>>(
			"/stock_market/gainers",
		),
		fmpFetch<Array<{ symbol: string; changesPercentage: number; price: number }>>(
			"/stock_market/losers",
		),
	]);

	// Filter for LSE only
	const filterLSE = (
		items: Array<{ symbol: string; changesPercentage: number; price: number }> | null,
	) =>
		(items ?? [])
			.filter((i) => i.symbol.endsWith(".L"))
			.map((i) => ({ ...i, symbol: i.symbol.replace(".L", "") }));

	return {
		gainers: filterLSE(gainers),
		losers: filterLSE(losers),
	};
}
