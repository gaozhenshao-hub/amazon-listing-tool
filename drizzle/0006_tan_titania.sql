CREATE TABLE `adStructures` (
	`id` int AUTO_INCREMENT NOT NULL,
	`projectId` int NOT NULL,
	`userId` int NOT NULL,
	`structureData` text,
	`structureDataCn` text,
	`keywordCount` int DEFAULT 0,
	`campaignCount` int DEFAULT 0,
	`status` enum('generating','completed','failed') NOT NULL DEFAULT 'generating',
	`errorMessage` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `adStructures_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `keywords` (
	`id` int AUTO_INCREMENT NOT NULL,
	`projectId` int NOT NULL,
	`userId` int NOT NULL,
	`keyword` varchar(500) NOT NULL,
	`source` enum('manual','csv_import','asin_reverse','search_suggest','review_extract','ai_expand') NOT NULL DEFAULT 'manual',
	`sourceDetail` text,
	`relevance` enum('high','medium','low','none') NOT NULL DEFAULT 'medium',
	`trafficLevel` enum('high','medium','low') NOT NULL DEFAULT 'medium',
	`competition` enum('high','medium','low') NOT NULL DEFAULT 'medium',
	`monthlySearchVolume` int,
	`spr` int,
	`ppcBid` varchar(20),
	`naturalRank` int,
	`trafficScore` int,
	`sceneTags` text,
	`intentTag` varchar(100),
	`rootCategory` enum('core','function','scene','audience','spec','painpoint','gift_holiday'),
	`rootWord` varchar(200),
	`rootImpact` enum('high','medium','low'),
	`strategyCategory` enum('core_main','sub_core','precise_longtail','scene_intent','longtail_main','observe_test','negative'),
	`listingPlacement` enum('title_front','title_mid','title_end','bullet_first','bullet_body','aplus','search_term','not_use'),
	`status` enum('raw','cleaned','scored','tagged','finalized','negative') NOT NULL DEFAULT 'raw',
	`isNegative` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `keywords_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `negativeKeywords` (
	`id` int AUTO_INCREMENT NOT NULL,
	`projectId` int NOT NULL,
	`userId` int NOT NULL,
	`keyword` varchar(500) NOT NULL,
	`isRoot` int NOT NULL DEFAULT 0,
	`reason` text,
	`source` enum('auto_filter','manual','ai_suggest','word_freq') NOT NULL DEFAULT 'manual',
	`matchType` enum('exact','phrase','broad') NOT NULL DEFAULT 'exact',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `negativeKeywords_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `listings` ADD `imageAdviceCn` text;