import { expect, test } from "bun:test";

process.env.ANTHROPIC_API_KEY = "test-key";
process.env.RESEND_API_KEY = "test-key";
process.env.ALERT_EMAIL_TO = "test@example.com";

test("lseStock uses SMART routing with LSE as primary exchange", async () => {
	const { lseStock } = await import("../src/broker/contracts.ts");
	const contract = lseStock("SHEL");

	expect(contract.symbol).toBe("SHEL");
	expect(contract.exchange).toBe("SMART");
	expect(contract.primaryExch).toBe("LSE");
	expect(contract.currency).toBe("GBP");
});
