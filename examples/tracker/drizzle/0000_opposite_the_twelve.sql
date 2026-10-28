CREATE TABLE `files` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`filename` text NOT NULL,
	`content_type` text NOT NULL,
	`size` integer NOT NULL,
	`status` text NOT NULL,
	`created_at` integer NOT NULL,
	`uploaded_at` integer
);
--> statement-breakpoint
CREATE INDEX `files_owner_id` ON `files` (`owner_id`);--> statement-breakpoint
CREATE INDEX `files_status` ON `files` (`status`);--> statement-breakpoint
CREATE TABLE `members` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`role` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `messages_owner_at` ON `messages` (`owner_id`,`at`,`id`);--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`title` text NOT NULL,
	`project_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`private` integer DEFAULT false NOT NULL,
	`done` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE INDEX `tasks_project` ON `tasks` (`project_id`,`id`);--> statement-breakpoint
CREATE INDEX `tasks_owner` ON `tasks` (`owner_id`,`id`);--> statement-breakpoint
CREATE TABLE `wc_history` (
	`id` text PRIMARY KEY NOT NULL,
	`data` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `wc_kv` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `wc_meta` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `wc_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`fingerprint` text NOT NULL,
	`response` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `wc_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`due` integer NOT NULL,
	`data` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `wc_runs_due` ON `wc_runs` (`status`,`due`);--> statement-breakpoint
CREATE TABLE `wc_schedules` (
	`id` text PRIMARY KEY NOT NULL,
	`enabled` integer NOT NULL,
	`at` integer NOT NULL,
	`data` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `wc_schedules_due` ON `wc_schedules` (`enabled`,`at`);--> statement-breakpoint
CREATE TABLE `wc_steps` (
	`run_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`data` text NOT NULL,
	PRIMARY KEY(`run_id`, `sequence`)
);
