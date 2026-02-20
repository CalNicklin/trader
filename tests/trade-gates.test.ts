import { expect, test } from "bun:test";
import { checkTradeGates } from "../src/agent/trade-gates.ts";

test("rejects BUY with confidence below 0.7", () => {
	const result = checkTradeGates({
		side: "BUY",
		confidence: 0.5,
		marketPhase: "open",
		riskApproved: true,
		riskReasons: [],
	});

	expect(result).not.toBeNull();
	expect(result!.toLowerCase()).toContain("confidence");
});

test("rejects BUY during wind-down", () => {
	const result = checkTradeGates({
		side: "BUY",
		confidence: 0.8,
		marketPhase: "wind-down",
		riskApproved: true,
		riskReasons: [],
	});

	expect(result).not.toBeNull();
});

test("rejects BUY during post-market", () => {
	const result = checkTradeGates({
		side: "BUY",
		confidence: 0.8,
		marketPhase: "post-market",
		riskApproved: true,
		riskReasons: [],
	});

	expect(result).not.toBeNull();
});

test("allows SELL during wind-down", () => {
	const result = checkTradeGates({
		side: "SELL",
		confidence: 0.8,
		marketPhase: "wind-down",
		riskApproved: true,
		riskReasons: [],
	});

	expect(result).toBeNull();
});

test("rejects BUY when risk check fails", () => {
	const result = checkTradeGates({
		side: "BUY",
		confidence: 0.8,
		marketPhase: "open",
		riskApproved: false,
		riskReasons: ["Exceeds sector exposure limit"],
	});

	expect(result).not.toBeNull();
	expect(result!.toLowerCase()).toContain("risk");
});

test("allows valid BUY during open market", () => {
	const result = checkTradeGates({
		side: "BUY",
		confidence: 0.8,
		marketPhase: "open",
		riskApproved: true,
		riskReasons: [],
	});

	expect(result).toBeNull();
});
