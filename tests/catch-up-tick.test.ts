import { expect, test } from "bun:test";
import { shouldRunCatchUpTick } from "../src/utils/catch-up.ts";

test("triggers catch-up when last log is stale and market is open", () => {
	const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000);
	expect(shouldRunCatchUpTick(threeHoursAgo, "open")).toBe(true);
});

test("does not trigger when last log is recent", () => {
	const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000);
	expect(shouldRunCatchUpTick(thirtyMinAgo, "open")).toBe(false);
});

test("does not trigger when market is closed", () => {
	const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000);
	expect(shouldRunCatchUpTick(threeHoursAgo, "closed")).toBe(false);
});

test("triggers during pre-market if stale", () => {
	const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000);
	expect(shouldRunCatchUpTick(threeHoursAgo, "pre-market")).toBe(true);
});
