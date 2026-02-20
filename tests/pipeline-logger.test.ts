import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/bun-sqlite";
import type { DbClient } from "../src/db/client.ts";
import { agentLogs } from "../src/db/schema.ts";
import { logPipelineEvent } from "../src/research/pipeline-logger.ts";

function createTestDb(): DbClient {
	const sqlite = new Database(":memory:");
	sqlite.exec(`CREATE TABLE agent_logs (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		level TEXT NOT NULL,
		phase TEXT,
		message TEXT NOT NULL,
		data TEXT,
		created_at TEXT NOT NULL DEFAULT (datetime('now'))
	)`);
	return drizzle(sqlite) as unknown as DbClient;
}

describe("logPipelineEvent", () => {
	test("writes discovery results to agent_logs", async () => {
		const db = createTestDb();

		await logPipelineEvent(db, {
			phase: "discovery",
			message: "Stock discovery complete",
			data: { candidates: 12, added: 3 },
		});

		const rows = await db.select().from(agentLogs);
		expect(rows).toHaveLength(1);
		expect(rows[0]!.level).toBe("INFO");
		expect(rows[0]!.phase).toBe("discovery");
		expect(rows[0]!.message).toBe("Stock discovery complete");
		expect(JSON.parse(rows[0]!.data!)).toEqual({ candidates: 12, added: 3 });
	});

	test("writes error events with ERROR level", async () => {
		const db = createTestDb();

		await logPipelineEvent(db, {
			phase: "discovery",
			message: "FMP screener failed",
			level: "ERROR",
			data: { error: "HTTP 500" },
		});

		const rows = await db.select().from(agentLogs);
		expect(rows[0]!.level).toBe("ERROR");
	});
});
