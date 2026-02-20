DELETE FROM `exclusions` WHERE `id` NOT IN (
  SELECT MIN(`id`) FROM `exclusions` GROUP BY `type`, `value`
);--> statement-breakpoint
CREATE UNIQUE INDEX `exclusions_type_value_unique` ON `exclusions` (`type`,`value`);
