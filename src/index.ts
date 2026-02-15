import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { getAccountSummary, getPositions } from "./broker/account.ts";
import { connect, disconnect } from "./broker/connection.ts";
import { getConfig } from "./config.ts";
import { closeDb, getDb } from "./db/client.ts";
import { seedDatabase } from "./db/seed.ts";
import { startScheduler, stopScheduler } from "./scheduler/cron.ts";
import { getLogger } from "./utils/logger.ts";

const log = getLogger();

async function boot() {
	const config = getConfig();
	log.info({ env: config.NODE_ENV, paper: config.PAPER_TRADING }, "Trader agent starting");

	// Initialize database and run migrations
	const db = getDb();
	migrate(db, { migrationsFolder: "./drizzle/migrations" });
	log.info("Database connected and migrated");

	// Run seed (idempotent)
	await seedDatabase();

	// Connect to IBKR
	log.info({ host: config.IBKR_HOST, port: config.IBKR_PORT }, "Connecting to IBKR...");
	await connect();
	log.info("Connected to IBKR");

	// Fetch and log account data
	const summary = await getAccountSummary();
	log.info(
		{
			account: summary.accountId,
			netLiquidation: summary.netLiquidation,
			cash: summary.totalCashValue,
			positions: summary.grossPositionValue,
		},
		"Account summary",
	);

	const positions = await getPositions();
	if (positions.length > 0) {
		log.info({ positions }, "Current positions");
	} else {
		log.info("No open positions");
	}

	// Start the scheduler
	startScheduler();
	log.info("Scheduler started - agent is running");
}

// Graceful shutdown
async function shutdown(signal: string) {
	log.info({ signal }, "Shutting down...");
	stopScheduler();
	await disconnect();
	closeDb();
	log.info("Shutdown complete");
	process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

// Unhandled errors
process.on("uncaughtException", (error) => {
	log.fatal({ error }, "Uncaught exception");
	shutdown("uncaughtException");
});

process.on("unhandledRejection", (reason) => {
	log.fatal({ reason }, "Unhandled rejection");
});

boot().catch((error) => {
	log.fatal({ error }, "Boot failed");
	process.exit(1);
});
