CREATE TABLE `kb_intel_collect_logs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`sourceId` int NOT NULL,
	`userId` int NOT NULL,
	`triggerType` enum('manual','auto','test') NOT NULL,
	`status` enum('running','success','partial','failed') NOT NULL DEFAULT 'running',
	`totalFound` int DEFAULT 0,
	`totalNew` int DEFAULT 0,
	`totalDuplicate` int DEFAULT 0,
	`totalEvaluated` int DEFAULT 0,
	`totalRecommended` int DEFAULT 0,
	`errorMessage` text,
	`details` json,
	`startedAt` bigint NOT NULL,
	`completedAt` bigint,
	`durationMs` int,
	CONSTRAINT `kb_intel_collect_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `kb_intel_sources` ADD `autoCollectEnabled` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `kb_intel_sources` ADD `autoCollectCron` varchar(100);--> statement-breakpoint
ALTER TABLE `kb_intel_sources` ADD `autoCollectInterval` enum('every_6h','every_12h','daily','weekly','custom') DEFAULT 'daily';--> statement-breakpoint
ALTER TABLE `kb_intel_sources` ADD `lastAutoCollectAt` bigint;--> statement-breakpoint
ALTER TABLE `kb_intel_sources` ADD `nextAutoCollectAt` bigint;--> statement-breakpoint
ALTER TABLE `kb_intel_sources` ADD `autoEvaluateEnabled` boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `kb_intel_sources` ADD `autoCollectMaxItems` int DEFAULT 10;--> statement-breakpoint
ALTER TABLE `kb_intel_sources` ADD `consecutiveFailures` int DEFAULT 0;