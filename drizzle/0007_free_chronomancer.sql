CREATE TABLE `listingVersions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`listingId` int NOT NULL,
	`projectId` int NOT NULL,
	`userId` int NOT NULL,
	`versionNumber` int NOT NULL DEFAULT 1,
	`changeType` enum('generate','ab_apply','optimize','manual_edit','translate') NOT NULL,
	`changeDescription` text,
	`title` text,
	`bulletPoints` text,
	`description` text,
	`searchTerms` text,
	`titleCn` text,
	`bulletPointsCn` text,
	`descriptionCn` text,
	`searchTermsCn` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `listingVersions_id` PRIMARY KEY(`id`)
);
