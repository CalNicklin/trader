import YahooFinance from "yahoo-finance2";
import { createChildLogger } from "../../utils/logger.ts";

const log = createChildLogger({ module: "research-yahoo" });

const yf = new YahooFinance();

export interface YahooQuoteData {
	symbol: string;
	price: number;
	change: number;
	changePercent: number;
	volume: number;
	avgVolume: number;
	marketCap: number;
	peRatio: number | null;
	eps: number | null;
	dividend: number | null;
	fiftyTwoWeekHigh: number;
	fiftyTwoWeekLow: number;
}

/** Get quote data from Yahoo Finance for a UK stock */
export async function getYahooQuote(symbol: string): Promise<YahooQuoteData | null> {
	try {
		// LSE stocks use .L suffix in Yahoo
		const yahooSymbol = symbol.endsWith(".L") ? symbol : `${symbol}.L`;
		const quote = await yf.quote(yahooSymbol);

		if (!quote) return null;

		return {
			symbol,
			price: quote.regularMarketPrice ?? 0,
			change: quote.regularMarketChange ?? 0,
			changePercent: quote.regularMarketChangePercent ?? 0,
			volume: quote.regularMarketVolume ?? 0,
			avgVolume: quote.averageDailyVolume3Month ?? 0,
			marketCap: quote.marketCap ?? 0,
			peRatio: quote.trailingPE ?? null,
			eps: quote.epsTrailingTwelveMonths ?? null,
			dividend: quote.quoteType === "EQUITY" ? (quote.dividendYield ?? null) : null,
			fiftyTwoWeekHigh: quote.fiftyTwoWeekHigh ?? 0,
			fiftyTwoWeekLow: quote.fiftyTwoWeekLow ?? 0,
		};
	} catch (error) {
		log.error({ symbol, error }, "Yahoo quote fetch failed");
		return null;
	}
}

export interface YahooFundamentals {
	symbol: string;
	revenue: number | null;
	revenueGrowth: number | null;
	profitMargin: number | null;
	operatingMargin: number | null;
	returnOnEquity: number | null;
	debtToEquity: number | null;
	freeCashFlow: number | null;
	sector: string | null;
	industry: string | null;
	description: string | null;
}

/** Get fundamental data from Yahoo Finance */
export async function getYahooFundamentals(symbol: string): Promise<YahooFundamentals | null> {
	try {
		const yahooSymbol = symbol.endsWith(".L") ? symbol : `${symbol}.L`;
		const result = await yf.quoteSummary(yahooSymbol, {
			modules: ["financialData", "defaultKeyStatistics", "assetProfile"],
		});

		if (!result) return null;

		const fin = result.financialData;
		const profile = result.assetProfile;

		return {
			symbol,
			revenue: fin?.totalRevenue ?? null,
			revenueGrowth: fin?.revenueGrowth ?? null,
			profitMargin: fin?.profitMargins ?? null,
			operatingMargin: fin?.operatingMargins ?? null,
			returnOnEquity: fin?.returnOnEquity ?? null,
			debtToEquity: fin?.debtToEquity ?? null,
			freeCashFlow: fin?.freeCashflow ?? null,
			sector: profile?.sector ?? null,
			industry: profile?.industry ?? null,
			description: profile?.longBusinessSummary?.substring(0, 500) ?? null,
		};
	} catch (error) {
		log.error({ symbol, error }, "Yahoo fundamentals fetch failed");
		return null;
	}
}

/** Screen for active UK stocks using Yahoo Finance */
export async function screenUKStocks(): Promise<string[]> {
	try {
		const result = await yf.search("LSE stocks", { quotesCount: 50 });
		return (result.quotes ?? [])
			.filter((q: Record<string, unknown>) => q.exchDisp === "London" || q.exchange === "LSE")
			.map((q: Record<string, unknown>) => String(q.symbol ?? "").replace(".L", ""))
			.filter(Boolean);
	} catch (error) {
		log.error({ error }, "UK stock screening failed");
		return [];
	}
}
