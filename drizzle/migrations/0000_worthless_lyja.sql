CREATE TABLE `agent_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`level` text NOT NULL,
	`phase` text,
	`message` text NOT NULL,
	`data` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `daily_snapshots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`date` text NOT NULL,
	`portfolio_value` real NOT NULL,
	`cash_balance` real NOT NULL,
	`positions_value` real NOT NULL,
	`daily_pnl` real NOT NULL,
	`daily_pnl_percent` real NOT NULL,
	`total_pnl` real NOT NULL,
	`trades_count` integer DEFAULT 0 NOT NULL,
	`wins_count` integer DEFAULT 0 NOT NULL,
	`losses_count` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `daily_snapshots_date_unique` ON `daily_snapshots` (`date`);--> statement-breakpoint
CREATE TABLE `exclusions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`type` text NOT NULL,
	`value` text NOT NULL,
	`reason` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `improvement_proposals` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`files_changed` text,
	`pr_url` text,
	`pr_number` integer,
	`status` text DEFAULT 'PROPOSED' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `positions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`symbol` text NOT NULL,
	`quantity` integer NOT NULL,
	`avg_cost` real NOT NULL,
	`current_price` real,
	`unrealized_pnl` real,
	`market_value` real,
	`stop_loss_price` real,
	`target_price` real,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `positions_symbol_unique` ON `positions` (`symbol`);--> statement-breakpoint
CREATE TABLE `research` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`symbol` text NOT NULL,
	`source` text NOT NULL,
	`raw_data` text,
	`sentiment` real,
	`bull_case` text,
	`bear_case` text,
	`suggested_action` text,
	`confidence` real,
	`analysis` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `risk_config` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`key` text NOT NULL,
	`value` real NOT NULL,
	`description` text,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `risk_config_key_unique` ON `risk_config` (`key`);--> statement-breakpoint
CREATE TABLE `trades` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`symbol` text NOT NULL,
	`side` text NOT NULL,
	`quantity` integer NOT NULL,
	`order_type` text NOT NULL,
	`limit_price` real,
	`fill_price` real,
	`commission` real,
	`status` text DEFAULT 'PENDING' NOT NULL,
	`ib_order_id` integer,
	`reasoning` text,
	`confidence` real,
	`pnl` real,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`filled_at` text
);
--> statement-breakpoint
CREATE TABLE `watchlist` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`symbol` text NOT NULL,
	`name` text,
	`sector` text,
	`score` real DEFAULT 0,
	`last_researched_at` text,
	`added_at` text NOT NULL,
	`active` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `watchlist_symbol_unique` ON `watchlist` (`symbol`);