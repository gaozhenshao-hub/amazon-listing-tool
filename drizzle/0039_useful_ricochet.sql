CREATE TABLE `ad_analysis_tasks` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`task_name` varchar(200) NOT NULL,
	`task_type` enum('search_term_analysis','keyword_optimization','campaign_review','budget_optimization') NOT NULL,
	`status` enum('pending','running','completed','failed') NOT NULL DEFAULT 'pending',
	`input_params` json,
	`ai_result` json,
	`user_edits` json,
	`confirmed_at` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `ad_analysis_tasks_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `ad_automation_rules` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`rule_name` varchar(200) NOT NULL,
	`rule_type` enum('negate_keyword','add_keyword','adjust_bid','pause_campaign','enable_campaign','adjust_budget','custom') NOT NULL,
	`condition_json` json,
	`action_json` json,
	`scope_json` json,
	`is_active` int DEFAULT 1,
	`last_run_at` timestamp,
	`run_count` int DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `ad_automation_rules_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `competitor_monitors` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`competitor_asin` varchar(20) NOT NULL,
	`own_asin` varchar(20),
	`marketplace` varchar(10) DEFAULT 'US',
	`competitor_title` varchar(500),
	`competitor_brand` varchar(200),
	`category` varchar(200),
	`monitor_frequency` enum('daily','weekly','manual') DEFAULT 'daily',
	`is_active` int DEFAULT 1,
	`last_checked_at` timestamp,
	`notes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `competitor_monitors_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `competitor_reports` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`report_name` varchar(200) NOT NULL,
	`monitor_ids` json,
	`report_type` enum('comparison','trend','opportunity','threat') DEFAULT 'comparison',
	`ai_analysis` json,
	`user_edits` json,
	`status` enum('draft','confirmed','archived') DEFAULT 'draft',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `competitor_reports_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `competitor_snapshots` (
	`id` int AUTO_INCREMENT NOT NULL,
	`monitor_id` int NOT NULL,
	`snapshot_date` varchar(10) NOT NULL,
	`price` decimal(10,2),
	`bsr_rank` int,
	`bsr_category` varchar(200),
	`review_count` int,
	`rating` decimal(3,1),
	`main_image_url` text,
	`bullet_points` json,
	`is_in_stock` int DEFAULT 1,
	`coupon_info` varchar(200),
	`deal_info` varchar(200),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `competitor_snapshots_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `inventory_config` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`seller_sku` varchar(100) NOT NULL,
	`marketplace` varchar(10) DEFAULT 'US',
	`lead_time_days` int DEFAULT 30,
	`safety_stock_days` int DEFAULT 14,
	`review_cycle_days` int DEFAULT 7,
	`moq` int DEFAULT 100,
	`pack_size` int DEFAULT 1,
	`alert_days_low` int DEFAULT 14,
	`alert_days_critical` int DEFAULT 7,
	`alert_days_overstock` int DEFAULT 90,
	`is_active` int DEFAULT 1,
	`notes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `inventory_config_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `inventory_snapshots` (
	`id` int AUTO_INCREMENT NOT NULL,
	`seller_sku` varchar(100) NOT NULL,
	`marketplace` varchar(10) DEFAULT 'US',
	`snapshot_date` varchar(10) NOT NULL,
	`fulfillable_qty` int DEFAULT 0,
	`inbound_qty` int DEFAULT 0,
	`reserved_qty` int DEFAULT 0,
	`unsellable_qty` int DEFAULT 0,
	`avg_daily_sales` decimal(10,2),
	`days_of_supply` int,
	`storage_fee` decimal(10,2),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `inventory_snapshots_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `lingxing_api_logs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`endpoint` varchar(200) NOT NULL,
	`method` varchar(10) NOT NULL,
	`status_code` varchar(20),
	`duration` int,
	`is_mock` int DEFAULT 0,
	`error_msg` text,
	`user_id` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `lingxing_api_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `lingxing_config` (
	`id` int AUTO_INCREMENT NOT NULL,
	`config_key` varchar(100) NOT NULL,
	`config_value` text,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `lingxing_config_id` PRIMARY KEY(`id`),
	CONSTRAINT `lingxing_config_config_key_unique` UNIQUE(`config_key`)
);
--> statement-breakpoint
CREATE TABLE `profit_alert_rules` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`rule_name` varchar(200) NOT NULL,
	`rule_type` enum('margin_drop','cost_spike','revenue_drop','ad_spend_high','custom') NOT NULL,
	`condition_json` json,
	`is_active` int DEFAULT 1,
	`last_triggered_at` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `profit_alert_rules_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `profit_snapshots` (
	`id` int AUTO_INCREMENT NOT NULL,
	`seller_sku` varchar(100),
	`marketplace` varchar(10) DEFAULT 'US',
	`snapshot_date` varchar(10) NOT NULL,
	`revenue` decimal(12,2),
	`product_cost` decimal(12,2),
	`ad_spend` decimal(12,2),
	`fba_fee` decimal(12,2),
	`referral_fee` decimal(12,2),
	`other_fee` decimal(12,2),
	`profit` decimal(12,2),
	`profit_margin` decimal(5,1),
	`order_count` int,
	`unit_count` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `profit_snapshots_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `search_term_actions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`analysis_task_id` int,
	`search_term` varchar(500) NOT NULL,
	`keyword_text` varchar(500),
	`match_type` varchar(20),
	`suggested_action` enum('add_exact','add_phrase','negate_exact','negate_phrase','increase_bid','decrease_bid','keep','monitor') NOT NULL,
	`ai_reason` text,
	`metrics_json` json,
	`user_decision` enum('accepted','rejected','modified','pending') DEFAULT 'pending',
	`user_notes` text,
	`executed_at` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `search_term_actions_id` PRIMARY KEY(`id`)
);
