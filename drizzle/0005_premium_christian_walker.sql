CREATE TABLE `analysisVersions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`projectFileId` int NOT NULL,
	`userId` int NOT NULL,
	`version` int NOT NULL DEFAULT 1,
	`analysisResult` text NOT NULL,
	`changeType` enum('auto_analysis','manual_edit','re_analysis') NOT NULL DEFAULT 'auto_analysis',
	`changeNote` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `analysisVersions_id` PRIMARY KEY(`id`)
);
