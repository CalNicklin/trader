import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import type { DbClient } from "../src/db/client.ts";
import * as schema from "../src/db/schema.ts";
import { canAffordSonnet, getDailySpend, getEstimatedSessionCost } from "../src/utils/budget.ts";

process.env.ANTHROPIC_API_KEY = "test-key";
process.env.RESEND_API_KEY = "test-key";
process.env.ALERT_EMAIL_TO = "test@test.com";
process.env.DAILY_API_BUDGET_USD = "3"; // tests expect a finite budget

function createTestDb(): DbClient {
	const sqlite = new Database(":memory:");
	const db = drizzle(sqlite, { schema });
	migrate(db, { migrationsFolder: "drizzle/migrations" });
	return db;
}

describe("getDailySpend", () => {
	test("returns 0 when no usage rows exist", async () => {
		const db = createTestDb();
		const spend = await getDailySpend(db);
		expect(spend).toBe(0);
	});

	test("sums today's usage only", async () => {
		const db = createTestDb();
		const now = new Date();
		const yesterday = new Date(now);
		yesterday.setUTCDate(yesterday.getUTCDate() - 1);

		await db.insert(schema.tokenUsage).values([
			{
				job: "trading_analyst",
				inputTokens: 1000,
				outputTokens: 500,
				estimatedCostUsd: 1.5,
				createdAt: now.toISOString(),
			},
			{
				job: "trading_analyst",
				inputTokens: 2000,
				outputTokens: 1000,
				estimatedCostUsd: 0.8,
				createdAt: now.toISOString(),
			},
			{
				job: "trading_analyst",
				inputTokens: 5000,
				outputTokens: 2000,
				estimatedCostUsd: 5.0,
				createdAt: yesterday.toISOString(),
			},
		]);

		const spend = await getDailySpend(db);
		expect(spend).toBeCloseTo(2.3, 2);
	});
});

describe("getEstimatedSessionCost", () => {
	test("returns minimum floor when no completed sessions exist", async () => {
		const db = createTestDb();
		const cost = await getEstimatedSessionCost(db);
		expect(cost).toBe(0.2);
	});

	test("returns average of recent completed sessions with safety margin", async () => {
		const db = createTestDb();
		for (let i = 0; i < 5; i++) {
			await db.insert(schema.tokenUsage).values({
				job: "trading_analyst",
				inputTokens: 10000,
				outputTokens: 5000,
				estimatedCostUsd: 0.4,
				status: "complete",
			});
		}

		const cost = await getEstimatedSessionCost(db);
		expect(cost).toBeCloseTo(0.6, 2);
	});

	test("ignores non-complete sessions", async () => {
		const db = createTestDb();
		await db.insert(schema.tokenUsage).values([
			{
				job: "trading_analyst",
				inputTokens: 10000,
				outputTokens: 5000,
				estimatedCostUsd: 0.4,
				status: "complete",
			},
			{
				job: "trading_analyst",
				inputTokens: 10000,
				outputTokens: 5000,
				estimatedCostUsd: 2.0,
				status: "error",
			},
			{
				job: "trading_analyst",
				inputTokens: 10000,
				outputTokens: 5000,
				estimatedCostUsd: 1.5,
				status: "max_iterations",
			},
		]);

		const cost = await getEstimatedSessionCost(db);
		expect(cost).toBeCloseTo(0.6, 2);
	});
});

describe("canAffordSonnet", () => {
	test("returns true when daily spend is well under budget", async () => {
		const db = createTestDb();
		expect(await canAffordSonnet(db)).toBe(true);
	});

	test("returns false when daily spend plus estimated session exceeds budget", async () => {
		const db = createTestDb();
		await db.insert(schema.tokenUsage).values({
			job: "trading_analyst",
			inputTokens: 100000,
			outputTokens: 50000,
			estimatedCostUsd: 2.9,
		});

		// Default budget is $3, spend is $2.9, estimated session is $0.2 (floor)
		// 2.9 + 0.2 = 3.1 > 3.0
		expect(await canAffordSonnet(db)).toBe(false);
	});
});

describe("budget resets after midnight UTC", () => {
	test("yesterday's spend does not count toward today's budget", async () => {
		const db = createTestDb();
		const yesterday = new Date();
		yesterday.setUTCDate(yesterday.getUTCDate() - 1);
		yesterday.setUTCHours(23, 59, 0, 0);

		await db.insert(schema.tokenUsage).values({
			job: "trading_analyst",
			inputTokens: 100000,
			outputTokens: 50000,
			estimatedCostUsd: 50.0,
			createdAt: yesterday.toISOString(),
		});

		// $50 spent yesterday should not affect today's budget
		const spend = await getDailySpend(db);
		expect(spend).toBe(0);
		expect(await canAffordSonnet(db)).toBe(true);
	});
});
