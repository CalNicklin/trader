CREATE TABLE `escalation_state` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`fingerprint` text NOT NULL,
	`conclusion` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `token_usage` ADD `cache_creation_tokens` integer;--> statement-breakpoint
ALTER TABLE `token_usage` ADD `cache_read_tokens` integer;--> statement-breakpoint
ALTER TABLE `token_usage` ADD `status` text;