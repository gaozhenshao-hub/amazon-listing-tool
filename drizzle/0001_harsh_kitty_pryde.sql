CREATE TABLE `competitorAnalyses` (
	`id` int AUTO_INCREMENT NOT NULL,
	`projectId` int NOT NULL,
	`asin` varchar(20) NOT NULL,
	`title` text,
	`bulletPoints` text,
	`imageUrls` text,
	`price` varchar(50),
	`rating` varchar(10),
	`reviewCount` varchar(20),
	`reviewAnalysis` text,
	`keywords` text,
	`rawData` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `competitorAnalyses_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `imageAnalyses` (
	`id` int AUTO_INCREMENT NOT NULL,
	`projectId` int NOT NULL,
	`imageUrl` text NOT NULL,
	`analysisResult` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `imageAnalyses_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `listings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`projectId` int NOT NULL,
	`title` text,
	`bulletPoints` text,
	`description` text,
	`searchTerms` text,
	`imageAdvice` text,
	`version` int NOT NULL DEFAULT 1,
	`isActive` int NOT NULL DEFAULT 1,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `listings_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `projects` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`name` varchar(255) NOT NULL,
	`brand` varchar(255),
	`productName` varchar(500),
	`category` varchar(255),
	`targetMarket` varchar(100) DEFAULT 'US',
	`productFeatures` text,
	`productSpecs` text,
	`status` enum('draft','analyzing','generating','completed') NOT NULL DEFAULT 'draft',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `projects_id` PRIMARY KEY(`id`)
);
