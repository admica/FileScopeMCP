CREATE TABLE `symbol_dependencies` (
  `id`                integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `caller_symbol_id`  integer NOT NULL,
  `callee_symbol_id`  integer NOT NULL,
  `call_line`         integer NOT NULL,
  `confidence`        real NOT NULL
);--> statement-breakpoint
CREATE INDEX `symbol_deps_caller_idx` ON `symbol_dependencies` (`caller_symbol_id`);--> statement-breakpoint
CREATE INDEX `symbol_deps_callee_idx` ON `symbol_dependencies` (`callee_symbol_id`);
