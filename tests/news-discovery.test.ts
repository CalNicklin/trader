import { describe, expect, test } from "bun:test";

process.env.ANTHROPIC_API_KEY = "test-key";
process.env.RESEND_API_KEY = "test-key";
process.env.ALERT_EMAIL_TO = "test@example.com";

describe("parseNewsDiscovery", () => {
	test("extracts symbols with exchange from LLM JSON response", async () => {
		const { parseNewsDiscovery } = await import("../src/research/pipeline.ts");

		const llmOutput = JSON.stringify([
			{ symbol: "AAPL", name: "Apple Inc", exchange: "NASDAQ" },
			{ symbol: "SHEL.L", name: "Shell", exchange: "LSE" },
			{ symbol: "IBM", name: "IBM Corp", exchange: "NYSE" },
		]);

		const result = parseNewsDiscovery(`Some text before [${llmOutput.slice(1)}`);

		expect(result).toHaveLength(3);
		expect(result[0]).toEqual({ symbol: "AAPL", name: "Apple Inc", exchange: "NASDAQ" });
		expect(result[1]).toEqual({ symbol: "SHEL", name: "Shell", exchange: "LSE" });
		expect(result[2]).toEqual({ symbol: "IBM", name: "IBM Corp", exchange: "NYSE" });
	});

	test("strips .L suffix from LSE symbols", async () => {
		const { parseNewsDiscovery } = await import("../src/research/pipeline.ts");

		const result = parseNewsDiscovery(
			JSON.stringify([{ symbol: "AZN.L", name: "AstraZeneca", exchange: "LSE" }]),
		);

		expect(result[0]!.symbol).toBe("AZN");
	});

	test("defaults to LSE when exchange is missing from LLM output", async () => {
		const { parseNewsDiscovery } = await import("../src/research/pipeline.ts");

		const result = parseNewsDiscovery(JSON.stringify([{ symbol: "BARC", name: "Barclays" }]));

		expect(result[0]!.exchange).toBe("LSE");
	});

	test("returns empty array when no JSON found", async () => {
		const { parseNewsDiscovery } = await import("../src/research/pipeline.ts");

		expect(parseNewsDiscovery("no json here")).toEqual([]);
	});

	test("uppercases symbols", async () => {
		const { parseNewsDiscovery } = await import("../src/research/pipeline.ts");

		const result = parseNewsDiscovery(
			JSON.stringify([{ symbol: "aapl", name: "Apple", exchange: "NASDAQ" }]),
		);

		expect(result[0]!.symbol).toBe("AAPL");
	});
});
