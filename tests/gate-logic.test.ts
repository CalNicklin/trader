import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";

process.env.ANTHROPIC_API_KEY = "test-key";
process.env.RESEND_API_KEY = "test-key";
process.env.ALERT_EMAIL_TO = "test@test.com";

import type { EscalationSnapshot } from "../src/agent/escalation-state.ts";
import { evaluateGates, type GateInput, type GateVerdict } from "../src/agent/gate-evaluator.ts";
import * as schema from "../src/db/schema.ts";

function makeGateInput(overrides: Partial<GateInput> = {}): GateInput {
	return {
		lastEscalation: null,
		cooldownMin: 20,
		materialChangePct: 2,
		haikuEscalated: true,
		canAffordSonnet: true,
		fingerprint: "abc123",
		lastQuotes: new Map(),
		currentQuotes: new Map(),
		positionRows: [],
		...overrides,
	};
}

describe("evaluateGates", () => {
	describe("cooldown gate", () => {
		test("skips when last escalation was hold within cooldown and no material change", () => {
			const now = Date.now();
			const lastEscalation: EscalationSnapshot = {
				fingerprint: "old",
				timestamp: now - 5 * 60_000, // 5 min ago
				conclusion: "hold",
			};

			const result = evaluateGates(
				makeGateInput({
					lastEscalation,
					cooldownMin: 20,
				}),
			);

			expect(result.proceed).toBe(false);
			expect(result.skipReason).toBe("cooldown_active");
		});

		test("proceeds when cooldown has expired", () => {
			const now = Date.now();
			const lastEscalation: EscalationSnapshot = {
				fingerprint: "old",
				timestamp: now - 25 * 60_000, // 25 min ago, cooldown is 20
				conclusion: "hold",
			};

			const result = evaluateGates(
				makeGateInput({
					lastEscalation,
					cooldownMin: 20,
				}),
			);

			expect(result.proceed).toBe(true);
		});

		test("proceeds when last escalation was acted (not hold)", () => {
			const now = Date.now();
			const lastEscalation: EscalationSnapshot = {
				fingerprint: "old",
				timestamp: now - 5 * 60_000,
				conclusion: "acted",
			};

			const result = evaluateGates(
				makeGateInput({
					lastEscalation,
				}),
			);

			expect(result.proceed).toBe(true);
		});

		test("proceeds when no previous escalation exists", () => {
			const result = evaluateGates(
				makeGateInput({
					lastEscalation: null,
				}),
			);

			expect(result.proceed).toBe(true);
		});
	});

	describe("material-change override", () => {
		test("overrides cooldown when price moves beyond threshold", () => {
			const now = Date.now();
			const lastEscalation: EscalationSnapshot = {
				fingerprint: "old",
				timestamp: now - 5 * 60_000,
				conclusion: "hold",
			};

			const result = evaluateGates(
				makeGateInput({
					lastEscalation,
					cooldownMin: 20,
					materialChangePct: 2,
					positionRows: [{ symbol: "SHEL", quantity: 100 }],
					lastQuotes: new Map([["SHEL", 25.0]]),
					currentQuotes: new Map([["SHEL", 26.0]]), // 4% move
				}),
			);

			expect(result.proceed).toBe(true);
		});

		test("does not override cooldown when price move is below threshold", () => {
			const now = Date.now();
			const lastEscalation: EscalationSnapshot = {
				fingerprint: "old",
				timestamp: now - 5 * 60_000,
				conclusion: "hold",
			};

			const result = evaluateGates(
				makeGateInput({
					lastEscalation,
					cooldownMin: 20,
					materialChangePct: 2,
					positionRows: [{ symbol: "SHEL", quantity: 100 }],
					lastQuotes: new Map([["SHEL", 25.0]]),
					currentQuotes: new Map([["SHEL", 25.2]]), // 0.8% move
				}),
			);

			expect(result.proceed).toBe(false);
			expect(result.skipReason).toBe("cooldown_active");
		});
	});

	describe("haiku gate", () => {
		test("skips when haiku does not escalate", () => {
			const result = evaluateGates(
				makeGateInput({
					haikuEscalated: false,
				}),
			);

			expect(result.proceed).toBe(false);
			expect(result.skipReason).toBe("haiku_no_escalate");
		});
	});

	describe("budget gate", () => {
		test("skips when budget exceeded", () => {
			const result = evaluateGates(
				makeGateInput({
					canAffordSonnet: false,
				}),
			);

			expect(result.proceed).toBe(false);
			expect(result.skipReason).toBe("budget_exceeded");
		});
	});

	describe("state-hash gate", () => {
		test("skips when fingerprint matches last escalation", () => {
			const lastEscalation: EscalationSnapshot = {
				fingerprint: "same_hash",
				timestamp: Date.now() - 30 * 60_000, // outside cooldown
				conclusion: "hold",
			};

			const result = evaluateGates(
				makeGateInput({
					lastEscalation,
					fingerprint: "same_hash",
				}),
			);

			expect(result.proceed).toBe(false);
			expect(result.skipReason).toBe("state_unchanged");
		});

		test("proceeds when fingerprint differs from last escalation", () => {
			const lastEscalation: EscalationSnapshot = {
				fingerprint: "old_hash",
				timestamp: Date.now() - 30 * 60_000,
				conclusion: "hold",
			};

			const result = evaluateGates(
				makeGateInput({
					lastEscalation,
					fingerprint: "new_hash",
				}),
			);

			expect(result.proceed).toBe(true);
		});
	});

	describe("identical ticks suppressed", () => {
		test("5 identical ticks: first proceeds, subsequent 4 are blocked", () => {
			const fingerprint = "identical_state";
			const results: GateVerdict[] = [];

			// Tick 1: no prior escalation → proceeds
			results.push(
				evaluateGates(
					makeGateInput({
						lastEscalation: null,
						fingerprint,
					}),
				),
			);

			// Simulate: after tick 1 ran Sonnet and concluded "hold"
			const afterTick1: EscalationSnapshot = {
				fingerprint,
				timestamp: Date.now(),
				conclusion: "hold",
			};

			// Ticks 2-5: same fingerprint, within cooldown, hold conclusion
			for (let i = 0; i < 4; i++) {
				results.push(
					evaluateGates(
						makeGateInput({
							lastEscalation: afterTick1,
							fingerprint,
							cooldownMin: 20,
						}),
					),
				);
			}

			expect(results[0]!.proceed).toBe(true);
			expect(results[1]!.proceed).toBe(false);
			expect(results[2]!.proceed).toBe(false);
			expect(results[3]!.proceed).toBe(false);
			expect(results[4]!.proceed).toBe(false);

			const skipReasons = results.slice(1).map((r) => r.skipReason);
			for (const reason of skipReasons) {
				expect(reason === "cooldown_active" || reason === "state_unchanged").toBe(true);
			}
		});
	});

	describe("gate ordering", () => {
		test("cooldown is checked before haiku (haiku never runs during cooldown)", () => {
			const now = Date.now();
			const lastEscalation: EscalationSnapshot = {
				fingerprint: "old",
				timestamp: now - 5 * 60_000,
				conclusion: "hold",
			};

			const result = evaluateGates(
				makeGateInput({
					lastEscalation,
					cooldownMin: 20,
					haikuEscalated: true,
					canAffordSonnet: true,
					fingerprint: "new_hash",
				}),
			);

			// Even though haiku escalated and budget is fine and hash changed,
			// cooldown should block first
			expect(result.proceed).toBe(false);
			expect(result.skipReason).toBe("cooldown_active");
		});

		test("budget is checked after haiku but before hash", () => {
			const result = evaluateGates(
				makeGateInput({
					lastEscalation: null,
					haikuEscalated: true,
					canAffordSonnet: false,
					fingerprint: "new_hash",
				}),
			);

			expect(result.proceed).toBe(false);
			expect(result.skipReason).toBe("budget_exceeded");
		});
	});
});

describe("restart hydration", () => {
	function createTestDb() {
		const sqlite = new Database(":memory:");
		const db = drizzle(sqlite, { schema });
		migrate(db, { migrationsFolder: "drizzle/migrations" });
		return db;
	}

	test("escalation state survives simulated restart via DB round-trip", async () => {
		const db = createTestDb();
		const fingerprint = "restart_test_fp";
		const conclusion = "hold";

		await db.insert(schema.escalationState).values({ fingerprint, conclusion });

		// Simulate restart: read back from DB (what hydrateEscalationState does)
		const [row] = await db
			.select()
			.from(schema.escalationState)
			.orderBy(schema.escalationState.id)
			.limit(1);

		expect(row).toBeDefined();
		expect(row!.fingerprint).toBe(fingerprint);
		expect(row!.conclusion).toBe(conclusion);

		// Reconstruct snapshot as hydrateEscalationState would
		const snapshot: EscalationSnapshot = {
			fingerprint: row!.fingerprint,
			timestamp: new Date(row!.createdAt).getTime(),
			conclusion: row!.conclusion as EscalationSnapshot["conclusion"],
		};

		// Verify the hydrated state blocks identical ticks
		const result = evaluateGates(
			makeGateInput({
				lastEscalation: snapshot,
				fingerprint,
				cooldownMin: 20,
			}),
		);

		expect(result.proceed).toBe(false);
		expect(result.skipReason === "cooldown_active" || result.skipReason === "state_unchanged").toBe(
			true,
		);
	});

	test("hydrated state allows ticks with different fingerprint after cooldown", async () => {
		const db = createTestDb();

		// Insert an old escalation (30 min ago)
		const thirtyMinAgo = new Date(Date.now() - 30 * 60_000);
		await db
			.insert(schema.escalationState)
			.values({ fingerprint: "old_fp", conclusion: "hold", createdAt: thirtyMinAgo.toISOString() });

		const [row] = await db
			.select()
			.from(schema.escalationState)
			.orderBy(schema.escalationState.id)
			.limit(1);

		const snapshot: EscalationSnapshot = {
			fingerprint: row!.fingerprint,
			timestamp: new Date(row!.createdAt).getTime(),
			conclusion: row!.conclusion as EscalationSnapshot["conclusion"],
		};

		const result = evaluateGates(
			makeGateInput({
				lastEscalation: snapshot,
				fingerprint: "new_fp",
				cooldownMin: 20,
			}),
		);

		expect(result.proceed).toBe(true);
	});
});
