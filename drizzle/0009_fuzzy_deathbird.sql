CREATE TABLE `sellingPointDrafts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`projectId` int NOT NULL,
	`userId` int NOT NULL,
	`sellingPointCores` text,
	`generatedBullets` text,
	`confirmedBullets` text,
	`emphasis` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `sellingPointDrafts_id` PRIMARY KEY(`id`)
);
