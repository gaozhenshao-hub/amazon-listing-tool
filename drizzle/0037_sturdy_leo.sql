CREATE TABLE `kb_bot_conversations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`title` varchar(255),
	`lastMessageAt` bigint,
	`messageCount` int DEFAULT 0,
	`createdAt` bigint NOT NULL,
	`updatedAt` bigint NOT NULL,
	CONSTRAINT `kb_bot_conversations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `kb_bot_messages` (
	`id` int AUTO_INCREMENT NOT NULL,
	`conversationId` int NOT NULL,
	`role` enum('user','assistant') NOT NULL,
	`content` text NOT NULL,
	`references` json,
	`searchPath` json,
	`tokensUsed` int,
	`createdAt` bigint NOT NULL,
	CONSTRAINT `kb_bot_messages_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `kb_call_logs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`callerModule` varchar(100) NOT NULL,
	`callerAction` varchar(100) NOT NULL,
	`kbItemId` int NOT NULL,
	`kbItemType` varchar(50) NOT NULL,
	`loadLevel` enum('L1','L2','L3') NOT NULL,
	`relevanceScore` decimal(3,2),
	`createdAt` bigint NOT NULL,
	CONSTRAINT `kb_call_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `kb_feedback` (
	`id` int AUTO_INCREMENT NOT NULL,
	`callLogId` int,
	`conversationMessageId` int,
	`userId` int NOT NULL,
	`kbItemId` int NOT NULL,
	`kbItemType` varchar(50) NOT NULL,
	`rating` enum('helpful','irrelevant','wrong') NOT NULL,
	`comment` text,
	`createdAt` bigint NOT NULL,
	CONSTRAINT `kb_feedback_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `kb_intel_items` (
	`id` int AUTO_INCREMENT NOT NULL,
	`sourceId` int NOT NULL,
	`title` varchar(500) NOT NULL,
	`author` varchar(200),
	`originalUrl` varchar(1000) NOT NULL,
	`publishedAt` bigint,
	`rawContent` text NOT NULL,
	`aiSummary` text,
	`aiQualityScore` decimal(3,1),
	`aiScoreDetails` json,
	`aiSuggestedType` enum('sop','listing','product','image','video'),
	`aiFormattedContent` text,
	`status` enum('pending','recommended','adopted','ignored','expired','bookmarked') NOT NULL DEFAULT 'pending',
	`adoptedKbType` varchar(50),
	`adoptedKbItemId` int,
	`reviewedBy` int,
	`reviewedAt` bigint,
	`createdAt` bigint NOT NULL,
	CONSTRAINT `kb_intel_items_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `kb_intel_sources` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`name` varchar(200) NOT NULL,
	`sourceType` enum('amazon_news','wearesellers','media','custom_url','rss') NOT NULL,
	`url` varchar(1000) NOT NULL,
	`crawlFrequency` enum('daily','weekly','manual') NOT NULL DEFAULT 'manual',
	`qualityThreshold` decimal(3,1) DEFAULT '6.0',
	`isActive` boolean NOT NULL DEFAULT true,
	`lastCrawledAt` bigint,
	`totalCrawled` int DEFAULT 0,
	`totalAdopted` int DEFAULT 0,
	`createdAt` bigint NOT NULL,
	`updatedAt` bigint NOT NULL,
	CONSTRAINT `kb_intel_sources_id` PRIMARY KEY(`id`)
);
