CREATE TABLE `keyword_daily_records` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tracking_id` int NOT NULL,
	`record_date` varchar(10) NOT NULL,
	`actual_organic_rank` int,
	`actual_ad_orders` int,
	`actual_ad_spend` decimal(12,2),
	`actual_impressions` int,
	`actual_clicks` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `keyword_daily_records_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `keyword_trackings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`plan_id` int NOT NULL,
	`keyword` varchar(300) NOT NULL,
	`keyword_cn` varchar(300),
	`target_organic_rank` int,
	`target_daily_ad_orders` int,
	`is_core_keyword` int DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `keyword_trackings_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `product_ops_daily_records` (
	`id` int AUTO_INCREMENT NOT NULL,
	`plan_id` int NOT NULL,
	`record_date` varchar(10) NOT NULL,
	`actual_bsr` int,
	`actual_impressions` int,
	`actual_total_orders` int,
	`actual_ad_orders` int,
	`actual_organic_orders` int,
	`actual_acos` decimal(6,2),
	`actual_profit_margin` decimal(6,2),
	`actual_conversion_rate` decimal(6,2),
	`actual_organic_ratio` decimal(6,2),
	`actual_unit_price` decimal(10,2),
	`actual_sales` decimal(12,2),
	`actual_ad_spend` decimal(12,2),
	`notes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `product_ops_daily_records_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `product_ops_plans` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`product_profile_id` int,
	`asin` varchar(20) NOT NULL,
	`plan_name` varchar(200) NOT NULL,
	`target_bsr` int,
	`target_daily_orders` decimal(10,2),
	`target_ad_orders` decimal(10,2),
	`target_organic_orders` decimal(10,2),
	`target_acos` decimal(6,2),
	`target_profit_margin` decimal(6,2),
	`target_organic_ratio` decimal(6,2),
	`target_conversion_rate` decimal(6,2),
	`promotion_cycle_days` int,
	`start_date` varchar(10),
	`end_date` varchar(10),
	`product_ops_plan_status` enum('planning','active','completed','paused') NOT NULL DEFAULT 'planning',
	`notes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `product_ops_plans_id` PRIMARY KEY(`id`)
);
