ALTER TABLE `dev_bom_items` ADD `parentId` int;--> statement-breakpoint
ALTER TABLE `dev_bom_items` ADD `level` int DEFAULT 0;--> statement-breakpoint
ALTER TABLE `dev_bom_items` ADD `sortOrder` int DEFAULT 0;--> statement-breakpoint
ALTER TABLE `dev_time_plans` ADD `status` varchar(50) DEFAULT 'pending';--> statement-breakpoint
ALTER TABLE `dev_time_plans` ADD `color` varchar(20);--> statement-breakpoint
ALTER TABLE `dev_time_plans` ADD `dependsOn` int;--> statement-breakpoint
ALTER TABLE `dev_time_plans` ADD `sortOrder` int DEFAULT 0;