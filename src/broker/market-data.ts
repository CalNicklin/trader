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

/** Fetch raw IBKR quote (may be real-time or delayed) */
function getIbkrQuote(symbol: string): Promise<{ quote: Quote; isDelayed: boolean }> {
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

				const rtLast = ticks.get(IBApiTickType.LAST)?.value ?? null;
				const rtBid = ticks.get(IBApiTickType.BID)?.value ?? null;
				const hasRealTime = rtLast !== null || rtBid !== null;

				// Read real-time tick, falling back to delayed tick type
				const tick = (rt: IBApiTickType, delayed: IBApiTickType) =>
					ticks.get(rt)?.value ?? ticks.get(delayed)?.value ?? null;

				const quote: Quote = {
					symbol,
					bid: tick(IBApiTickType.BID, IBApiTickType.DELAYED_BID),
					ask: tick(IBApiTickType.ASK, IBApiTickType.DELAYED_ASK),
					last: tick(IBApiTickType.LAST, IBApiTickType.DELAYED_LAST),
					volume: tick(IBApiTickType.VOLUME, IBApiTickType.DELAYED_VOLUME),
					high: tick(IBApiTickType.HIGH, IBApiTickType.DELAYED_HIGH),
					low: tick(IBApiTickType.LOW, IBApiTickType.DELAYED_LOW),
					close: tick(IBApiTickType.CLOSE, IBApiTickType.DELAYED_CLOSE),
					timestamp: new Date(),
				};

				clearTimeout(timeout);
				sub.unsubscribe();
				resolve({ quote, isDelayed: !hasRealTime });
			},
			error: (err) => {
				clearTimeout(timeout);
				reject(err);
			},
		});
	});
}

/** Try Yahoo Finance for a fresher quote */
async function getYahooQuoteAsFallback(symbol: string): Promise<Quote | null> {
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
 *  Priority: IBKR real-time → Yahoo Finance → IBKR delayed */
export async function getQuote(symbol: string): Promise<Quote> {
	// Try IBKR first (real-time or delayed)
	const ibkr = await getIbkrQuote(symbol);

	// If real-time, use it directly
	if (!ibkr.isDelayed) {
		log.debug({ symbol, last: ibkr.quote.last, source: "ibkr-realtime" }, "Quote fetched");
		return ibkr.quote;
	}

	// IBKR returned delayed data — try Yahoo for fresher price
	const yahoo = await getYahooQuoteAsFallback(symbol);
	if (yahoo) {
		log.debug({ symbol, last: yahoo.last, source: "yahoo" }, "Quote fetched (Yahoo fallback)");
		return yahoo;
	}

	// Yahoo failed — use IBKR delayed data
	log.debug({ symbol, last: ibkr.quote.last, source: "ibkr-delayed" }, "Quote fetched (delayed)");
	return ibkr.quote;
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

	// FMP as final fallback for complete IBKR failures (timeout/disconnect)
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
