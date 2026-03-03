CREATE TABLE `file_dependencies` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source_path` text NOT NULL,
	`target_path` text NOT NULL,
	`dependency_type` text NOT NULL,
	`package_name` text,
	`package_version` text,
	`is_dev_dependency` integer
);
--> statement-breakpoint
CREATE INDEX `dep_source_idx` ON `file_dependencies` (`source_path`);--> statement-breakpoint
CREATE INDEX `dep_target_idx` ON `file_dependencies` (`target_path`);--> statement-breakpoint
CREATE TABLE `files` (
	`path` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`is_directory` integer DEFAULT false NOT NULL,
	`importance` integer DEFAULT 0,
	`summary` text,
	`mtime` integer,
	`summary_stale_since` integer,
	`concepts_stale_since` integer,
	`change_impact_stale_since` integer
);
--> statement-breakpoint
CREATE INDEX `files_is_directory_idx` ON `files` (`is_directory`);--> statement-breakpoint
CREATE TABLE `llm_jobs` (
	`job_id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`file_path` text NOT NULL,
	`job_type` text NOT NULL,
	`priority_tier` integer DEFAULT 2 NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer NOT NULL,
	`started_at` integer,
	`completed_at` integer,
	`error_message` text,
	`retry_count` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `jobs_status_priority_idx` ON `llm_jobs` (`status`,`priority_tier`);--> statement-breakpoint
CREATE INDEX `jobs_file_path_idx` ON `llm_jobs` (`file_path`);--> statement-breakpoint
CREATE TABLE `schema_version` (
	`version` integer PRIMARY KEY NOT NULL
);
