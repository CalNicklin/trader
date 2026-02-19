import { BarSizeSetting, IBApiTickType } from "@stoqey/ib";
import { getFMPQuotes } from "../research/sources/fmp.ts";
import { getYahooQuote } from "../research/sources/yahoo-finance.ts";
import { createChildLogger } from "../utils/logger.ts";
import { getApi } from "./connection.ts";
import { lseStock } from "./contracts.ts";

const log = createChildLogger({ module: "broker-market-data" });

export interface Quote {
	symbol: string;
	bid: number | null;
	ask: number | null;
	last: number | null;
	volume: number | null;
	high: number | null;
	low: number | null;
	close: number | null;
	timestamp: Date;
}

/** Fetch real-time quote from IBKR */
function getIbkrQuote(symbol: string): Promise<Quote> {
	const api = getApi();
	const contract = lseStock(symbol);

	return new Promise((resolve, reject) => {
		const timeout = setTimeout(() => {
			sub.unsubscribe();
			reject(new Error(`Quote timeout for ${symbol}`));
		}, 10000);

		const sub = api.getMarketData(contract, "", true, false).subscribe({
			next: (update) => {
				const ticks = update.all;
				const quote: Quote = {
					symbol,
					bid: ticks.get(IBApiTickType.BID)?.value ?? null,
					ask: ticks.get(IBApiTickType.ASK)?.value ?? null,
					last: ticks.get(IBApiTickType.LAST)?.value ?? null,
					volume: ticks.get(IBApiTickType.VOLUME)?.value ?? null,
					high: ticks.get(IBApiTickType.HIGH)?.value ?? null,
					low: ticks.get(IBApiTickType.LOW)?.value ?? null,
					close: ticks.get(IBApiTickType.CLOSE)?.value ?? null,
					timestamp: new Date(),
				};
				clearTimeout(timeout);
				sub.unsubscribe();
				log.debug({ symbol, last: quote.last, bid: quote.bid, ask: quote.ask }, "Quote fetched");
				resolve(quote);
			},
			error: (err) => {
				clearTimeout(timeout);
				reject(err);
			},
		});
	});
}

/** Try Yahoo Finance as fallback quote source */
async function getYahooFallbackQuote(symbol: string): Promise<Quote | null> {
	try {
		const yq = await getYahooQuote(symbol);
		if (!yq || !yq.price) return null;
		return {
			symbol,
			bid: null,
			ask: null,
			last: yq.price,
			volume: yq.volume,
			high: yq.fiftyTwoWeekHigh,
			low: yq.fiftyTwoWeekLow,
			close: null,
			timestamp: new Date(),
		};
	} catch {
		return null;
	}
}

/** Get a market data snapshot for an LSE symbol.
 *  Priority: IBKR real-time → Yahoo Finance */
export async function getQuote(symbol: string): Promise<Quote> {
	try {
		return await getIbkrQuote(symbol);
	} catch {
		// IBKR failed (error 354 / timeout) — try Yahoo
		const yahoo = await getYahooFallbackQuote(symbol);
		if (yahoo) {
			log.info({ symbol, last: yahoo.last }, "Yahoo fallback quote");
			return yahoo;
		}
		throw new Error(`No quote available for ${symbol} (IBKR and Yahoo both failed)`);
	}
}

/** Get quotes for multiple symbols */
export async function getQuotes(
	symbols: string[],
	options?: { skipFmpFallback?: boolean },
): Promise<Map<string, Quote>> {
	const quotes = new Map<string, Quote>();
	const results = await Promise.allSettled(symbols.map((s) => getQuote(s)));

	const failedSymbols: string[] = [];
	for (let i = 0; i < symbols.length; i++) {
		const result = results[i]!;
		if (result.status === "fulfilled") {
			quotes.set(symbols[i]!, result.value);
		} else {
			log.warn({ symbol: symbols[i], error: result.reason }, "Failed to get quote");
			failedSymbols.push(symbols[i]!);
		}
	}

	// FMP as final fallback when both IBKR and Yahoo fail
	if (failedSymbols.length > 0 && !options?.skipFmpFallback) {
		try {
			const fmpQuotes = await getFMPQuotes(failedSymbols);
			for (const [symbol, quote] of fmpQuotes) {
				quotes.set(symbol, quote);
				log.info({ symbol, last: quote.last }, "FMP fallback quote");
			}
		} catch (error) {
			log.warn({ error, symbols: failedSymbols }, "FMP fallback failed");
		}
	}

	return quotes;
}

export interface HistoricalBar {
	time: string;
	open: number;
	high: number;
	low: number;
	close: number;
	volume: number;
}

/** Get historical daily bars for an LSE symbol */
export async function getHistoricalBars(
	symbol: string,
	duration: string = "1 M",
	barSize: BarSizeSetting = BarSizeSetting.DAYS_ONE,
): Promise<HistoricalBar[]> {
	const api = getApi();
	const contract = lseStock(symbol);

	const bars = await api.getHistoricalData(contract, "", duration, barSize, "TRADES", 1, 1);

	return bars.map((bar) => ({
		time: bar.time ?? "",
		open: bar.open ?? 0,
		high: bar.high ?? 0,
		low: bar.low ?? 0,
		close: bar.close ?? 0,
		volume: bar.volume ?? 0,
	}));
}
