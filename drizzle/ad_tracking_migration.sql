-- Ad Keyword Tracking Module Migration

-- 1. ASIN ↔ Ad Portfolio mapping
CREATE TABLE IF NOT EXISTS `ad_portfolio_mappings` (
  `id` int AUTO_INCREMENT NOT NULL,
  `user_id` int NOT NULL,
  `product_id` int NOT NULL,
  `parent_asin` varchar(20) NOT NULL,
  `portfolio_name` varchar(300) NOT NULL,
  `store_name` varchar(255),
  `notes` text,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `ad_portfolio_mappings_id` PRIMARY KEY(`id`)
);

-- 2. Ad report imports
CREATE TABLE IF NOT EXISTS `ad_report_imports` (
  `id` int AUTO_INCREMENT NOT NULL,
  `user_id` int NOT NULL,
  `file_name` varchar(500) NOT NULL,
  `file_url` text,
  `week_start_date` varchar(10) NOT NULL,
  `week_end_date` varchar(10) NOT NULL,
  `total_rows` int DEFAULT 0,
  `keyword_rows` int DEFAULT 0,
  `product_target_rows` int DEFAULT 0,
  `mapped_rows` int DEFAULT 0,
  `unmapped_portfolios` text,
  `import_status` enum('pending','parsing','previewing','importing','completed','failed') NOT NULL DEFAULT 'pending',
  `error_message` text,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `ad_report_imports_id` PRIMARY KEY(`id`)
);

-- 3. Ad keyword weekly data
CREATE TABLE IF NOT EXISTS `ad_keyword_weekly` (
  `id` int AUTO_INCREMENT NOT NULL,
  `import_id` int NOT NULL,
  `user_id` int NOT NULL,
  `product_id` int,
  `parent_asin` varchar(20),
  `week_start_date` varchar(10) NOT NULL,
  `week_end_date` varchar(10) NOT NULL,
  `store_name` varchar(200),
  `country` varchar(50),
  `ad_type` varchar(10) NOT NULL,
  `portfolio_name` varchar(300),
  `campaign_name` varchar(500),
  `ad_group_name` varchar(500),
  `keyword` varchar(500) NOT NULL,
  `match_type` varchar(20) NOT NULL,
  `targeting_type` varchar(20) NOT NULL DEFAULT 'keyword',
  `ad_status` varchar(50),
  `bid` decimal(10,2),
  `default_bid` decimal(10,2),
  `impressions` int DEFAULT 0,
  `impression_share` varchar(20),
  `clicks` int DEFAULT 0,
  `ctr` decimal(6,2),
  `cpc` decimal(10,2),
  `spend` decimal(12,2),
  `sales` decimal(12,2),
  `direct_sales` decimal(12,2),
  `indirect_sales` decimal(12,2),
  `acos` decimal(6,2),
  `roas` decimal(8,2),
  `orders` int DEFAULT 0,
  `direct_orders` int DEFAULT 0,
  `indirect_orders` int DEFAULT 0,
  `cvr` decimal(6,2),
  `ad_sales_qty` int DEFAULT 0,
  `direct_sales_qty` int DEFAULT 0,
  `indirect_sales_qty` int DEFAULT 0,
  `brand_new_orders` int DEFAULT 0,
  `brand_new_sales` decimal(12,2),
  `brand_search_count` int DEFAULT 0,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `ad_keyword_weekly_id` PRIMARY KEY(`id`)
);

-- 4. Ad keyword metadata (manually editable)
CREATE TABLE IF NOT EXISTS `ad_keyword_meta` (
  `id` int AUTO_INCREMENT NOT NULL,
  `user_id` int NOT NULL,
  `product_id` int,
  `parent_asin` varchar(20),
  `keyword` varchar(500) NOT NULL,
  `match_type` varchar(20),
  `monthly_search_volume` int,
  `search_volume_updated_at` timestamp,
  `notes` text,
  `is_tracked` int NOT NULL DEFAULT 1,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `ad_keyword_meta_id` PRIMARY KEY(`id`)
);

-- 5. Competitor rank data (reserved for future)
CREATE TABLE IF NOT EXISTS `ad_competitor_ranks` (
  `id` int AUTO_INCREMENT NOT NULL,
  `user_id` int NOT NULL,
  `product_id` int,
  `parent_asin` varchar(20),
  `keyword` varchar(500) NOT NULL,
  `week_start_date` varchar(10) NOT NULL,
  `week_end_date` varchar(10) NOT NULL,
  `competitor_brand` varchar(200) NOT NULL,
  `competitor_asin` varchar(20),
  `organic_rank` int,
  `ad_rank` int,
  `aba_click_share` decimal(6,2),
  `notes` text,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `ad_competitor_ranks_id` PRIMARY KEY(`id`)
);

-- Indexes for performance
CREATE INDEX `idx_ad_portfolio_product` ON `ad_portfolio_mappings` (`product_id`);
CREATE INDEX `idx_ad_portfolio_asin` ON `ad_portfolio_mappings` (`parent_asin`);
CREATE INDEX `idx_ad_portfolio_name` ON `ad_portfolio_mappings` (`portfolio_name`);

CREATE INDEX `idx_ad_kw_weekly_product` ON `ad_keyword_weekly` (`product_id`, `week_start_date`);
CREATE INDEX `idx_ad_kw_weekly_import` ON `ad_keyword_weekly` (`import_id`);
CREATE INDEX `idx_ad_kw_weekly_keyword` ON `ad_keyword_weekly` (`keyword`, `match_type`);
CREATE INDEX `idx_ad_kw_weekly_portfolio` ON `ad_keyword_weekly` (`portfolio_name`);

CREATE INDEX `idx_ad_kw_meta_product` ON `ad_keyword_meta` (`product_id`);
CREATE INDEX `idx_ad_kw_meta_keyword` ON `ad_keyword_meta` (`keyword`);

CREATE INDEX `idx_ad_comp_ranks_product` ON `ad_competitor_ranks` (`product_id`, `keyword`, `week_start_date`);
