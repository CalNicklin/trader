import { expect, test } from "bun:test";
import { getMarketPhase, isMarketOpen } from "../src/utils/clock.ts";

test("market is closed on weekends", () => {
	// Sunday 2024-01-07 12:00 UTC
	const sunday = new Date("2024-01-07T12:00:00Z");
	expect(isMarketOpen(sunday)).toBe(false);
	expect(getMarketPhase(sunday)).toBe("closed");
});

test("market is open during trading hours", () => {
	// Wednesday 10:00 London time (in winter UTC = London)
	const wednesday = new Date("2024-01-10T10:00:00Z");
	expect(isMarketOpen(wednesday)).toBe(true);
	expect(getMarketPhase(wednesday)).toBe("open");
});

test("market is closed after hours", () => {
	// Wednesday 20:00 London time
	const evening = new Date("2024-01-10T20:00:00Z");
	expect(isMarketOpen(evening)).toBe(false);
});
