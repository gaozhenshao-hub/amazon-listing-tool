ALTER TABLE `product_todos` ADD `reminder_days` varchar(100);--> statement-breakpoint
ALTER TABLE `product_todos` ADD `reminder_enabled` int DEFAULT 1;--> statement-breakpoint
ALTER TABLE `product_todos` ADD `last_reminder_sent_at` timestamp;--> statement-breakpoint
ALTER TABLE `team_tasks` ADD `reminder_days` varchar(100);--> statement-breakpoint
ALTER TABLE `team_tasks` ADD `reminder_enabled` int DEFAULT 1;--> statement-breakpoint
ALTER TABLE `team_tasks` ADD `last_reminder_sent_at` timestamp;