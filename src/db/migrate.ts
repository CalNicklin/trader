import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { createChildLogger } from "../utils/logger.ts";
import { closeDb, getDb } from "./client.ts";

const log = createChildLogger({ module: "migrate" });

try {
	const db = getDb();
	migrate(db, { migrationsFolder: "./drizzle/migrations" });
	log.info("Migrations completed successfully");
} catch (error) {
	log.error({ error }, "Migration failed");
	process.exit(1);
} finally {
	closeDb();
}
