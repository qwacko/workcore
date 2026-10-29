CREATE TABLE `saved_displays` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`title` text NOT NULL,
	`project_id` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `saved_displays_owner_created` ON `saved_displays` (`owner_id`,`created_at`,`id`);