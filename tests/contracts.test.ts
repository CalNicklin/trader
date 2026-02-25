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

test("usStock uses SMART routing with NASDAQ as primary exchange", async () => {
	const { usStock } = await import("../src/broker/contracts.ts");
	const contract = usStock("AAPL", "NASDAQ");

	expect(contract.symbol).toBe("AAPL");
	expect(contract.exchange).toBe("SMART");
	expect(contract.primaryExch).toBe("NASDAQ");
	expect(contract.currency).toBe("USD");
});

test("usStock uses SMART routing with NYSE as primary exchange", async () => {
	const { usStock } = await import("../src/broker/contracts.ts");
	const contract = usStock("IBM", "NYSE");

	expect(contract.symbol).toBe("IBM");
	expect(contract.exchange).toBe("SMART");
	expect(contract.primaryExch).toBe("NYSE");
	expect(contract.currency).toBe("USD");
});

test("getContract dispatches LSE to lseStock", async () => {
	const { getContract } = await import("../src/broker/contracts.ts");
	const contract = getContract("SHEL", "LSE");

	expect(contract.symbol).toBe("SHEL");
	expect(contract.primaryExch).toBe("LSE");
	expect(contract.currency).toBe("GBP");
});

test("getContract dispatches NASDAQ to usStock", async () => {
	const { getContract } = await import("../src/broker/contracts.ts");
	const contract = getContract("AAPL", "NASDAQ");

	expect(contract.symbol).toBe("AAPL");
	expect(contract.primaryExch).toBe("NASDAQ");
	expect(contract.currency).toBe("USD");
});

test("getContract dispatches NYSE to usStock", async () => {
	const { getContract } = await import("../src/broker/contracts.ts");
	const contract = getContract("MSFT", "NYSE");

	expect(contract.symbol).toBe("MSFT");
	expect(contract.primaryExch).toBe("NYSE");
	expect(contract.currency).toBe("USD");
});
