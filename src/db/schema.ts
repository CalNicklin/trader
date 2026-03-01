import { integer, real, sqliteTable, text, unique, uniqueIndex } from "drizzle-orm/sqlite-core";

export const trades = sqliteTable("trades", {
	id: integer("id").primaryKey({ autoIncrement: true }),
	symbol: text("symbol").notNull(),
	exchange: text("exchange").notNull().default("LSE"),
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

export const positions = sqliteTable(
	"positions",
	{
		id: integer("id").primaryKey({ autoIncrement: true }),
		symbol: text("symbol").notNull(),
		exchange: text("exchange").notNull().default("LSE"),
		currency: text("currency").notNull().default("GBP"),
		quantity: integer("quantity").notNull(),
		avgCost: real("avg_cost").notNull(),
		currentPrice: real("current_price"),
		unrealizedPnl: real("unrealized_pnl"),
		marketValue: real("market_value"),
		stopLossPrice: real("stop_loss_price"),
		targetPrice: real("target_price"),
		highWaterMark: real("high_water_mark"),
		trailingStopPrice: real("trailing_stop_price"),
		updatedAt: text("updated_at")
			.notNull()
			.$defaultFn(() => new Date().toISOString()),
	},
	(table) => ({
		symbolExchangeUnique: unique("positions_symbol_exchange_unique").on(
			table.symbol,
			table.exchange,
		),
	}),
);

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

export const watchlist = sqliteTable(
	"watchlist",
	{
		id: integer("id").primaryKey({ autoIncrement: true }),
		symbol: text("symbol").notNull(),
		exchange: text("exchange").notNull().default("LSE"),
		name: text("name"),
		sector: text("sector"),
		score: real("score").default(0),
		lastResearchedAt: text("last_researched_at"),
		addedAt: text("added_at")
			.notNull()
			.$defaultFn(() => new Date().toISOString()),
		active: integer("active", { mode: "boolean" }).notNull().default(true),
		high52w: real("high_52w"),
		low52w: real("low_52w"),
	},
	(table) => ({
		symbolExchangeUnique: unique("watchlist_symbol_exchange_unique").on(
			table.symbol,
			table.exchange,
		),
	}),
);

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

export const exclusions = sqliteTable(
	"exclusions",
	{
		id: integer("id").primaryKey({ autoIncrement: true }),
		type: text("type", { enum: ["SYMBOL", "SECTOR", "SIC_CODE"] }).notNull(),
		value: text("value").notNull(),
		reason: text("reason").notNull(),
		createdAt: text("created_at")
			.notNull()
			.$defaultFn(() => new Date().toISOString()),
	},
	(table) => ({
		typeValueIdx: uniqueIndex("exclusions_type_value_unique").on(table.type, table.value),
	}),
);

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

export const tradeReviews = sqliteTable("trade_reviews", {
	id: integer("id").primaryKey({ autoIncrement: true }),
	tradeId: integer("trade_id").notNull(),
	symbol: text("symbol").notNull(),
	side: text("side", { enum: ["BUY", "SELL"] }).notNull(),
	pnl: real("pnl"),
	confidence: real("confidence"),
	outcome: text("outcome", { enum: ["win", "loss", "breakeven"] }).notNull(),
	reasoningQuality: text("reasoning_quality", {
		enum: ["sound", "partial", "flawed"],
	}).notNull(),
	lessonLearned: text("lesson_learned").notNull(),
	tags: text("tags").notNull(), // JSON array string
	shouldRepeat: integer("should_repeat", { mode: "boolean" }).notNull(),
	createdAt: text("created_at")
		.notNull()
		.$defaultFn(() => new Date().toISOString()),
});

export const weeklyInsights = sqliteTable("weekly_insights", {
	id: integer("id").primaryKey({ autoIncrement: true }),
	weekStart: text("week_start").notNull(),
	runType: text("run_type", { enum: ["mid_week", "end_of_week"] }).notNull(),
	category: text("category", {
		enum: [
			"confidence_calibration",
			"sector_performance",
			"timing",
			"risk_management",
			"momentum_compliance",
			"holding_asymmetry",
			"general",
		],
	}).notNull(),
	insight: text("insight").notNull(),
	actionable: text("actionable").notNull(),
	severity: text("severity", { enum: ["info", "warning", "critical"] }).notNull(),
	data: text("data"), // JSON string with supporting numbers
	createdAt: text("created_at")
		.notNull()
		.$defaultFn(() => new Date().toISOString()),
});

export const tokenUsage = sqliteTable("token_usage", {
	id: integer("id").primaryKey({ autoIncrement: true }),
	job: text("job").notNull(),
	inputTokens: integer("input_tokens").notNull(),
	outputTokens: integer("output_tokens").notNull(),
	cacheCreationTokens: integer("cache_creation_tokens"),
	cacheReadTokens: integer("cache_read_tokens"),
	estimatedCostUsd: real("estimated_cost_usd").notNull(),
	status: text("status"),
	createdAt: text("created_at")
		.notNull()
		.$defaultFn(() => new Date().toISOString()),
});

export const decisionScores = sqliteTable("decision_scores", {
	id: integer("id").primaryKey({ autoIncrement: true }),
	symbol: text("symbol").notNull(),
	decisionTime: text("decision_time").notNull(),
	statedAction: text("stated_action").notNull(),
	reason: text("reason"),
	priceAtDecision: real("price_at_decision").notNull(),
	priceNow: real("price_now").notNull(),
	changePct: real("change_pct").notNull(),
	score: text("score", {
		enum: ["good_hold", "good_pass", "good_avoid", "missed_opportunity", "unclear"],
	}).notNull(),
	genuineMiss: integer("genuine_miss", { mode: "boolean" }),
	lesson: text("lesson"),
	tags: text("tags"),
	signalState: text("signal_state"),
	gateResult: text("gate_result"),
	aiOverrideReason: text("ai_override_reason"),
	createdAt: text("created_at")
		.notNull()
		.$defaultFn(() => new Date().toISOString()),
});

export const strategyHypotheses = sqliteTable("strategy_hypotheses", {
	id: integer("id").primaryKey({ autoIncrement: true }),
	hypothesis: text("hypothesis").notNull(),
	evidence: text("evidence").notNull(),
	actionable: text("actionable").notNull(),
	targetType: text("target_type", {
		enum: ["gate_param", "prompt", "risk_config"],
	})
		.notNull()
		.default("prompt"),
	targetParam: text("target_param"),
	category: text("category", {
		enum: ["sector", "timing", "momentum", "value", "risk", "sizing", "general"],
	}).notNull(),
	status: text("status", {
		enum: ["proposed", "active", "confirmed", "rejected"],
	})
		.notNull()
		.default("proposed"),
	supportingTrades: integer("supporting_trades").notNull().default(0),
	winRate: real("win_rate"),
	championWinRate: real("champion_win_rate"),
	expectancy: real("expectancy"),
	championExpectancy: real("champion_expectancy"),
	maxDrawdown: real("max_drawdown"),
	championMaxDrawdown: real("champion_max_drawdown"),
	sampleSize: integer("sample_size").notNull().default(0),
	proposedAt: text("proposed_at")
		.notNull()
		.$defaultFn(() => new Date().toISOString()),
	lastEvaluatedAt: text("last_evaluated_at"),
	statusChangedAt: text("status_changed_at"),
	rejectionReason: text("rejection_reason"),
});

export const improvementProposals = sqliteTable("improvement_proposals", {
	id: integer("id").primaryKey({ autoIncrement: true }),
	title: text("title").notNull(),
	description: text("description").notNull(),
	filesChanged: text("files_changed"),
	prUrl: text("pr_url"),
	prNumber: integer("pr_number"),
	status: text("status", {
		enum: ["PROPOSED", "PR_CREATED", "ISSUE_CREATED", "MERGED", "REJECTED"],
	})
		.notNull()
		.default("PROPOSED"),
	createdAt: text("created_at")
		.notNull()
		.$defaultFn(() => new Date().toISOString()),
});

export const escalationState = sqliteTable("escalation_state", {
	id: integer("id").primaryKey({ autoIncrement: true }),
	fingerprint: text("fingerprint").notNull(),
	conclusion: text("conclusion").notNull(),
	createdAt: text("created_at")
		.notNull()
		.$defaultFn(() => new Date().toISOString()),
});
