import { expect, test } from "bun:test";
import { getExchangePhase, getMarketPhase, isMarketOpen } from "../src/utils/clock.ts";

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

test("LSE exchange phase: open at 10:00", () => {
	// Wednesday 10:00 London time (winter: UTC = London)
	const date = new Date("2024-01-10T10:00:00Z");
	expect(getExchangePhase("LSE", date)).toBe("open");
});

test("LSE exchange phase: wind-down at 16:26", () => {
	const date = new Date("2024-01-10T16:26:00Z");
	expect(getExchangePhase("LSE", date)).toBe("wind-down");
});

test("LSE exchange phase: closed at 19:00", () => {
	const date = new Date("2024-01-10T19:00:00Z");
	expect(getExchangePhase("LSE", date)).toBe("closed");
});

test("US exchange phase: closed before 14:30", () => {
	const date = new Date("2024-01-10T10:00:00Z");
	expect(getExchangePhase("NASDAQ", date)).toBe("closed");
});

test("US exchange phase: open at 15:00", () => {
	// 15:00 London = 30 minutes into US session
	const date = new Date("2024-01-10T15:00:00Z");
	expect(getExchangePhase("NASDAQ", date)).toBe("open");
});

test("US exchange phase: open at 20:00", () => {
	const date = new Date("2024-01-10T20:00:00Z");
	expect(getExchangePhase("NASDAQ", date)).toBe("open");
});

test("US exchange phase: wind-down at 20:56", () => {
	const date = new Date("2024-01-10T20:56:00Z");
	expect(getExchangePhase("NASDAQ", date)).toBe("wind-down");
});

test("US exchange phase: post-market at 21:05", () => {
	const date = new Date("2024-01-10T21:05:00Z");
	expect(getExchangePhase("NASDAQ", date)).toBe("post-market");
});

test("US exchange phase: closed at 22:00", () => {
	const date = new Date("2024-01-10T22:00:00Z");
	expect(getExchangePhase("NASDAQ", date)).toBe("closed");
});

test("NYSE uses same hours as NASDAQ", () => {
	const date = new Date("2024-01-10T15:00:00Z");
	expect(getExchangePhase("NYSE", date)).toBe("open");
});

test("overall market phase: open at 19:00 (US only)", () => {
	// 19:00 London — LSE closed, US open
	const date = new Date("2024-01-10T19:00:00Z");
	expect(getMarketPhase(date)).toBe("open");
});

test("overall market phase: open during overlap at 15:00 (both open)", () => {
	// 15:00 London — both LSE and US open
	const date = new Date("2024-01-10T15:00:00Z");
	expect(getMarketPhase(date)).toBe("open");
});

test("overall market phase: open at 10:00 (LSE only)", () => {
	// 10:00 London — LSE open, US closed
	const date = new Date("2024-01-10T10:00:00Z");
	expect(getMarketPhase(date)).toBe("open");
});

test("overall market phase: wind-down at 20:56 (US wind-down, LSE closed)", () => {
	const date = new Date("2024-01-10T20:56:00Z");
	expect(getMarketPhase(date)).toBe("wind-down");
});

test("overall market phase: post-market at 21:05 (US post-market)", () => {
	const date = new Date("2024-01-10T21:05:00Z");
	expect(getMarketPhase(date)).toBe("post-market");
});

test("overall market phase: open at 16:26 (LSE wind-down but US open)", () => {
	// 16:26 London — LSE wind-down, but US is open → overall = open
	const date = new Date("2024-01-10T16:26:00Z");
	expect(getMarketPhase(date)).toBe("open");
});
