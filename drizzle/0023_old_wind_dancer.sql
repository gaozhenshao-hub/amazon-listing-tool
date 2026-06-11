CREATE TABLE `dev_manual_assets` (
	`id` int AUTO_INCREMENT NOT NULL,
	`projectId` int NOT NULL,
	`userId` int NOT NULL,
	`assetType` enum('logo','cover','content_bg','qrcode','chapter_image','other') NOT NULL,
	`chapterKey` varchar(100),
	`fileName` varchar(255),
	`fileUrl` text NOT NULL,
	`sortOrder` int DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `dev_manual_assets_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `dev_module_locks` (
	`id` int AUTO_INCREMENT NOT NULL,
	`projectId` int NOT NULL,
	`userId` int NOT NULL,
	`moduleName` enum('profile','bom','manual','test','profit') NOT NULL,
	`isLocked` boolean NOT NULL DEFAULT false,
	`lockedAt` timestamp,
	`unlockedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `dev_module_locks_id` PRIMARY KEY(`id`)
);
