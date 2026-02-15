import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const trades = sqliteTable("trades", {
	id: integer("id").primaryKey({ autoIncrement: true }),
	symbol: text("symbol").notNull(),
	side: text("side", { enum: ["BUY", "SELL"] }).notNull(),
	quantity: integer("quantity").notNull(),
	orderType: text("order_type", { enum: ["LIMIT", "MARKET"] }).notNull(),
	limitPrice: real("limit_price"),
	fillPrice: real("fill_price"),
	commission: real("commission"),
	status: text("status", {
		enum: ["PENDING", "SUBMITTED", "FILLED", "PARTIALLY_FILLED", "CANCELLED", "ERROR"],
	})
		.notNull()
		.default("PENDING"),
	ibOrderId: integer("ib_order_id"),
	reasoning: text("reasoning"),
	confidence: real("confidence"),
	pnl: real("pnl"),
	createdAt: text("created_at")
		.notNull()
		.$defaultFn(() => new Date().toISOString()),
	updatedAt: text("updated_at")
		.notNull()
		.$defaultFn(() => new Date().toISOString()),
	filledAt: text("filled_at"),
});

export const positions = sqliteTable("positions", {
	id: integer("id").primaryKey({ autoIncrement: true }),
	symbol: text("symbol").notNull().unique(),
	quantity: integer("quantity").notNull(),
	avgCost: real("avg_cost").notNull(),
	currentPrice: real("current_price"),
	unrealizedPnl: real("unrealized_pnl"),
	marketValue: real("market_value"),
	stopLossPrice: real("stop_loss_price"),
	targetPrice: real("target_price"),
	updatedAt: text("updated_at")
		.notNull()
		.$defaultFn(() => new Date().toISOString()),
});

export const research = sqliteTable("research", {
	id: integer("id").primaryKey({ autoIncrement: true }),
	symbol: text("symbol").notNull(),
	source: text("source").notNull(),
	rawData: text("raw_data"),
	sentiment: real("sentiment"),
	bullCase: text("bull_case"),
	bearCase: text("bear_case"),
	suggestedAction: text("suggested_action", { enum: ["BUY", "SELL", "HOLD", "WATCH"] }),
	confidence: real("confidence"),
	analysis: text("analysis"),
	createdAt: text("created_at")
		.notNull()
		.$defaultFn(() => new Date().toISOString()),
});

export const watchlist = sqliteTable("watchlist", {
	id: integer("id").primaryKey({ autoIncrement: true }),
	symbol: text("symbol").notNull().unique(),
	name: text("name"),
	sector: text("sector"),
	score: real("score").default(0),
	lastResearchedAt: text("last_researched_at"),
	addedAt: text("added_at")
		.notNull()
		.$defaultFn(() => new Date().toISOString()),
	active: integer("active", { mode: "boolean" }).notNull().default(true),
});

export const dailySnapshots = sqliteTable("daily_snapshots", {
	id: integer("id").primaryKey({ autoIncrement: true }),
	date: text("date").notNull().unique(),
	portfolioValue: real("portfolio_value").notNull(),
	cashBalance: real("cash_balance").notNull(),
	positionsValue: real("positions_value").notNull(),
	dailyPnl: real("daily_pnl").notNull(),
	dailyPnlPercent: real("daily_pnl_percent").notNull(),
	totalPnl: real("total_pnl").notNull(),
	tradesCount: integer("trades_count").notNull().default(0),
	winsCount: integer("wins_count").notNull().default(0),
	lossesCount: integer("losses_count").notNull().default(0),
	createdAt: text("created_at")
		.notNull()
		.$defaultFn(() => new Date().toISOString()),
});

export const riskConfig = sqliteTable("risk_config", {
	id: integer("id").primaryKey({ autoIncrement: true }),
	key: text("key").notNull().unique(),
	value: real("value").notNull(),
	description: text("description"),
	updatedAt: text("updated_at")
		.notNull()
		.$defaultFn(() => new Date().toISOString()),
});

export const exclusions = sqliteTable("exclusions", {
	id: integer("id").primaryKey({ autoIncrement: true }),
	type: text("type", { enum: ["SYMBOL", "SECTOR", "SIC_CODE"] }).notNull(),
	value: text("value").notNull(),
	reason: text("reason").notNull(),
	createdAt: text("created_at")
		.notNull()
		.$defaultFn(() => new Date().toISOString()),
});

export const agentLogs = sqliteTable("agent_logs", {
	id: integer("id").primaryKey({ autoIncrement: true }),
	level: text("level", { enum: ["INFO", "WARN", "ERROR", "DECISION", "ACTION"] }).notNull(),
	phase: text("phase"),
	message: text("message").notNull(),
	data: text("data"),
	createdAt: text("created_at")
		.notNull()
		.$defaultFn(() => new Date().toISOString()),
});

export const improvementProposals = sqliteTable("improvement_proposals", {
	id: integer("id").primaryKey({ autoIncrement: true }),
	title: text("title").notNull(),
	description: text("description").notNull(),
	filesChanged: text("files_changed"),
	prUrl: text("pr_url"),
	prNumber: integer("pr_number"),
	status: text("status", { enum: ["PROPOSED", "PR_CREATED", "MERGED", "REJECTED"] })
		.notNull()
		.default("PROPOSED"),
	createdAt: text("created_at")
		.notNull()
		.$defaultFn(() => new Date().toISOString()),
});
