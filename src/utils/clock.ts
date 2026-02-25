import type { Exchange } from "../broker/contracts.ts";

const LONDON_TZ = "Europe/London";

/** Exchange session boundaries in minutes from midnight (London time) */
const LSE_PRE_MARKET = 7 * 60 + 30; // 07:30
const LSE_OPEN = 8 * 60; // 08:00
const LSE_WIND_DOWN = 16 * 60 + 25; // 16:25
const LSE_CLOSE = 16 * 60 + 30; // 16:30
const LSE_POST_MARKET_END = 17 * 60; // 17:00

const US_OPEN = 14 * 60 + 30; // 14:30 London
const US_WIND_DOWN = 20 * 60 + 55; // 20:55 London
const US_CLOSE = 21 * 60; // 21:00 London
const US_POST_MARKET_END = 21 * 60 + 15; // 21:15 London

const RESEARCH_START = 18 * 60; // 18:00
const RESEARCH_END = 22 * 60; // 22:00

export type MarketPhase =
	| "pre-market"
	| "open"
	| "wind-down"
	| "post-market"
	| "research"
	| "closed";

function getLondonDate(date?: Date): {
	hours: number;
	minutes: number;
	day: number;
	totalMinutes: number;
} {
	const d = date ?? new Date();
	const londonStr = d.toLocaleString("en-GB", { timeZone: LONDON_TZ });
	const parts = londonStr.split(", ");
	const timeParts = parts[1]!.split(":");
	const hours = Number.parseInt(timeParts[0]!, 10);
	const minutes = Number.parseInt(timeParts[1]!, 10);
	const dateParts = parts[0]!.split("/");
	const londonDate = new Date(`${dateParts[2]}-${dateParts[1]}-${dateParts[0]}`);
	const day = londonDate.getDay();
	return { hours, minutes, day, totalMinutes: hours * 60 + minutes };
}

function isWeekday(day: number): boolean {
	return day !== 0 && day !== 6;
}

export function isMarketOpen(date?: Date): boolean {
	const { day, totalMinutes } = getLondonDate(date);
	if (!isWeekday(day)) return false;
	return totalMinutes >= LSE_OPEN && totalMinutes < LSE_CLOSE;
}

/** Get the trading phase for a specific exchange */
export function getExchangePhase(exchange: Exchange, date?: Date): MarketPhase {
	const { day, totalMinutes } = getLondonDate(date);
	if (!isWeekday(day)) return "closed";

	if (exchange === "LSE") {
		if (totalMinutes >= LSE_PRE_MARKET && totalMinutes < LSE_OPEN) return "pre-market";
		if (totalMinutes >= LSE_WIND_DOWN && totalMinutes < LSE_CLOSE) return "wind-down";
		if (totalMinutes >= LSE_OPEN && totalMinutes < LSE_WIND_DOWN) return "open";
		if (totalMinutes >= LSE_CLOSE && totalMinutes < LSE_POST_MARKET_END) return "post-market";
		return "closed";
	}

	// NASDAQ / NYSE — US hours in London time
	if (totalMinutes >= US_WIND_DOWN && totalMinutes < US_CLOSE) return "wind-down";
	if (totalMinutes >= US_OPEN && totalMinutes < US_WIND_DOWN) return "open";
	if (totalMinutes >= US_CLOSE && totalMinutes < US_POST_MARKET_END) return "post-market";
	return "closed";
}

/** Get the overall market phase across all exchanges.
 *  Returns the most active phase: open > wind-down > post-market > pre-market > research > closed */
export function getMarketPhase(date?: Date): MarketPhase {
	const { day, totalMinutes } = getLondonDate(date);
	if (!isWeekday(day)) return "closed";

	const lse = getExchangePhase("LSE", date);
	const us = getExchangePhase("NASDAQ", date);

	if (lse === "open" || us === "open") return "open";
	if (lse === "wind-down" || us === "wind-down") return "wind-down";
	if (lse === "post-market" || us === "post-market") return "post-market";
	if (lse === "pre-market") return "pre-market";

	// Research window (global, not exchange-specific)
	if (totalMinutes >= RESEARCH_START && totalMinutes < RESEARCH_END) return "research";

	return "closed";
}
