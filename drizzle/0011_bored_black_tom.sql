ALTER TABLE `keywords` ADD `translation_cn` varchar(500);--> statement-breakpoint
ALTER TABLE `keywords` ADD `is_ac_recommended` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `keywords` ADD `skip_semantic_filter` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `negativeKeywords` ADD `reason_cn` text;--> statement-breakpoint
ALTER TABLE `keywords` DROP COLUMN `translationCn`;--> statement-breakpoint
ALTER TABLE `keywords` DROP COLUMN `isAcRecommended`;--> statement-breakpoint
ALTER TABLE `keywords` DROP COLUMN `skipSemanticFilter`;