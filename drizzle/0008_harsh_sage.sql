CREATE TABLE `reviewAggregations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`projectId` int NOT NULL,
	`userId` int NOT NULL,
	`painPoints` text,
	`itchPoints` text,
	`delightPoints` text,
	`overallSentiment` text,
	`keyThemes` text,
	`analysisCount` int DEFAULT 0,
	`status` enum('pending','analyzing','completed','failed') NOT NULL DEFAULT 'pending',
	`errorMessage` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `reviewAggregations_id` PRIMARY KEY(`id`)
);
