PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_saved_displays` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`title` text NOT NULL,
	`project_id` text DEFAULT '' NOT NULL,
	`document` text NOT NULL,
	`protocol_version` integer NOT NULL,
	`status` text NOT NULL,
	`group_name` text,
	`display_order` integer,
	`version` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_saved_displays`("id", "owner_id", "title", "project_id", "document", "protocol_version", "status", "group_name", "display_order", "version", "created_at", "updated_at") SELECT "id", "owner_id", "title", "project_id", "document", "protocol_version", "status", "group_name", "display_order", "version", "created_at", "updated_at" FROM `saved_displays`;--> statement-breakpoint
DROP TABLE `saved_displays`;--> statement-breakpoint
ALTER TABLE `__new_saved_displays` RENAME TO `saved_displays`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `saved_displays_owner_updated` ON `saved_displays` (`owner_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `saved_displays_status_updated` ON `saved_displays` (`status`,`updated_at`);