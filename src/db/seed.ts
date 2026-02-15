import { createChildLogger } from "../utils/logger.ts";
import { closeDb, getDb } from "./client.ts";
import { exclusions, riskConfig } from "./schema.ts";

const log = createChildLogger({ module: "seed" });

export async function seedDatabase() {
	const db = getDb();

	// Seed exclusions - sectors and SIC codes for weapons/firearms/illegal
	const exclusionData = [
		{ type: "SIC_CODE" as const, value: "3484", reason: "Small arms manufacturing" },
		{ type: "SIC_CODE" as const, value: "3489", reason: "Ordnance and accessories" },
		{ type: "SIC_CODE" as const, value: "3761", reason: "Guided missiles and space vehicles" },
		{ type: "SIC_CODE" as const, value: "3764", reason: "Guided missile propulsion units" },
		{ type: "SIC_CODE" as const, value: "3769", reason: "Guided missile and space vehicle parts" },
		{ type: "SECTOR" as const, value: "Tobacco", reason: "Tobacco products" },
		{ type: "SECTOR" as const, value: "Gambling", reason: "Gambling operations" },
		{ type: "SECTOR" as const, value: "Weapons", reason: "Weapons manufacturing" },
		{ type: "SECTOR" as const, value: "Defense", reason: "Defense/military manufacturing" },
		{ type: "SYMBOL" as const, value: "BAT", reason: "British American Tobacco" },
		{ type: "SYMBOL" as const, value: "IMB", reason: "Imperial Brands (tobacco)" },
		{ type: "SYMBOL" as const, value: "BAE", reason: "BAE Systems (defense)" },
	];

	for (const item of exclusionData) {
		await db.insert(exclusions).values(item).onConflictDoNothing();
	}
	log.info({ count: exclusionData.length }, "Seeded exclusions");

	// Seed default risk config
	const riskConfigData = [
		{ key: "max_position_pct", value: 5, description: "Max single position as % of portfolio" },
		{ key: "max_position_gbp", value: 500, description: "Hard cap on single position in GBP" },
		{
			key: "min_cash_reserve_pct",
			value: 20,
			description: "Minimum cash reserve as % of portfolio",
		},
		{ key: "per_trade_stop_loss_pct", value: 3, description: "Per-trade stop loss %" },
		{ key: "daily_loss_limit_pct", value: 2, description: "Daily loss limit as % of portfolio" },
		{ key: "weekly_loss_limit_pct", value: 5, description: "Weekly loss limit as % of portfolio" },
		{ key: "max_positions", value: 10, description: "Maximum number of open positions" },
		{ key: "max_trades_per_day", value: 10, description: "Maximum trades per day" },
		{ key: "min_trade_interval_min", value: 15, description: "Minimum minutes between trades" },
		{ key: "max_sector_exposure_pct", value: 30, description: "Maximum sector exposure %" },
		{
			key: "min_price_gbp",
			value: 0.1,
			description: "Minimum stock price (GBP) - no penny stocks",
		},
		{ key: "min_avg_volume", value: 50000, description: "Minimum average daily volume" },
	];

	for (const item of riskConfigData) {
		await db.insert(riskConfig).values(item).onConflictDoNothing();
	}
	log.info({ count: riskConfigData.length }, "Seeded risk config");
}

// Run directly if called as script
if (import.meta.main) {
	try {
		await seedDatabase();
		log.info("Seed completed");
	} catch (error) {
		log.error({ error }, "Seed failed");
		process.exit(1);
	} finally {
		closeDb();
	}
}
