CREATE TABLE `projectFiles` (
	`id` int AUTO_INCREMENT NOT NULL,
	`projectId` int NOT NULL,
	`userId` int NOT NULL,
	`fileType` enum('product_attributes','competitor_listings','search_term_report','aba_keywords') NOT NULL,
	`filename` varchar(500) NOT NULL,
	`fileUrl` text,
	`fileSize` int,
	`rawContent` text,
	`parsedData` text,
	`analysisResult` text,
	`status` enum('uploaded','parsing','parsed','analyzing','completed','failed') NOT NULL DEFAULT 'uploaded',
	`errorMessage` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `projectFiles_id` PRIMARY KEY(`id`)
);
