import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { getConfig } from "../config.ts";
import * as schema from "./schema.ts";

let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;
let _sqlite: Database | null = null;

export function getDb() {
	if (!_db) {
		const config = getConfig();
		// Ensure data directory exists
		const dir = config.DB_PATH.substring(0, config.DB_PATH.lastIndexOf("/"));
		if (dir) {
			const fs = require("node:fs");
			fs.mkdirSync(dir, { recursive: true });
		}
		_sqlite = new Database(config.DB_PATH);
		_sqlite.exec("PRAGMA journal_mode = WAL;");
		_sqlite.exec("PRAGMA foreign_keys = ON;");
		_db = drizzle(_sqlite, { schema });
	}
	return _db;
}

export function closeDb() {
	if (_sqlite) {
		_sqlite.close();
		_sqlite = null;
		_db = null;
	}
}

export type DbClient = ReturnType<typeof getDb>;
