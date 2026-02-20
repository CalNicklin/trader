import { expect, test } from "bun:test";
import {
	buildContextEnrichments,
	type EnrichmentInputs,
} from "../src/agent/context-enrichments.ts";

test("includes day plan excerpt when provided", () => {
	const inputs: EnrichmentInputs = {
		dayPlan:
			"Focus on SHEL pullback to 2450p, watch AZN earnings next week. Avoid DGE — weak momentum.",
		lastAgentResponse: null,
		positionsWithSectors: [],
		quoteSuccessCount: 5,
		quoteFailures: [],
	};

	const result = buildContextEnrichments(inputs);

	expect(result).toContain("SHEL pullback");
	expect(result).toContain("Day plan");
});

test("includes last agent response when provided", () => {
	const inputs: EnrichmentInputs = {
		dayPlan: null,
		lastAgentResponse: "Decided to hold SHEL — RSI approaching overbought at 68.",
		positionsWithSectors: [],
		quoteSuccessCount: 5,
		quoteFailures: [],
	};

	const result = buildContextEnrichments(inputs);

	expect(result).toContain("hold SHEL");
	expect(result).toContain("last assessment");
});

test("includes sector breakdown from positions", () => {
	const inputs: EnrichmentInputs = {
		dayPlan: null,
		lastAgentResponse: null,
		positionsWithSectors: [
			{ symbol: "SHEL", marketValue: 5000, sector: "Energy" },
			{ symbol: "AZN", marketValue: 3000, sector: "Healthcare" },
			{ symbol: "BP", marketValue: 2000, sector: "Energy" },
		],
		quoteSuccessCount: 3,
		quoteFailures: [],
	};

	const result = buildContextEnrichments(inputs);

	expect(result).toContain("Energy");
	expect(result).toContain("Healthcare");
});

test("includes failed quote symbols", () => {
	const inputs: EnrichmentInputs = {
		dayPlan: null,
		lastAgentResponse: null,
		positionsWithSectors: [],
		quoteSuccessCount: 4,
		quoteFailures: ["GSK", "RIO"],
	};

	const result = buildContextEnrichments(inputs);

	expect(result).toContain("GSK");
	expect(result).toContain("RIO");
	expect(result).toContain("failed");
});

test("returns empty string when nothing to enrich", () => {
	const inputs: EnrichmentInputs = {
		dayPlan: null,
		lastAgentResponse: null,
		positionsWithSectors: [],
		quoteSuccessCount: 5,
		quoteFailures: [],
	};

	const result = buildContextEnrichments(inputs);

	expect(result).toBe("");
});
