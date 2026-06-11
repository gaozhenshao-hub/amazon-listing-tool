CREATE TABLE `dev_panorama_status` (
	`id` int AUTO_INCREMENT NOT NULL,
	`projectId` int NOT NULL,
	`userId` int NOT NULL,
	`confirmed` int NOT NULL DEFAULT 0,
	`confirmedAt` timestamp,
	`lastMergedAt` timestamp,
	`totalProducts` int DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `dev_panorama_status_id` PRIMARY KEY(`id`)
);
