const LONDON_TZ = "Europe/London";

/** LSE trading hours in minutes from midnight (London time) */
const MARKET_OPEN_MINUTES = 8 * 60; // 08:00
const MARKET_CLOSE_MINUTES = 16 * 60 + 30; // 16:30

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

export function isMarketOpen(date?: Date): boolean {
	const { day, totalMinutes } = getLondonDate(date);
	if (day === 0 || day === 6) return false; // weekend
	return totalMinutes >= MARKET_OPEN_MINUTES && totalMinutes < MARKET_CLOSE_MINUTES;
}

function isPreMarket(date?: Date): boolean {
	const { day, totalMinutes } = getLondonDate(date);
	if (day === 0 || day === 6) return false;
	return totalMinutes >= 7 * 60 + 30 && totalMinutes < MARKET_OPEN_MINUTES; // 07:30 - 08:00
}

function isPostMarket(date?: Date): boolean {
	const { day, totalMinutes } = getLondonDate(date);
	if (day === 0 || day === 6) return false;
	return totalMinutes >= MARKET_CLOSE_MINUTES && totalMinutes < 17 * 60; // 16:30 - 17:00
}

function isResearchWindow(date?: Date): boolean {
	const { day, totalMinutes } = getLondonDate(date);
	if (day === 0 || day === 6) return false;
	return totalMinutes >= 18 * 60 && totalMinutes < 22 * 60; // 18:00 - 22:00
}

function isWindDown(date?: Date): boolean {
	const { day, totalMinutes } = getLondonDate(date);
	if (day === 0 || day === 6) return false;
	return totalMinutes >= 16 * 60 + 25 && totalMinutes < MARKET_CLOSE_MINUTES; // 16:25 - 16:30
}

export function getMarketPhase(
	date?: Date,
): "pre-market" | "open" | "wind-down" | "post-market" | "research" | "closed" {
	if (isPreMarket(date)) return "pre-market";
	if (isWindDown(date)) return "wind-down";
	if (isMarketOpen(date)) return "open";
	if (isPostMarket(date)) return "post-market";
	if (isResearchWindow(date)) return "research";
	return "closed";
}
