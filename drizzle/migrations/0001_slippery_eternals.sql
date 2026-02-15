CREATE TABLE `token_usage` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`job` text NOT NULL,
	`input_tokens` integer NOT NULL,
	`output_tokens` integer NOT NULL,
	`estimated_cost_usd` real NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `trade_reviews` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`trade_id` integer NOT NULL,
	`symbol` text NOT NULL,
	`side` text NOT NULL,
	`pnl` real,
	`confidence` real,
	`outcome` text NOT NULL,
	`reasoning_quality` text NOT NULL,
	`lesson_learned` text NOT NULL,
	`tags` text NOT NULL,
	`should_repeat` integer NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `weekly_insights` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`week_start` text NOT NULL,
	`run_type` text NOT NULL,
	`category` text NOT NULL,
	`insight` text NOT NULL,
	`actionable` text NOT NULL,
	`severity` text NOT NULL,
	`data` text,
	`created_at` text NOT NULL
);
