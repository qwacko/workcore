PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_activities` (
	`application_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`id` text NOT NULL,
	`title` text NOT NULL,
	`status` text NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`application_id`, `workspace_id`, `id`)
);
--> statement-breakpoint
INSERT INTO `__new_activities`("application_id", "workspace_id", "id", "title", "status", "updated_at") SELECT "application_id", "workspace_id", "id", "title", "status", "updated_at" FROM `activities`;--> statement-breakpoint
DROP TABLE `activities`;--> statement-breakpoint
ALTER TABLE `__new_activities` RENAME TO `activities`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE TABLE `__new_workcore_workspace_members` (
	`application_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	PRIMARY KEY(`application_id`, `workspace_id`, `user_id`),
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`application_id`,`workspace_id`) REFERENCES `workcore_workspaces`(`application_id`,`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_workcore_workspace_members`("application_id", "workspace_id", "user_id", "role") SELECT "application_id", "workspace_id", "user_id", "role" FROM `workcore_workspace_members`;--> statement-breakpoint
DROP TABLE `workcore_workspace_members`;--> statement-breakpoint
ALTER TABLE `__new_workcore_workspace_members` RENAME TO `workcore_workspace_members`;--> statement-breakpoint
CREATE TABLE `__new_workcore_workspaces` (
	`application_id` text NOT NULL,
	`id` text NOT NULL,
	`name` text NOT NULL,
	PRIMARY KEY(`application_id`, `id`)
);
--> statement-breakpoint
INSERT INTO `__new_workcore_workspaces`("application_id", "id", "name") SELECT "application_id", "id", "name" FROM `workcore_workspaces`;--> statement-breakpoint
DROP TABLE `workcore_workspaces`;--> statement-breakpoint
ALTER TABLE `__new_workcore_workspaces` RENAME TO `workcore_workspaces`;