-- Product Weekly Operations Data
CREATE TABLE IF NOT EXISTS `product_weekly_ops` (
  `id` int AUTO_INCREMENT NOT NULL,
  `product_id` int NOT NULL,
  `user_id` int NOT NULL,
  `week_start_date` varchar(10) NOT NULL,
  `week_end_date` varchar(10) NOT NULL,
  `sales_trend` enum('up','down','stable') DEFAULT 'stable',
  `sales_qty` int DEFAULT 0,
  `order_qty` int DEFAULT 0,
  `sales_amount` decimal(12,2) DEFAULT '0',
  `order_profit` decimal(12,2) DEFAULT '0',
  `order_profit_margin` decimal(6,2) DEFAULT '0',
  `session_total` int DEFAULT 0,
  `total_cvr` decimal(6,2) DEFAULT '0',
  `ad_cvr` decimal(6,2) DEFAULT '0',
  `organic_cvr` decimal(6,2) DEFAULT '0',
  `ad_orders` int DEFAULT 0,
  `organic_orders` int DEFAULT 0,
  `ad_clicks` int DEFAULT 0,
  `organic_clicks` int DEFAULT 0,
  `ctr` decimal(6,4) DEFAULT '0',
  `ad_impressions` int DEFAULT 0,
  `cpc` decimal(8,2) DEFAULT '0',
  `ad_spend` decimal(12,2) DEFAULT '0',
  `acos` decimal(6,2) DEFAULT '0',
  `rating` decimal(3,1) DEFAULT '0',
  `review_count` int DEFAULT 0,
  `return_rate` decimal(6,2) DEFAULT '0',
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `product_weekly_ops_id` PRIMARY KEY(`id`)
);

CREATE INDEX `idx_weekly_ops_product` ON `product_weekly_ops` (`product_id`, `week_start_date`);
CREATE INDEX `idx_weekly_ops_user` ON `product_weekly_ops` (`user_id`);

-- Product Monthly Summary
CREATE TABLE IF NOT EXISTS `product_monthly_summary` (
  `id` int AUTO_INCREMENT NOT NULL,
  `product_id` int NOT NULL,
  `user_id` int NOT NULL,
  `year_month` varchar(7) NOT NULL,
  `financial_profit` decimal(12,2) DEFAULT '0',
  `order_profit_total` decimal(12,2) DEFAULT '0',
  `total_sales_qty` int DEFAULT 0,
  `total_order_qty` int DEFAULT 0,
  `total_sales_amount` decimal(12,2) DEFAULT '0',
  `total_ad_spend` decimal(12,2) DEFAULT '0',
  `avg_acos` decimal(6,2) DEFAULT '0',
  `avg_rating` decimal(3,1) DEFAULT '0',
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `product_monthly_summary_id` PRIMARY KEY(`id`)
);

CREATE INDEX `idx_monthly_summary_product` ON `product_monthly_summary` (`product_id`, `year_month`);
CREATE INDEX `idx_monthly_summary_user` ON `product_monthly_summary` (`user_id`);

-- Product Basic Info
CREATE TABLE IF NOT EXISTS `product_basic_info` (
  `id` int AUTO_INCREMENT NOT NULL,
  `product_id` int NOT NULL,
  `user_id` int NOT NULL,
  `selling_price` decimal(10,2),
  `break_even_price` decimal(10,2),
  `gross_profit` decimal(10,2),
  `gross_margin` decimal(6,2),
  `return_rate` decimal(6,2) DEFAULT '0',
  `rating` decimal(3,1),
  `review_count` int DEFAULT 0,
  `product_cost` decimal(10,2),
  `shipping_cost` decimal(10,2),
  `fba_fee` decimal(10,2),
  `referral_fee` decimal(10,2),
  `current_stock` int DEFAULT 0,
  `in_transit_stock` int DEFAULT 0,
  `packing_qty` int,
  `weight_kg` decimal(8,2),
  `shipping_unit_price` decimal(8,2),
  `last_month_profit` decimal(12,2),
  `tracking_sheet_url` text,
  `listing_date` varchar(10),
  `asin` varchar(20),
  `notes` text,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `product_basic_info_id` PRIMARY KEY(`id`)
);

CREATE INDEX `idx_basic_info_product` ON `product_basic_info` (`product_id`);
CREATE INDEX `idx_basic_info_user` ON `product_basic_info` (`user_id`);
