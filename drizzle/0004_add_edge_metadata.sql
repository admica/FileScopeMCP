ALTER TABLE `file_dependencies` ADD COLUMN `edge_type` text NOT NULL DEFAULT 'imports';--> statement-breakpoint
ALTER TABLE `file_dependencies` ADD COLUMN `confidence` real NOT NULL DEFAULT 0.8;--> statement-breakpoint
ALTER TABLE `file_dependencies` ADD COLUMN `confidence_source` text NOT NULL DEFAULT 'inferred';--> statement-breakpoint
ALTER TABLE `file_dependencies` ADD COLUMN `weight` integer NOT NULL DEFAULT 1;--> statement-breakpoint
CREATE TABLE `file_communities` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `community_id` integer NOT NULL,
  `file_path` text NOT NULL,
  FOREIGN KEY (`file_path`) REFERENCES `files`(`path`) ON DELETE CASCADE
);--> statement-breakpoint
CREATE INDEX `communities_community_id_idx` ON `file_communities` (`community_id`);
