CREATE TABLE `dev_project_tag_categories` (
	`id` int AUTO_INCREMENT NOT NULL,
	`projectId` int NOT NULL,
	`userId` int NOT NULL,
	`categoryKey` varchar(50) NOT NULL,
	`categoryName` varchar(100) NOT NULL,
	`description` text,
	`sortOrder` int NOT NULL DEFAULT 0,
	`confirmed` int NOT NULL DEFAULT 0,
	`confirmedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `dev_project_tag_categories_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `dev_project_tag_items` (
	`id` int AUTO_INCREMENT NOT NULL,
	`categoryId` int NOT NULL,
	`projectId` int NOT NULL,
	`tagName` varchar(255) NOT NULL,
	`tagValue` text,
	`source` enum('ai','manual') NOT NULL DEFAULT 'ai',
	`sortOrder` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `dev_project_tag_items_id` PRIMARY KEY(`id`)
);
