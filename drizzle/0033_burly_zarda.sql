CREATE TABLE `kb_sync_logs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`syncDirection` enum('push','pull') NOT NULL,
	`resourceType` enum('kb_product','kb_listing','kb_image_set','kb_video','kb_skill') NOT NULL,
	`resourceId` int NOT NULL,
	`remoteResourceId` int,
	`syncStatus` enum('pending','synced','conflict','failed') NOT NULL DEFAULT 'pending',
	`conflictDetail` text,
	`peer_instance_id` varchar(100),
	`item_count` int DEFAULT 0,
	`error_detail` text,
	`syncedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `kb_sync_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `login_logs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int,
	`loginMethod` enum('password','oauth') NOT NULL,
	`loginIdentifier` varchar(320),
	`ipAddress` varchar(45),
	`userAgent` varchar(512),
	`success` int NOT NULL,
	`failReason` varchar(100),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `login_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `project_assignments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`projectId` int NOT NULL,
	`projectType` enum('dev_project','listing_project') NOT NULL DEFAULT 'dev_project',
	`assignedUserId` int NOT NULL,
	`assignedBy` int NOT NULL,
	`permission` enum('read','write') NOT NULL DEFAULT 'read',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `project_assignments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `remote_usage_snapshots` (
	`id` int AUTO_INCREMENT NOT NULL,
	`instanceId` varchar(100) NOT NULL,
	`instanceName` varchar(255),
	`snapshotDate` varchar(10) NOT NULL,
	`totalUsers` int DEFAULT 0,
	`activeUsers` int DEFAULT 0,
	`aiCallCount` int DEFAULT 0,
	`aiTokensUsed` bigint DEFAULT 0,
	`scraperCallCount` int DEFAULT 0,
	`storageUsedBytes` bigint DEFAULT 0,
	`apiCallCount` int DEFAULT 0,
	`detailJson` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `remote_usage_snapshots_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `role_permissions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`role` varchar(50) NOT NULL,
	`modules` text NOT NULL,
	`description` varchar(200),
	`updatedBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `role_permissions_id` PRIMARY KEY(`id`),
	CONSTRAINT `role_permissions_role_unique` UNIQUE(`role`)
);
--> statement-breakpoint
CREATE TABLE `sop_access_grants` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`skillLevel` enum('intermediate','advanced') NOT NULL,
	`grantedBy` int NOT NULL,
	`expiresAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `sop_access_grants_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `usage_stats` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int,
	`statDate` varchar(10) NOT NULL,
	`aiCallCount` int DEFAULT 0,
	`aiTokensUsed` bigint DEFAULT 0,
	`scraperCallCount` int DEFAULT 0,
	`storageUsedBytes` bigint DEFAULT 0,
	`apiCallCount` int DEFAULT 0,
	`loginCount` int DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `usage_stats_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `users` MODIFY COLUMN `openId` varchar(64);--> statement-breakpoint
ALTER TABLE `users` MODIFY COLUMN `role` enum('super_admin','admin','ops_manager','ops_specialist','product_dev','finance','purchaser','designer') NOT NULL DEFAULT 'ops_specialist';--> statement-breakpoint
ALTER TABLE `kb_image_sets` ADD `reviewStatus` enum('draft','pending_review','approved','rejected') DEFAULT 'draft' NOT NULL;--> statement-breakpoint
ALTER TABLE `kb_image_sets` ADD `reviewedBy` int;--> statement-breakpoint
ALTER TABLE `kb_image_sets` ADD `reviewNote` text;--> statement-breakpoint
ALTER TABLE `kb_image_sets` ADD `reviewedAt` timestamp;--> statement-breakpoint
ALTER TABLE `kb_image_sets` ADD `submittedAt` timestamp;--> statement-breakpoint
ALTER TABLE `kb_image_sets` ADD `visibility` enum('private','team','public') DEFAULT 'private' NOT NULL;--> statement-breakpoint
ALTER TABLE `kb_image_sets` ADD `origin_instance_id` varchar(100);--> statement-breakpoint
ALTER TABLE `kb_image_sets` ADD `remote_id` int;--> statement-breakpoint
ALTER TABLE `kb_image_sets` ADD `sync_version` int DEFAULT 0;--> statement-breakpoint
ALTER TABLE `kb_image_sets` ADD `last_synced_at` timestamp;--> statement-breakpoint
ALTER TABLE `kb_listing_copywriting` ADD `reviewStatus` enum('draft','pending_review','approved','rejected') DEFAULT 'draft' NOT NULL;--> statement-breakpoint
ALTER TABLE `kb_listing_copywriting` ADD `reviewedBy` int;--> statement-breakpoint
ALTER TABLE `kb_listing_copywriting` ADD `reviewNote` text;--> statement-breakpoint
ALTER TABLE `kb_listing_copywriting` ADD `reviewedAt` timestamp;--> statement-breakpoint
ALTER TABLE `kb_listing_copywriting` ADD `submittedAt` timestamp;--> statement-breakpoint
ALTER TABLE `kb_listing_copywriting` ADD `visibility` enum('private','team','public') DEFAULT 'private' NOT NULL;--> statement-breakpoint
ALTER TABLE `kb_listing_copywriting` ADD `origin_instance_id` varchar(100);--> statement-breakpoint
ALTER TABLE `kb_listing_copywriting` ADD `remote_id` int;--> statement-breakpoint
ALTER TABLE `kb_listing_copywriting` ADD `sync_version` int DEFAULT 0;--> statement-breakpoint
ALTER TABLE `kb_listing_copywriting` ADD `last_synced_at` timestamp;--> statement-breakpoint
ALTER TABLE `kb_operation_skills` ADD `reviewStatus` enum('draft','pending_review','approved','rejected') DEFAULT 'draft' NOT NULL;--> statement-breakpoint
ALTER TABLE `kb_operation_skills` ADD `reviewedBy` int;--> statement-breakpoint
ALTER TABLE `kb_operation_skills` ADD `reviewNote` text;--> statement-breakpoint
ALTER TABLE `kb_operation_skills` ADD `reviewedAt` timestamp;--> statement-breakpoint
ALTER TABLE `kb_operation_skills` ADD `submittedAt` timestamp;--> statement-breakpoint
ALTER TABLE `kb_operation_skills` ADD `visibility` enum('private','team','public') DEFAULT 'private' NOT NULL;--> statement-breakpoint
ALTER TABLE `kb_operation_skills` ADD `accessLevel` enum('public','team','restricted') DEFAULT 'public' NOT NULL;--> statement-breakpoint
ALTER TABLE `kb_operation_skills` ADD `allowedRoles` text;--> statement-breakpoint
ALTER TABLE `kb_operation_skills` ADD `origin_instance_id` varchar(100);--> statement-breakpoint
ALTER TABLE `kb_operation_skills` ADD `remote_id` int;--> statement-breakpoint
ALTER TABLE `kb_operation_skills` ADD `sync_version` int DEFAULT 0;--> statement-breakpoint
ALTER TABLE `kb_operation_skills` ADD `last_synced_at` timestamp;--> statement-breakpoint
ALTER TABLE `kb_product_innovations` ADD `reviewStatus` enum('draft','pending_review','approved','rejected') DEFAULT 'draft' NOT NULL;--> statement-breakpoint
ALTER TABLE `kb_product_innovations` ADD `reviewedBy` int;--> statement-breakpoint
ALTER TABLE `kb_product_innovations` ADD `reviewNote` text;--> statement-breakpoint
ALTER TABLE `kb_product_innovations` ADD `reviewedAt` timestamp;--> statement-breakpoint
ALTER TABLE `kb_product_innovations` ADD `submittedAt` timestamp;--> statement-breakpoint
ALTER TABLE `kb_product_innovations` ADD `visibility` enum('private','team','public') DEFAULT 'private' NOT NULL;--> statement-breakpoint
ALTER TABLE `kb_product_innovations` ADD `origin_instance_id` varchar(100);--> statement-breakpoint
ALTER TABLE `kb_product_innovations` ADD `remote_id` int;--> statement-breakpoint
ALTER TABLE `kb_product_innovations` ADD `sync_version` int DEFAULT 0;--> statement-breakpoint
ALTER TABLE `kb_product_innovations` ADD `last_synced_at` timestamp;--> statement-breakpoint
ALTER TABLE `kb_videos` ADD `reviewStatus` enum('draft','pending_review','approved','rejected') DEFAULT 'draft' NOT NULL;--> statement-breakpoint
ALTER TABLE `kb_videos` ADD `reviewedBy` int;--> statement-breakpoint
ALTER TABLE `kb_videos` ADD `reviewNote` text;--> statement-breakpoint
ALTER TABLE `kb_videos` ADD `reviewedAt` timestamp;--> statement-breakpoint
ALTER TABLE `kb_videos` ADD `submittedAt` timestamp;--> statement-breakpoint
ALTER TABLE `kb_videos` ADD `visibility` enum('private','team','public') DEFAULT 'private' NOT NULL;--> statement-breakpoint
ALTER TABLE `kb_videos` ADD `origin_instance_id` varchar(100);--> statement-breakpoint
ALTER TABLE `kb_videos` ADD `remote_id` int;--> statement-breakpoint
ALTER TABLE `kb_videos` ADD `sync_version` int DEFAULT 0;--> statement-breakpoint
ALTER TABLE `kb_videos` ADD `last_synced_at` timestamp;--> statement-breakpoint
ALTER TABLE `users` ADD `phone` varchar(20);--> statement-breakpoint
ALTER TABLE `users` ADD `password` varchar(256);--> statement-breakpoint
ALTER TABLE `users` ADD `department` varchar(100);--> statement-breakpoint
ALTER TABLE `users` ADD `jobTitle` varchar(100);--> statement-breakpoint
ALTER TABLE `users` ADD `status` enum('active','disabled','pending') DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `mustChangePassword` int DEFAULT 1;--> statement-breakpoint
ALTER TABLE `users` ADD `failedLoginAttempts` int DEFAULT 0;--> statement-breakpoint
ALTER TABLE `users` ADD `lockedUntil` timestamp;--> statement-breakpoint
ALTER TABLE `users` ADD `invitedBy` int;--> statement-breakpoint
ALTER TABLE `users` ADD `lastPasswordChangedAt` timestamp;