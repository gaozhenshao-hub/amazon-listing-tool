CREATE TABLE `dev_analysis_reports` (
	`id` int AUTO_INCREMENT NOT NULL,
	`projectId` int NOT NULL,
	`userId` int NOT NULL,
	`reportType` enum('market_overview','product_analysis','price_analysis','brand_analysis','competitor_analysis','review_analysis','review_analysis_recent_2y','external_analysis','ai_summary') NOT NULL,
	`title` varchar(255),
	`content` text,
	`status` enum('generating','completed','failed') NOT NULL DEFAULT 'generating',
	`errorMessage` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `dev_analysis_reports_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `dev_bom_items` (
	`id` int AUTO_INCREMENT NOT NULL,
	`projectId` int NOT NULL,
	`userId` int NOT NULL,
	`partName` varchar(255) NOT NULL,
	`material` varchar(255),
	`process` varchar(255),
	`specification` text,
	`quantity` int DEFAULT 1,
	`unitPrice` varchar(50),
	`subtotal` varchar(50),
	`remark` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `dev_bom_items_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `dev_bom_summary` (
	`id` int AUTO_INCREMENT NOT NULL,
	`projectId` int NOT NULL,
	`userId` int NOT NULL,
	`materialCost` varchar(50),
	`moldAmortizationQty` int,
	`moldAmortizationCost` varchar(50),
	`packagingCost` varchar(50),
	`laborCost` varchar(50),
	`shippingCost` varchar(50),
	`otherCost` varchar(50),
	`totalUnitCost` varchar(50),
	`targetPrice` varchar(50),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `dev_bom_summary_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `dev_external_data` (
	`id` int AUTO_INCREMENT NOT NULL,
	`projectId` int NOT NULL,
	`userId` int NOT NULL,
	`dataType` enum('google_trends','youtube_kol','tiktok_kol','facebook_ads','competitor_site','crowdfunding') NOT NULL,
	`query` varchar(500),
	`rawData` text,
	`aiSummary` text,
	`status` enum('fetching','analyzing','completed','failed') NOT NULL DEFAULT 'fetching',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `dev_external_data_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `dev_global_suppliers` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`name` varchar(255) NOT NULL,
	`contactPerson` varchar(100),
	`phone` varchar(50),
	`email` varchar(320),
	`address` text,
	`categories` text,
	`website` varchar(500),
	`qualityCerts` text,
	`overallScore` int,
	`notes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `dev_global_suppliers_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `dev_mold_costs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`projectId` int NOT NULL,
	`userId` int NOT NULL,
	`partName` varchar(255) NOT NULL,
	`moldType` varchar(100),
	`moldMaterial` varchar(100),
	`cavities` int,
	`estimatedCost` varchar(50),
	`leadTimeDays` int,
	`remark` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `dev_mold_costs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `dev_product_manuals` (
	`id` int AUTO_INCREMENT NOT NULL,
	`projectId` int NOT NULL,
	`userId` int NOT NULL,
	`brandName` varchar(255),
	`logoUrl` text,
	`contentSections` text,
	`contentStatus` enum('draft','editing','confirmed') NOT NULL DEFAULT 'draft',
	`finalManualUrl` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `dev_product_manuals_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `dev_product_profiles` (
	`id` int AUTO_INCREMENT NOT NULL,
	`projectId` int NOT NULL,
	`userId` int NOT NULL,
	`appearanceColors` text,
	`mainFunctions` text,
	`costBreakdown` text,
	`packageDimensions` text,
	`packageDesign` text,
	`userPersona` text,
	`usageScenarios` text,
	`productMap` text,
	`status` enum('draft','confirmed') NOT NULL DEFAULT 'draft',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `dev_product_profiles_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `dev_products` (
	`id` int AUTO_INCREMENT NOT NULL,
	`projectId` int NOT NULL,
	`asin` varchar(20),
	`title` text,
	`brand` varchar(255),
	`price` varchar(50),
	`rating` varchar(10),
	`reviewCount` varchar(20),
	`monthlySales` int,
	`bsr` int,
	`bulletPoints` text,
	`monthlySalesHistory` text,
	`tags` text,
	`tagStatus` enum('pending','tagged','confirmed') NOT NULL DEFAULT 'pending',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `dev_products_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `dev_profit_calculations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`projectId` int,
	`name` varchar(255),
	`sellingPrice` varchar(50),
	`productCost` varchar(50),
	`fbaFee` varchar(50),
	`referralFeeRate` varchar(20),
	`adSpend` varchar(50),
	`otherCost` varchar(50),
	`profit` varchar(50),
	`profitMargin` varchar(20),
	`roi` varchar(20),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `dev_profit_calculations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `dev_project_scores` (
	`id` int AUTO_INCREMENT NOT NULL,
	`projectId` int NOT NULL,
	`userId` int NOT NULL,
	`marketCapacity` int DEFAULT 0,
	`differentiation` int DEFAULT 0,
	`competitiveness` int DEFAULT 0,
	`entryOpportunity` int DEFAULT 0,
	`profit` int DEFAULT 0,
	`risk` int DEFAULT 0,
	`totalScore` int DEFAULT 0,
	`aiReasoning` text,
	`recommendation` enum('approve','review','reject') NOT NULL DEFAULT 'review',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `dev_project_scores_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `dev_projects` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`name` varchar(255) NOT NULL,
	`description` text,
	`targetMarket` varchar(100) DEFAULT 'US',
	`platform` varchar(50) DEFAULT 'amazon',
	`keywords` text,
	`status` enum('draft','data_collection','analyzing','scoring','completed','archived') NOT NULL DEFAULT 'draft',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `dev_projects_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `dev_reviews` (
	`id` int AUTO_INCREMENT NOT NULL,
	`projectId` int NOT NULL,
	`asin` varchar(20),
	`title` text,
	`content` text,
	`rating` int,
	`reviewDate` varchar(50),
	`isVP` int DEFAULT 0,
	`variant` varchar(255),
	`helpfulCount` int DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `dev_reviews_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `dev_suppliers` (
	`id` int AUTO_INCREMENT NOT NULL,
	`projectId` int NOT NULL,
	`userId` int NOT NULL,
	`name` varchar(255) NOT NULL,
	`factoryScale` varchar(100),
	`employeeCount` varchar(50),
	`rdStaffCount` varchar(50),
	`qualityCerts` text,
	`productQuality` int,
	`yieldRate` varchar(20),
	`deliveryScore` int,
	`priceScore` int,
	`overallScore` int,
	`specialties` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `dev_suppliers_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `dev_tag_dimensions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`name` varchar(100) NOT NULL,
	`category` varchar(100),
	`description` text,
	`isDefault` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `dev_tag_dimensions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `dev_test_reports` (
	`id` int AUTO_INCREMENT NOT NULL,
	`projectId` int NOT NULL,
	`userId` int NOT NULL,
	`testItems` text,
	`reportContent` text,
	`status` enum('draft','editing','confirmed') NOT NULL DEFAULT 'draft',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `dev_test_reports_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `dev_time_plans` (
	`id` int AUTO_INCREMENT NOT NULL,
	`projectId` int NOT NULL,
	`userId` int NOT NULL,
	`phaseName` varchar(255) NOT NULL,
	`estimatedDays` int,
	`startOffset` int,
	`description` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `dev_time_plans_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `dev_uploaded_files` (
	`id` int AUTO_INCREMENT NOT NULL,
	`projectId` int NOT NULL,
	`userId` int NOT NULL,
	`fileType` enum('sales','bullet_points','reviews','history_sales') NOT NULL,
	`filename` varchar(500) NOT NULL,
	`fileUrl` text,
	`fileSize` int,
	`parsedData` text,
	`totalRows` int,
	`status` enum('uploaded','parsing','parsed','failed') NOT NULL DEFAULT 'uploaded',
	`errorMessage` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `dev_uploaded_files_id` PRIMARY KEY(`id`)
);
