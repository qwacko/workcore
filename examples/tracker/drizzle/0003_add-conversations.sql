CREATE TABLE `tracker_conversation_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`role` text NOT NULL,
	`text` text NOT NULL,
	`status` text NOT NULL,
	`run_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `tracker_conversations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `tracker_conversation_messages_order_idx` ON `tracker_conversation_messages` (`conversation_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `tracker_conversations` (
	`id` text PRIMARY KEY NOT NULL,
	`application_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`actor_id` text NOT NULL,
	`title` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`actor_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `tracker_conversations_scope_actor_idx` ON `tracker_conversations` (`application_id`,`workspace_id`,`actor_id`,`updated_at`);