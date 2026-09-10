CREATE TABLE `ops_ad_mcp_profiles` (
  `workspaceId` int NOT NULL,
  `id` int AUTO_INCREMENT NOT NULL,
  `profile_id` varchar(64) NOT NULL,
  `source_store_id` varchar(64) NOT NULL,
  `country` varchar(16) NOT NULL,
  `store_name` varchar(200),
  `profile_name` varchar(300),
  `status` varchar(32) NOT NULL DEFAULT 'active',
  `source_batch_id` int NOT NULL,
  `source_row_hash` varchar(64) NOT NULL,
  `metadata` json,
  `is_active` int NOT NULL DEFAULT 1,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `ops_ad_mcp_profiles_id` PRIMARY KEY(`id`),
  CONSTRAINT `uk_ops_ad_mcp_profiles_workspace_profile` UNIQUE(`workspaceId`, `profile_id`)
);
--> statement-breakpoint
CREATE INDEX `idx_ops_ad_mcp_profiles_store_country` ON `ops_ad_mcp_profiles` (`workspaceId`, `source_store_id`, `country`);
--> statement-breakpoint

CREATE TABLE `ops_ad_mcp_campaign_daily_facts` (
  `workspaceId` int NOT NULL,
  `id` int AUTO_INCREMENT NOT NULL,
  `user_id` int NOT NULL,
  `profile_id` varchar(64) NOT NULL,
  `source_store_id` varchar(64) NOT NULL,
  `country` varchar(16) NOT NULL,
  `report_date` varchar(10) NOT NULL,
  `ad_type` varchar(12) NOT NULL,
  `campaign_id` varchar(80) NOT NULL,
  `campaign_name` varchar(500),
  `campaign_status` varchar(64),
  `bidding_strategy` varchar(100),
  `budget` decimal(14,2),
  `currency` varchar(12),
  `impressions` bigint NOT NULL DEFAULT 0,
  `clicks` bigint NOT NULL DEFAULT 0,
  `spend` decimal(14,2) NOT NULL DEFAULT '0',
  `sales` decimal(14,2) NOT NULL DEFAULT '0',
  `orders` int NOT NULL DEFAULT 0,
  `source_batch_id` int NOT NULL,
  `source_row_hash` varchar(64) NOT NULL,
  `source_payload_hash` varchar(64) NOT NULL,
  `version` int NOT NULL DEFAULT 1,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `ops_ad_mcp_campaign_daily_facts_id` PRIMARY KEY(`id`),
  CONSTRAINT `uk_ops_ad_mcp_campaign_daily_identity` UNIQUE(`workspaceId`, `profile_id`, `report_date`, `ad_type`, `campaign_id`)
);
--> statement-breakpoint
CREATE INDEX `idx_ops_ad_mcp_campaign_week_lookup` ON `ops_ad_mcp_campaign_daily_facts` (`workspaceId`, `source_store_id`, `country`, `report_date`);
--> statement-breakpoint
CREATE INDEX `idx_ops_ad_mcp_campaign_batch` ON `ops_ad_mcp_campaign_daily_facts` (`workspaceId`, `source_batch_id`);
--> statement-breakpoint

CREATE TABLE `ops_ad_mcp_product_daily_facts` (
  `workspaceId` int NOT NULL,
  `id` int AUTO_INCREMENT NOT NULL,
  `user_id` int NOT NULL,
  `profile_id` varchar(64) NOT NULL,
  `source_store_id` varchar(64) NOT NULL,
  `country` varchar(16) NOT NULL,
  `report_date` varchar(10) NOT NULL,
  `ad_type` varchar(12) NOT NULL,
  `campaign_id` varchar(80) NOT NULL,
  `campaign_name` varchar(500),
  `ad_group_id` varchar(80) NOT NULL,
  `ad_group_name` varchar(500),
  `ad_id` varchar(80) NOT NULL,
  `advertised_asin` varchar(20) NOT NULL,
  `advertised_sku` varchar(200),
  `creative_sku` varchar(200),
  `creative_resolved_asin` varchar(20),
  `parent_asin` varchar(20) NOT NULL,
  `mapping_status` varchar(48) NOT NULL,
  `mapping_evidence_date` varchar(10),
  `mapping_evidence_kind` varchar(64) NOT NULL,
  `currency` varchar(12),
  `impressions` bigint NOT NULL DEFAULT 0,
  `clicks` bigint NOT NULL DEFAULT 0,
  `spend` decimal(14,2) NOT NULL DEFAULT '0',
  `sales` decimal(14,2) NOT NULL DEFAULT '0',
  `orders` int NOT NULL DEFAULT 0,
  `source_batch_id` int NOT NULL,
  `source_row_hash` varchar(64) NOT NULL,
  `source_payload_hash` varchar(64) NOT NULL,
  `version` int NOT NULL DEFAULT 1,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `ops_ad_mcp_product_daily_facts_id` PRIMARY KEY(`id`),
  CONSTRAINT `uk_ops_ad_mcp_product_daily_identity` UNIQUE(`workspaceId`, `profile_id`, `report_date`, `ad_type`, `campaign_id`, `ad_group_id`, `ad_id`, `advertised_asin`)
);
--> statement-breakpoint
CREATE INDEX `idx_ops_ad_mcp_product_parent_week_lookup` ON `ops_ad_mcp_product_daily_facts` (`workspaceId`, `parent_asin`, `source_store_id`, `country`, `report_date`);
--> statement-breakpoint
CREATE INDEX `idx_ops_ad_mcp_product_child_week_lookup` ON `ops_ad_mcp_product_daily_facts` (`workspaceId`, `advertised_asin`, `source_store_id`, `country`, `report_date`);
--> statement-breakpoint
CREATE INDEX `idx_ops_ad_mcp_product_batch` ON `ops_ad_mcp_product_daily_facts` (`workspaceId`, `source_batch_id`);
--> statement-breakpoint

CREATE TABLE `ops_ad_mcp_fact_revisions` (
  `workspaceId` int NOT NULL,
  `id` int AUTO_INCREMENT NOT NULL,
  `fact_type` enum('campaign','product') NOT NULL,
  `fact_id` int NOT NULL,
  `source_batch_id` int NOT NULL,
  `previous_source_payload_hash` varchar(64),
  `next_source_payload_hash` varchar(64) NOT NULL,
  `changed_fields` json NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `ops_ad_mcp_fact_revisions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `idx_ops_ad_mcp_fact_revisions_fact` ON `ops_ad_mcp_fact_revisions` (`workspaceId`, `fact_type`, `fact_id`, `created_at`);
--> statement-breakpoint
CREATE INDEX `idx_ops_ad_mcp_fact_revisions_batch` ON `ops_ad_mcp_fact_revisions` (`workspaceId`, `source_batch_id`);
