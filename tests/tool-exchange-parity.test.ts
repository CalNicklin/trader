import { describe, expect, test } from "bun:test";

process.env.ANTHROPIC_API_KEY = "test-key";
process.env.RESEND_API_KEY = "test-key";
process.env.ALERT_EMAIL_TO = "test@example.com";

describe("tool schema exchange parity", () => {
	test("get_max_position_size schema includes exchange parameter", async () => {
		const { toolDefinitions } = await import("../src/agent/tools.ts");

		const tool = toolDefinitions.find((t) => t.name === "get_max_position_size");
		expect(tool).toBeDefined();

		const props = tool!.input_schema.properties as Record<string, unknown>;
		expect(props.exchange).toBeDefined();
	});

	test("get_max_position_size schema documents currency-aware sizing", async () => {
		const { toolDefinitions } = await import("../src/agent/tools.ts");

		const tool = toolDefinitions.find((t) => t.name === "get_max_position_size");
		const props = tool!.input_schema.properties as Record<string, { description?: string }>;

		expect(props.price!.description).not.toContain("GBP");
	});

	test("research_symbol schema includes exchange parameter", async () => {
		const { toolDefinitions } = await import("../src/agent/tools.ts");

		const tool = toolDefinitions.find((t) => t.name === "research_symbol");
		expect(tool).toBeDefined();

		const props = tool!.input_schema.properties as Record<string, unknown>;
		expect(props.exchange).toBeDefined();
	});
});
