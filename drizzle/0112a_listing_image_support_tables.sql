-- Listing and image workflow support tables that predate the governed migration ledger.

CREATE TABLE IF NOT EXISTS `buyer_questions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`project_id` int NOT NULL,
	`user_id` int NOT NULL,
	`question` text NOT NULL,
	`question_cn` text,
	`source` enum('ad_search_term','sp_prompts','qa_section','competitor_review','manual') NOT NULL DEFAULT 'manual',
	`category` varchar(100),
	`frequency` int DEFAULT 1,
	`priority` enum('high','medium','low') NOT NULL DEFAULT 'medium',
	`covered_in_bullet` int DEFAULT 0,
	`covered_in_description` int DEFAULT 0,
	`covered_in_qa` int DEFAULT 0,
	`suggested_answer` text,
	`status` enum('active','dismissed','covered') NOT NULL DEFAULT 'active',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `buyer_questions_id` PRIMARY KEY(`id`)
);

CREATE TABLE IF NOT EXISTS `competitor_image_analyses` (
	`id` int AUTO_INCREMENT NOT NULL,
	`projectId` int NOT NULL,
	`userId` int NOT NULL,
	`competitorName` varchar(255) NOT NULL DEFAULT '',
	`imageUrl` text NOT NULL,
	`imageType` varchar(100),
	`aiAnalysis` text,
	`userEdit` text,
	`confirmed` int NOT NULL DEFAULT 0,
	`sortOrder` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `competitor_image_analyses_id` PRIMARY KEY(`id`)
);

CREATE TABLE IF NOT EXISTS `expression_group_images` (
	`id` int AUTO_INCREMENT NOT NULL,
	`groupId` int NOT NULL,
	`projectId` int NOT NULL,
	`userId` int NOT NULL,
	`competitorName` varchar(255) NOT NULL DEFAULT '',
	`imageUrl` text NOT NULL,
	`sortOrder` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `expression_group_images_id` PRIMARY KEY(`id`)
);

CREATE TABLE IF NOT EXISTS `expression_groups` (
	`id` int AUTO_INCREMENT NOT NULL,
	`projectId` int NOT NULL,
	`userId` int NOT NULL,
	`expressionName` varchar(255) NOT NULL,
	`aiAnalysis` text,
	`userEdit` text,
	`confirmed` int NOT NULL DEFAULT 0,
	`sortOrder` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `expression_groups_id` PRIMARY KEY(`id`)
);
