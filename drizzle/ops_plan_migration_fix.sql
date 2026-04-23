-- Fix: Add new columns without AFTER dependency (columns are added at end of table)
ALTER TABLE ops_plans ADD COLUMN baseline_week_label VARCHAR(50);
ALTER TABLE ops_plans ADD COLUMN baseline_sales DECIMAL(12,2);
ALTER TABLE ops_plans ADD COLUMN baseline_subcategory_rank INT;
ALTER TABLE ops_plans ADD COLUMN baseline_profit_rate DECIMAL(6,2);
ALTER TABLE ops_plans ADD COLUMN baseline_conv_rate DECIMAL(6,2);
ALTER TABLE ops_plans ADD COLUMN baseline_organic_orders INT;
ALTER TABLE ops_plans ADD COLUMN baseline_ad_orders INT;
ALTER TABLE ops_plans ADD COLUMN current_week_label VARCHAR(50);
ALTER TABLE ops_plans ADD COLUMN current_sales DECIMAL(12,2);
ALTER TABLE ops_plans ADD COLUMN current_subcategory_rank INT;
ALTER TABLE ops_plans ADD COLUMN current_profit_rate DECIMAL(6,2);
ALTER TABLE ops_plans ADD COLUMN current_conv_rate DECIMAL(6,2);
ALTER TABLE ops_plans ADD COLUMN current_organic_orders INT;
ALTER TABLE ops_plans ADD COLUMN current_ad_orders INT;
ALTER TABLE ops_plans ADD COLUMN target_sales DECIMAL(12,2);
ALTER TABLE ops_plans ADD COLUMN target_subcategory_rank INT;
ALTER TABLE ops_plans ADD COLUMN target_profit_rate DECIMAL(6,2);
ALTER TABLE ops_plans ADD COLUMN target_conv_rate DECIMAL(6,2);
ALTER TABLE ops_plans ADD COLUMN target_organic_orders INT;
ALTER TABLE ops_plans ADD COLUMN target_ad_orders INT;
ALTER TABLE ops_plans ADD COLUMN target_rating_score DECIMAL(3,1);
ALTER TABLE ops_plans ADD COLUMN target_rating_count INT;
-- Also drop remaining old columns that may still exist
ALTER TABLE ops_plans DROP COLUMN baseline_daily_sales;
ALTER TABLE ops_plans DROP COLUMN current_daily_sales;
ALTER TABLE ops_plans DROP COLUMN target_search_conv_rate;
