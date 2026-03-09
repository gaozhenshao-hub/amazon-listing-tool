CREATE TABLE `adStructures` (
	`id` int AUTO_INCREMENT NOT NULL,
	`projectId` int NOT NULL,
	`userId` int NOT NULL,
	`structureData` text,
	`structureDataCn` text,
	`keywordCount` int DEFAULT 0,
	`campaignCount` int DEFAULT 0,
	`status` enum('generating','completed','failed') NOT NULL DEFAULT 'generating',
	`errorMessage` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `adStructures_id` PRIMARY KEY(`id`)
);
