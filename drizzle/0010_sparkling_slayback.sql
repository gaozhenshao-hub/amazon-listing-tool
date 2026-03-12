ALTER TABLE `keywords` MODIFY COLUMN `rootCategory` enum('core','function','scene','audience','spec','painpoint','gift_holiday','brand_competitor');--> statement-breakpoint
ALTER TABLE `keywords` MODIFY COLUMN `strategyCategory` enum('core_main','sub_core','precise_longtail','scene_intent','longtail_main','observe_test','negative','brand_offensive');--> statement-breakpoint
ALTER TABLE `keywords` ADD `translationCn` varchar(500);--> statement-breakpoint
ALTER TABLE `keywords` ADD `isAcRecommended` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `keywords` ADD `skipSemanticFilter` int DEFAULT 0 NOT NULL;