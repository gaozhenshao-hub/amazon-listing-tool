CREATE TABLE `conversion_check_items` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int,
	`category_index` int NOT NULL,
	`category_name` varchar(100) NOT NULL,
	`sub_dimension` varchar(200),
	`standard` text,
	`sort_order` int DEFAULT 0,
	`is_custom` int DEFAULT 0,
	`is_active` int DEFAULT 1,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `conversion_check_items_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `conversion_comparisons` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`product_profile_id` int NOT NULL,
	`comparison_name` varchar(200) NOT NULL,
	`own_asin` varchar(20) NOT NULL,
	`competitor_asins` text,
	`comparison_status` enum('draft','crawling','scoring','completed') NOT NULL DEFAULT 'draft',
	`overall_own_score` decimal(5,2),
	`crawl_data` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `conversion_comparisons_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `conversion_scores` (
	`id` int AUTO_INCREMENT NOT NULL,
	`comparison_id` int NOT NULL,
	`check_item_id` int NOT NULL,
	`asin` varchar(20) NOT NULL,
	`score` int,
	`ai_score` int,
	`reason` text,
	`ai_reason` text,
	`raw_data` text,
	`is_locked` int DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `conversion_scores_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `conversion_suggestions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`comparison_id` int NOT NULL,
	`user_id` int NOT NULL,
	`category_name` varchar(100) NOT NULL,
	`own_score` decimal(5,2),
	`best_competitor_score` decimal(5,2),
	`gap_analysis` text,
	`suggestion` text,
	`suggestion_priority` enum('high','medium','low') NOT NULL DEFAULT 'medium',
	`expected_effect` text,
	`is_locked` int DEFAULT 0,
	`linked_plan_action_id` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `conversion_suggestions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `ops_plan_actions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`plan_id` int NOT NULL,
	`user_id` int NOT NULL,
	`dimension` varchar(200) NOT NULL,
	`current_status` text,
	`target_action` text,
	`action_priority` enum('high','medium','low') NOT NULL DEFAULT 'medium',
	`planned_date` varchar(10),
	`assignee` varchar(100),
	`action_status` enum('not_started','in_progress','completed','delayed') NOT NULL DEFAULT 'not_started',
	`linked_todo_id` int,
	`sort_order` int DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `ops_plan_actions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `ops_plan_summaries` (
	`id` int AUTO_INCREMENT NOT NULL,
	`plan_id` int NOT NULL,
	`user_id` int NOT NULL,
	`period` varchar(50),
	`achievement_summary` text,
	`planner_feedback` text,
	`summary_rating` enum('excellent','good','needs_improvement'),
	`actual_industry_conv_rate` decimal(6,2),
	`actual_search_conv_rate` decimal(6,2),
	`actual_order_conv_rate` decimal(6,2),
	`actual_ad_conv_rate` decimal(6,2),
	`actual_sales` decimal(12,2),
	`actual_profit` decimal(12,2),
	`actual_profit_rate` decimal(6,2),
	`actual_ranking` int,
	`actual_rating` decimal(3,1),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `ops_plan_summaries_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `ops_plans` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`product_profile_id` int NOT NULL,
	`plan_name` varchar(200) NOT NULL,
	`plan_period` varchar(50),
	`project_manager` varchar(100),
	`project_members` text,
	`game_planner` varchar(100),
	`baseline_daily_sales` decimal(12,2),
	`baseline_daily_orders` decimal(10,2),
	`baseline_ad_conv_rate` decimal(6,2),
	`baseline_industry_search_conv_rate` decimal(6,2),
	`baseline_search_conv_rate` decimal(6,2),
	`baseline_category_search_conv_rate` decimal(6,2),
	`baseline_avg_price` decimal(10,2),
	`baseline_rating_count` int,
	`baseline_rating_score` decimal(3,1),
	`current_daily_sales` decimal(12,2),
	`current_daily_orders` decimal(10,2),
	`current_ad_conv_rate` decimal(6,2),
	`current_industry_search_conv_rate` decimal(6,2),
	`current_search_conv_rate` decimal(6,2),
	`current_category_search_conv_rate` decimal(6,2),
	`current_avg_price` decimal(10,2),
	`current_rating_count` int,
	`current_rating_score` decimal(3,1),
	`target_search_conv_rate` decimal(6,2),
	`target_order_conv_rate` decimal(6,2),
	`target_ad_conv_rate` decimal(6,2),
	`target_keyword_advantage` decimal(6,2),
	`plan_status` enum('draft','active','completed','archived') NOT NULL DEFAULT 'draft',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `ops_plans_id` PRIMARY KEY(`id`)
);
