-- Migration: Update ops_plans table fields from old metrics to new weekly metrics
-- Old fields: daily_sales, daily_orders, ad_conv_rate, industry_search_conv_rate, search_conv_rate, category_search_conv_rate, avg_price
-- New fields: sales, subcategory_rank, profit_rate, conv_rate, organic_orders, ad_orders + week_label

-- Add new baseline columns
ALTER TABLE ops_plans ADD COLUMN baseline_week_label VARCHAR(50) AFTER game_planner;
ALTER TABLE ops_plans ADD COLUMN baseline_sales DECIMAL(12,2) AFTER baseline_week_label;
ALTER TABLE ops_plans ADD COLUMN baseline_subcategory_rank INT AFTER baseline_sales;
ALTER TABLE ops_plans ADD COLUMN baseline_profit_rate DECIMAL(6,2) AFTER baseline_subcategory_rank;
ALTER TABLE ops_plans ADD COLUMN baseline_conv_rate DECIMAL(6,2) AFTER baseline_profit_rate;
ALTER TABLE ops_plans ADD COLUMN baseline_organic_orders INT AFTER baseline_conv_rate;
ALTER TABLE ops_plans ADD COLUMN baseline_ad_orders INT AFTER baseline_organic_orders;

-- Add new current columns
ALTER TABLE ops_plans ADD COLUMN current_week_label VARCHAR(50) AFTER baseline_rating_count;
ALTER TABLE ops_plans ADD COLUMN current_sales DECIMAL(12,2) AFTER current_week_label;
ALTER TABLE ops_plans ADD COLUMN current_subcategory_rank INT AFTER current_sales;
ALTER TABLE ops_plans ADD COLUMN current_profit_rate DECIMAL(6,2) AFTER current_subcategory_rank;
ALTER TABLE ops_plans ADD COLUMN current_conv_rate DECIMAL(6,2) AFTER current_profit_rate;
ALTER TABLE ops_plans ADD COLUMN current_organic_orders INT AFTER current_conv_rate;
ALTER TABLE ops_plans ADD COLUMN current_ad_orders INT AFTER current_organic_orders;

-- Add new target columns
ALTER TABLE ops_plans ADD COLUMN target_sales DECIMAL(12,2) AFTER current_rating_count;
ALTER TABLE ops_plans ADD COLUMN target_subcategory_rank INT AFTER target_sales;
ALTER TABLE ops_plans ADD COLUMN target_profit_rate DECIMAL(6,2) AFTER target_subcategory_rank;
ALTER TABLE ops_plans ADD COLUMN target_conv_rate DECIMAL(6,2) AFTER target_profit_rate;
ALTER TABLE ops_plans ADD COLUMN target_organic_orders INT AFTER target_conv_rate;
ALTER TABLE ops_plans ADD COLUMN target_ad_orders INT AFTER target_organic_orders;
ALTER TABLE ops_plans ADD COLUMN target_rating_score DECIMAL(3,1) AFTER target_ad_orders;
ALTER TABLE ops_plans ADD COLUMN target_rating_count INT AFTER target_rating_score;

-- Drop old baseline columns
ALTER TABLE ops_plans DROP COLUMN baseline_daily_sales;
ALTER TABLE ops_plans DROP COLUMN baseline_daily_orders;
ALTER TABLE ops_plans DROP COLUMN baseline_ad_conv_rate;
ALTER TABLE ops_plans DROP COLUMN baseline_industry_search_conv_rate;
ALTER TABLE ops_plans DROP COLUMN baseline_search_conv_rate;
ALTER TABLE ops_plans DROP COLUMN baseline_category_search_conv_rate;
ALTER TABLE ops_plans DROP COLUMN baseline_avg_price;

-- Drop old current columns
ALTER TABLE ops_plans DROP COLUMN current_daily_sales;
ALTER TABLE ops_plans DROP COLUMN current_daily_orders;
ALTER TABLE ops_plans DROP COLUMN current_ad_conv_rate;
ALTER TABLE ops_plans DROP COLUMN current_industry_search_conv_rate;
ALTER TABLE ops_plans DROP COLUMN current_search_conv_rate;
ALTER TABLE ops_plans DROP COLUMN current_category_search_conv_rate;
ALTER TABLE ops_plans DROP COLUMN current_avg_price;

-- Drop old target columns
ALTER TABLE ops_plans DROP COLUMN target_search_conv_rate;
ALTER TABLE ops_plans DROP COLUMN target_order_conv_rate;
ALTER TABLE ops_plans DROP COLUMN target_ad_conv_rate;
ALTER TABLE ops_plans DROP COLUMN target_keyword_advantage;
