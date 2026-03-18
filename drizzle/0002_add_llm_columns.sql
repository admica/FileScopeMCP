ALTER TABLE `files` ADD COLUMN `concepts` text;--> statement-breakpoint
ALTER TABLE `files` ADD COLUMN `change_impact` text;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `llm_runtime_state` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
