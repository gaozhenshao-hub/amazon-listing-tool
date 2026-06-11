CREATE TABLE `off_ai_analysis_logs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`analysisType` varchar(50) NOT NULL,
	`inputData` text,
	`outputData` text,
	`modelUsed` varchar(100),
	`tokensUsed` int DEFAULT 0,
	`durationMs` int DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `off_ai_analysis_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `off_attribution_links` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`campaignId` int,
	`influencerId` int,
	`originalUrl` text NOT NULL,
	`trackingUrl` text,
	`utmSource` varchar(100),
	`utmMedium` varchar(100),
	`utmCampaign` varchar(200),
	`utmContent` varchar(200),
	`shortCode` varchar(50),
	`clicks` int DEFAULT 0,
	`conversions` int DEFAULT 0,
	`revenue` decimal(12,2) DEFAULT '0',
	`status` varchar(30) DEFAULT 'active',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `off_attribution_links_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `off_campaign_analytics` (
	`id` int AUTO_INCREMENT NOT NULL,
	`campaignId` int NOT NULL,
	`date` varchar(20) NOT NULL,
	`impressions` int DEFAULT 0,
	`clicks` int DEFAULT 0,
	`conversions` int DEFAULT 0,
	`revenue` decimal(12,2) DEFAULT '0',
	`cost` decimal(12,2) DEFAULT '0',
	`roas` decimal(8,2) DEFAULT '0',
	`brbBonus` decimal(10,2) DEFAULT '0',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `off_campaign_analytics_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `off_campaigns` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`name` varchar(300) NOT NULL,
	`description` text,
	`type` varchar(50) DEFAULT 'influencer',
	`status` varchar(30) DEFAULT 'draft',
	`budget` decimal(12,2) DEFAULT '0',
	`spentAmount` decimal(12,2) DEFAULT '0',
	`startDate` varchar(20),
	`endDate` varchar(20),
	`targetAsin` varchar(50),
	`targetMarketplace` varchar(10),
	`goals` text,
	`tags` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `off_campaigns_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `off_collaborations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`campaignId` int NOT NULL,
	`influencerId` int NOT NULL,
	`userId` int NOT NULL,
	`stage` varchar(30) DEFAULT 'contacted',
	`fee` decimal(10,2) DEFAULT '0',
	`deliverables` text,
	`deadline` varchar(20),
	`notes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `off_collaborations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `off_content_calendar` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`socialAccountId` int,
	`platform` varchar(50) NOT NULL,
	`title` varchar(300) NOT NULL,
	`content` text,
	`mediaUrls` text,
	`scheduledDate` varchar(20) NOT NULL,
	`scheduledTime` varchar(10),
	`status` varchar(30) DEFAULT 'draft',
	`publishedUrl` text,
	`aiGenerated` boolean DEFAULT false,
	`tags` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `off_content_calendar_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `off_content_submissions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`collaborationId` int NOT NULL,
	`userId` int NOT NULL,
	`contentType` varchar(30) DEFAULT 'post',
	`contentUrl` text,
	`caption` text,
	`mediaUrls` text,
	`aiReviewResult` text,
	`aiReviewedAt` timestamp,
	`humanStatus` varchar(30) DEFAULT 'pending',
	`humanNotes` text,
	`reviewedBy` int,
	`reviewedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `off_content_submissions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `off_influencer_scores` (
	`id` int AUTO_INCREMENT NOT NULL,
	`influencerId` int NOT NULL,
	`campaignId` int,
	`overallScore` decimal(5,2) DEFAULT '0',
	`relevanceScore` decimal(5,2) DEFAULT '0',
	`engagementScore` decimal(5,2) DEFAULT '0',
	`audienceScore` decimal(5,2) DEFAULT '0',
	`costScore` decimal(5,2) DEFAULT '0',
	`aiReasoning` text,
	`scoredAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `off_influencer_scores_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `off_influencers` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`name` varchar(200) NOT NULL,
	`platform` varchar(50) NOT NULL,
	`handle` varchar(200),
	`profileUrl` text,
	`avatarUrl` text,
	`followerCount` int DEFAULT 0,
	`engagementRate` decimal(8,4) DEFAULT '0',
	`category` varchar(100),
	`country` varchar(50),
	`language` varchar(50),
	`email` varchar(320),
	`phone` varchar(50),
	`notes` text,
	`tags` text,
	`status` varchar(30) DEFAULT 'active',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `off_influencers_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `off_matrix_groups` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`name` varchar(200) NOT NULL,
	`description` text,
	`targetAsin` varchar(50),
	`strategy` text,
	`accountCount` int DEFAULT 0,
	`status` varchar(30) DEFAULT 'active',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `off_matrix_groups_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `off_outreach_messages` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`influencerId` int NOT NULL,
	`campaignId` int,
	`channel` varchar(30) DEFAULT 'email',
	`direction` varchar(10) DEFAULT 'outbound',
	`subject` varchar(500),
	`content` text,
	`status` varchar(30) DEFAULT 'draft',
	`sentAt` timestamp,
	`aiGenerated` boolean DEFAULT false,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `off_outreach_messages_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `off_social_accounts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`platform` varchar(50) NOT NULL,
	`accountName` varchar(200) NOT NULL,
	`accountId` varchar(200),
	`avatarUrl` text,
	`followerCount` int DEFAULT 0,
	`matrixGroupId` int,
	`status` varchar(30) DEFAULT 'active',
	`lastSyncAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `off_social_accounts_id` PRIMARY KEY(`id`)
);
