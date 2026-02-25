DROP INDEX `positions_symbol_unique`;--> statement-breakpoint
ALTER TABLE `positions` ADD `exchange` text DEFAULT 'LSE' NOT NULL;--> statement-breakpoint
ALTER TABLE `positions` ADD `currency` text DEFAULT 'GBP' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `positions_symbol_exchange_unique` ON `positions` (`symbol`,`exchange`);--> statement-breakpoint
DROP INDEX `watchlist_symbol_unique`;--> statement-breakpoint
ALTER TABLE `watchlist` ADD `exchange` text DEFAULT 'LSE' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `watchlist_symbol_exchange_unique` ON `watchlist` (`symbol`,`exchange`);--> statement-breakpoint
ALTER TABLE `trades` ADD `exchange` text DEFAULT 'LSE' NOT NULL;