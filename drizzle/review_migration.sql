-- Migration: Update execution_reviews to match new ops plan fields
-- Drop old metric columns
ALTER TABLE execution_reviews DROP COLUMN IF EXISTS baseline_profit;
ALTER TABLE execution_reviews DROP COLUMN IF EXISTS baseline_order_conv_rate;
ALTER TABLE execution_reviews DROP COLUMN IF EXISTS baseline_search_conv_rate;
ALTER TABLE execution_reviews DROP COLUMN IF EXISTS baseline_ad_conv_rate;
ALTER TABLE execution_reviews DROP COLUMN IF EXISTS baseline_ranking;
ALTER TABLE execution_reviews DROP COLUMN IF EXISTS baseline_rating;
ALTER TABLE execution_reviews DROP COLUMN IF EXISTS actual_profit;
ALTER TABLE execution_reviews DROP COLUMN IF EXISTS actual_order_conv_rate;
ALTER TABLE execution_reviews DROP COLUMN IF EXISTS actual_search_conv_rate;
ALTER TABLE execution_reviews DROP COLUMN IF EXISTS actual_ad_conv_rate;
ALTER TABLE execution_reviews DROP COLUMN IF EXISTS actual_ranking;
ALTER TABLE execution_reviews DROP COLUMN IF EXISTS actual_rating;
ALTER TABLE execution_reviews DROP COLUMN IF EXISTS target_profit;
ALTER TABLE execution_reviews DROP COLUMN IF EXISTS target_order_conv_rate;
ALTER TABLE execution_reviews DROP COLUMN IF EXISTS target_search_conv_rate;
ALTER TABLE execution_reviews DROP COLUMN IF EXISTS target_ad_conv_rate;

-- Add new metric columns (matching ops plan fields)
-- Baseline: 销售额/小类排名/利润率/转化率/自然单/广告单/评分/Rating数量
ALTER TABLE execution_reviews ADD COLUMN baseline_subcategory_rank INT NULL;
ALTER TABLE execution_reviews ADD COLUMN baseline_conv_rate DECIMAL(5,2) NULL;
ALTER TABLE execution_reviews ADD COLUMN baseline_organic_orders INT NULL;
ALTER TABLE execution_reviews ADD COLUMN baseline_ad_orders INT NULL;
ALTER TABLE execution_reviews ADD COLUMN baseline_rating_score DECIMAL(3,2) NULL;
ALTER TABLE execution_reviews ADD COLUMN baseline_rating_count INT NULL;
ALTER TABLE execution_reviews ADD COLUMN baseline_week_label VARCHAR(50) NULL;

-- Actual: same fields
ALTER TABLE execution_reviews ADD COLUMN actual_subcategory_rank INT NULL;
ALTER TABLE execution_reviews ADD COLUMN actual_conv_rate DECIMAL(5,2) NULL;
ALTER TABLE execution_reviews ADD COLUMN actual_organic_orders INT NULL;
ALTER TABLE execution_reviews ADD COLUMN actual_ad_orders INT NULL;
ALTER TABLE execution_reviews ADD COLUMN actual_rating_score DECIMAL(3,2) NULL;
ALTER TABLE execution_reviews ADD COLUMN actual_rating_count INT NULL;
ALTER TABLE execution_reviews ADD COLUMN actual_week_label VARCHAR(100) NULL;
ALTER TABLE execution_reviews ADD COLUMN actual_week_count INT DEFAULT 1;

-- Target: same fields
ALTER TABLE execution_reviews ADD COLUMN target_subcategory_rank INT NULL;
ALTER TABLE execution_reviews ADD COLUMN target_conv_rate DECIMAL(5,2) NULL;
ALTER TABLE execution_reviews ADD COLUMN target_organic_orders INT NULL;
ALTER TABLE execution_reviews ADD COLUMN target_ad_orders INT NULL;
ALTER TABLE execution_reviews ADD COLUMN target_rating_score DECIMAL(3,2) NULL;
ALTER TABLE execution_reviews ADD COLUMN target_rating_count INT NULL;

-- Add parentAsin for direct data query
ALTER TABLE execution_reviews ADD COLUMN parent_asin VARCHAR(20) NULL;

-- Rename existing baseline_profit_rate to keep it (already correct name)
-- baseline_sales already exists and is correct
-- actual_sales already exists and is correct
-- target_sales already exists and is correct
-- actual_profit_rate already exists and is correct
-- baseline_profit_rate already exists and is correct
