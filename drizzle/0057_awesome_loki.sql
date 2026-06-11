CREATE TABLE `custom_dashboards` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`name` varchar(200) NOT NULL,
	`description` varchar(500),
	`layout` json,
	`is_default` boolean NOT NULL DEFAULT false,
	`template` varchar(50),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `custom_dashboards_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `customer_profiles` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`customer_id` varchar(100) NOT NULL,
	`buyer_name` varchar(200),
	`email` varchar(200),
	`sid` int,
	`total_orders` int DEFAULT 0,
	`total_spent` decimal(12,2) DEFAULT '0',
	`first_order_date` varchar(10),
	`last_order_date` varchar(10),
	`avg_order_value` decimal(10,2) DEFAULT '0',
	`review_count` int DEFAULT 0,
	`avg_rating` decimal(3,1),
	`return_count` int DEFAULT 0,
	`return_rate` decimal(5,2) DEFAULT '0',
	`communication_count` int DEFAULT 0,
	`ai_value_score` decimal(5,2),
	`ai_value_tag` enum('high_value','normal','risk','new'),
	`ai_analysis` json,
	`last_sync_at` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `customer_profiles_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `dashboard_widgets` (
	`id` int AUTO_INCREMENT NOT NULL,
	`dashboard_id` int NOT NULL,
	`widget_type` enum('kpi_card','line_chart','bar_chart','pie_chart','heatmap','table','ai_summary','calendar','radar_chart') NOT NULL,
	`title` varchar(200) NOT NULL,
	`data_source` varchar(100) NOT NULL,
	`config` json,
	`position` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `dashboard_widgets_id` PRIMARY KEY(`id`)
);
