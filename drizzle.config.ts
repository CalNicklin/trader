import type { Config } from "drizzle-kit";

export default {
	schema: "./src/db/schema.ts",
	out: "./drizzle/migrations",
	dialect: "sqlite",
	dbCredentials: {
		url: process.env.DB_PATH ?? "./data/trader.db",
	},
} satisfies Config;
