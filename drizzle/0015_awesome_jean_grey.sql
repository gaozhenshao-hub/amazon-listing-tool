CREATE TABLE `dev_analysis_stages` (
	`id` int AUTO_INCREMENT NOT NULL,
	`projectId` int NOT NULL,
	`userId` int NOT NULL,
	`stageType` enum('data_parsing','tag_annotation','market_overview','product_attributes','price_analysis','brand_competition','review_analysis','decision_dashboard','attribute_tagging','attribute_cross','review_kano') NOT NULL,
	`status` enum('pending','generating','generated','editing','confirmed','running','completed') DEFAULT 'pending',
	`rawResult` text,
	`editedResult` text,
	`chartConfig` text,
	`confirmedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `dev_analysis_stages_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `dev_offsite_analyses` (
	`id` int AUTO_INCREMENT NOT NULL,
	`project_id` int NOT NULL,
	`user_id` varchar(255) NOT NULL,
	`source_type` enum('google_trends','youtube','tiktok','facebook','independent_site','reddit','crowdfunding') NOT NULL,
	`keyword` varchar(500) NOT NULL,
	`status` enum('pending','running','completed','failed') NOT NULL DEFAULT 'pending',
	`raw_data` json,
	`ai_analysis` text,
	`ai_analysis_confirmed` int NOT NULL DEFAULT 0,
	`edited_analysis` text,
	`error_message` text,
	`created_at` bigint NOT NULL,
	`updated_at` bigint NOT NULL,
	CONSTRAINT `dev_offsite_analyses_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `dev_product_tags` (
	`id` int AUTO_INCREMENT NOT NULL,
	`projectId` int NOT NULL,
	`asin` varchar(20) NOT NULL,
	`dimensionName` varchar(100) NOT NULL,
	`dimensionValue` varchar(255) NOT NULL,
	`source` enum('ai','manual','specification') DEFAULT 'ai',
	`confirmed` int DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `dev_product_tags_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `dev_products` ADD `monthlyRevenue` decimal(12,2);--> statement-breakpoint
ALTER TABLE `dev_products` ADD `listingDate` varchar(50);--> statement-breakpoint
ALTER TABLE `dev_products` ADD `fulfillment` varchar(20);--> statement-breakpoint
ALTER TABLE `dev_products` ADD `sellerName` varchar(255);--> statement-breakpoint
ALTER TABLE `dev_products` ADD `sellerLocation` varchar(100);--> statement-breakpoint
ALTER TABLE `dev_products` ADD `variantCount` int;--> statement-breakpoint
ALTER TABLE `dev_products` ADD `category` varchar(255);--> statement-breakpoint
ALTER TABLE `dev_products` ADD `subcategory` varchar(255);--> statement-breakpoint
ALTER TABLE `dev_products` ADD `monthlyRevenueHistory` text;--> statement-breakpoint
ALTER TABLE `dev_products` ADD `specifications` text;--> statement-breakpoint
ALTER TABLE `dev_products` ADD `description` text;--> statement-breakpoint
ALTER TABLE `dev_products` ADD `imageUrl` text;--> statement-breakpoint
ALTER TABLE `dev_products` ADD `searchRank` int;--> statement-breakpoint
ALTER TABLE `dev_reviews` ADD `isVine` int DEFAULT 0;--> statement-breakpoint
ALTER TABLE `dev_reviews` ADD `hasImage` int DEFAULT 0;--> statement-breakpoint
ALTER TABLE `dev_reviews` ADD `hasVideo` int DEFAULT 0;--> statement-breakpoint
ALTER TABLE `dev_reviews` ADD `reviewerName` varchar(255);