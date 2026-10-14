-- FRESH BOOTSTRAP ONLY. Align reviewed public-source column semantics on the empty fresh lineage.
-- These are literal current projection definitions; omitted DEFAULT on nullable columns means NULL.
-- No historical SQL is edited and no existing-schema runner consumes this file.
ALTER TABLE `ops_asin_daily_snapshots` MODIFY COLUMN `is_valid` int NOT NULL DEFAULT 1;
ALTER TABLE `ops_inventory_planning_parameters` MODIFY COLUMN `is_active` int NOT NULL DEFAULT 1;
ALTER TABLE `emperor_conversation_plan_steps` MODIFY COLUMN `approvalRequired` int NOT NULL DEFAULT 0;
ALTER TABLE `knowledge_claim_ledgers` MODIFY COLUMN `isCurrent` int NOT NULL DEFAULT 1;
ALTER TABLE `ops_ad_mcp_profiles` MODIFY COLUMN `workspaceId` int;
ALTER TABLE `ops_ad_mcp_campaign_daily_facts` MODIFY COLUMN `workspaceId` int;
ALTER TABLE `ops_ad_mcp_product_daily_facts` MODIFY COLUMN `workspaceId` int;
ALTER TABLE `ops_ad_mcp_fact_revisions` MODIFY COLUMN `workspaceId` int;
ALTER TABLE `ops_asin_lifecycle_statuses` MODIFY COLUMN `workspaceId` int;
ALTER TABLE `ops_monthly_financial_profits` MODIFY COLUMN `workspaceId` int;
ALTER TABLE `ad_keyword_weekly` MODIFY COLUMN `brand_search_count` int;
ALTER TABLE `off_influencers` MODIFY COLUMN `handle` varchar(200) NOT NULL;
ALTER TABLE `lingxing_product_weekly`
  MODIFY COLUMN `asin` varchar(2000),
  MODIFY COLUMN `parent_asin` varchar(500),
  MODIFY COLUMN `price` varchar(200);
-- Preserve full ASIN storage while keeping the non-unique lookup inside utf8mb4's key-byte limit.
DROP INDEX `idx_sh_asin_week` ON `saihu_product_weekly`;
ALTER TABLE `saihu_product_weekly`
  MODIFY COLUMN `asin` varchar(2000),
  MODIFY COLUMN `parent_asin` varchar(500);
CREATE INDEX `idx_sh_asin_week` ON `saihu_product_weekly` (`asin`(191), `week_start_date`);
-- Six missing plain columns append after the existing final workspaceId column.
ALTER TABLE `inventory_config` ADD COLUMN `production_time_days` int DEFAULT 15;
ALTER TABLE `product_profiles` ADD COLUMN `chinese_name` varchar(500);
ALTER TABLE `ops_plans` ADD COLUMN `parent_asin` varchar(20);
ALTER TABLE `execution_reviews` ADD COLUMN `target_week_label` varchar(50);
ALTER TABLE `team_tasks` ADD COLUMN `meeting_record_id` int;
ALTER TABLE `product_weekly_ops` ADD COLUMN `ad_sales` decimal(12,2) DEFAULT '0';
-- Preserve physical positions and the existing indexes while adopting current ORM column names.
ALTER TABLE `ops_inventory_planning_versions`
  CHANGE COLUMN `status` `inventory_planning_version_status` enum('draft','confirmed','superseded') NOT NULL DEFAULT 'draft';
ALTER TABLE `ops_replenishment_plans`
  CHANGE COLUMN `status` `replenishment_plan_status` enum('draft','confirmed','cancelled','completed') NOT NULL DEFAULT 'draft';
