CREATE TABLE `keyword_monitors` (
	`id` int AUTO_INCREMENT NOT NULL,
	`product_id` int NOT NULL,
	`user_id` int NOT NULL,
	`keyword` varchar(500) NOT NULL,
	`keyword_cn` varchar(500),
	`target_asin` varchar(20),
	`marketplace` varchar(10) DEFAULT 'US',
	`match_type` enum('exact','phrase','broad') DEFAULT 'exact',
	`monitor_frequency` enum('daily','weekly','manual') DEFAULT 'daily',
	`is_active` int DEFAULT 1,
	`last_checked_at` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `keyword_monitors_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `keyword_snapshots` (
	`id` int AUTO_INCREMENT NOT NULL,
	`keyword_monitor_id` int NOT NULL,
	`snapshot_date` varchar(10) NOT NULL,
	`organic_rank` int,
	`ad_rank` int,
	`search_volume` int,
	`page_number` int,
	`total_results` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `keyword_snapshots_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `product_logs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`product_id` int NOT NULL,
	`user_id` int NOT NULL,
	`content` text NOT NULL,
	`log_type` enum('operation','note','issue','decision','milestone') NOT NULL DEFAULT 'note',
	`created_by` varchar(100),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `product_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `product_profiles` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`parent_asin` varchar(20) NOT NULL,
	`title` varchar(500) NOT NULL,
	`brand` varchar(200),
	`category` varchar(300),
	`marketplace` varchar(10) DEFAULT 'US',
	`image_url` text,
	`status` enum('active','inactive','discontinued') NOT NULL DEFAULT 'active',
	`budget_revenue` decimal(12,2),
	`budget_profit` decimal(12,2),
	`budget_acos` decimal(5,1),
	`notes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `product_profiles_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `product_todos` (
	`id` int AUTO_INCREMENT NOT NULL,
	`product_id` int NOT NULL,
	`user_id` int NOT NULL,
	`title` varchar(500) NOT NULL,
	`description` text,
	`priority` enum('high','medium','low') NOT NULL DEFAULT 'medium',
	`status` enum('pending','in_progress','completed') NOT NULL DEFAULT 'pending',
	`due_date` varchar(10),
	`assignee` varchar(100),
	`sort_order` int DEFAULT 0,
	`completed_at` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `product_todos_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `product_variants` (
	`id` int AUTO_INCREMENT NOT NULL,
	`product_id` int NOT NULL,
	`child_asin` varchar(20) NOT NULL,
	`sku` varchar(100),
	`title` varchar(500),
	`price` decimal(10,2),
	`variation_attributes` json,
	`status` enum('active','inactive') NOT NULL DEFAULT 'active',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `product_variants_id` PRIMARY KEY(`id`)
);
