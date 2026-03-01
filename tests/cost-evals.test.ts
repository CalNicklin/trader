process.env.ANTHROPIC_API_KEY = "test-key";
process.env.RESEND_API_KEY = "test-key";
process.env.ALERT_EMAIL_TO = "test@test.com";

import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";

import * as schema from "../src/db/schema.ts";
import {
	evalBudgetHeadroom,
	evalMaterialChangeSensitivity,
	evalPhantomRecurrence,
	evalTrackingAccuracy,
	evalWasteReduction,
} from "../src/evals/cost-evals.ts";

function createTestDb() {
	const sqlite = new Database(":memory:");
	const db = drizzle(sqlite, { schema });
	migrate(db, { migrationsFolder: "drizzle/migrations" });
	return db;
}

const TODAY = new Date().toISOString().split("T")[0]!;

describe("evalWasteReduction", () => {
	test("passes when no duplicate fingerprints exist within 30 min", async () => {
		const db = createTestDb();

		await db.insert(schema.escalationState).values([
			{ fingerprint: "fp_a", conclusion: "hold", createdAt: `${TODAY}T09:00:00.000Z` },
			{ fingerprint: "fp_b", conclusion: "hold", createdAt: `${TODAY}T09:30:00.000Z` },
			{ fingerprint: "fp_c", conclusion: "acted", createdAt: `${TODAY}T10:00:00.000Z` },
		]);

		const result = await evalWasteReduction(db, TODAY);
		expect(result.passed).toBe(true);
		expect(result.duplicateCount).toBe(0);
	});

	test("fails when same fingerprint appears within 30 min", async () => {
		const db = createTestDb();

		await db.insert(schema.escalationState).values([
			{ fingerprint: "fp_same", conclusion: "hold", createdAt: `${TODAY}T09:00:00.000Z` },
			{ fingerprint: "fp_same", conclusion: "hold", createdAt: `${TODAY}T09:15:00.000Z` },
		]);

		const result = await evalWasteReduction(db, TODAY);
		expect(result.passed).toBe(false);
		expect(result.duplicateCount).toBe(1);
	});

	test("allows same fingerprint if more than 30 min apart", async () => {
		const db = createTestDb();

		await db.insert(schema.escalationState).values([
			{ fingerprint: "fp_same", conclusion: "hold", createdAt: `${TODAY}T09:00:00.000Z` },
			{ fingerprint: "fp_same", conclusion: "hold", createdAt: `${TODAY}T09:45:00.000Z` },
		]);

		const result = await evalWasteReduction(db, TODAY);
		expect(result.passed).toBe(true);
		expect(result.duplicateCount).toBe(0);
	});
});

describe("evalBudgetHeadroom", () => {
	test("passes when 2-6 Sonnet sessions ran on a non-budget-capped day", async () => {
		const db = createTestDb();

		for (let i = 0; i < 4; i++) {
			await db.insert(schema.tokenUsage).values({
				job: "trading_analyst",
				inputTokens: 10000,
				outputTokens: 5000,
				estimatedCostUsd: 0.5,
				status: "complete",
				createdAt: `${TODAY}T${String(9 + i).padStart(2, "0")}:00:00.000Z`,
			});
		}

		const result = await evalBudgetHeadroom(db, TODAY);
		expect(result.passed).toBe(true);
		expect(result.sessionCount).toBe(4);
	});

	test("fails when too many Sonnet sessions ran (gates not working)", async () => {
		const db = createTestDb();

		for (let i = 0; i < 12; i++) {
			await db.insert(schema.tokenUsage).values({
				job: "trading_analyst",
				inputTokens: 10000,
				outputTokens: 5000,
				estimatedCostUsd: 0.2,
				status: "complete",
				createdAt: `${TODAY}T${String(9 + i).padStart(2, "0")}:00:00.000Z`,
			});
		}

		const result = await evalBudgetHeadroom(db, TODAY);
		expect(result.passed).toBe(false);
		expect(result.sessionCount).toBe(12);
	});

	test("passes with 0 sessions (quiet day is valid)", async () => {
		const db = createTestDb();
		const result = await evalBudgetHeadroom(db, TODAY);
		expect(result.passed).toBe(true);
		expect(result.sessionCount).toBe(0);
	});

	test("skips eval when budget cap was hit (not meaningful to grade)", async () => {
		const db = createTestDb();

		await db.insert(schema.agentLogs).values({
			level: "INFO",
			phase: "trading",
			message: "Skip [budget_exceeded]: Daily API budget would be exceeded",
			data: JSON.stringify({ type: "escalation_skip", reason: "budget_exceeded" }),
			createdAt: `${TODAY}T10:00:00.000Z`,
		});

		const result = await evalBudgetHeadroom(db, TODAY);
		expect(result.passed).toBe(true);
		expect(result.skipped).toBe(true);
	});
});

describe("evalMaterialChangeSensitivity", () => {
	test("passes when a cooldown override led to an acted conclusion", async () => {
		const db = createTestDb();

		await db.insert(schema.agentLogs).values({
			level: "INFO",
			phase: "trading",
			message: "Material change detected — overriding cooldown",
			createdAt: `${TODAY}T10:00:00.000Z`,
		});

		await db.insert(schema.escalationState).values({
			fingerprint: "fp_after_override",
			conclusion: "acted",
			createdAt: `${TODAY}T10:01:00.000Z`,
		});

		const result = await evalMaterialChangeSensitivity(db, TODAY);
		expect(result.passed).toBe(true);
		expect(result.overridesThatActed).toBeGreaterThan(0);
	});

	test("passes vacuously when no overrides occurred (no events to judge)", async () => {
		const db = createTestDb();
		const result = await evalMaterialChangeSensitivity(db, TODAY);
		expect(result.passed).toBe(true);
		expect(result.skipped).toBe(true);
	});
});

describe("evalPhantomRecurrence", () => {
	test("passes when no negative positions exist", async () => {
		const db = createTestDb();

		await db.insert(schema.positions).values({
			symbol: "SHEL",
			exchange: "LSE",
			currency: "GBP",
			quantity: 100,
			avgCost: 25.0,
		});

		const result = await evalPhantomRecurrence(db);
		expect(result.passed).toBe(true);
		expect(result.phantomCount).toBe(0);
	});

	test("fails when negative positions exist", async () => {
		const db = createTestDb();

		await db.insert(schema.positions).values({
			symbol: "DGE",
			exchange: "LSE",
			currency: "GBP",
			quantity: -2200,
			avgCost: 25.0,
		});

		const result = await evalPhantomRecurrence(db);
		expect(result.passed).toBe(false);
		expect(result.phantomCount).toBe(1);
	});
});

describe("evalTrackingAccuracy", () => {
	test("passes when tracked cost is within 1.3x of actual", async () => {
		const db = createTestDb();

		await db.insert(schema.tokenUsage).values({
			job: "trading_analyst",
			inputTokens: 50000,
			outputTokens: 10000,
			estimatedCostUsd: 2.0,
			createdAt: `${TODAY}T10:00:00.000Z`,
		});

		// Actual $2.40, tracked $2.00 → ratio 1.2x → passes
		const result = await evalTrackingAccuracy(db, TODAY, 2.4);
		expect(result.passed).toBe(true);
		expect(result.ratio).toBeCloseTo(1.2, 1);
	});

	test("fails when tracked cost is more than 1.3x below actual", async () => {
		const db = createTestDb();

		await db.insert(schema.tokenUsage).values({
			job: "trading_analyst",
			inputTokens: 50000,
			outputTokens: 10000,
			estimatedCostUsd: 1.0,
			createdAt: `${TODAY}T10:00:00.000Z`,
		});

		// Actual $2.50, tracked $1.00 → ratio 2.5x → fails
		const result = await evalTrackingAccuracy(db, TODAY, 2.5);
		expect(result.passed).toBe(false);
		expect(result.ratio).toBeCloseTo(2.5, 1);
	});

	test("passes with ratio of 1.0 (perfect tracking)", async () => {
		const db = createTestDb();

		await db.insert(schema.tokenUsage).values({
			job: "trading_analyst",
			inputTokens: 50000,
			outputTokens: 10000,
			estimatedCostUsd: 3.0,
			createdAt: `${TODAY}T10:00:00.000Z`,
		});

		const result = await evalTrackingAccuracy(db, TODAY, 3.0);
		expect(result.passed).toBe(true);
		expect(result.ratio).toBeCloseTo(1.0, 1);
	});
});
