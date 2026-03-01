import YahooFinance from "yahoo-finance2";
import type { Exchange } from "../../broker/contracts.ts";
import { createChildLogger } from "../../utils/logger.ts";

const log = createChildLogger({ module: "research-yahoo" });

const yf = new YahooFinance();

/** LSE symbols need .L suffix; US symbols are bare in Yahoo Finance. */
export function toYahooSymbol(symbol: string, exchange: Exchange): string {
	if (exchange === "LSE") return symbol.endsWith(".L") ? symbol : `${symbol}.L`;
	return symbol;
}

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
	bid: number | null;
	ask: number | null;
	dayHigh: number | null;
	dayLow: number | null;
}

/** Get quote data from Yahoo Finance */
export async function getYahooQuote(
	symbol: string,
	exchange: Exchange = "LSE",
): Promise<YahooQuoteData | null> {
	try {
		const yahooSymbol = toYahooSymbol(symbol, exchange);
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
			bid: quote.bid ?? null,
			ask: quote.ask ?? null,
			dayHigh: quote.regularMarketDayHigh ?? null,
			dayLow: quote.regularMarketDayLow ?? null,
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
	forwardPE: number | null;
	pegRatio: number | null;
	priceToBook: number | null;
	enterpriseToEbitda: number | null;
	earningsGrowth: number | null;
	revenueGrowthEstimate: number | null;
	nextEarningsDate: string | null;
	sector: string | null;
	industry: string | null;
	description: string | null;
}

/** Get fundamental data from Yahoo Finance */
export async function getYahooFundamentals(
	symbol: string,
	exchange: Exchange = "LSE",
): Promise<YahooFundamentals | null> {
	try {
		const yahooSymbol = toYahooSymbol(symbol, exchange);
		const result = await yf.quoteSummary(yahooSymbol, {
			modules: [
				"financialData",
				"defaultKeyStatistics",
				"assetProfile",
				"earningsTrend",
				"calendarEvents",
			],
		});

		if (!result) return null;

		const fin = result.financialData;
		const stats = result.defaultKeyStatistics;
		const profile = result.assetProfile;
		const earnings = result.earningsTrend;
		const calendar = result.calendarEvents;

		const nextEarningsRaw = calendar?.earnings?.earningsDate?.[0];
		const nextEarningsDate = nextEarningsRaw
			? new Date(nextEarningsRaw).toISOString().split("T")[0]!
			: null;

		return {
			symbol,
			revenue: fin?.totalRevenue ?? null,
			revenueGrowth: fin?.revenueGrowth ?? null,
			profitMargin: fin?.profitMargins ?? null,
			operatingMargin: fin?.operatingMargins ?? null,
			returnOnEquity: fin?.returnOnEquity ?? null,
			debtToEquity: fin?.debtToEquity ?? null,
			freeCashFlow: fin?.freeCashflow ?? null,
			forwardPE: stats?.forwardPE ?? null,
			pegRatio: stats?.pegRatio ?? null,
			priceToBook: stats?.priceToBook ?? null,
			enterpriseToEbitda: stats?.enterpriseToEbitda ?? null,
			earningsGrowth: earnings?.trend?.[0]?.earningsEstimate?.growth ?? null,
			revenueGrowthEstimate: earnings?.trend?.[0]?.revenueEstimate?.growth ?? null,
			nextEarningsDate,
			sector: profile?.sector ?? null,
			industry: profile?.industry ?? null,
			description: profile?.longBusinessSummary?.substring(0, 500) ?? null,
		};
	} catch (error) {
		log.error({ symbol, error }, "Yahoo fundamentals fetch failed");
		return null;
	}
}

export interface YahooHistoricalBar {
	time: string;
	open: number;
	high: number;
	low: number;
	close: number;
	volume: number;
}

/** Get historical daily bars from Yahoo Finance. Duration string like "1 M" or "3 M". */
export async function getYahooHistoricalBars(
	symbol: string,
	duration: string = "1 M",
	exchange: Exchange = "LSE",
): Promise<YahooHistoricalBar[]> {
	const yahooSymbol = toYahooSymbol(symbol, exchange);

	const months = duration.includes("M") ? Number.parseInt(duration, 10) || 1 : 1;
	const period1 = new Date();
	period1.setMonth(period1.getMonth() - months);

	const results = await yf.historical(yahooSymbol, {
		period1: period1.toISOString().split("T")[0]!,
	});

	return results.map(
		(bar: {
			date: Date;
			open: number;
			high: number;
			low: number;
			close: number;
			volume: number;
		}) => ({
			time: bar.date.toISOString().split("T")[0]!,
			open: bar.open,
			high: bar.high,
			low: bar.low,
			close: bar.close,
			volume: bar.volume,
		}),
	);
}

/** @deprecated Use screenLSEStocks() from lse-screener.ts instead */
