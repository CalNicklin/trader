import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { startAdminServer, stopAdminServer } from "./admin/server.ts";
import { getAccountSummary, getPositions } from "./broker/account.ts";
import { connect, disconnect } from "./broker/connection.ts";
import { startGuardian, stopGuardian } from "./broker/guardian.ts";
import { getConfig } from "./config.ts";
import { closeDb, getDb } from "./db/client.ts";
import { seedDatabase } from "./db/seed.ts";
import { startScheduler, stopScheduler } from "./scheduler/cron.ts";
import { sendCriticalAlert } from "./utils/alert.ts";
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

	// Start the scheduler, guardian, and admin server
	startScheduler();
	startGuardian();
	startAdminServer();
	log.info("Scheduler and guardian started - agent is running");
}

// Graceful shutdown
async function shutdown(signal: string) {
	log.info({ signal }, "Shutting down...");
	stopAdminServer();
	stopGuardian();
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
	sendCriticalAlert("Uncaught exception", String(error?.stack ?? error)).finally(() =>
		shutdown("uncaughtException"),
	);
});

const rejectionTimestamps: number[] = [];
const REJECTION_WINDOW_MS = 60_000;
const REJECTION_THRESHOLD = 10;

process.on("unhandledRejection", (reason) => {
	log.error({ reason }, "Unhandled rejection");

	const now = Date.now();
	rejectionTimestamps.push(now);
	// Remove entries older than the window
	while (rejectionTimestamps.length > 0 && rejectionTimestamps[0]! <= now - REJECTION_WINDOW_MS) {
		rejectionTimestamps.shift();
	}

	if (rejectionTimestamps.length >= REJECTION_THRESHOLD) {
		log.fatal(
			{ count: rejectionTimestamps.length, windowMs: REJECTION_WINDOW_MS },
			"Too many unhandled rejections - exiting",
		);
		sendCriticalAlert(
			"Trader crash: rejection storm",
			`${rejectionTimestamps.length} unhandled rejections in ${REJECTION_WINDOW_MS / 1000}s. Last: ${String(reason)}`,
		).finally(() => process.exit(1));
	}
});

boot().catch(async (error) => {
	log.fatal({ error }, "Boot failed");
	await sendCriticalAlert("Boot failed", String(error?.stack ?? error));
	process.exit(1);
});
