ALTER TABLE `file_dependencies` ADD COLUMN `imported_names` text;--> statement-breakpoint
ALTER TABLE `file_dependencies` ADD COLUMN `import_line` integer;--> statement-breakpoint
CREATE TABLE `symbols` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `path` text NOT NULL,
  `name` text NOT NULL,
  `kind` text NOT NULL,
  `start_line` integer NOT NULL,
  `end_line` integer NOT NULL,
  `is_export` integer NOT NULL DEFAULT false
);--> statement-breakpoint
CREATE INDEX `symbols_name_idx` ON `symbols` (`name`);--> statement-breakpoint
CREATE INDEX `symbols_path_idx` ON `symbols` (`path`);--> statement-breakpoint
CREATE TABLE `kv_state` (
  `key` text PRIMARY KEY NOT NULL,
  `value` text NOT NULL
);
