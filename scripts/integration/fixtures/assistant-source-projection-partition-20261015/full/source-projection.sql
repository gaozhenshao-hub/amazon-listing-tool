-- SOURCE-DERIVED PROJECTION ONLY; NOT A PRODUCTION CLONE OR MIGRATION LEDGER.
-- source-schema-projection/1.0; excludes dedicated 0206/0207 tables; no business data or seeds.
CREATE TABLE `acquisition_asset_candidates` (
	`id` int AUTO_INCREMENT NOT NULL,
	`workspace_id` int NOT NULL,
	`snapshot_id` int NOT NULL,
	`source_artifact_id` int NOT NULL,
	`role` enum('main','secondary','aplus','brand_story','video','unknown') NOT NULL DEFAULT 'unknown',
	`position_index` int NOT NULL,
	`source_json_path` varchar(512) NOT NULL,
	`source_url_hash` varchar(64) NOT NULL,
	`provider_asset_id` varchar(255),
	`storage_key` varchar(1024),
	`content_hash` varchar(64),
	`content_type` varchar(128),
	`size_bytes` bigint,
	`width` int,
	`height` int,
	`module_type` varchar(64),
	`module_class` varchar(128),
	`field_status` varchar(64) NOT NULL,
	`review_status` enum('pending','approved','rejected') NOT NULL DEFAULT 'pending',
	`reviewed_by` int,
	`reviewed_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `acquisition_asset_candidates_id` PRIMARY KEY(`id`),
	CONSTRAINT `uk_acq_asset_snapshot_role_pos` UNIQUE(`snapshot_id`,`role`,`position_index`)
);

CREATE TABLE `acquisition_confirmed_snapshots` (
	`id` int AUTO_INCREMENT NOT NULL,
	`workspace_id` int NOT NULL,
	`snapshot_id` int NOT NULL,
	`revision_id` int,
	`marketplace` varchar(16) NOT NULL,
	`asin` varchar(20) NOT NULL,
	`confirmation_version` int NOT NULL,
	`content_hash` varchar(64) NOT NULL,
	`confirmed_data` json NOT NULL,
	`field_statuses` json NOT NULL,
	`confirmed_asset_ids` json NOT NULL,
	`is_current` int NOT NULL DEFAULT 1,
	`confirmed_by` int NOT NULL,
	`confirmed_at` timestamp NOT NULL DEFAULT (now()),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `acquisition_confirmed_snapshots_id` PRIMARY KEY(`id`),
	CONSTRAINT `uk_acq_confirmed_snapshot_ver` UNIQUE(`snapshot_id`,`confirmation_version`)
);

CREATE TABLE `acquisition_consumer_links` (
	`id` int AUTO_INCREMENT NOT NULL,
	`workspace_id` int NOT NULL,
	`confirmed_snapshot_id` int NOT NULL,
	`consumer_type` varchar(64) NOT NULL,
	`consumer_ref` varchar(128) NOT NULL,
	`capability_scope` varchar(64) NOT NULL,
	`projection_version` varchar(64) NOT NULL,
	`status` enum('active','superseded','detached') NOT NULL DEFAULT 'active',
	`created_by` int NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `acquisition_consumer_links_id` PRIMARY KEY(`id`),
	CONSTRAINT `uk_acq_consumer_link` UNIQUE(`workspace_id`,`consumer_type`,`consumer_ref`,`capability_scope`,`confirmed_snapshot_id`)
);

CREATE TABLE `acquisition_jobs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`workspace_id` int NOT NULL,
	`requested_by` int NOT NULL,
	`provider_profile_id` int,
	`consumer_type` varchar(64) NOT NULL,
	`consumer_ref` varchar(128) NOT NULL,
	`marketplace` varchar(16) NOT NULL,
	`asin` varchar(20) NOT NULL,
	`requested_capabilities` json NOT NULL,
	`idempotency_key` varchar(128) NOT NULL,
	`status` enum('queued','running','review_required','confirmed','failed','canceled') NOT NULL DEFAULT 'queued',
	`priority` int NOT NULL DEFAULT 100,
	`cache_policy` enum('prefer_cache','refresh','cache_only') NOT NULL DEFAULT 'prefer_cache',
	`max_charge_usd` decimal(12,4),
	`cache_hit_snapshot_id` int,
	`requested_at` timestamp NOT NULL DEFAULT (now()),
	`started_at` timestamp,
	`completed_at` timestamp,
	`expires_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `acquisition_jobs_id` PRIMARY KEY(`id`),
	CONSTRAINT `uk_acq_job_ws_idem` UNIQUE(`workspace_id`,`idempotency_key`)
);

CREATE TABLE `acquisition_provider_profiles` (
	`id` int AUTO_INCREMENT NOT NULL,
	`workspace_id` int NOT NULL,
	`profile_key` varchar(64) NOT NULL,
	`provider_code` varchar(64) NOT NULL,
	`display_name` varchar(128) NOT NULL,
	`status` enum('draft','qualification_pending','active','paused','rejected') NOT NULL DEFAULT 'draft',
	`secret_ref` varchar(255),
	`actor_name` varchar(255),
	`capabilities` json NOT NULL,
	`provider_settings` json,
	`per_run_max_usd` decimal(12,4),
	`daily_budget_usd` decimal(12,4),
	`monthly_budget_usd` decimal(12,4),
	`cache_ttl_seconds` int NOT NULL DEFAULT 86400,
	`qualification_version` varchar(64),
	`last_qualified_at` timestamp,
	`created_by` int NOT NULL,
	`updated_by` int NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `acquisition_provider_profiles_id` PRIMARY KEY(`id`),
	CONSTRAINT `uk_acq_profile_ws_key` UNIQUE(`workspace_id`,`profile_key`)
);

CREATE TABLE `acquisition_raw_artifacts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`workspace_id` int NOT NULL,
	`run_id` int NOT NULL,
	`artifact_kind` varchar(64) NOT NULL,
	`storage_key` varchar(1024) NOT NULL,
	`content_hash` varchar(64) NOT NULL,
	`content_type` varchar(128) NOT NULL,
	`size_bytes` bigint NOT NULL,
	`schema_fingerprint` varchar(64),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `acquisition_raw_artifacts_id` PRIMARY KEY(`id`),
	CONSTRAINT `uk_acq_artifact_run_hash` UNIQUE(`run_id`,`artifact_kind`,`content_hash`)
);

CREATE TABLE `acquisition_runs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`workspace_id` int NOT NULL,
	`job_id` int NOT NULL,
	`provider_profile_id` int NOT NULL,
	`attempt` int NOT NULL,
	`provider_run_id` varchar(128),
	`provider_request_hash` varchar(64) NOT NULL,
	`status` enum('queued','running','succeeded','partial','failed','canceled') NOT NULL DEFAULT 'queued',
	`failure_category` varchar(64),
	`estimated_max_usd` decimal(12,4),
	`charged_usd` decimal(12,4),
	`result_count` int,
	`started_at` timestamp,
	`completed_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `acquisition_runs_id` PRIMARY KEY(`id`),
	CONSTRAINT `uk_acq_run_job_attempt` UNIQUE(`job_id`,`attempt`)
);

CREATE TABLE `acquisition_snapshot_revisions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`workspace_id` int NOT NULL,
	`snapshot_id` int NOT NULL,
	`version` int NOT NULL,
	`base_content_hash` varchar(64) NOT NULL,
	`patch` json NOT NULL,
	`revision_hash` varchar(64) NOT NULL,
	`reason_code` varchar(64) NOT NULL,
	`note` text,
	`created_by` int NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `acquisition_snapshot_revisions_id` PRIMARY KEY(`id`),
	CONSTRAINT `uk_acq_revision_snapshot_ver` UNIQUE(`snapshot_id`,`version`)
);

CREATE TABLE `acquisition_source_snapshots` (
	`id` int AUTO_INCREMENT NOT NULL,
	`workspace_id` int NOT NULL,
	`job_id` int NOT NULL,
	`run_id` int NOT NULL,
	`raw_artifact_id` int NOT NULL,
	`marketplace` varchar(16) NOT NULL,
	`asin` varchar(20) NOT NULL,
	`schema_version` varchar(64) NOT NULL,
	`source_hash` varchar(64) NOT NULL,
	`normalized_data` json NOT NULL,
	`field_statuses` json NOT NULL,
	`completeness` json,
	`status` enum('draft','pending_review','confirmed','rejected','superseded') NOT NULL DEFAULT 'draft',
	`reviewed_by` int,
	`reviewed_at` timestamp,
	`review_note` text,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `acquisition_source_snapshots_id` PRIMARY KEY(`id`),
	CONSTRAINT `uk_acq_snapshot_run_source` UNIQUE(`run_id`,`source_hash`)
);

CREATE TABLE `ad_analysis_tasks` (
	`workspaceId` int,
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

CREATE TABLE `ad_automation_rules` (
	`workspaceId` int,
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

CREATE TABLE `ad_campaign_reports` (
	`workspaceId` int,
	`id` int AUTO_INCREMENT NOT NULL,
	`upload_id` int NOT NULL,
	`user_id` int NOT NULL,
	`product_id` int,
	`parent_asin` varchar(20),
	`week_start_date` varchar(10) NOT NULL,
	`week_end_date` varchar(10) NOT NULL,
	`store_name` varchar(200),
	`country` varchar(50),
	`ad_type` varchar(10) NOT NULL,
	`portfolio_name` varchar(300),
	`campaign_name` varchar(500) NOT NULL,
	`effective_status` varchar(50),
	`budget` decimal(10,2),
	`impressions` int DEFAULT 0,
	`impression_share` varchar(20),
	`clicks` int DEFAULT 0,
	`ctr` decimal(8,4),
	`cpc` decimal(10,2),
	`spend` decimal(12,2),
	`sales` decimal(12,2),
	`direct_sales` decimal(12,2),
	`indirect_sales` decimal(12,2),
	`acos` decimal(8,4),
	`roas` decimal(8,2),
	`orders` int DEFAULT 0,
	`direct_orders` int DEFAULT 0,
	`indirect_orders` int DEFAULT 0,
	`indirect_order_ratio` decimal(6,4),
	`cpa` decimal(10,2),
	`cvr` decimal(8,4),
	`avg_order_value` decimal(10,2),
	`direct_avg_order_value` decimal(10,2),
	`indirect_avg_order_value` decimal(10,2),
	`brand_new_orders` int DEFAULT 0,
	`brand_new_cvr` decimal(8,4),
	`brand_new_sales` decimal(12,2),
	`brand_new_sales_qty` int DEFAULT 0,
	`ad_sales_qty` int DEFAULT 0,
	`direct_sales_qty` int DEFAULT 0,
	`indirect_sales_qty` int DEFAULT 0,
	`vcpm` decimal(10,2),
	`viewable_impressions` int DEFAULT 0,
	`dpv` int DEFAULT 0,
	`five_sec_views` int DEFAULT 0,
	`five_sec_view_rate` decimal(8,4),
	`video_quarter` int DEFAULT 0,
	`video_half` int DEFAULT 0,
	`video_three_quarter` int DEFAULT 0,
	`video_complete` int DEFAULT 0,
	`video_unmute` int DEFAULT 0,
	`vtr` decimal(8,4),
	`vctr` decimal(8,4),
	`brand_search_count` int DEFAULT 0,
	`avg_reach` decimal(8,2),
	`cumulative_reach` int DEFAULT 0,
	`tags` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `ad_campaign_reports_id` PRIMARY KEY(`id`)
);

CREATE TABLE `ad_clinic_records` (
	`workspaceId` int,
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`portfolio_names` text,
	`date_range_start` varchar(10),
	`date_range_end` varchar(10),
	`symptom_category` varchar(50),
	`symptom_description` text,
	`additional_context` text,
	`diagnosis` text,
	`prescription` text,
	`user_edits` text,
	`status` enum('consulting','diagnosed','treating','resolved','archived') NOT NULL DEFAULT 'consulting',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `ad_clinic_records_id` PRIMARY KEY(`id`)
);

CREATE TABLE `ad_competitor_ranks` (
	`workspaceId` int,
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

CREATE TABLE `ad_daily_business_reports` (
	`workspaceId` int,
	`id` int AUTO_INCREMENT NOT NULL,
	`upload_id` int NOT NULL,
	`user_id` int NOT NULL,
	`product_id` int,
	`parent_asin` varchar(20),
	`child_asin` varchar(20),
	`report_date` varchar(10) NOT NULL,
	`store_name` varchar(200),
	`country` varchar(50),
	`sku` varchar(100),
	`product_name` varchar(500),
	`sessions` int DEFAULT 0,
	`session_percentage` decimal(8,4),
	`page_views` int DEFAULT 0,
	`page_views_percentage` decimal(8,4),
	`buy_box_percentage` decimal(8,4),
	`units_ordered` int DEFAULT 0,
	`units_ordered_b2b` int DEFAULT 0,
	`unit_session_percentage` decimal(8,4),
	`unit_session_percentage_b2b` decimal(8,4),
	`ordered_product_sales` decimal(12,2),
	`ordered_product_sales_b2b` decimal(12,2),
	`total_order_items` int DEFAULT 0,
	`total_order_items_b2b` int DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `ad_daily_business_reports_id` PRIMARY KEY(`id`)
);

CREATE TABLE `ad_daily_impression_share_reports` (
	`workspaceId` int,
	`id` int AUTO_INCREMENT NOT NULL,
	`upload_id` int NOT NULL,
	`user_id` int NOT NULL,
	`product_id` int,
	`parent_asin` varchar(20),
	`report_date` varchar(10) NOT NULL,
	`store_name` varchar(200),
	`country` varchar(50),
	`ad_type` varchar(10) DEFAULT 'SP',
	`portfolio_name` varchar(300),
	`campaign_name` varchar(500),
	`ad_group_name` varchar(500),
	`targeting` varchar(500),
	`search_term` varchar(500),
	`impression_share` decimal(8,4),
	`impression_rank` int,
	`impressions` int DEFAULT 0,
	`clicks` int DEFAULT 0,
	`ctr` decimal(8,4),
	`spend` decimal(12,2),
	`sales` decimal(12,2),
	`acos` decimal(8,4),
	`orders` int DEFAULT 0,
	`top_competitor_share` decimal(8,4),
	`top_competitor_asin` varchar(20),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `ad_daily_impression_share_reports_id` PRIMARY KEY(`id`)
);

CREATE TABLE `ad_daily_placement_reports` (
	`workspaceId` int,
	`id` int AUTO_INCREMENT NOT NULL,
	`upload_id` int NOT NULL,
	`user_id` int NOT NULL,
	`product_id` int,
	`parent_asin` varchar(20),
	`report_date` varchar(10) NOT NULL,
	`store_name` varchar(200),
	`country` varchar(50),
	`ad_type` varchar(10) NOT NULL,
	`portfolio_name` varchar(300),
	`campaign_name` varchar(500) NOT NULL,
	`placement` varchar(100) NOT NULL,
	`impressions` int DEFAULT 0,
	`clicks` int DEFAULT 0,
	`ctr` decimal(8,4),
	`cpc` decimal(10,2),
	`spend` decimal(12,2),
	`sales` decimal(12,2),
	`direct_sales` decimal(12,2),
	`indirect_sales` decimal(12,2),
	`acos` decimal(8,4),
	`roas` decimal(8,2),
	`orders` int DEFAULT 0,
	`direct_orders` int DEFAULT 0,
	`indirect_orders` int DEFAULT 0,
	`cvr` decimal(8,4),
	`cpa` decimal(10,2),
	`brand_new_orders` int DEFAULT 0,
	`brand_new_sales` decimal(12,2),
	`viewable_impressions` int DEFAULT 0,
	`vtr` decimal(8,4),
	`vctr` decimal(8,4),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `ad_daily_placement_reports_id` PRIMARY KEY(`id`)
);

CREATE TABLE `ad_daily_sb_benchmark_reports` (
	`workspaceId` int,
	`id` int AUTO_INCREMENT NOT NULL,
	`upload_id` int NOT NULL,
	`user_id` int NOT NULL,
	`product_id` int,
	`parent_asin` varchar(20),
	`report_date` varchar(10) NOT NULL,
	`store_name` varchar(200),
	`country` varchar(50),
	`campaign_name` varchar(500) NOT NULL,
	`ad_format` varchar(50),
	`impressions` int DEFAULT 0,
	`clicks` int DEFAULT 0,
	`ctr` decimal(8,4),
	`cpc` decimal(10,2),
	`spend` decimal(12,2),
	`sales` decimal(12,2),
	`acos` decimal(8,4),
	`roas` decimal(8,2),
	`orders` int DEFAULT 0,
	`dpv` int DEFAULT 0,
	`new_to_brand_orders` int DEFAULT 0,
	`new_to_brand_sales` decimal(12,2),
	`new_to_brand_rate` decimal(8,4),
	`benchmark_ctr` decimal(8,4),
	`benchmark_cpc` decimal(10,2),
	`benchmark_acos` decimal(8,4),
	`benchmark_roas` decimal(8,2),
	`benchmark_cvr` decimal(8,4),
	`benchmark_dpv_rate` decimal(8,4),
	`benchmark_new_to_brand_rate` decimal(8,4),
	`ctr_vs_benchmark` varchar(20),
	`cpc_vs_benchmark` varchar(20),
	`acos_vs_benchmark` varchar(20),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `ad_daily_sb_benchmark_reports_id` PRIMARY KEY(`id`)
);

CREATE TABLE `ad_daily_search_term_reports` (
	`workspaceId` int,
	`id` int AUTO_INCREMENT NOT NULL,
	`upload_id` int NOT NULL,
	`user_id` int NOT NULL,
	`product_id` int,
	`parent_asin` varchar(20),
	`report_date` varchar(10) NOT NULL,
	`store_name` varchar(200),
	`country` varchar(50),
	`ad_type` varchar(10) NOT NULL,
	`portfolio_name` varchar(300),
	`campaign_name` varchar(500),
	`ad_group_name` varchar(500),
	`keyword` varchar(500),
	`match_type` varchar(20),
	`targeting` varchar(500),
	`search_term` varchar(500) NOT NULL,
	`impressions` int DEFAULT 0,
	`clicks` int DEFAULT 0,
	`ctr` decimal(8,4),
	`cpc` decimal(10,2),
	`spend` decimal(12,2),
	`sales` decimal(12,2),
	`direct_sales` decimal(12,2),
	`indirect_sales` decimal(12,2),
	`acos` decimal(8,4),
	`roas` decimal(8,2),
	`orders` int DEFAULT 0,
	`direct_orders` int DEFAULT 0,
	`indirect_orders` int DEFAULT 0,
	`cvr` decimal(8,4),
	`cpa` decimal(10,2),
	`avg_order_value` decimal(10,2),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `ad_daily_search_term_reports_id` PRIMARY KEY(`id`)
);

CREATE TABLE `ad_diagnoses` (
	`workspaceId` int,
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`portfolio_names` text,
	`date_range_start` varchar(10) NOT NULL,
	`date_range_end` varchar(10) NOT NULL,
	`diagnosis_result` text,
	`overall_verdict` text,
	`priority_actions` text,
	`warning` text,
	`user_edits` text,
	`status` enum('draft','confirmed','archived') NOT NULL DEFAULT 'draft',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `ad_diagnoses_id` PRIMARY KEY(`id`)
);

CREATE TABLE `ad_dsp_reports` (
	`workspaceId` int,
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`upload_id` int NOT NULL,
	`product_id` int,
	`week_start_date` varchar(10),
	`week_end_date` varchar(10),
	`order_name` varchar(500),
	`order_budget` decimal(12,2) DEFAULT '0',
	`order_status` varchar(50),
	`spends` decimal(12,2) DEFAULT '0',
	`sales` decimal(12,2) DEFAULT '0',
	`orders` int DEFAULT 0,
	`impressions` int DEFAULT 0,
	`viewable_impressions` int DEFAULT 0,
	`clicks` int DEFAULT 0,
	`dpv` int DEFAULT 0,
	`total_add_to_cart` int DEFAULT 0,
	`roas` decimal(8,2) DEFAULT '0',
	`acos` decimal(8,2) DEFAULT '0',
	`ctr` decimal(8,4) DEFAULT '0',
	`line_item_type` varchar(100),
	`creative_type` varchar(100),
	`store_name` varchar(200),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `ad_dsp_reports_id` PRIMARY KEY(`id`)
);

CREATE TABLE `ad_hourly_reports` (
	`workspaceId` int,
	`id` int AUTO_INCREMENT NOT NULL,
	`upload_id` int NOT NULL,
	`user_id` int NOT NULL,
	`product_id` int,
	`parent_asin` varchar(20),
	`hour` int NOT NULL,
	`report_date` varchar(10),
	`currency` varchar(10),
	`account_name` varchar(200),
	`portfolio_name` varchar(300),
	`campaign_name` varchar(500),
	`campaign_id` varchar(100),
	`ad_group_name` varchar(500),
	`ad_group_id` varchar(100),
	`targeting_value` varchar(500),
	`search_term` varchar(500),
	`promoted_sku` varchar(100),
	`promoted_asin` varchar(20),
	`placement_name` varchar(200),
	`placement_classification` varchar(100),
	`impressions` int DEFAULT 0,
	`invalid_impressions` int DEFAULT 0,
	`clicks` int DEFAULT 0,
	`invalid_clicks` int DEFAULT 0,
	`ctr` decimal(8,4),
	`cpc` decimal(10,2),
	`cpm` decimal(10,2),
	`vcpm` decimal(10,2),
	`vctr` decimal(8,4),
	`spend` decimal(12,2),
	`purchases` int DEFAULT 0,
	`sales` decimal(12,2),
	`cost_per_purchase` decimal(10,2),
	`purchase_rate` decimal(8,4),
	`roas` decimal(8,2),
	`click_purchases` int DEFAULT 0,
	`click_roas` decimal(8,2),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `ad_hourly_reports_id` PRIMARY KEY(`id`)
);

CREATE TABLE `ad_keyword_meta` (
	`workspaceId` int,
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

CREATE TABLE `ad_keyword_tiers` (
	`workspaceId` int,
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`portfolio_names` text,
	`date_range_start` varchar(10) NOT NULL,
	`date_range_end` varchar(10) NOT NULL,
	`keyword` varchar(500) NOT NULL,
	`tier` varchar(20) NOT NULL,
	`role` varchar(20),
	`current_performance` varchar(20),
	`daily_trend` varchar(20),
	`anomaly_dates` text,
	`action` text,
	`bid_suggestion` text,
	`priority` varchar(10),
	`reason` text,
	`user_edited` int DEFAULT 0,
	`user_action` text,
	`status` enum('pending','confirmed','ignored') NOT NULL DEFAULT 'pending',
	`batch_id` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `ad_keyword_tiers_id` PRIMARY KEY(`id`)
);

CREATE TABLE `ad_keyword_weekly` (
	`workspaceId` int,
	`id` int AUTO_INCREMENT NOT NULL,
	`import_id` int NOT NULL,
	`user_id` int NOT NULL,
	`source_profile_id` varchar(64),
	`source_identity_hash` varchar(64),
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
	`brand_search_count` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `ad_keyword_weekly_id` PRIMARY KEY(`id`),
	CONSTRAINT `uk_ad_keyword_workspace_source_identity` UNIQUE(`workspaceId`,`source_identity_hash`)
);

CREATE TABLE `ad_order_hourly` (
	`workspaceId` int,
	`id` int AUTO_INCREMENT NOT NULL,
	`upload_id` int NOT NULL,
	`user_id` int NOT NULL,
	`product_id` int,
	`parent_asin` varchar(20),
	`order_id` varchar(50) NOT NULL,
	`order_status` varchar(50),
	`order_type` varchar(20),
	`order_date` timestamp NOT NULL,
	`order_hour` int NOT NULL,
	`order_day_of_week` int NOT NULL,
	`order_date_str` varchar(10) NOT NULL,
	`store_name` varchar(200),
	`country` varchar(50),
	`asin` varchar(20),
	`sku` varchar(100),
	`msku` varchar(100),
	`product_name` varchar(500),
	`quantity` int DEFAULT 1,
	`unit_price` decimal(10,2),
	`sales_revenue` decimal(10,2),
	`item_price` decimal(10,2),
	`currency` varchar(10),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `ad_order_hourly_id` PRIMARY KEY(`id`)
);

CREATE TABLE `ad_placement_reports` (
	`workspaceId` int,
	`id` int AUTO_INCREMENT NOT NULL,
	`upload_id` int NOT NULL,
	`user_id` int NOT NULL,
	`product_id` int,
	`parent_asin` varchar(20),
	`week_start_date` varchar(10) NOT NULL,
	`week_end_date` varchar(10) NOT NULL,
	`store_name` varchar(200),
	`country` varchar(50),
	`ad_type` varchar(10) NOT NULL,
	`portfolio_name` varchar(300),
	`campaign_name` varchar(500) NOT NULL,
	`placement` varchar(100) NOT NULL,
	`impressions` int DEFAULT 0,
	`clicks` int DEFAULT 0,
	`ctr` decimal(8,4),
	`cpc` decimal(10,2),
	`spend` decimal(12,2),
	`sales` decimal(12,2),
	`direct_sales` decimal(12,2),
	`indirect_sales` decimal(12,2),
	`acos` decimal(8,4),
	`roas` decimal(8,2),
	`orders` int DEFAULT 0,
	`direct_orders` int DEFAULT 0,
	`indirect_orders` int DEFAULT 0,
	`indirect_order_ratio` decimal(6,4),
	`cpa` decimal(10,2),
	`cvr` decimal(8,4),
	`avg_order_value` decimal(10,2),
	`direct_avg_order_value` decimal(10,2),
	`indirect_avg_order_value` decimal(10,2),
	`brand_new_orders` int DEFAULT 0,
	`brand_new_cvr` decimal(8,4),
	`brand_new_sales` decimal(12,2),
	`brand_new_sales_qty` int DEFAULT 0,
	`ad_sales_qty` int DEFAULT 0,
	`direct_sales_qty` int DEFAULT 0,
	`indirect_sales_qty` int DEFAULT 0,
	`viewable_impressions` int DEFAULT 0,
	`dpv` int DEFAULT 0,
	`five_sec_views` int DEFAULT 0,
	`five_sec_view_rate` decimal(8,4),
	`video_quarter` int DEFAULT 0,
	`video_half` int DEFAULT 0,
	`video_three_quarter` int DEFAULT 0,
	`video_complete` int DEFAULT 0,
	`video_unmute` int DEFAULT 0,
	`vtr` decimal(8,4),
	`vctr` decimal(8,4),
	`brand_search_count` int DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `ad_placement_reports_id` PRIMARY KEY(`id`)
);

CREATE TABLE `ad_portfolio_mappings` (
	`workspaceId` int,
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

CREATE TABLE `ad_product_stages` (
	`workspaceId` int,
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`portfolio_names` text,
	`parent_asin` varchar(20),
	`date_range_start` varchar(10) NOT NULL,
	`date_range_end` varchar(10) NOT NULL,
	`stage` varchar(20) NOT NULL,
	`confidence` int DEFAULT 0,
	`evidence` text,
	`red_flags` text,
	`daily_highlights` text,
	`strategy` text,
	`transition_signals` text,
	`user_edits` text,
	`status` enum('draft','confirmed','archived') NOT NULL DEFAULT 'draft',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `ad_product_stages_id` PRIMARY KEY(`id`)
);

CREATE TABLE `ad_report_analysis_records` (
	`workspaceId` int,
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`report_type` varchar(30) NOT NULL,
	`portfolio_names` text,
	`date_range_start` varchar(10) NOT NULL,
	`date_range_end` varchar(10) NOT NULL,
	`analysis_result` text,
	`action_items` text,
	`user_edits` text,
	`status` enum('draft','confirmed','archived') NOT NULL DEFAULT 'draft',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `ad_report_analysis_records_id` PRIMARY KEY(`id`)
);

CREATE TABLE `ad_report_imports` (
	`workspaceId` int,
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

CREATE TABLE `ad_report_uploads` (
	`workspaceId` int,
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`report_type` enum('search_term','campaign','placement','hourly','order','dsp','daily_placement','daily_search_term','daily_impression_share','daily_sb_benchmark','daily_business') NOT NULL,
	`file_name` varchar(500) NOT NULL,
	`file_url` text,
	`week_start_date` varchar(10),
	`week_end_date` varchar(10),
	`date_label` varchar(50),
	`total_rows` int DEFAULT 0,
	`imported_rows` int DEFAULT 0,
	`store_name` varchar(200),
	`upload_status` enum('pending','parsing','completed','failed') NOT NULL DEFAULT 'pending',
	`error_message` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `ad_report_uploads_id` PRIMARY KEY(`id`)
);

CREATE TABLE `ad_search_term_reports` (
	`workspaceId` int,
	`id` int AUTO_INCREMENT NOT NULL,
	`upload_id` int NOT NULL,
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
	`keyword` varchar(500),
	`match_type` varchar(20),
	`targeting` varchar(500),
	`search_term` varchar(500) NOT NULL,
	`impressions` int DEFAULT 0,
	`clicks` int DEFAULT 0,
	`ctr` decimal(8,4),
	`cpc` decimal(10,2),
	`spend` decimal(12,2),
	`sales` decimal(12,2),
	`direct_sales` decimal(12,2),
	`indirect_sales` decimal(12,2),
	`acos` decimal(8,4),
	`roas` decimal(8,2),
	`orders` int DEFAULT 0,
	`direct_orders` int DEFAULT 0,
	`indirect_orders` int DEFAULT 0,
	`indirect_order_ratio` decimal(6,4),
	`cpa` decimal(10,2),
	`cvr` decimal(8,4),
	`avg_order_value` decimal(10,2),
	`direct_avg_order_value` decimal(10,2),
	`indirect_avg_order_value` decimal(10,2),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `ad_search_term_reports_id` PRIMARY KEY(`id`)
);

CREATE TABLE `ad_sop_tasks` (
	`workspaceId` int,
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`portfolio_names` text,
	`period` varchar(20) NOT NULL,
	`category` varchar(50) NOT NULL,
	`title` varchar(500) NOT NULL,
	`description` text,
	`evidence` text,
	`priority` varchar(10),
	`status` enum('pending','in_progress','completed','skipped') NOT NULL DEFAULT 'pending',
	`completedAt` timestamp,
	`completed_note` text,
	`source_module` varchar(30),
	`source_record_id` int,
	`due_date` varchar(10),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `ad_sop_tasks_id` PRIMARY KEY(`id`)
);

CREATE TABLE `adStructures` (
	`id` int AUTO_INCREMENT NOT NULL,
	`projectId` int NOT NULL,
	`userId` int NOT NULL,
	`structureData` text,
	`structureDataCn` text,
	`keywordCount` int DEFAULT 0,
	`campaignCount` int DEFAULT 0,
	`status` enum('generating','completed','failed') NOT NULL DEFAULT 'generating',
	`errorMessage` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `adStructures_id` PRIMARY KEY(`id`)
);

CREATE TABLE `ai_artifact_consumptions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`consumptionId` varchar(80) NOT NULL,
	`workspaceId` int,
	`projectId` int,
	`artifactId` varchar(80) NOT NULL,
	`artifactKey` varchar(128) NOT NULL,
	`artifactVersion` int NOT NULL,
	`artifactRef` varchar(192) NOT NULL,
	`consumerDomain` enum('listing','image','ads','video','agent','project','file','ops','tool','other') NOT NULL,
	`consumerType` enum('agent_node','ai_job','skill_run','business_operation') NOT NULL,
	`consumerId` varchar(128) NOT NULL,
	`runId` varchar(80),
	`nodeId` varchar(128),
	`metadata` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `ai_artifact_consumptions_id` PRIMARY KEY(`id`),
	CONSTRAINT `ai_artifact_consumptions_consumptionId_unique` UNIQUE(`consumptionId`)
);

CREATE TABLE `ai_artifact_selection_events` (
	`id` int AUTO_INCREMENT NOT NULL,
	`selectionId` varchar(80) NOT NULL,
	`workspaceId` int,
	`projectId` int,
	`artifactKey` varchar(128) NOT NULL,
	`sourceTable` varchar(128),
	`sourceRowId` varchar(128),
	`fromArtifactId` varchar(80),
	`fromVersion` int,
	`toArtifactId` varchar(80) NOT NULL,
	`toVersion` int NOT NULL,
	`action` enum('select','rollback','confirm') NOT NULL,
	`userId` int,
	`reason` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `ai_artifact_selection_events_id` PRIMARY KEY(`id`),
	CONSTRAINT `ai_artifact_selection_events_selectionId_unique` UNIQUE(`selectionId`)
);

CREATE TABLE `ai_artifacts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`workspaceId` int,
	`artifactId` varchar(80) NOT NULL,
	`domain` enum('listing','image','ads','video','agent','project','file','ops','tool','other') NOT NULL DEFAULT 'other',
	`artifactKey` varchar(128) NOT NULL,
	`artifactType` enum('json','text','markdown','html','image','file','table','video','audio','other') NOT NULL DEFAULT 'json',
	`sourceType` enum('upload','ai_output','user_edit','import','tool_output','system','archive') NOT NULL DEFAULT 'ai_output',
	`sourceId` varchar(128),
	`sourceTable` varchar(128),
	`sourceRowId` varchar(128),
	`runId` varchar(80),
	`agentSlug` varchar(128),
	`nodeId` varchar(128),
	`projectId` int,
	`userId` int,
	`status` enum('draft','final','superseded','archived','deleted') NOT NULL DEFAULT 'draft',
	`version` int NOT NULL DEFAULT 1,
	`isCurrent` int NOT NULL DEFAULT 0,
	`parentArtifactId` varchar(80),
	`selectedBy` int,
	`currentSince` timestamp,
	`contentJson` json,
	`searchableText` text,
	`summary` text,
	`contentHash` varchar(64),
	`storageObjectId` int,
	`storageUri` text,
	`mimeType` varchar(128),
	`fileName` varchar(255),
	`fileSizeBytes` bigint,
	`retentionClass` enum('hot','warm','cold','archive') NOT NULL DEFAULT 'hot',
	`retainUntil` timestamp,
	`archiveAfter` timestamp,
	`deleteAfter` timestamp,
	`archivedAt` timestamp,
	`metadata` json,
	`sourceSkillRunId` varchar(80),
	`sourceAiJobRunId` varchar(80),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `ai_artifacts_id` PRIMARY KEY(`id`),
	CONSTRAINT `ai_artifacts_artifactId_unique` UNIQUE(`artifactId`)
);

CREATE TABLE `ai_data_archive_items` (
	`id` int AUTO_INCREMENT NOT NULL,
	`workspaceId` int,
	`archiveRunId` varchar(80) NOT NULL,
	`sourceTable` varchar(128) NOT NULL,
	`sourceId` varchar(128) NOT NULL,
	`sourceCreatedAt` timestamp,
	`storageObjectId` int,
	`contentHash` varchar(64),
	`status` enum('archived','deleted','failed') NOT NULL DEFAULT 'archived',
	`metadata` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `ai_data_archive_items_id` PRIMARY KEY(`id`)
);

CREATE TABLE `ai_data_archive_runs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`workspaceId` int,
	`archiveRunId` varchar(80) NOT NULL,
	`policySlug` varchar(128) NOT NULL,
	`tableName` varchar(128) NOT NULL,
	`status` enum('planned','running','succeeded','failed','dry_run') NOT NULL DEFAULT 'planned',
	`mode` enum('count','archive','delete') NOT NULL DEFAULT 'archive',
	`cutoffAt` timestamp,
	`batchSize` int NOT NULL DEFAULT 1000,
	`candidateCount` int NOT NULL DEFAULT 0,
	`archivedCount` int NOT NULL DEFAULT 0,
	`deletedCount` int NOT NULL DEFAULT 0,
	`storageObjectId` int,
	`storageUri` text,
	`errorMessage` text,
	`metadata` json,
	`createdBy` int,
	`startedAt` timestamp,
	`completedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `ai_data_archive_runs_id` PRIMARY KEY(`id`),
	CONSTRAINT `ai_data_archive_runs_archiveRunId_unique` UNIQUE(`archiveRunId`)
);

CREATE TABLE `ai_job_dead_letters` (
	`id` int AUTO_INCREMENT NOT NULL,
	`workspaceId` int,
	`runId` varchar(80) NOT NULL,
	`kind` varchar(128) NOT NULL,
	`module` varchar(64) NOT NULL,
	`procedure` varchar(128),
	`status` varchar(40),
	`attempt` int NOT NULL DEFAULT 0,
	`maxAttempts` int NOT NULL DEFAULT 1,
	`userId` int,
	`projectId` int,
	`skillSlug` varchar(128),
	`errorMessage` text,
	`input` json,
	`metadata` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `ai_job_dead_letters_id` PRIMARY KEY(`id`),
	CONSTRAINT `ai_job_dead_letters_runId_unique` UNIQUE(`runId`)
);

CREATE TABLE `ai_job_workers` (
	`id` int AUTO_INCREMENT NOT NULL,
	`workerId` varchar(128) NOT NULL,
	`hostname` varchar(255),
	`pid` int,
	`role` varchar(64) NOT NULL DEFAULT 'worker',
	`status` enum('active','draining','stopped','unhealthy') NOT NULL DEFAULT 'active',
	`concurrency` int NOT NULL DEFAULT 1,
	`runningCount` int NOT NULL DEFAULT 0,
	`lastHeartbeatAt` timestamp,
	`startedAt` timestamp NOT NULL DEFAULT (now()),
	`stoppedAt` timestamp,
	`metadata` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `ai_job_workers_id` PRIMARY KEY(`id`),
	CONSTRAINT `ai_job_workers_workerId_unique` UNIQUE(`workerId`)
);

CREATE TABLE `ai_jobs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`workspaceId` int,
	`runId` varchar(80) NOT NULL,
	`kind` varchar(128) NOT NULL,
	`module` varchar(64) NOT NULL,
	`procedure` varchar(128),
	`status` enum('queued','running','succeeded','failed','canceled') NOT NULL DEFAULT 'queued',
	`progress` int NOT NULL DEFAULT 0,
	`priority` int NOT NULL DEFAULT 0,
	`queueName` varchar(64) NOT NULL DEFAULT 'default',
	`attempt` int NOT NULL DEFAULT 0,
	`maxAttempts` int NOT NULL DEFAULT 1,
	`timeoutSeconds` int NOT NULL DEFAULT 600,
	`userId` int NOT NULL,
	`projectId` int,
	`skillSlug` varchar(128),
	`input` json,
	`output` json,
	`errorMessage` text,
	`retentionClass` enum('hot','warm','cold','archive') NOT NULL DEFAULT 'hot',
	`archiveAfter` timestamp,
	`deleteAfter` timestamp,
	`archivedAt` timestamp,
	`archiveBatchId` varchar(80),
	`nextRunAt` timestamp,
	`leaseUntil` timestamp,
	`lockedBy` varchar(128),
	`claimedAt` timestamp,
	`lastHeartbeatAt` timestamp,
	`deadLetterAt` timestamp,
	`deadLetterReason` text,
	`recoveryOfRunId` varchar(80),
	`recoveryReason` text,
	`startedAt` timestamp,
	`completedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `ai_jobs_id` PRIMARY KEY(`id`),
	CONSTRAINT `ai_jobs_runId_unique` UNIQUE(`runId`)
);

CREATE TABLE `ai_operational_alerts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`alertId` varchar(80) NOT NULL,
	`fingerprint` varchar(191) NOT NULL,
	`category` varchar(64) NOT NULL,
	`severity` enum('warning','critical') NOT NULL DEFAULT 'warning',
	`status` enum('open','resolved') NOT NULL DEFAULT 'open',
	`title` varchar(255) NOT NULL,
	`message` text NOT NULL,
	`occurrenceCount` int NOT NULL DEFAULT 1,
	`firstOccurredAt` timestamp NOT NULL DEFAULT (now()),
	`lastOccurredAt` timestamp NOT NULL DEFAULT (now()),
	`notifiedAt` timestamp,
	`resolvedAt` timestamp,
	`metadata` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `ai_operational_alerts_id` PRIMARY KEY(`id`),
	CONSTRAINT `ai_operational_alerts_alertId_unique` UNIQUE(`alertId`),
	CONSTRAINT `ai_operational_alerts_fingerprint_unique` UNIQUE(`fingerprint`)
);

CREATE TABLE `ai_storage_objects` (
	`id` int AUTO_INCREMENT NOT NULL,
	`workspaceId` int,
	`storageId` varchar(80) NOT NULL,
	`provider` enum('forge','s3','oss','local','external') NOT NULL DEFAULT 'forge',
	`bucket` varchar(128),
	`objectKey` text NOT NULL,
	`storageUri` text NOT NULL,
	`publicUrl` text,
	`mimeType` varchar(128),
	`fileName` varchar(255),
	`sizeBytes` bigint,
	`contentHash` varchar(64),
	`contentEncoding` varchar(64),
	`sourceDomain` enum('listing','image','ads','video','agent','project','file','ops','tool','other') NOT NULL DEFAULT 'other',
	`sourceType` enum('upload','ai_output','user_edit','import','tool_output','system','archive') NOT NULL DEFAULT 'upload',
	`sourceId` varchar(128),
	`lifecycleState` enum('hot','warm','cold','archived','deleted') NOT NULL DEFAULT 'hot',
	`retainUntil` timestamp,
	`archiveAfter` timestamp,
	`deleteAfter` timestamp,
	`archivedAt` timestamp,
	`metadata` json,
	`createdBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `ai_storage_objects_id` PRIMARY KEY(`id`),
	CONSTRAINT `ai_storage_objects_storageId_unique` UNIQUE(`storageId`)
);

CREATE TABLE `amazon_monitor_runs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`workspace_id` int NOT NULL,
	`monitor_kind` enum('competitor','keyword') NOT NULL,
	`monitor_id` int,
	`trigger_type` enum('manual','schedule','qualification') NOT NULL,
	`provider_profile_id` int NOT NULL,
	`requested_by` int NOT NULL,
	`marketplace` varchar(16) NOT NULL,
	`asin` varchar(20) NOT NULL,
	`keyword` varchar(500),
	`postal_code` varchar(20),
	`depth` int,
	`requested_capabilities` json NOT NULL,
	`idempotency_key` varchar(128) NOT NULL,
	`status` enum('queued','running','succeeded','partial','failed','canceled') NOT NULL DEFAULT 'queued',
	`provider_run_id` varchar(128),
	`provider_request_hash` varchar(64) NOT NULL,
	`estimated_max_usd` decimal(12,4),
	`max_charge_usd` decimal(12,4) NOT NULL,
	`charged_usd` decimal(12,4),
	`raw_storage_key` varchar(1024),
	`raw_content_hash` varchar(64),
	`raw_content_type` varchar(128),
	`raw_size_bytes` bigint,
	`normalized_result` json,
	`failure_category` varchar(64),
	`ai_job_run_id` varchar(64),
	`agent_run_id` varchar(64),
	`started_at` timestamp,
	`completed_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `amazon_monitor_runs_id` PRIMARY KEY(`id`),
	CONSTRAINT `uk_amazon_monitor_run_idem` UNIQUE(`workspace_id`,`idempotency_key`)
);

CREATE TABLE `amazon_monitor_schedules` (
	`id` int AUTO_INCREMENT NOT NULL,
	`workspace_id` int NOT NULL,
	`monitor_kind` enum('competitor','keyword') NOT NULL,
	`monitor_id` int NOT NULL,
	`owner_user_id` int NOT NULL,
	`frequency` enum('manual','daily','weekly') NOT NULL DEFAULT 'manual',
	`cron_expression` varchar(64),
	`heartbeat_task_uid` varchar(128),
	`status` enum('draft','active','paused','error','retired') NOT NULL DEFAULT 'draft',
	`next_run_at` timestamp,
	`last_heartbeat_at` timestamp,
	`last_queued_run_id` int,
	`last_error` text,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `amazon_monitor_schedules_id` PRIMARY KEY(`id`),
	CONSTRAINT `uk_amazon_monitor_schedule_owner` UNIQUE(`workspace_id`,`monitor_kind`,`monitor_id`),
	CONSTRAINT `uk_amazon_monitor_schedule_task` UNIQUE(`heartbeat_task_uid`)
);

CREATE TABLE `analysisVersions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`projectFileId` int NOT NULL,
	`userId` int NOT NULL,
	`version` int NOT NULL DEFAULT 1,
	`analysisResult` text NOT NULL,
	`changeType` enum('auto_analysis','manual_edit','re_analysis') NOT NULL DEFAULT 'auto_analysis',
	`changeNote` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `analysisVersions_id` PRIMARY KEY(`id`)
);

CREATE TABLE `asin_logs` (
	`workspaceId` int,
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` varchar(255) NOT NULL,
	`user_name` varchar(255),
	`asin` varchar(50) NOT NULL,
	`content` text NOT NULL,
	`log_type` varchar(50) DEFAULT 'manual',
	`batch_id` int,
	`batch_name` varchar(255),
	`created_at` bigint NOT NULL,
	CONSTRAINT `asin_logs_id` PRIMARY KEY(`id`)
);

CREATE TABLE `asin_permissions` (
	`workspaceId` int,
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`asin` varchar(20) NOT NULL,
	`msku` varchar(100),
	`marketplace` varchar(10) DEFAULT 'US',
	`permission_level` enum('read','write','admin') NOT NULL DEFAULT 'read',
	`granted_by` int,
	`created_at` bigint NOT NULL,
	`updated_at` bigint NOT NULL,
	CONSTRAINT `asin_permissions_id` PRIMARY KEY(`id`)
);

CREATE TABLE `asin_status_cache` (
	`workspaceId` int,
	`id` int AUTO_INCREMENT NOT NULL,
	`asin` varchar(20) NOT NULL,
	`msku` varchar(100),
	`sid` varchar(20),
	`marketplace` varchar(10) DEFAULT 'US',
	`listing_status` enum('active','inactive','deleted','manual_inactive') NOT NULL DEFAULT 'active',
	`last_synced_at` bigint,
	`created_at` bigint NOT NULL,
	`updated_at` bigint NOT NULL,
	CONSTRAINT `asin_status_cache_id` PRIMARY KEY(`id`)
);

CREATE TABLE `asin_tag_assignments` (
	`workspaceId` int,
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`tag_id` int NOT NULL,
	`asin` varchar(20) NOT NULL,
	`msku` varchar(100),
	`sid` varchar(20),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `asin_tag_assignments_id` PRIMARY KEY(`id`)
);

CREATE TABLE `asin_tag_definitions` (
	`workspaceId` int,
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`name` varchar(50) NOT NULL,
	`color` varchar(20) NOT NULL DEFAULT '#6366f1',
	`is_system` int NOT NULL DEFAULT 0,
	`hide_from_inventory` int NOT NULL DEFAULT 0,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `asin_tag_definitions_id` PRIMARY KEY(`id`)
);

CREATE TABLE `batch_logs` (
	`workspaceId` int,
	`id` int AUTO_INCREMENT NOT NULL,
	`batch_id` int NOT NULL,
	`user_id` varchar(255),
	`user_name` varchar(255),
	`action` varchar(100) NOT NULL,
	`from_step` int,
	`to_step` int,
	`details` text,
	`created_at` bigint NOT NULL,
	CONSTRAINT `batch_logs_id` PRIMARY KEY(`id`)
);

CREATE TABLE `batch_products` (
	`workspaceId` int,
	`id` int AUTO_INCREMENT NOT NULL,
	`batch_id` int NOT NULL,
	`sku` varchar(255) NOT NULL,
	`asin` varchar(50),
	`product_name` varchar(500),
	`quantity` int NOT NULL DEFAULT 0,
	`unit_cost` decimal(10,2) DEFAULT '0',
	`total_cost` decimal(12,2) DEFAULT '0',
	`weight` decimal(8,2),
	`volume` decimal(10,4),
	`fnsku` varchar(50),
	`lingxing_product_id` varchar(255),
	`created_at` bigint NOT NULL,
	CONSTRAINT `batch_products_id` PRIMARY KEY(`id`)
);

CREATE TABLE `batch_step_configs` (
	`workspaceId` int,
	`id` int AUTO_INCREMENT NOT NULL,
	`batch_id` int NOT NULL,
	`step_number` int NOT NULL,
	`step_name` varchar(100) NOT NULL,
	`expected_days` int NOT NULL DEFAULT 0,
	`actual_start_at` bigint,
	`actual_end_at` bigint,
	`actual_days` int,
	`notes` text,
	`step_status` enum('pending','active','completed','skipped') NOT NULL DEFAULT 'pending',
	`created_at` bigint NOT NULL,
	`updated_at` bigint NOT NULL,
	CONSTRAINT `batch_step_configs_id` PRIMARY KEY(`id`)
);

CREATE TABLE `budget_tracking` (
	`workspaceId` int,
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`marketplace` varchar(20) NOT NULL DEFAULT 'US',
	`batch_id` varchar(64) NOT NULL,
	`total_budget_before` decimal(12,2),
	`total_budget_after` decimal(12,2),
	`campaign_count` int DEFAULT 0,
	`baseline_spend` decimal(12,2),
	`baseline_sales` decimal(12,2),
	`baseline_acos` decimal(8,4),
	`baseline_roas` decimal(8,4),
	`baseline_orders` int DEFAULT 0,
	`budget_user_decision` enum('accepted','modified','rejected','partial') NOT NULL DEFAULT 'accepted',
	`user_notes` text,
	`campaign_decisions` text,
	`followup_spend` decimal(12,2),
	`followup_sales` decimal(12,2),
	`followup_acos` decimal(8,4),
	`followup_roas` decimal(8,4),
	`followup_orders` int,
	`followup_evaluated_at` timestamp,
	`effect_summary` text,
	`effect_score` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `budget_tracking_id` PRIMARY KEY(`id`)
);

CREATE TABLE `buyer_questions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`project_id` int NOT NULL,
	`user_id` int NOT NULL,
	`question` text NOT NULL,
	`question_cn` text,
	`source` enum('ad_search_term','sp_prompts','qa_section','competitor_review','manual') NOT NULL DEFAULT 'manual',
	`category` varchar(100),
	`frequency` int DEFAULT 1,
	`priority` enum('high','medium','low') NOT NULL DEFAULT 'medium',
	`covered_in_bullet` int DEFAULT 0,
	`covered_in_description` int DEFAULT 0,
	`covered_in_qa` int DEFAULT 0,
	`suggested_answer` text,
	`status` enum('active','dismissed','covered') NOT NULL DEFAULT 'active',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `buyer_questions_id` PRIMARY KEY(`id`)
);

CREATE TABLE `check_item_overrides` (
	`workspaceId` int,
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`check_item_id` int NOT NULL,
	`is_hidden` int DEFAULT 0,
	`custom_sub_dimension` varchar(200),
	`custom_standard` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `check_item_overrides_id` PRIMARY KEY(`id`)
);

CREATE TABLE `competitor_ad_benchmarks` (
	`workspaceId` int,
	`id` int AUTO_INCREMENT NOT NULL,
	`plan_id` int NOT NULL,
	`competitor_brand` varchar(200) NOT NULL,
	`competitor_asin` varchar(20),
	`ad_type` enum('sp','sb','sd','dsp','mixed') NOT NULL DEFAULT 'mixed',
	`acos` decimal(8,2),
	`ctr` decimal(8,4),
	`cvr` decimal(8,4),
	`cpc` decimal(8,2),
	`cpa` decimal(8,2),
	`total_spend` decimal(12,2),
	`total_sales` decimal(12,2),
	`total_orders` int,
	`total_impressions` int,
	`total_clicks` int,
	`data_period` varchar(50),
	`analysis_notes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `competitor_ad_benchmarks_id` PRIMARY KEY(`id`)
);

CREATE TABLE `competitorAnalyses` (
	`id` int AUTO_INCREMENT NOT NULL,
	`projectId` int NOT NULL,
	`asin` varchar(20) NOT NULL,
	`title` text,
	`bulletPoints` text,
	`imageUrls` text,
	`price` varchar(50),
	`rating` varchar(10),
	`reviewCount` varchar(20),
	`reviewAnalysis` text,
	`keywords` text,
	`rawData` text,
	`aiSummary` text,
	`summary` text,
	`summaryStatus` enum('draft','confirmed') NOT NULL DEFAULT 'draft',
	`summaryVersion` int NOT NULL DEFAULT 1,
	`summaryConfirmedBy` int,
	`summaryConfirmedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `competitorAnalyses_id` PRIMARY KEY(`id`)
);

CREATE TABLE `competitorComparisonReports` (
	`id` int AUTO_INCREMENT NOT NULL,
	`workspaceId` int,
	`projectId` int NOT NULL,
	`userId` int NOT NULL,
	`selectionKey` varchar(500) NOT NULL,
	`analysisIds` text NOT NULL,
	`analyzedAsins` text NOT NULL,
	`aiSummary` text NOT NULL,
	`summary` text NOT NULL,
	`sellingPointRows` text NOT NULL,
	`status` enum('draft','confirmed') NOT NULL DEFAULT 'draft',
	`version` int NOT NULL DEFAULT 1,
	`confirmedBy` int,
	`confirmedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `competitorComparisonReports_id` PRIMARY KEY(`id`)
);

CREATE TABLE `competitor_image_analyses` (
	`id` int AUTO_INCREMENT NOT NULL,
	`projectId` int NOT NULL,
	`userId` int NOT NULL,
	`competitorName` varchar(255) NOT NULL DEFAULT '',
	`imageUrl` text NOT NULL,
	`imageType` varchar(100),
	`aiAnalysis` text,
	`userEdit` text,
	`confirmed` int NOT NULL DEFAULT 0,
	`sortOrder` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `competitor_image_analyses_id` PRIMARY KEY(`id`)
);

CREATE TABLE `competitor_monitors` (
	`workspaceId` int,
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

CREATE TABLE `competitor_reports` (
	`workspaceId` int,
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

CREATE TABLE `competitor_snapshots` (
	`workspaceId` int,
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

CREATE TABLE `conversion_check_items` (
	`workspaceId` int,
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int,
	`category_index` int NOT NULL,
	`category_name` varchar(100) NOT NULL,
	`sub_dimension` varchar(200),
	`standard` text,
	`sort_order` int DEFAULT 0,
	`is_custom` int DEFAULT 0,
	`is_active` int DEFAULT 1,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `conversion_check_items_id` PRIMARY KEY(`id`)
);

CREATE TABLE `conversion_comparisons` (
	`workspaceId` int,
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`product_profile_id` int NOT NULL,
	`comparison_name` varchar(200) NOT NULL,
	`own_asin` varchar(20) NOT NULL,
	`competitor_asins` text,
	`comparison_status` enum('draft','crawling','scoring','completed') NOT NULL DEFAULT 'draft',
	`overall_own_score` decimal(5,2),
	`crawl_data` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `conversion_comparisons_id` PRIMARY KEY(`id`)
);

CREATE TABLE `conversion_scores` (
	`workspaceId` int,
	`id` int AUTO_INCREMENT NOT NULL,
	`comparison_id` int NOT NULL,
	`check_item_id` int NOT NULL,
	`asin` varchar(20) NOT NULL,
	`score` int,
	`ai_score` int,
	`reason` text,
	`ai_reason` text,
	`raw_data` text,
	`source` varchar(20) DEFAULT 'ai',
	`is_locked` int DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `conversion_scores_id` PRIMARY KEY(`id`)
);

CREATE TABLE `conversion_suggestions` (
	`workspaceId` int,
	`id` int AUTO_INCREMENT NOT NULL,
	`comparison_id` int NOT NULL,
	`user_id` int NOT NULL,
	`category_name` varchar(100) NOT NULL,
	`own_score` decimal(5,2),
	`best_competitor_score` decimal(5,2),
	`gap_analysis` text,
	`suggestion` text,
	`suggestion_priority` enum('high','medium','low') NOT NULL DEFAULT 'medium',
	`expected_effect` text,
	`is_locked` int DEFAULT 0,
	`linked_plan_action_id` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `conversion_suggestions_id` PRIMARY KEY(`id`)
);

CREATE TABLE `custom_dashboards` (
	`workspaceId` int,
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

CREATE TABLE `customer_profiles` (
	`workspaceId` int,
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

CREATE TABLE `dashboard_widgets` (
	`workspaceId` int,
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

CREATE TABLE `data_imports` (
	`workspaceId` int,
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`source_type` enum('lingxing','saihu') NOT NULL,
	`file_name` varchar(500) NOT NULL,
	`file_url` text,
	`week_start_date` varchar(10) NOT NULL,
	`week_end_date` varchar(10) NOT NULL,
	`data_granularity` enum('weekly','daily') NOT NULL DEFAULT 'weekly',
	`replaces_import_id` int,
	`superseded_at` timestamp,
	`total_rows` int DEFAULT 0,
	`imported_rows` int DEFAULT 0,
	`skipped_rows` int DEFAULT 0,
	`import_status` enum('pending','parsing','previewing','importing','completed','failed') NOT NULL DEFAULT 'pending',
	`error_message` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `data_imports_id` PRIMARY KEY(`id`)
);

CREATE TABLE `database_slow_query_samples` (
	`id` int AUTO_INCREMENT NOT NULL,
	`sampleId` varchar(80) NOT NULL,
	`databaseSchema` varchar(128) NOT NULL,
	`digest` varchar(128) NOT NULL,
	`digestText` text NOT NULL,
	`executionCount` bigint NOT NULL DEFAULT 0,
	`avgTimerWaitMs` decimal(18,3) NOT NULL DEFAULT '0.000',
	`maxTimerWaitMs` decimal(18,3) NOT NULL DEFAULT '0.000',
	`totalRowsExamined` bigint NOT NULL DEFAULT 0,
	`totalRowsSent` bigint NOT NULL DEFAULT 0,
	`firstSeen` timestamp,
	`lastSeen` timestamp,
	`sampledAt` timestamp NOT NULL DEFAULT (now()),
	`source` varchar(64) NOT NULL DEFAULT 'performance_schema',
	`metadata` json,
	CONSTRAINT `database_slow_query_samples_id` PRIMARY KEY(`id`),
	CONSTRAINT `database_slow_query_samples_sampleId_unique` UNIQUE(`sampleId`)
);

CREATE TABLE `dev_analysis_reports` (
	`id` int AUTO_INCREMENT NOT NULL,
	`workspaceId` int,
	`projectId` int NOT NULL,
	`userId` int NOT NULL,
	`reportType` enum('market_overview','product_analysis','price_analysis','brand_analysis','competitor_analysis','review_analysis','review_analysis_recent_2y','external_analysis','ai_summary') NOT NULL,
	`title` varchar(255),
	`content` text,
	`status` enum('generating','completed','failed') NOT NULL DEFAULT 'generating',
	`errorMessage` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `dev_analysis_reports_id` PRIMARY KEY(`id`)
);

CREATE TABLE `dev_analysis_stage_conflicts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`workspaceId` int,
	`projectId` int NOT NULL,
	`stageType` varchar(64) NOT NULL,
	`keptStageId` int NOT NULL,
	`duplicateStageId` int NOT NULL,
	`duplicateSnapshot` json NOT NULL,
	`resolution` varchar(64) NOT NULL DEFAULT 'deduplicated_before_unique_key',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `dev_analysis_stage_conflicts_id` PRIMARY KEY(`id`),
	CONSTRAINT `uniq_dev_stage_conflicts_duplicate` UNIQUE(`duplicateStageId`)
);

CREATE TABLE `dev_analysis_stages` (
	`id` int AUTO_INCREMENT NOT NULL,
	`workspaceId` int,
	`projectId` int NOT NULL,
	`userId` int NOT NULL,
	`stageType` enum('data_parsing','tag_annotation','market_overview','product_attributes','price_analysis','brand_competition','review_analysis','decision_dashboard','attribute_tagging','attribute_cross','review_kano','information_summary') NOT NULL,
	`status` enum('pending','generating','generated','editing','confirmed','running','completed') DEFAULT 'pending',
	`rawResult` text,
	`editedResult` text,
	`chartConfig` text,
	`runId` varchar(96),
	`runProgress` int NOT NULL DEFAULT 0,
	`runError` text,
	`runStartedAt` timestamp,
	`runCompletedAt` timestamp,
	`rowVersion` int NOT NULL DEFAULT 0,
	`lastMutationKey` varchar(128),
	`confirmedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `dev_analysis_stages_id` PRIMARY KEY(`id`),
	CONSTRAINT `uniq_dev_stages_workspace_project_type` UNIQUE(`workspaceId`,`projectId`,`stageType`),
	CONSTRAINT `uniq_dev_stages_project_type` UNIQUE(`projectId`,`stageType`)
);

CREATE TABLE `dev_bom_items` (
	`id` int AUTO_INCREMENT NOT NULL,
	`workspaceId` int,
	`projectId` int NOT NULL,
	`userId` int NOT NULL,
	`parentId` int,
	`level` int DEFAULT 0,
	`partName` varchar(255) NOT NULL,
	`material` varchar(255),
	`process` varchar(255),
	`specification` text,
	`quantity` int DEFAULT 1,
	`unitPrice` varchar(50),
	`subtotal` varchar(50),
	`remark` text,
	`supplierGlobalId` int,
	`supplierName` varchar(255),
	`sortOrder` int DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `dev_bom_items_id` PRIMARY KEY(`id`)
);

CREATE TABLE `dev_bom_summary` (
	`id` int AUTO_INCREMENT NOT NULL,
	`workspaceId` int,
	`projectId` int NOT NULL,
	`userId` int NOT NULL,
	`materialCost` varchar(50),
	`moldAmortizationQty` int,
	`moldAmortizationCost` varchar(50),
	`packagingCost` varchar(50),
	`laborCost` varchar(50),
	`shippingCost` varchar(50),
	`otherCost` varchar(50),
	`totalUnitCost` varchar(50),
	`targetPrice` varchar(50),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `dev_bom_summary_id` PRIMARY KEY(`id`)
);

CREATE TABLE `dev_external_data` (
	`id` int AUTO_INCREMENT NOT NULL,
	`workspaceId` int,
	`projectId` int NOT NULL,
	`userId` int NOT NULL,
	`dataType` enum('google_trends','youtube_kol','tiktok_kol','facebook_ads','competitor_site','crowdfunding') NOT NULL,
	`query` varchar(500),
	`rawData` text,
	`aiSummary` text,
	`status` enum('fetching','analyzing','completed','failed') NOT NULL DEFAULT 'fetching',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `dev_external_data_id` PRIMARY KEY(`id`)
);

CREATE TABLE `dev_global_suppliers` (
	`id` int AUTO_INCREMENT NOT NULL,
	`workspaceId` int,
	`userId` int NOT NULL,
	`name` varchar(255) NOT NULL,
	`contactPerson` varchar(100),
	`phone` varchar(50),
	`email` varchar(320),
	`address` text,
	`categories` text,
	`website` varchar(500),
	`qualityCerts` text,
	`overallScore` int,
	`notes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `dev_global_suppliers_id` PRIMARY KEY(`id`)
);

CREATE TABLE `dev_import_apply_snapshots` (
	`id` int AUTO_INCREMENT NOT NULL,
	`workspaceId` int NOT NULL,
	`projectId` int NOT NULL,
	`batchId` int NOT NULL,
	`resourceType` enum('products','reviews') NOT NULL,
	`beforeSnapshot` text NOT NULL,
	`appliedAt` timestamp NOT NULL DEFAULT (now()),
	`rolledBackAt` timestamp,
	`rolledBackBy` int,
	`rollbackBlockedReason` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `dev_import_apply_snapshots_id` PRIMARY KEY(`id`),
	CONSTRAINT `uniq_dev_import_snapshot_batch` UNIQUE(`batchId`)
);

CREATE TABLE `dev_import_batches` (
	`id` int AUTO_INCREMENT NOT NULL,
	`workspaceId` int,
	`projectId` int NOT NULL,
	`userId` int NOT NULL,
	`status` enum('draft','validated','confirmed','applying','applied','superseded','rolled_back','rejected','failed') NOT NULL DEFAULT 'draft',
	`replacesBatchId` int,
	`snapshot` text,
	`uploadedFileId` int,
	`fileType` enum('sales','reviews'),
	`fileName` varchar(500),
	`fileHash` varchar(128),
	`totalRows` int NOT NULL DEFAULT 0,
	`validRows` int NOT NULL DEFAULT 0,
	`warningRows` int NOT NULL DEFAULT 0,
	`errorRows` int NOT NULL DEFAULT 0,
	`validationSummary` text,
	`normalizedRows` text,
	`confirmedBy` int,
	`confirmedAt` timestamp,
	`appliedBy` int,
	`appliedAt` timestamp,
	`rollbackReason` text,
	`rolledBackBy` int,
	`rolledBackAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `dev_import_batches_id` PRIMARY KEY(`id`)
);

CREATE TABLE `dev_manual_assets` (
	`id` int AUTO_INCREMENT NOT NULL,
	`workspaceId` int,
	`projectId` int NOT NULL,
	`userId` int NOT NULL,
	`assetType` enum('logo','cover','content_bg','qrcode','chapter_image','reference','other') NOT NULL,
	`chapterKey` varchar(100),
	`fileName` varchar(255),
	`fileUrl` text NOT NULL,
	`sortOrder` int DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `dev_manual_assets_id` PRIMARY KEY(`id`)
);

CREATE TABLE `dev_module_locks` (
	`id` int AUTO_INCREMENT NOT NULL,
	`workspaceId` int,
	`projectId` int NOT NULL,
	`userId` int NOT NULL,
	`moduleName` enum('profile','bom','manual','test','profit') NOT NULL,
	`isLocked` boolean NOT NULL DEFAULT false,
	`lockedAt` timestamp,
	`unlockedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `dev_module_locks_id` PRIMARY KEY(`id`)
);

CREATE TABLE `dev_mold_costs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`workspaceId` int,
	`projectId` int NOT NULL,
	`userId` int NOT NULL,
	`partName` varchar(255) NOT NULL,
	`moldType` varchar(100),
	`moldMaterial` varchar(100),
	`cavities` int,
	`estimatedCost` varchar(50),
	`leadTimeDays` int,
	`remark` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `dev_mold_costs_id` PRIMARY KEY(`id`)
);

CREATE TABLE `dev_offsite_analyses` (
	`id` int AUTO_INCREMENT NOT NULL,
	`workspaceId` int,
	`project_id` int NOT NULL,
	`user_id` varchar(255) NOT NULL,
	`source_type` enum('google_trends','youtube','tiktok','facebook','independent_site','reddit','crowdfunding') NOT NULL,
	`keyword` varchar(500) NOT NULL,
	`status` enum('pending','running','completed','failed') NOT NULL DEFAULT 'pending',
	`raw_data` json,
	`ai_analysis` text,
	`ai_analysis_confirmed` int NOT NULL DEFAULT 0,
	`edited_analysis` text,
	`error_message` text,
	`created_at` bigint NOT NULL,
	`updated_at` bigint NOT NULL,
	CONSTRAINT `dev_offsite_analyses_id` PRIMARY KEY(`id`)
);

CREATE TABLE `dev_panorama_market_insights` (
	`id` int AUTO_INCREMENT NOT NULL,
	`workspaceId` int,
	`projectId` int NOT NULL,
	`userId` int NOT NULL,
	`status` enum('pending','queued','running','ready','editing','confirmed','failed','canceled') NOT NULL DEFAULT 'pending',
	`rawResult` json,
	`editedResult` json,
	`runId` varchar(96),
	`runProgress` int NOT NULL DEFAULT 0,
	`runError` text,
	`version` int NOT NULL DEFAULT 1,
	`confirmedBy` int,
	`confirmedAt` timestamp,
	`runStartedAt` timestamp,
	`runCompletedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `dev_panorama_market_insights_id` PRIMARY KEY(`id`),
	CONSTRAINT `uniq_dev_panorama_market_insights_project` UNIQUE(`projectId`)
);

CREATE TABLE `dev_panorama_status` (
	`id` int AUTO_INCREMENT NOT NULL,
	`workspaceId` int,
	`projectId` int NOT NULL,
	`userId` int NOT NULL,
	`confirmed` int NOT NULL DEFAULT 0,
	`selectedCompetitorAsins` json,
	`currentVersionId` int,
	`confirmedAt` timestamp,
	`lastMergedAt` timestamp,
	`totalProducts` int DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `dev_panorama_status_id` PRIMARY KEY(`id`)
);

CREATE TABLE `dev_panorama_versions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`workspaceId` int,
	`projectId` int NOT NULL,
	`userId` int NOT NULL,
	`version` int NOT NULL,
	`snapshot` json NOT NULL,
	`sourceSummary` json,
	`status` enum('confirmed','superseded') NOT NULL DEFAULT 'confirmed',
	`confirmedAt` timestamp NOT NULL DEFAULT (now()),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `dev_panorama_versions_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_dev_panorama_version` UNIQUE(`workspaceId`,`projectId`,`version`)
);

CREATE TABLE `dev_product_manuals` (
	`id` int AUTO_INCREMENT NOT NULL,
	`workspaceId` int,
	`projectId` int NOT NULL,
	`userId` int NOT NULL,
	`brandName` varchar(255),
	`logoUrl` text,
	`coverImageUrl` text,
	`qrCodeUrl` text,
	`contentSections` text,
	`spanishContent` text,
	`brandAssets` text,
	`htmlEnUrl` text,
	`htmlEsUrl` text,
	`pdfEnUrl` text,
	`pdfEsUrl` text,
	`contentStatus` enum('draft','editing','confirmed') NOT NULL DEFAULT 'draft',
	`finalManualUrl` text,
	`themeStyle` varchar(50) DEFAULT 'classic',
	`themeColor` varchar(50) DEFAULT '#1a1a2e',
	`fontScheme` varchar(50) DEFAULT 'default',
	`referenceManualUrl` text,
	`referenceManualNotes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `dev_product_manuals_id` PRIMARY KEY(`id`)
);

CREATE TABLE `dev_product_profiles` (
	`id` int AUTO_INCREMENT NOT NULL,
	`workspaceId` int,
	`projectId` int NOT NULL,
	`userId` int NOT NULL,
	`appearanceColors` text,
	`appearanceAiSuggestion` text,
	`appearanceConfirmed` int NOT NULL DEFAULT 0,
	`mainFunctions` text,
	`functionsAiSuggestion` text,
	`functionsConfirmed` int NOT NULL DEFAULT 0,
	`costBreakdown` text,
	`costAiSuggestion` text,
	`costConfirmed` int NOT NULL DEFAULT 0,
	`packageDimensions` text,
	`packageAiSuggestion` text,
	`packageConfirmed` int NOT NULL DEFAULT 0,
	`packageDesign` text,
	`packageDesignAiSuggestion` text,
	`packageDesignConfirmed` int NOT NULL DEFAULT 0,
	`userPersona` text,
	`userPersonaAiSuggestion` text,
	`userPersonaConfirmed` int NOT NULL DEFAULT 0,
	`usageScenarios` text,
	`usageScenariosAiSuggestion` text,
	`usageScenariosConfirmed` int NOT NULL DEFAULT 0,
	`productMap` text,
	`productMapAiSuggestion` text,
	`productMapConfirmed` int NOT NULL DEFAULT 0,
	`status` enum('draft','confirmed') NOT NULL DEFAULT 'draft',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `dev_product_profiles_id` PRIMARY KEY(`id`)
);

CREATE TABLE `dev_product_tags` (
	`id` int AUTO_INCREMENT NOT NULL,
	`workspaceId` int,
	`projectId` int NOT NULL,
	`asin` varchar(20) NOT NULL,
	`dimensionName` varchar(100) NOT NULL,
	`dimensionValue` varchar(255) NOT NULL,
	`source` enum('ai','manual','specification') DEFAULT 'ai',
	`confirmed` int DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `dev_product_tags_id` PRIMARY KEY(`id`)
);

CREATE TABLE `dev_products` (
	`id` int AUTO_INCREMENT NOT NULL,
	`workspaceId` int,
	`projectId` int NOT NULL,
	`asin` varchar(20),
	`title` text,
	`brand` varchar(255),
	`price` varchar(50),
	`rating` varchar(10),
	`reviewCount` varchar(20),
	`monthlySales` int,
	`bsr` int,
	`bulletPoints` text,
	`monthlySalesHistory` text,
	`tags` text,
	`tagStatus` enum('pending','tagged','confirmed') NOT NULL DEFAULT 'pending',
	`monthlyRevenue` decimal(12,2),
	`listingDate` varchar(50),
	`fulfillment` varchar(20),
	`sellerName` varchar(255),
	`sellerLocation` varchar(100),
	`variantCount` int,
	`category` varchar(255),
	`subcategory` varchar(255),
	`monthlyRevenueHistory` text,
	`specifications` text,
	`description` text,
	`imageUrl` text,
	`searchRank` int,
	`parentAsin` varchar(20),
	`sku` varchar(100),
	`productLink` text,
	`categoryPath` text,
	`bsrLarge` int,
	`bsrSmall` int,
	`bsrGrowthRate` varchar(50),
	`fbaFee` varchar(50),
	`grossMargin` varchar(50),
	`monthlySalesGrowth` varchar(50),
	`childSales` int,
	`childRevenue` decimal(12,2),
	`monthlyNewReviews` int,
	`reviewRate` varchar(50),
	`lqs` int,
	`sellerCount` int,
	`listingDays` int,
	`buyboxSeller` varchar(255),
	`buyboxType` varchar(50),
	`hasAPlus` int DEFAULT 0,
	`hasVideo` int DEFAULT 0,
	`hasBrandStory` int DEFAULT 0,
	`hasAmazonChoice` int DEFAULT 0,
	`productWeight` varchar(100),
	`productSize` varchar(200),
	`packageWeight` varchar(100),
	`packageSize` varchar(200),
	`packageSizeTier` varchar(100),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `dev_products_id` PRIMARY KEY(`id`)
);

CREATE TABLE `dev_profit_calculations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`workspaceId` int,
	`userId` int NOT NULL,
	`projectId` int,
	`name` varchar(255),
	`sellingPrice` varchar(50),
	`productCost` varchar(50),
	`fbaFee` varchar(50),
	`referralFeeRate` varchar(20),
	`adSpend` varchar(50),
	`otherCost` varchar(50),
	`profit` varchar(50),
	`profitMargin` varchar(20),
	`roi` varchar(20),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `dev_profit_calculations_id` PRIMARY KEY(`id`)
);

CREATE TABLE `dev_project_progress` (
	`id` int AUTO_INCREMENT NOT NULL,
	`workspaceId` int,
	`projectId` int NOT NULL,
	`primaryCompetitorAsin` varchar(20),
	`selectorName` varchar(100),
	`operatorName` varchar(255),
	`landingStage` varchar(40),
	`landingProgress` int NOT NULL DEFAULT 0,
	`reviewStatus` enum('unreviewed','reviewing','approved','rejected') NOT NULL DEFAULT 'unreviewed',
	`assistantName` varchar(100),
	`updatedBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `dev_project_progress_id` PRIMARY KEY(`id`),
	CONSTRAINT `uniq_dev_project_progress_project` UNIQUE(`projectId`)
);

CREATE TABLE `dev_project_scores` (
	`id` int AUTO_INCREMENT NOT NULL,
	`workspaceId` int,
	`projectId` int NOT NULL,
	`userId` int NOT NULL,
	`marketCapacity` int DEFAULT 0,
	`differentiation` int DEFAULT 0,
	`competitiveness` int DEFAULT 0,
	`entryOpportunity` int DEFAULT 0,
	`profit` int DEFAULT 0,
	`risk` int DEFAULT 0,
	`totalScore` int DEFAULT 0,
	`aiReasoning` text,
	`recommendation` enum('approve','review','reject') NOT NULL DEFAULT 'review',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `dev_project_scores_id` PRIMARY KEY(`id`)
);

CREATE TABLE `dev_project_tag_categories` (
	`id` int AUTO_INCREMENT NOT NULL,
	`workspaceId` int,
	`projectId` int NOT NULL,
	`userId` int NOT NULL,
	`categoryKey` varchar(50) NOT NULL,
	`categoryName` varchar(100) NOT NULL,
	`description` text,
	`sortOrder` int NOT NULL DEFAULT 0,
	`confirmed` int NOT NULL DEFAULT 0,
	`confirmedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `dev_project_tag_categories_id` PRIMARY KEY(`id`)
);

CREATE TABLE `dev_project_tag_items` (
	`id` int AUTO_INCREMENT NOT NULL,
	`workspaceId` int,
	`categoryId` int NOT NULL,
	`projectId` int NOT NULL,
	`tagName` varchar(255) NOT NULL,
	`tagValue` text,
	`source` enum('ai','manual') NOT NULL DEFAULT 'ai',
	`sourceEvidence` text,
	`sortOrder` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `dev_project_tag_items_id` PRIMARY KEY(`id`)
);

CREATE TABLE `dev_projects` (
	`id` int AUTO_INCREMENT NOT NULL,
	`workspaceId` int,
	`userId` int NOT NULL,
	`name` varchar(255) NOT NULL,
	`description` text,
	`targetMarket` varchar(100) DEFAULT 'US',
	`platform` varchar(50) DEFAULT 'amazon',
	`keywords` text,
	`status` enum('draft','data_collection','analyzing','scoring','completed','archived') NOT NULL DEFAULT 'draft',
	`phase` enum('market_analysis','project_execution') NOT NULL DEFAULT 'market_analysis',
	`approvedAt` timestamp,
	`approvedScore` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `dev_projects_id` PRIMARY KEY(`id`)
);

CREATE TABLE `dev_reviews` (
	`id` int AUTO_INCREMENT NOT NULL,
	`workspaceId` int,
	`projectId` int NOT NULL,
	`asin` varchar(20),
	`title` text,
	`content` text,
	`rating` int,
	`reviewDate` varchar(50),
	`isVP` int DEFAULT 0,
	`variant` varchar(255),
	`helpfulCount` int DEFAULT 0,
	`isVine` int DEFAULT 0,
	`hasImage` int DEFAULT 0,
	`hasVideo` int DEFAULT 0,
	`reviewerName` varchar(255),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `dev_reviews_id` PRIMARY KEY(`id`)
);

CREATE TABLE `dev_suppliers` (
	`id` int AUTO_INCREMENT NOT NULL,
	`workspaceId` int,
	`projectId` int NOT NULL,
	`userId` int NOT NULL,
	`name` varchar(255) NOT NULL,
	`factoryScale` varchar(100),
	`employeeCount` varchar(50),
	`rdStaffCount` varchar(50),
	`qualityCerts` text,
	`productQuality` int,
	`yieldRate` varchar(20),
	`deliveryScore` int,
	`priceScore` int,
	`overallScore` int,
	`specialties` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `dev_suppliers_id` PRIMARY KEY(`id`)
);

CREATE TABLE `dev_tag_dimensions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`workspaceId` int,
	`userId` int NOT NULL,
	`name` varchar(100) NOT NULL,
	`category` varchar(100),
	`description` text,
	`isDefault` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `dev_tag_dimensions_id` PRIMARY KEY(`id`)
);

CREATE TABLE `dev_test_reports` (
	`id` int AUTO_INCREMENT NOT NULL,
	`workspaceId` int,
	`projectId` int NOT NULL,
	`userId` int NOT NULL,
	`testItems` text,
	`reportContent` text,
	`excelUrl` text,
	`status` enum('draft','editing','confirmed') NOT NULL DEFAULT 'draft',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `dev_test_reports_id` PRIMARY KEY(`id`)
);

CREATE TABLE `dev_time_plans` (
	`id` int AUTO_INCREMENT NOT NULL,
	`workspaceId` int,
	`projectId` int NOT NULL,
	`userId` int NOT NULL,
	`phaseName` varchar(255) NOT NULL,
	`estimatedDays` int,
	`startOffset` int,
	`description` text,
	`status` varchar(50) DEFAULT 'pending',
	`color` varchar(20),
	`dependsOn` int,
	`sortOrder` int DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `dev_time_plans_id` PRIMARY KEY(`id`)
);

CREATE TABLE `dev_uploaded_files` (
	`id` int AUTO_INCREMENT NOT NULL,
	`workspaceId` int,
	`projectId` int NOT NULL,
	`userId` int NOT NULL,
	`fileType` enum('sales','bullet_points','reviews','history_sales') NOT NULL,
	`filename` varchar(500) NOT NULL,
	`fileUrl` text,
	`fileSize` int,
	`parsedData` text,
	`totalRows` int,
	`status` enum('uploaded','parsing','parsed','failed') NOT NULL DEFAULT 'uploaded',
	`confirmed` int NOT NULL DEFAULT 0,
	`confirmedAt` timestamp,
	`errorMessage` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `dev_uploaded_files_id` PRIMARY KEY(`id`)
);

CREATE TABLE `email_replies` (
	`workspaceId` int,
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`sid` int,
	`email_id` varchar(100),
	`buyer_email` varchar(320),
	`order_id` varchar(50),
	`asin` varchar(20),
	`email_category` enum('return_request','product_inquiry','complaint','positive_feedback','other'),
	`urgency_level` enum('critical','high','medium','low') DEFAULT 'medium',
	`ai_classification` text,
	`ai_draft_reply` text,
	`edited_reply` text,
	`final_reply` text,
	`template_id` int,
	`status` enum('unread','read','draft','replied','closed') NOT NULL DEFAULT 'unread',
	`replied_at` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `email_replies_id` PRIMARY KEY(`id`)
);

CREATE TABLE `email_templates` (
	`workspaceId` int,
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`category` enum('return_handling','product_inquiry','negative_review_reply','positive_review_thanks','logistics_inquiry','after_sales_followup','other') NOT NULL DEFAULT 'other',
	`template_name` varchar(200) NOT NULL,
	`subject` varchar(500),
	`body_content` text NOT NULL,
	`language` varchar(10) NOT NULL DEFAULT 'en',
	`variables` json,
	`is_ai_generated` int DEFAULT 0,
	`usage_count` int DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `email_templates_id` PRIMARY KEY(`id`)
);

CREATE TABLE `emperor_agent_artifacts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`workspaceId` int,
	`runId` varchar(80) NOT NULL,
	`unifiedArtifactId` varchar(80),
	`agentSlug` varchar(128) NOT NULL,
	`nodeId` varchar(128) NOT NULL,
	`artifactKey` varchar(128) NOT NULL,
	`artifactType` enum('json','text','markdown','html','image','file','table','other') NOT NULL DEFAULT 'json',
	`status` enum('draft','final','superseded') NOT NULL DEFAULT 'draft',
	`version` int NOT NULL DEFAULT 1,
	`isCurrent` int NOT NULL DEFAULT 0,
	`currentSince` timestamp,
	`selectedBy` int,
	`userId` int NOT NULL,
	`projectId` int,
	`content` json,
	`contentHash` varchar(64),
	`summary` text,
	`metadata` json,
	`mimeType` varchar(128),
	`fileName` varchar(255),
	`fileSizeBytes` bigint,
	`storageUri` text,
	`retentionClass` enum('hot','warm','cold','archive') NOT NULL DEFAULT 'hot',
	`archiveAfter` timestamp,
	`deleteAfter` timestamp,
	`archivedAt` timestamp,
	`sourceSkillRunId` varchar(80),
	`sourceAiJobRunId` varchar(80),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `emperor_agent_artifacts_id` PRIMARY KEY(`id`)
);

CREATE TABLE `emperor_agent_checkpoints` (
	`id` int AUTO_INCREMENT NOT NULL,
	`workspaceId` int,
	`runId` varchar(80) NOT NULL,
	`agentSlug` varchar(128) NOT NULL,
	`nodeId` varchar(128) NOT NULL,
	`nodeLabel` varchar(255),
	`nodeType` varchar(64) NOT NULL,
	`status` enum('pending','ready','running','waiting_human','confirmed','skipped','failed','canceled') NOT NULL DEFAULT 'pending',
	`attempt` int NOT NULL DEFAULT 0,
	`maxAttempts` int NOT NULL DEFAULT 1,
	`input` json,
	`output` json,
	`userEdit` json,
	`metadata` json,
	`skillRunId` varchar(80),
	`aiJobRunId` varchar(80),
	`aiJobAttempt` int NOT NULL DEFAULT 0,
	`aiJobClaimedAt` timestamp,
	`lockToken` varchar(80),
	`lockedAt` timestamp,
	`timeoutAt` timestamp,
	`retryCount` int NOT NULL DEFAULT 0,
	`retryScheduledAt` timestamp,
	`lastFailureKind` varchar(40),
	`reviewerUserId` int,
	`errorMessage` longtext,
	`startedAt` timestamp,
	`completedAt` timestamp,
	`confirmedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `emperor_agent_checkpoints_id` PRIMARY KEY(`id`)
);

CREATE TABLE `emperor_agent_events` (
	`id` int AUTO_INCREMENT NOT NULL,
	`workspaceId` int,
	`runId` varchar(80) NOT NULL,
	`agentSlug` varchar(128) NOT NULL,
	`nodeId` varchar(128),
	`eventType` varchar(64) NOT NULL,
	`message` text,
	`payload` json,
	`retentionClass` enum('hot','warm','cold','archive') NOT NULL DEFAULT 'hot',
	`archiveAfter` timestamp,
	`deleteAfter` timestamp,
	`archivedAt` timestamp,
	`archiveBatchId` varchar(80),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `emperor_agent_events_id` PRIMARY KEY(`id`)
);

CREATE TABLE `emperor_agent_runs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`workspaceId` int,
	`runId` varchar(80) NOT NULL,
	`agentSlug` varchar(128) NOT NULL,
	`agentName` varchar(255),
	`templateVersionId` int,
	`templateVersion` varchar(40),
	`dagHash` varchar(64),
	`userId` int NOT NULL,
	`projectId` int,
	`status` enum('running','waiting_human','paused','completed','failed','canceled') NOT NULL DEFAULT 'waiting_human',
	`currentNodeId` varchar(128),
	`progress` int NOT NULL DEFAULT 0,
	`stateVersion` int NOT NULL DEFAULT 0,
	`recoverySnapshotId` varchar(80),
	`inputs` json,
	`outputs` json,
	`errorMessage` text,
	`startedAt` timestamp,
	`completedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `emperor_agent_runs_id` PRIMARY KEY(`id`),
	CONSTRAINT `emperor_agent_runs_runId_unique` UNIQUE(`runId`)
);

CREATE TABLE `emperor_agent_template_versions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`workspaceId` int,
	`agentSlug` varchar(128) NOT NULL,
	`agentName` varchar(255),
	`parentVersionId` int,
	`versionNumber` int NOT NULL,
	`version` varchar(40) NOT NULL,
	`dagHash` varchar(64) NOT NULL,
	`status` enum('draft','released','deprecated') NOT NULL DEFAULT 'released',
	`isDefault` int NOT NULL DEFAULT 0,
	`rolloutPercent` int NOT NULL DEFAULT 100,
	`rolloutPolicy` json,
	`dagDefinition` json NOT NULL,
	`releaseNotes` text,
	`createdBy` int,
	`releasedAt` timestamp,
	`activatedAt` timestamp,
	`deprecatedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `emperor_agent_template_versions_id` PRIMARY KEY(`id`)
);

CREATE TABLE `emperor_agents` (
	`id` int AUTO_INCREMENT NOT NULL,
	`workspaceId` int,
	`slug` varchar(128) NOT NULL,
	`name` varchar(255) NOT NULL,
	`description` text,
	`category` varchar(64) DEFAULT '通用',
	`status` enum('draft','active','deprecated') NOT NULL DEFAULT 'active',
	`scope` enum('global','project','private') NOT NULL DEFAULT 'project',
	`triggerType` enum('manual','event','scheduled') NOT NULL DEFAULT 'manual',
	`maxExecutionSeconds` int NOT NULL DEFAULT 300,
	`cronExpression` varchar(120),
	`ownerUserId` int,
	`dagDefinition` json NOT NULL,
	`execution_mode` enum('inline','fork','background') NOT NULL DEFAULT 'inline',
	`callCount` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `emperor_agents_id` PRIMARY KEY(`id`),
	CONSTRAINT `emperor_agents_slug_unique` UNIQUE(`slug`)
);

CREATE TABLE `emperor_ai_os_evaluations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`workspaceId` int,
	`evaluationId` varchar(80) NOT NULL,
	`entityType` varchar(40) NOT NULL,
	`entityId` varchar(128) NOT NULL,
	`evaluationType` varchar(80) NOT NULL DEFAULT 'heuristic_quality',
	`score` decimal(5,2) NOT NULL,
	`grade` varchar(20),
	`status` varchar(40),
	`evaluator` varchar(80) NOT NULL DEFAULT 'system.heuristic',
	`userId` int,
	`projectId` int,
	`agentSlug` varchar(128),
	`nodeId` varchar(128),
	`skillSlug` varchar(128),
	`toolSlug` varchar(128),
	`rubric` json,
	`details` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `emperor_ai_os_evaluations_id` PRIMARY KEY(`id`),
	CONSTRAINT `emperor_ai_os_evaluations_evaluationId_unique` UNIQUE(`evaluationId`)
);

CREATE TABLE `emperor_ai_os_metrics` (
	`id` int AUTO_INCREMENT NOT NULL,
	`workspaceId` int,
	`entityType` varchar(40) NOT NULL,
	`entityId` varchar(128) NOT NULL,
	`metricName` varchar(80) NOT NULL,
	`metricValue` decimal(18,4),
	`status` varchar(40),
	`userId` int,
	`projectId` int,
	`agentSlug` varchar(128),
	`nodeId` varchar(128),
	`skillSlug` varchar(128),
	`toolSlug` varchar(128),
	`metadata` json,
	`retentionClass` enum('hot','warm','cold','archive') NOT NULL DEFAULT 'hot',
	`archiveAfter` timestamp,
	`deleteAfter` timestamp,
	`archivedAt` timestamp,
	`archiveBatchId` varchar(80),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `emperor_ai_os_metrics_id` PRIMARY KEY(`id`)
);

CREATE TABLE `emperor_assistant_configuration_versions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`workspaceId` int NOT NULL,
	`agentKey` varchar(32) NOT NULL,
	`revision` int NOT NULL,
	`config` json NOT NULL,
	`configHash` char(64) NOT NULL,
	`sourceRevision` int,
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `emperor_assistant_configuration_versions_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_assistant_configuration_version_scope` UNIQUE(`workspaceId`,`agentKey`,`revision`)
);

CREATE TABLE `emperor_assistant_configurations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`workspaceId` int NOT NULL,
	`agentKey` varchar(32) NOT NULL,
	`revision` int NOT NULL,
	`config` json NOT NULL,
	`configHash` char(64) NOT NULL,
	`updatedBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `emperor_assistant_configurations_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_assistant_configuration_scope` UNIQUE(`workspaceId`,`agentKey`)
);

CREATE TABLE `emperor_conversation_attachments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`workspaceId` int,
	`attachmentId` varchar(80) NOT NULL,
	`conversationId` varchar(80) NOT NULL,
	`messageId` varchar(80),
	`storageObjectId` int,
	`artifactId` varchar(80),
	`fileName` varchar(255) NOT NULL,
	`mimeType` varchar(128) NOT NULL,
	`sizeBytes` bigint,
	`contentHash` varchar(64),
	`contextPolicy` enum('summary_only','extracted_text','image_vision','blocked') NOT NULL DEFAULT 'summary_only',
	`scanStatus` enum('pending','ready','blocked','failed') NOT NULL DEFAULT 'pending',
	`contextSummary` text,
	`metadata` json,
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `emperor_conversation_attachments_id` PRIMARY KEY(`id`),
	CONSTRAINT `emperor_conversation_attachments_attachmentId_unique` UNIQUE(`attachmentId`)
);

CREATE TABLE `emperor_conversation_knowledge_refs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`workspaceId` int,
	`referenceId` varchar(80) NOT NULL,
	`conversationId` varchar(80) NOT NULL,
	`sourceKind` enum('emperor_memory','amz_ops_skill') NOT NULL,
	`sourceId` int NOT NULL,
	`title` varchar(512) NOT NULL,
	`contextSummary` text NOT NULL,
	`tags` json,
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `emperor_conversation_knowledge_refs_id` PRIMARY KEY(`id`),
	CONSTRAINT `emperor_conversation_knowledge_refs_referenceId_unique` UNIQUE(`referenceId`)
);

CREATE TABLE `emperor_conversation_messages` (
	`id` int AUTO_INCREMENT NOT NULL,
	`workspaceId` int,
	`messageId` varchar(80) NOT NULL,
	`conversationId` varchar(80) NOT NULL,
	`role` enum('user','assistant','system','tool') NOT NULL,
	`status` enum('draft','streaming','completed','failed','canceled') NOT NULL DEFAULT 'completed',
	`content` text NOT NULL,
	`structuredContent` json,
	`skillRunId` varchar(80),
	`planId` varchar(80),
	`stepId` varchar(80),
	`createdBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `emperor_conversation_messages_id` PRIMARY KEY(`id`),
	CONSTRAINT `emperor_conversation_messages_messageId_unique` UNIQUE(`messageId`)
);

CREATE TABLE `emperor_conversation_plan_steps` (
	`id` int AUTO_INCREMENT NOT NULL,
	`workspaceId` int,
	`stepId` varchar(80) NOT NULL,
	`planId` varchar(80) NOT NULL,
	`sequence` int NOT NULL,
	`title` varchar(255) NOT NULL,
	`description` text,
	`capabilityType` enum('skill','agent','tool') NOT NULL,
	`capabilitySlug` varchar(128) NOT NULL,
	`input` json,
	`riskLevel` enum('L0','L1','L2','L3') NOT NULL DEFAULT 'L1',
	`approvalRequired` int NOT NULL DEFAULT 0,
	`approvalState` enum('not_required','pending','approved','rejected','skipped') NOT NULL DEFAULT 'not_required',
	`status` enum('pending','ready','running','waiting_human','succeeded','skipped','failed','canceled') NOT NULL DEFAULT 'pending',
	`stateVersion` int NOT NULL DEFAULT 0,
	`skillRunId` varchar(80),
	`agentRunId` varchar(80),
	`toolRunId` varchar(80),
	`traceId` varchar(80),
	`recoverySnapshotId` varchar(80),
	`reviewRequestId` varchar(80),
	`errorMessage` text,
	`metadata` json,
	`startedAt` timestamp,
	`completedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `emperor_conversation_plan_steps_id` PRIMARY KEY(`id`),
	CONSTRAINT `emperor_conversation_plan_steps_stepId_unique` UNIQUE(`stepId`)
);

CREATE TABLE `emperor_conversation_plans` (
	`id` int AUTO_INCREMENT NOT NULL,
	`workspaceId` int,
	`planId` varchar(80) NOT NULL,
	`conversationId` varchar(80) NOT NULL,
	`version` int NOT NULL DEFAULT 1,
	`status` enum('draft','proposed','approved','executing','completed','failed','canceled','superseded') NOT NULL DEFAULT 'draft',
	`stateVersion` int NOT NULL DEFAULT 0,
	`recoverySnapshotId` varchar(80),
	`goal` text NOT NULL,
	`assumptions` json,
	`planJson` json NOT NULL,
	`riskSummary` json,
	`approvedBy` int,
	`approvedAt` timestamp,
	`canceledAt` timestamp,
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `emperor_conversation_plans_id` PRIMARY KEY(`id`),
	CONSTRAINT `emperor_conversation_plans_planId_unique` UNIQUE(`planId`)
);

CREATE TABLE `emperor_conversations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`workspaceId` int,
	`conversationId` varchar(80) NOT NULL,
	`userId` int NOT NULL,
	`projectId` int,
	`title` varchar(255) NOT NULL,
	`status` enum('draft','planning','awaiting_plan_confirmation','running','waiting_human','completed','failed','canceled','archived') NOT NULL DEFAULT 'draft',
	`activePlanId` varchar(80),
	`lastTraceId` varchar(80),
	`metadata` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `emperor_conversations_id` PRIMARY KEY(`id`),
	CONSTRAINT `emperor_conversations_conversationId_unique` UNIQUE(`conversationId`)
);

CREATE TABLE `emperor_execution_recovery_requests` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`recoveryId` varchar(80) NOT NULL,
	`idempotencyKey` varchar(64) NOT NULL,
	`snapshotId` varchar(80) NOT NULL,
	`traceId` varchar(80),
	`targetType` varchar(40) NOT NULL,
	`targetId` varchar(128) NOT NULL,
	`requestedAction` varchar(40) NOT NULL,
	`expectedStateVersion` int NOT NULL,
	`status` varchar(40) NOT NULL DEFAULT 'requested',
	`reasonCode` varchar(80),
	`result` json,
	`requestedBy` int,
	`completedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `emperor_execution_recovery_requests_id` PRIMARY KEY(`id`),
	CONSTRAINT `emperor_execution_recovery_requests_recoveryId_unique` UNIQUE(`recoveryId`),
	CONSTRAINT `emperor_execution_recovery_requests_idempotencyKey_unique` UNIQUE(`idempotencyKey`)
);

CREATE TABLE `emperor_execution_state_snapshots` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`snapshotId` varchar(80) NOT NULL,
	`workspaceId` int,
	`traceId` varchar(80),
	`targetType` varchar(40) NOT NULL,
	`targetId` varchar(128) NOT NULL,
	`stateVersion` int NOT NULL,
	`status` varchar(40) NOT NULL DEFAULT 'captured',
	`planId` varchar(80),
	`planVersion` int,
	`capabilityType` varchar(24),
	`capabilitySlug` varchar(128),
	`capabilityVersion` varchar(80),
	`approvalState` varchar(40),
	`contextManifestHash` varchar(64),
	`inputHash` varchar(64),
	`snapshot` json NOT NULL,
	`createdBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `emperor_execution_state_snapshots_id` PRIMARY KEY(`id`),
	CONSTRAINT `emperor_execution_state_snapshots_snapshotId_unique` UNIQUE(`snapshotId`)
);

CREATE TABLE `emperor_external_knowledge_callers` (
	`id` int AUTO_INCREMENT NOT NULL,
	`connectorId` int NOT NULL,
	`workspaceId` int NOT NULL,
	`tokenHash` varchar(64) NOT NULL,
	`tokenPrefix` varchar(20) NOT NULL,
	`scopes` json NOT NULL,
	`createdByUserId` int NOT NULL,
	`lastUsedAt` timestamp,
	`revokedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `emperor_external_knowledge_callers_id` PRIMARY KEY(`id`),
	CONSTRAINT `emperor_external_knowledge_callers_connectorId_unique` UNIQUE(`connectorId`),
	CONSTRAINT `emperor_external_knowledge_callers_tokenHash_unique` UNIQUE(`tokenHash`)
);

CREATE TABLE `emperor_knowledge` (
	`id` int AUTO_INCREMENT NOT NULL,
	`workspaceId` int,
	`user_id` int NOT NULL,
	`project_id` varchar(128),
	`title` varchar(512) NOT NULL,
	`content` text NOT NULL,
	`memory_type` enum('feedback','fact','project','reference') NOT NULL DEFAULT 'fact',
	`source` varchar(1024),
	`tags` json,
	`is_active` int NOT NULL DEFAULT 1,
	`confidence` decimal(4,3) DEFAULT '1.000',
	`created_at` bigint NOT NULL,
	`updated_at` bigint NOT NULL,
	CONSTRAINT `emperor_knowledge_id` PRIMARY KEY(`id`)
);

CREATE TABLE `emperor_mcp_connectors` (
	`id` int AUTO_INCREMENT NOT NULL,
	`workspaceId` int,
	`slug` varchar(128) NOT NULL,
	`name` varchar(255) NOT NULL,
	`description` text,
	`connectionType` enum('http_api','database','webhook','internal','script') NOT NULL DEFAULT 'http_api',
	`config` json,
	`governancePolicy` json,
	`secretRefs` json,
	`isActive` int NOT NULL DEFAULT 1,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `emperor_mcp_connectors_id` PRIMARY KEY(`id`),
	CONSTRAINT `emperor_mcp_connectors_slug_unique` UNIQUE(`slug`)
);

CREATE TABLE `emperor_model_providers` (
	`id` int AUTO_INCREMENT NOT NULL,
	`workspaceId` int,
	`slug` varchar(64) NOT NULL,
	`name` varchar(128) NOT NULL,
	`provider` enum('manus_builtin','openai','deepseek','anthropic','custom') NOT NULL DEFAULT 'manus_builtin',
	`baseUrl` varchar(512),
	`apiKeyRef` varchar(256),
	`modelId` varchar(128) NOT NULL,
	`displayName` varchar(128),
	`isDefault` int NOT NULL DEFAULT 0,
	`isActive` int NOT NULL DEFAULT 1,
	`capabilityTags` json,
	`costPer1kInputTokens` decimal(12,6) NOT NULL DEFAULT '0',
	`costPer1kOutputTokens` decimal(12,6) NOT NULL DEFAULT '0',
	`maxContextTokens` int NOT NULL DEFAULT 128000,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `emperor_model_providers_id` PRIMARY KEY(`id`),
	CONSTRAINT `emperor_model_providers_slug_unique` UNIQUE(`slug`)
);

CREATE TABLE `emperor_scheduled_tasks` (
	`id` int AUTO_INCREMENT NOT NULL,
	`slug` varchar(128) NOT NULL,
	`workspaceId` int,
	`name` varchar(255) NOT NULL,
	`description` text,
	`skillSlug` varchar(128) NOT NULL,
	`cronExpr` varchar(64),
	`inputTemplate` json,
	`isActive` int NOT NULL DEFAULT 1,
	`triggerMode` enum('internal','heartbeat') NOT NULL DEFAULT 'internal',
	`systemManaged` int NOT NULL DEFAULT 0,
	`dataDomain` varchar(64),
	`externalScheduleId` int,
	`externalTaskUid` varchar(65),
	`managePath` varchar(255),
	`lastBatchId` int,
	`lastRunAt` timestamp,
	`nextRunAt` timestamp,
	`lastRunStatus` enum('succeeded','failed','running'),
	`runCount` int NOT NULL DEFAULT 0,
	`createdByUserId` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `emperor_scheduled_tasks_id` PRIMARY KEY(`id`),
	CONSTRAINT `emperor_scheduled_tasks_slug_unique` UNIQUE(`slug`),
	CONSTRAINT `uk_emperor_scheduled_tasks_external_task_uid` UNIQUE(`externalTaskUid`)
);

CREATE TABLE `emperor_secret_key_versions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`scope` enum('tool','model','system') NOT NULL DEFAULT 'tool',
	`keyVersion` varchar(64) NOT NULL,
	`status` enum('active','deprecated','retired') NOT NULL DEFAULT 'active',
	`activatedAt` timestamp,
	`deprecatedAt` timestamp,
	`retiredAt` timestamp,
	`metadata` json,
	`createdBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `emperor_secret_key_versions_id` PRIMARY KEY(`id`)
);

CREATE TABLE `emperor_skill_runs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`workspaceId` int,
	`runId` varchar(64) NOT NULL,
	`skillSlug` varchar(128) NOT NULL,
	`skillName` varchar(255),
	`skillVersion` int,
	`skillPromptHash` varchar(64),
	`skillManifestHash` varchar(64),
	`migrationSource` varchar(255),
	`userId` int,
	`input` json,
	`output` json,
	`status` enum('queued','running','succeeded','failed','canceled') NOT NULL DEFAULT 'queued',
	`stateVersion` int NOT NULL DEFAULT 0,
	`recoverySnapshotId` varchar(80),
	`errorMessage` text,
	`modelSlug` varchar(128),
	`provider` varchar(64),
	`inputTokens` int DEFAULT 0,
	`outputTokens` int DEFAULT 0,
	`durationMs` int DEFAULT 0,
	`costCents` int DEFAULT 0,
	`traceId` varchar(64),
	`startedAt` timestamp,
	`completedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `emperor_skill_runs_id` PRIMARY KEY(`id`),
	CONSTRAINT `emperor_skill_runs_runId_unique` UNIQUE(`runId`)
);

CREATE TABLE `emperor_skills` (
	`id` int AUTO_INCREMENT NOT NULL,
	`workspaceId` int,
	`slug` varchar(128) NOT NULL,
	`name` varchar(255) NOT NULL,
	`description` text,
	`category` varchar(64) NOT NULL DEFAULT '通用',
	`owner` varchar(64) DEFAULT 'system',
	`riskTier` enum('L0','L1','L2','L3') NOT NULL DEFAULT 'L1',
	`status` enum('Draft','Validated','Approved','Released','Deprecated') NOT NULL DEFAULT 'Released',
	`scope` enum('global','private','shared') NOT NULL DEFAULT 'global',
	`version` int NOT NULL DEFAULT 1,
	`isSystem` int NOT NULL DEFAULT 1,
	`callCount` int NOT NULL DEFAULT 0,
	`manifest` json NOT NULL,
	`modelOverride` varchar(128),
	`when_to_use` text,
	`timeout_seconds` int NOT NULL DEFAULT 120,
	`execution_mode` enum('inline','fork','background') NOT NULL DEFAULT 'inline',
	`allowed_tools` json,
	`disallowed_tools` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `emperor_skills_id` PRIMARY KEY(`id`),
	CONSTRAINT `emperor_skills_slug_unique` UNIQUE(`slug`)
);

CREATE TABLE `emperor_tool_runs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`workspaceId` int,
	`toolRunId` varchar(80) NOT NULL,
	`toolSlug` varchar(128) NOT NULL,
	`toolName` varchar(255),
	`toolType` enum('mcp','api','internal','code') NOT NULL,
	`source` enum('builtin','emperor_tools','mcp_connector') NOT NULL,
	`status` enum('running','succeeded','failed','blocked') NOT NULL DEFAULT 'running',
	`riskLevel` enum('low','medium','high','critical') NOT NULL DEFAULT 'medium',
	`userId` int NOT NULL,
	`agentRunId` varchar(80),
	`nodeId` varchar(128),
	`projectId` int,
	`input` json,
	`output` json,
	`normalizedOutput` json,
	`errorMessage` text,
	`retentionClass` enum('hot','warm','cold','archive') NOT NULL DEFAULT 'hot',
	`archiveAfter` timestamp,
	`deleteAfter` timestamp,
	`archivedAt` timestamp,
	`archiveBatchId` varchar(80),
	`failureKind` enum('policy','rate_limit','circuit_open','schema','auth','timeout','network','http','executor','unknown'),
	`retryable` int NOT NULL DEFAULT 0,
	`attemptCount` int NOT NULL DEFAULT 0,
	`governanceDecision` json,
	`secretRefs` json,
	`circuitState` varchar(32),
	`durationMs` int,
	`httpStatus` int,
	`requestHost` varchar(255),
	`startedAt` timestamp,
	`completedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `emperor_tool_runs_id` PRIMARY KEY(`id`),
	CONSTRAINT `emperor_tool_runs_toolRunId_unique` UNIQUE(`toolRunId`)
);

CREATE TABLE `emperor_tool_secrets` (
	`id` int AUTO_INCREMENT NOT NULL,
	`workspaceId` int,
	`slug` varchar(128) NOT NULL,
	`description` text,
	`encryptedValue` text NOT NULL,
	`iv` varchar(32) NOT NULL,
	`authTag` varchar(32) NOT NULL,
	`keyVersion` varchar(64) NOT NULL DEFAULT 'v1',
	`previousKeyVersion` varchar(64),
	`status` enum('active','rotating','retired') NOT NULL DEFAULT 'active',
	`rotatedAt` timestamp,
	`expiresAt` timestamp,
	`metadata` json,
	`createdBy` int,
	`updatedBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `emperor_tool_secrets_id` PRIMARY KEY(`id`),
	CONSTRAINT `emperor_tool_secrets_slug_unique` UNIQUE(`slug`)
);

CREATE TABLE `emperor_tools` (
	`id` int AUTO_INCREMENT NOT NULL,
	`workspaceId` int,
	`slug` varchar(128) NOT NULL,
	`name` varchar(255) NOT NULL,
	`description` text,
	`type` enum('mcp','api','internal','code') NOT NULL,
	`config` json,
	`governancePolicy` json,
	`permissionPolicy` json,
	`rateLimitPolicy` json,
	`circuitBreakerPolicy` json,
	`secretRefs` json,
	`outputPolicy` json,
	`inputSchema` json,
	`outputSchema` json,
	`isActive` int NOT NULL DEFAULT 1,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `emperor_tools_id` PRIMARY KEY(`id`),
	CONSTRAINT `emperor_tools_slug_unique` UNIQUE(`slug`)
);

CREATE TABLE `execution_reviews` (
	`workspaceId` int,
	`id` int AUTO_INCREMENT NOT NULL,
	`product_profile_id` int NOT NULL,
	`user_id` int NOT NULL,
	`plan_id` int,
	`parent_asin` varchar(20),
	`period` varchar(50) NOT NULL,
	`period_type` enum('weekly','monthly','quarterly') NOT NULL DEFAULT 'monthly',
	`baseline_sales` decimal(12,2),
	`baseline_profit_rate` decimal(5,2),
	`baseline_subcategory_rank` int,
	`baseline_conv_rate` decimal(5,2),
	`baseline_organic_orders` int,
	`baseline_ad_orders` int,
	`baseline_rating_score` decimal(3,2),
	`baseline_rating_count` int,
	`baseline_week_label` varchar(50),
	`actual_sales` decimal(12,2),
	`actual_profit_rate` decimal(5,2),
	`actual_subcategory_rank` int,
	`actual_conv_rate` decimal(5,2),
	`actual_organic_orders` int,
	`actual_ad_orders` int,
	`actual_rating_score` decimal(3,2),
	`actual_rating_count` int,
	`actual_week_label` varchar(100),
	`actual_week_count` int DEFAULT 1,
	`target_sales` decimal(12,2),
	`target_subcategory_rank` int,
	`target_conv_rate` decimal(5,2),
	`target_organic_orders` int,
	`target_ad_orders` int,
	`target_rating_score` decimal(3,2),
	`target_rating_count` int,
	`target_week_label` varchar(50),
	`achievement_summary` text,
	`key_actions` text,
	`lessons_learned` text,
	`next_period_plan` text,
	`strategist_feedback` text,
	`strategist_rating` enum('S','A','B','C','D'),
	`ai_analysis` text,
	`ai_analysis_locked` int DEFAULT 0,
	`review_status` enum('draft','submitted','reviewed') NOT NULL DEFAULT 'draft',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `execution_reviews_id` PRIMARY KEY(`id`)
);

CREATE TABLE `expression_group_images` (
	`id` int AUTO_INCREMENT NOT NULL,
	`groupId` int NOT NULL,
	`projectId` int NOT NULL,
	`userId` int NOT NULL,
	`competitorName` varchar(255) NOT NULL DEFAULT '',
	`imageUrl` text NOT NULL,
	`sortOrder` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `expression_group_images_id` PRIMARY KEY(`id`)
);

CREATE TABLE `expression_groups` (
	`id` int AUTO_INCREMENT NOT NULL,
	`projectId` int NOT NULL,
	`userId` int NOT NULL,
	`expressionName` varchar(255) NOT NULL,
	`aiAnalysis` text,
	`userEdit` text,
	`confirmed` int NOT NULL DEFAULT 0,
	`sortOrder` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `expression_groups_id` PRIMARY KEY(`id`)
);

CREATE TABLE `image_acquisition_capability_coverage_revisions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`workspaceId` int NOT NULL,
	`projectId` int NOT NULL,
	`sourceSnapshotId` int NOT NULL,
	`confirmedSnapshotId` int,
	`consumerLinkId` int,
	`capability` enum('image_gallery','aplus','brand_story') NOT NULL,
	`coverageState` enum('not_requested','returned','confirmed_absent','not_returned','provider_unsupported','download_failed','pending_supplement','manually_supplemented') NOT NULL,
	`roleCoverageJson` json NOT NULL,
	`coverageHash` varchar(64) NOT NULL,
	`revision` int NOT NULL DEFAULT 1,
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `image_acquisition_capability_coverage_revisions_id` PRIMARY KEY(`id`),
	CONSTRAINT `uk_image_acq_coverage_snapshot_cap_revision` UNIQUE(`workspaceId`,`projectId`,`sourceSnapshotId`,`capability`,`revision`)
);

CREATE TABLE `image_asset_policy_revisions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`assetId` varchar(80) NOT NULL,
	`workspaceId` int NOT NULL,
	`projectId` int NOT NULL,
	`sourceReferenceId` int,
	`originKind` enum('competitor_research','own_product','approved_knowledge_reference','designer_upload','legacy_unclassified') NOT NULL,
	`originRecordType` varchar(64) NOT NULL,
	`originRecordId` varchar(128) NOT NULL,
	`contentHash` varchar(64),
	`allowedUsesJson` json NOT NULL,
	`licenseEvidenceJson` json,
	`reviewState` enum('unclassified','pending_review','approved','rejected','revoked','superseded') NOT NULL DEFAULT 'unclassified',
	`revision` int NOT NULL DEFAULT 1,
	`policyHash` varchar(64) NOT NULL,
	`createdBy` int NOT NULL,
	`reviewedBy` int,
	`reviewedAt` timestamp,
	`reviewNote` varchar(1024),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `image_asset_policy_revisions_id` PRIMARY KEY(`id`),
	CONSTRAINT `uk_image_asset_policy_scope_asset_revision` UNIQUE(`workspaceId`,`projectId`,`assetId`,`revision`)
);

CREATE TABLE `image_asset_source_references` (
	`id` int AUTO_INCREMENT NOT NULL,
	`assetId` varchar(80) NOT NULL,
	`workspaceId` int NOT NULL,
	`projectId` int NOT NULL,
	`sourceSnapshotId` int,
	`originRecordType` varchar(64) NOT NULL,
	`originRecordId` varchar(128) NOT NULL,
	`sourceRole` enum('main','secondary','aplus','brand_story','video','unknown') NOT NULL DEFAULT 'unknown',
	`sourceModule` varchar(128) NOT NULL DEFAULT '',
	`sourcePosition` int NOT NULL,
	`sourceReferenceKey` varchar(128) NOT NULL,
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `image_asset_source_references_id` PRIMARY KEY(`id`),
	CONSTRAINT `uk_image_asset_source_reference_scope_key` UNIQUE(`workspaceId`,`projectId`,`sourceReferenceKey`)
);

CREATE TABLE `image_assets` (
	`id` int AUTO_INCREMENT NOT NULL,
	`assetId` varchar(80) NOT NULL,
	`workspaceId` int NOT NULL,
	`assetType` enum('image') NOT NULL DEFAULT 'image',
	`contentHash` varchar(64),
	`storageRef` varchar(1024) NOT NULL,
	`contentType` varchar(128),
	`sizeBytes` int,
	`width` int,
	`height` int,
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `image_assets_id` PRIMARY KEY(`id`),
	CONSTRAINT `uk_image_asset_workspace_asset` UNIQUE(`workspaceId`,`assetId`),
	CONSTRAINT `uk_image_asset_workspace_hash` UNIQUE(`workspaceId`,`contentHash`)
);

CREATE TABLE `image_competitor_asset_facts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`workspaceId` int NOT NULL,
	`projectId` int NOT NULL,
	`subjectId` int NOT NULL,
	`acquisitionAssetId` int NOT NULL,
	`assetRole` varchar(32) NOT NULL,
	`positionIndex` int NOT NULL,
	`inputContentHash` varchar(64) NOT NULL,
	`status` enum('pending','analyzed','review_required','confirmed','excluded','failed') NOT NULL DEFAULT 'pending',
	`aiFacts` json,
	`userEdit` json,
	`confidence` decimal(5,4),
	`analyzedByJobRunId` varchar(80),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `image_competitor_asset_facts_id` PRIMARY KEY(`id`),
	CONSTRAINT `uk_image_comp_fact_subject_asset` UNIQUE(`subjectId`,`acquisitionAssetId`)
);

CREATE TABLE `image_competitor_gallery_analysis_versions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`workspaceId` int NOT NULL,
	`projectId` int NOT NULL,
	`subjectId` int NOT NULL,
	`selectionVersionId` int,
	`version` int NOT NULL,
	`inputHash` varchar(64) NOT NULL,
	`status` enum('draft','review_required','confirmed','superseded','failed') NOT NULL DEFAULT 'draft',
	`analysis` json NOT NULL,
	`userEdit` json,
	`evidenceAssetIds` json NOT NULL,
	`skillVersion` varchar(64) NOT NULL,
	`jobRunId` varchar(80),
	`createdBy` int NOT NULL,
	`confirmedBy` int,
	`confirmedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `image_competitor_gallery_analysis_versions_id` PRIMARY KEY(`id`),
	CONSTRAINT `uk_image_comp_gallery_subject_ver` UNIQUE(`subjectId`,`version`)
);

CREATE TABLE `image_competitor_gallery_selection_versions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`workspaceId` int NOT NULL,
	`projectId` int NOT NULL,
	`subjectId` int NOT NULL,
	`confirmedSnapshotId` int NOT NULL,
	`version` int NOT NULL,
	`status` enum('draft','confirmed','superseded') NOT NULL DEFAULT 'draft',
	`filterState` json NOT NULL,
	`selectedAssetIds` json NOT NULL,
	`selectionHash` varchar(64) NOT NULL,
	`createdBy` int NOT NULL,
	`confirmedBy` int,
	`confirmedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `image_competitor_gallery_selection_versions_id` PRIMARY KEY(`id`),
	CONSTRAINT `uk_image_comp_gallery_selection_subject_ver` UNIQUE(`subjectId`,`version`)
);

CREATE TABLE `image_competitor_research_subjects` (
	`id` int AUTO_INCREMENT NOT NULL,
	`workspaceId` int NOT NULL,
	`projectId` int NOT NULL,
	`userId` int NOT NULL,
	`confirmedSnapshotId` int NOT NULL,
	`marketplace` varchar(16) NOT NULL DEFAULT 'US',
	`asin` varchar(20) NOT NULL,
	`displayName` varchar(255) NOT NULL DEFAULT '',
	`role` enum('primary','benchmark','supplemental') NOT NULL DEFAULT 'benchmark',
	`status` enum('draft','ready','analyzing','review_required','confirmed','archived') NOT NULL DEFAULT 'draft',
	`currentAnalysisVersion` int NOT NULL DEFAULT 0,
	`sortOrder` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `image_competitor_research_subjects_id` PRIMARY KEY(`id`),
	CONSTRAINT `uk_image_comp_subject_snapshot` UNIQUE(`workspaceId`,`projectId`,`confirmedSnapshotId`)
);

CREATE TABLE `image_expression_analysis_versions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`workspaceId` int NOT NULL,
	`projectId` int NOT NULL,
	`sessionId` int NOT NULL,
	`groupId` int NOT NULL,
	`selectionVersionId` int NOT NULL,
	`version` int NOT NULL,
	`inputHash` varchar(64) NOT NULL,
	`status` enum('draft','review_required','confirmed','superseded','failed') NOT NULL DEFAULT 'draft',
	`analysis` json NOT NULL,
	`userEdit` json,
	`evidenceAssetIds` json NOT NULL,
	`skillVersion` varchar(64) NOT NULL,
	`jobRunId` varchar(80),
	`createdBy` int NOT NULL,
	`confirmedBy` int,
	`confirmedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `image_expression_analysis_versions_id` PRIMARY KEY(`id`),
	CONSTRAINT `uk_image_expr_analysis_group_ver` UNIQUE(`groupId`,`version`)
);

CREATE TABLE `image_expression_asset_links` (
	`id` int AUTO_INCREMENT NOT NULL,
	`workspaceId` int NOT NULL,
	`projectId` int NOT NULL,
	`selectionVersionId` int NOT NULL,
	`groupId` int NOT NULL,
	`subjectId` int NOT NULL,
	`acquisitionAssetId` int NOT NULL,
	`sortOrder` int NOT NULL DEFAULT 0,
	`source` enum('manual','ai_recommended') NOT NULL DEFAULT 'manual',
	`matchScore` decimal(5,4),
	`matchedSellingPoint` varchar(512),
	`matchedExpressionMethod` varchar(512),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `image_expression_asset_links_id` PRIMARY KEY(`id`),
	CONSTRAINT `uk_image_expr_asset_selection` UNIQUE(`selectionVersionId`,`acquisitionAssetId`)
);

CREATE TABLE `image_expression_selection_versions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`workspaceId` int NOT NULL,
	`projectId` int NOT NULL,
	`sessionId` int NOT NULL,
	`groupId` int NOT NULL,
	`version` int NOT NULL,
	`status` enum('draft','confirmed','superseded') NOT NULL DEFAULT 'draft',
	`filterState` json NOT NULL,
	`selectedAssetIds` json NOT NULL,
	`selectionHash` varchar(64) NOT NULL,
	`createdBy` int NOT NULL,
	`confirmedBy` int,
	`confirmedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `image_expression_selection_versions_id` PRIMARY KEY(`id`),
	CONSTRAINT `uk_image_expr_selection_group_ver` UNIQUE(`groupId`,`version`)
);

CREATE TABLE `image_step0_synthesis_versions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`workspaceId` int NOT NULL,
	`projectId` int NOT NULL,
	`sessionId` int NOT NULL,
	`version` int NOT NULL,
	`inputHash` varchar(64) NOT NULL,
	`status` enum('draft','review_required','confirmed','superseded','failed') NOT NULL DEFAULT 'draft',
	`analysis` json NOT NULL,
	`userEdit` json,
	`selectedDecisionIds` json NOT NULL,
	`evidenceRefs` json NOT NULL,
	`skillVersion` varchar(64) NOT NULL,
	`jobRunId` varchar(80),
	`createdBy` int NOT NULL,
	`confirmedBy` int,
	`confirmedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `image_step0_synthesis_versions_id` PRIMARY KEY(`id`),
	CONSTRAINT `uk_image_step0_synthesis_session_ver` UNIQUE(`sessionId`,`version`)
);

CREATE TABLE `image_workflow_sessions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`projectId` int NOT NULL,
	`userId` int NOT NULL,
	`currentStep` int NOT NULL DEFAULT 1,
	`step0AiResult` text,
	`step0UserEdit` text,
	`step0Confirmed` int NOT NULL DEFAULT 0,
	`step1AiResult` text,
	`step1UserEdit` text,
	`step1Confirmed` int NOT NULL DEFAULT 0,
	`step2AiResult` text,
	`step2UserEdit` text,
	`step2Confirmed` int NOT NULL DEFAULT 0,
	`step3AiResult` text,
	`step3UserEdit` text,
	`step3Confirmed` int NOT NULL DEFAULT 0,
	`step4AiResult` text,
	`step4UserEdit` text,
	`step4Confirmed` int NOT NULL DEFAULT 0,
	`step5AiResult` longtext,
	`step5AiResultCn` longtext,
	`step5UserEdit` longtext,
	`step5Confirmed` int NOT NULL DEFAULT 0,
	`agentRunId` varchar(80),
	`step5RunId` varchar(80),
	`step5RunStatus` enum('idle','queued','running','succeeded','failed','canceled') NOT NULL DEFAULT 'idle',
	`step5RunProgress` int NOT NULL DEFAULT 0,
	`step5RunError` longtext,
	`step5RunSegments` longtext,
	`step5RunFailedGroup` varchar(64),
	`step5RunFailedModule` varchar(128),
	`step5RunStartedAt` timestamp,
	`step5RunCompletedAt` timestamp,
	`step4CompositionRefs` text,
	`step4EffectRefs` text,
	`step5SelectedModule` text,
	`step5OptimizedResult` longtext,
	`step5OptimizedResultCn` longtext,
	`step5DesignerUploads` text,
	`step6AiResult` text,
	`step6AiResultCn` text,
	`step6UserEdit` text,
	`step6Confirmed` int NOT NULL DEFAULT 0,
	`step6LovartResult` text,
	`step6LovartResultEn` text,
	`step6LovartUserEdit` text,
	`step6LovartConfirmed` int NOT NULL DEFAULT 0,
	`pdfUrl` text,
	`status` enum('in_progress','completed') NOT NULL DEFAULT 'in_progress',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `image_workflow_sessions_id` PRIMARY KEY(`id`)
);

CREATE TABLE `image_workflow_step0_artifacts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`workspaceId` int NOT NULL,
	`projectId` int NOT NULL,
	`sessionId` int NOT NULL,
	`artifactType` enum('competitor_gallery','expression_summary','composite') NOT NULL,
	`version` int NOT NULL,
	`status` enum('draft','review_required','confirmed','superseded') NOT NULL DEFAULT 'draft',
	`content` json NOT NULL,
	`evidenceRefs` json NOT NULL,
	`createdBy` int NOT NULL,
	`confirmedBy` int,
	`confirmedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `image_workflow_step0_artifacts_id` PRIMARY KEY(`id`),
	CONSTRAINT `uk_image_step0_artifact_ver` UNIQUE(`sessionId`,`artifactType`,`version`)
);

CREATE TABLE `image_workflow_step4_image_versions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`sessionId` int NOT NULL,
	`projectId` int NOT NULL,
	`userId` int NOT NULL,
	`imageIndex` int NOT NULL,
	`imageKey` varchar(80) NOT NULL,
	`version` int NOT NULL,
	`status` enum('confirmed','superseded','unlocked') NOT NULL DEFAULT 'confirmed',
	`isCurrent` int NOT NULL DEFAULT 1,
	`content` text NOT NULL,
	`confirmedAt` timestamp NOT NULL DEFAULT (now()),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `image_workflow_step4_image_versions_id` PRIMARY KEY(`id`)
);

CREATE TABLE `inventory_config` (
	`workspaceId` int,
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`seller_sku` varchar(100) NOT NULL,
	`marketplace` varchar(10) DEFAULT 'US',
	`lead_time_days` int DEFAULT 30,
	`production_time_days` int DEFAULT 15,
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

CREATE TABLE `inventory_snapshots` (
	`workspaceId` int,
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

CREATE TABLE `kb_bot_conversations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`title` varchar(255),
	`lastMessageAt` bigint,
	`messageCount` int DEFAULT 0,
	`createdAt` bigint NOT NULL,
	`updatedAt` bigint NOT NULL,
	CONSTRAINT `kb_bot_conversations_id` PRIMARY KEY(`id`)
);

CREATE TABLE `kb_bot_messages` (
	`id` int AUTO_INCREMENT NOT NULL,
	`conversationId` int NOT NULL,
	`role` enum('user','assistant') NOT NULL,
	`content` text NOT NULL,
	`references` json,
	`searchPath` json,
	`tokensUsed` int,
	`createdAt` bigint NOT NULL,
	CONSTRAINT `kb_bot_messages_id` PRIMARY KEY(`id`)
);

CREATE TABLE `kb_call_logs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`callerModule` varchar(100) NOT NULL,
	`callerAction` varchar(100) NOT NULL,
	`kbItemId` int NOT NULL,
	`kbItemType` varchar(50) NOT NULL,
	`loadLevel` enum('L1','L2','L3') NOT NULL,
	`relevanceScore` decimal(3,2),
	`createdAt` bigint NOT NULL,
	CONSTRAINT `kb_call_logs_id` PRIMARY KEY(`id`)
);

CREATE TABLE `kb_feedback` (
	`id` int AUTO_INCREMENT NOT NULL,
	`callLogId` int,
	`conversationMessageId` int,
	`userId` int NOT NULL,
	`kbItemId` int NOT NULL,
	`kbItemType` varchar(50) NOT NULL,
	`rating` enum('helpful','irrelevant','wrong') NOT NULL,
	`comment` text,
	`createdAt` bigint NOT NULL,
	CONSTRAINT `kb_feedback_id` PRIMARY KEY(`id`)
);

CREATE TABLE `kb_image_sets` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`workspaceId` int NOT NULL,
	`asin` varchar(20) NOT NULL,
	`productTitle` varchar(512),
	`category` varchar(128),
	`brand` varchar(128),
	`overallAnalysis` text,
	`userEditedOverallAnalysis` text,
	`overallScore` int,
	`setStyle` varchar(30),
	`setStyleParams` text,
	`setPrimaryColor` varchar(20),
	`setAccentColor` varchar(20),
	`setCategory` varchar(30),
	`setTargetAudience` varchar(200),
	`setCategoryScene` varchar(200),
	`status` enum('crawling','analyzing','pending_review','confirmed','archived') NOT NULL DEFAULT 'crawling',
	`reviewStatus` enum('draft','pending_review','approved','rejected') NOT NULL DEFAULT 'draft',
	`reviewedBy` int,
	`reviewNote` text,
	`reviewedAt` timestamp,
	`submittedAt` timestamp,
	`visibility` enum('private','team','public') NOT NULL DEFAULT 'private',
	`confirmedAt` timestamp,
	`origin_instance_id` varchar(100),
	`remote_id` int,
	`sync_version` int DEFAULT 0,
	`last_synced_at` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `kb_image_sets_id` PRIMARY KEY(`id`)
);

CREATE TABLE `kb_images` (
	`id` int AUTO_INCREMENT NOT NULL,
	`imageSetId` int NOT NULL,
	`imageUrl` varchar(1024) NOT NULL,
	`imagePosition` enum('main','secondary','aplus','brand_story') NOT NULL,
	`positionIndex` int,
	`tagCategory` varchar(64),
	`tagColorScheme` varchar(64),
	`tagImageType` varchar(64),
	`tagDesignStyle` varchar(64),
	`tagImageBelong` varchar(20),
	`tagImageBelongSub` varchar(30),
	`tagImageTypeMain` varchar(20),
	`tagImageTypeSub` varchar(30),
	`tagSellingPointCategory` varchar(20),
	`tagSellingPointDetail` varchar(200),
	`tagComposition` varchar(20),
	`tagColorSchemeV2` varchar(30),
	`tagDesignStyleV2` varchar(30),
	`aiDimensionAnalysis` text,
	`userEditedDimensionAnalysis` text,
	`aplusModuleType` varchar(64),
	`aplusModuleClass` varchar(128),
	`singleImageScore` int,
	`highlights` text,
	`tagsConfirmed` int NOT NULL DEFAULT 0,
	`analysisConfirmed` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `kb_images_id` PRIMARY KEY(`id`)
);

CREATE TABLE `kb_intel_collect_logs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`sourceId` int NOT NULL,
	`userId` int NOT NULL,
	`triggerType` enum('manual','auto','test') NOT NULL,
	`status` enum('running','success','partial','failed') NOT NULL DEFAULT 'running',
	`totalFound` int DEFAULT 0,
	`totalNew` int DEFAULT 0,
	`totalDuplicate` int DEFAULT 0,
	`totalEvaluated` int DEFAULT 0,
	`totalRecommended` int DEFAULT 0,
	`errorMessage` text,
	`details` json,
	`startedAt` bigint NOT NULL,
	`completedAt` bigint,
	`durationMs` int,
	CONSTRAINT `kb_intel_collect_logs_id` PRIMARY KEY(`id`)
);

CREATE TABLE `kb_intel_items` (
	`id` int AUTO_INCREMENT NOT NULL,
	`sourceId` int NOT NULL,
	`title` varchar(500) NOT NULL,
	`author` varchar(200),
	`originalUrl` varchar(1000) NOT NULL,
	`publishedAt` bigint,
	`rawContent` text NOT NULL,
	`aiSummary` text,
	`aiQualityScore` decimal(3,1),
	`aiScoreDetails` json,
	`aiSuggestedType` enum('sop','listing','product','image','video'),
	`aiFormattedContent` text,
	`status` enum('pending','recommended','adopted','ignored','expired','bookmarked') NOT NULL DEFAULT 'pending',
	`adoptedKbType` varchar(50),
	`adoptedKbItemId` int,
	`reviewedBy` int,
	`reviewedAt` bigint,
	`createdAt` bigint NOT NULL,
	CONSTRAINT `kb_intel_items_id` PRIMARY KEY(`id`)
);

CREATE TABLE `kb_intel_sources` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`name` varchar(200) NOT NULL,
	`sourceType` enum('amazon_news','wearesellers','media','custom_url','rss') NOT NULL,
	`url` varchar(1000) NOT NULL,
	`crawlFrequency` enum('daily','weekly','manual') NOT NULL DEFAULT 'manual',
	`qualityThreshold` decimal(3,1) DEFAULT '6.0',
	`isActive` boolean NOT NULL DEFAULT true,
	`lastCrawledAt` bigint,
	`totalCrawled` int DEFAULT 0,
	`totalAdopted` int DEFAULT 0,
	`autoCollectEnabled` boolean NOT NULL DEFAULT false,
	`autoCollectCron` varchar(100),
	`autoCollectInterval` enum('every_6h','every_12h','daily','weekly','custom') DEFAULT 'daily',
	`lastAutoCollectAt` bigint,
	`nextAutoCollectAt` bigint,
	`autoEvaluateEnabled` boolean NOT NULL DEFAULT true,
	`autoCollectMaxItems` int DEFAULT 10,
	`consecutiveFailures` int DEFAULT 0,
	`createdAt` bigint NOT NULL,
	`updatedAt` bigint NOT NULL,
	CONSTRAINT `kb_intel_sources_id` PRIMARY KEY(`id`)
);

CREATE TABLE `kb_listing_copywriting` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`workspaceId` int NOT NULL,
	`asin` varchar(20) NOT NULL,
	`productTitle` varchar(512),
	`category` varchar(128),
	`brand` varchar(128),
	`titleText` text,
	`bulletPoints` text,
	`longDescription` text,
	`aPlusContent` text,
	`qaContent` text,
	`crawledData` text,
	`aiAnalysis` text,
	`userEditedAnalysis` text,
	`tags` text,
	`overallScore` int,
	`status` enum('crawling','analyzing','pending_review','confirmed','archived') NOT NULL DEFAULT 'crawling',
	`reviewStatus` enum('draft','pending_review','approved','rejected') NOT NULL DEFAULT 'draft',
	`reviewedBy` int,
	`reviewNote` text,
	`reviewedAt` timestamp,
	`submittedAt` timestamp,
	`visibility` enum('private','team','public') NOT NULL DEFAULT 'private',
	`confirmedAt` timestamp,
	`origin_instance_id` varchar(100),
	`remote_id` int,
	`sync_version` int DEFAULT 0,
	`last_synced_at` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `kb_listing_copywriting_id` PRIMARY KEY(`id`)
);

CREATE TABLE `kb_operation_skills` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`workspaceId` int NOT NULL,
	`title` varchar(256) NOT NULL,
	`sourceType` enum('upload_pdf','upload_word','upload_excel','upload_ppt','upload_md','upload_image','upload_mindmap','url','manual') NOT NULL,
	`sourceUrl` varchar(1024),
	`fileUrl` varchar(1024),
	`originalFileName` varchar(256),
	`extractedContent` text,
	`aiSummary` text,
	`userEditedSummary` text,
	`categories` text,
	`tags` text,
	`practicalityScore` int,
	`status` enum('parsing','analyzing','pending_review','confirmed','archived') NOT NULL DEFAULT 'parsing',
	`reviewStatus` enum('draft','pending_review','approved','rejected') NOT NULL DEFAULT 'draft',
	`reviewedBy` int,
	`reviewNote` text,
	`reviewedAt` timestamp,
	`submittedAt` timestamp,
	`visibility` enum('private','team','public') NOT NULL DEFAULT 'private',
	`accessLevel` enum('public','team','restricted') NOT NULL DEFAULT 'public',
	`allowedRoles` text,
	`confirmedAt` timestamp,
	`origin_instance_id` varchar(100),
	`remote_id` int,
	`sync_version` int DEFAULT 0,
	`last_synced_at` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `kb_operation_skills_id` PRIMARY KEY(`id`)
);

CREATE TABLE `kb_product_innovations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`workspaceId` int NOT NULL,
	`asin` varchar(20) NOT NULL,
	`productUrl` varchar(1024),
	`productTitle` varchar(512),
	`brand` varchar(128),
	`price` varchar(50),
	`bsr` int,
	`rating` varchar(10),
	`reviewCount` varchar(20),
	`category` varchar(128),
	`bulletPoints` text,
	`imageUrls` text,
	`crawledData` text,
	`aiAnalysis` text,
	`userEditedAnalysis` text,
	`tags` text,
	`overallScore` int,
	`status` enum('crawling','analyzing','pending_review','confirmed','archived') NOT NULL DEFAULT 'crawling',
	`reviewStatus` enum('draft','pending_review','approved','rejected') NOT NULL DEFAULT 'draft',
	`reviewedBy` int,
	`reviewNote` text,
	`reviewedAt` timestamp,
	`submittedAt` timestamp,
	`visibility` enum('private','team','public') NOT NULL DEFAULT 'private',
	`confirmedAt` timestamp,
	`origin_instance_id` varchar(100),
	`remote_id` int,
	`sync_version` int DEFAULT 0,
	`last_synced_at` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `kb_product_innovations_id` PRIMARY KEY(`id`)
);

CREATE TABLE `kb_sync_logs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`syncDirection` enum('push','pull') NOT NULL,
	`resourceType` enum('kb_product','kb_listing','kb_image_set','kb_video','kb_skill') NOT NULL,
	`resourceId` int NOT NULL,
	`remoteResourceId` int,
	`syncStatus` enum('pending','synced','conflict','failed') NOT NULL DEFAULT 'pending',
	`conflictDetail` text,
	`peer_instance_id` varchar(100),
	`item_count` int DEFAULT 0,
	`error_detail` text,
	`syncedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `kb_sync_logs_id` PRIMARY KEY(`id`)
);

CREATE TABLE `kb_tag_definitions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`dimension` varchar(50) NOT NULL,
	`parentValue` varchar(100),
	`value` varchar(200) NOT NULL,
	`sortOrder` int NOT NULL DEFAULT 0,
	`isSystem` int NOT NULL DEFAULT 0,
	`metadata` text,
	`usageCount` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `kb_tag_definitions_id` PRIMARY KEY(`id`)
);

CREATE TABLE `kb_transfer_item_receipts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`stageId` varchar(64) NOT NULL,
	`workspaceId` int NOT NULL,
	`module` enum('products','listings','images','skills','videos') NOT NULL,
	`contentHash` varchar(64) NOT NULL,
	`targetRecordId` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `kb_transfer_item_receipts_id` PRIMARY KEY(`id`)
);

CREATE TABLE `kb_transfer_stages` (
	`id` varchar(64) NOT NULL,
	`userId` int NOT NULL,
	`workspaceId` int NOT NULL,
	`status` enum('previewed','importing','completed','expired','failed') NOT NULL DEFAULT 'previewed',
	`packageSha256` varchar(64) NOT NULL,
	`originalFileName` varchar(255) NOT NULL,
	`manifestJson` longtext NOT NULL,
	`attachmentStorageJson` longtext NOT NULL,
	`previewJson` text NOT NULL,
	`importResultJson` text,
	`expiresAt` timestamp NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `kb_transfer_stages_id` PRIMARY KEY(`id`)
);

CREATE TABLE `kb_videos` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`workspaceId` int NOT NULL,
	`asin` varchar(20),
	`videoUrl` varchar(1024) NOT NULL,
	`videoTitle` varchar(512),
	`category` varchar(128),
	`duration` int,
	`thumbnailUrl` varchar(1024),
	`transcriptText` text,
	`keyframeUrls` text,
	`aiAnalysis` text,
	`userEditedAnalysis` text,
	`tags` text,
	`overallScore` int,
	`status` enum('downloading','transcribing','analyzing','pending_review','confirmed','archived') NOT NULL DEFAULT 'downloading',
	`reviewStatus` enum('draft','pending_review','approved','rejected') NOT NULL DEFAULT 'draft',
	`reviewedBy` int,
	`reviewNote` text,
	`reviewedAt` timestamp,
	`submittedAt` timestamp,
	`visibility` enum('private','team','public') NOT NULL DEFAULT 'private',
	`confirmedAt` timestamp,
	`origin_instance_id` varchar(100),
	`remote_id` int,
	`sync_version` int DEFAULT 0,
	`last_synced_at` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `kb_videos_id` PRIMARY KEY(`id`)
);

CREATE TABLE `keyword_daily_records` (
	`workspaceId` int,
	`id` int AUTO_INCREMENT NOT NULL,
	`tracking_id` int NOT NULL,
	`record_date` varchar(10) NOT NULL,
	`actual_organic_rank` int,
	`actual_ad_orders` int,
	`actual_ad_spend` decimal(12,2),
	`actual_impressions` int,
	`actual_clicks` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `keyword_daily_records_id` PRIMARY KEY(`id`)
);

CREATE TABLE `keyword_monitors` (
	`workspaceId` int,
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

CREATE TABLE `keyword_snapshots` (
	`workspaceId` int,
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

CREATE TABLE `keyword_trackings` (
	`workspaceId` int,
	`id` int AUTO_INCREMENT NOT NULL,
	`plan_id` int NOT NULL,
	`keyword` varchar(300) NOT NULL,
	`keyword_cn` varchar(300),
	`target_organic_rank` int,
	`target_daily_ad_orders` int,
	`is_core_keyword` int DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `keyword_trackings_id` PRIMARY KEY(`id`)
);

CREATE TABLE `keywords` (
	`id` int AUTO_INCREMENT NOT NULL,
	`projectId` int NOT NULL,
	`userId` int NOT NULL,
	`keyword` varchar(500) NOT NULL,
	`source` enum('manual','csv_import','asin_reverse','search_suggest','review_extract','ai_expand') NOT NULL DEFAULT 'manual',
	`sourceDetail` text,
	`relevance` enum('high','medium','low','none') NOT NULL DEFAULT 'medium',
	`trafficLevel` enum('high','medium','low') NOT NULL DEFAULT 'medium',
	`competition` enum('high','medium','low') NOT NULL DEFAULT 'medium',
	`monthlySearchVolume` int,
	`spr` int,
	`ppcBid` varchar(20),
	`naturalRank` int,
	`trafficScore` int,
	`sceneTags` text,
	`intentTag` varchar(100),
	`rootCategory` enum('core','function','scene','audience','spec','painpoint','gift_holiday','brand_competitor'),
	`rootWord` varchar(200),
	`rootImpact` enum('high','medium','low'),
	`strategyCategory` enum('core_main','sub_core','precise_longtail','scene_intent','longtail_main','observe_test','negative','brand_offensive'),
	`listingPlacement` enum('title_front','title_mid','title_end','bullet_first','bullet_body','aplus','search_term','not_use'),
	`translation_cn` varchar(500),
	`is_ac_recommended` int NOT NULL DEFAULT 0,
	`skip_semantic_filter` int NOT NULL DEFAULT 0,
	`status` enum('raw','cleaned','scored','tagged','finalized','negative') NOT NULL DEFAULT 'raw',
	`isNegative` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `keywords_id` PRIMARY KEY(`id`)
);

CREATE TABLE `knowledge_claim_ledger_consistency_decisions` (
	`decisionKey` varchar(80) NOT NULL,
	`workspaceId` int NOT NULL,
	`ledgerKey` varchar(80) NOT NULL,
	`matrixFingerprint` varchar(64) NOT NULL,
	`issueKey` varchar(160) NOT NULL,
	`decision` enum('accepted','ignored','new_version') NOT NULL,
	`note` text,
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `knowledge_claim_ledger_consistency_decisions_decisionKey` PRIMARY KEY(`decisionKey`)
);

CREATE TABLE `knowledge_claim_ledger_links` (
	`id` int AUTO_INCREMENT NOT NULL,
	`linkKey` varchar(80) NOT NULL,
	`workspaceId` int NOT NULL,
	`ledgerKey` varchar(80) NOT NULL,
	`claimKey` varchar(80) NOT NULL,
	`targetDomain` enum('listing','image','brand_story') NOT NULL,
	`targetType` varchar(64) NOT NULL,
	`targetRef` varchar(192) NOT NULL,
	`targetPosition` varchar(128),
	`status` enum('candidate','confirmed','locked','invalidated') NOT NULL DEFAULT 'candidate',
	`createdBy` int NOT NULL,
	`confirmedBy` int,
	`confirmedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `knowledge_claim_ledger_links_id` PRIMARY KEY(`id`),
	CONSTRAINT `knowledge_claim_ledger_links_linkKey_unique` UNIQUE(`linkKey`),
	CONSTRAINT `uq_claim_ledger_link_target` UNIQUE(`ledgerKey`,`claimKey`,`targetDomain`,`targetRef`)
);

CREATE TABLE `knowledge_claim_ledgers` (
	`id` int AUTO_INCREMENT NOT NULL,
	`ledgerKey` varchar(80) NOT NULL,
	`workspaceId` int NOT NULL,
	`businessProjectId` int,
	`listingId` int,
	`imageWorkflowSessionId` int,
	`profile` json NOT NULL,
	`claims` json NOT NULL,
	`status` enum('draft','review','locked','superseded','archived') NOT NULL DEFAULT 'draft',
	`artifactId` varchar(80),
	`version` int NOT NULL DEFAULT 1,
	`isCurrent` int NOT NULL DEFAULT 1,
	`parentLedgerKey` varchar(80),
	`lockedBy` int,
	`lockedAt` timestamp,
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `knowledge_claim_ledgers_id` PRIMARY KEY(`id`),
	CONSTRAINT `knowledge_claim_ledgers_ledgerKey_unique` UNIQUE(`ledgerKey`),
	CONSTRAINT `uq_claim_ledger_scope_version` UNIQUE(`workspaceId`,`businessProjectId`,`listingId`,`imageWorkflowSessionId`,`version`)
);

CREATE TABLE `knowledge_distillation_evidence` (
	`id` int AUTO_INCREMENT NOT NULL,
	`evidenceKey` varchar(80) NOT NULL,
	`workspaceId` int NOT NULL,
	`distillationProjectId` int NOT NULL,
	`sourceKey` varchar(80) NOT NULL,
	`evidenceType` enum('specification','benefit','compatibility','proof','objection','visual_pattern','compliance','brand') NOT NULL,
	`claim` text NOT NULL,
	`normalizedAttributes` json NOT NULL,
	`confidence` decimal(4,3) NOT NULL DEFAULT '0.000',
	`status` enum('draft','approved','rejected','invalidated') NOT NULL DEFAULT 'draft',
	`reviewerUserId` int,
	`reviewNote` text,
	`createdBy` int NOT NULL,
	`approvedAt` timestamp,
	`invalidatedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `knowledge_distillation_evidence_id` PRIMARY KEY(`id`),
	CONSTRAINT `knowledge_distillation_evidence_evidenceKey_unique` UNIQUE(`evidenceKey`),
	CONSTRAINT `uq_kdistill_evidence_project_source_claim` UNIQUE(`distillationProjectId`,`sourceKey`,`claim`(191))
);

CREATE TABLE `knowledge_distillation_projects` (
	`id` int AUTO_INCREMENT NOT NULL,
	`workspaceId` int NOT NULL,
	`projectKey` varchar(80) NOT NULL,
	`name` varchar(255) NOT NULL,
	`description` text,
	`status` enum('setup','ready','draft_review','paused','archived') NOT NULL DEFAULT 'setup',
	`profile` json NOT NULL,
	`sourcePolicy` json NOT NULL,
	`createdBy` int NOT NULL,
	`updatedBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `knowledge_distillation_projects_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_kdistill_project_workspace_key` UNIQUE(`workspaceId`,`projectKey`)
);

CREATE TABLE `knowledge_distillation_sources` (
	`id` int AUTO_INCREMENT NOT NULL,
	`sourceKey` varchar(80) NOT NULL,
	`workspaceId` int NOT NULL,
	`distillationProjectId` int NOT NULL,
	`sourceDomain` enum('products','listings','images','skills','videos') NOT NULL,
	`sourceTable` varchar(128) NOT NULL,
	`sourceRowId` varchar(128) NOT NULL,
	`sourceContentHash` varchar(64) NOT NULL,
	`sourceStatus` enum('eligible','invalidated','excluded') NOT NULL DEFAULT 'eligible',
	`sourceSummary` text,
	`sourceMetadata` json,
	`selectedBy` int NOT NULL,
	`confirmedBy` int,
	`confirmedAt` timestamp,
	`invalidatedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `knowledge_distillation_sources_id` PRIMARY KEY(`id`),
	CONSTRAINT `knowledge_distillation_sources_sourceKey_unique` UNIQUE(`sourceKey`),
	CONSTRAINT `uq_kdistill_source_identity` UNIQUE(`distillationProjectId`,`sourceTable`,`sourceRowId`,`sourceContentHash`)
);

CREATE TABLE `knowledge_skill_drafts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`draftKey` varchar(80) NOT NULL,
	`workspaceId` int NOT NULL,
	`distillationProjectId` int NOT NULL,
	`skillTypeKey` varchar(128) NOT NULL,
	`title` varchar(255) NOT NULL,
	`profile` json NOT NULL,
	`manifestDraft` json NOT NULL,
	`evidenceKeys` json NOT NULL,
	`sourceFingerprint` varchar(64) NOT NULL,
	`parentDraftKey` varchar(80),
	`proposedSkillSlug` varchar(128),
	`proposedSkillVersion` int,
	`status` enum('draft','conflict','review','approved','rejected','published','superseded') NOT NULL DEFAULT 'draft',
	`conflictReport` json,
	`reviewSummary` text,
	`artifactId` varchar(80),
	`createdBy` int NOT NULL,
	`reviewedBy` int,
	`reviewedAt` timestamp,
	`publishedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `knowledge_skill_drafts_id` PRIMARY KEY(`id`),
	CONSTRAINT `knowledge_skill_drafts_draftKey_unique` UNIQUE(`draftKey`),
	CONSTRAINT `uq_kdistill_draft_project_fingerprint` UNIQUE(`distillationProjectId`,`skillTypeKey`,`sourceFingerprint`)
);

CREATE TABLE `knowledge_skill_feedback` (
	`id` int AUTO_INCREMENT NOT NULL,
	`feedbackKey` varchar(80) NOT NULL,
	`workspaceId` int NOT NULL,
	`distillationProjectId` int,
	`skillSlug` varchar(128) NOT NULL,
	`skillVersion` int,
	`consumerDomain` enum('listing','image','other') NOT NULL,
	`consumerRef` varchar(192) NOT NULL,
	`outcome` enum('accepted','revised','rejected','published','issue') NOT NULL,
	`editDelta` json,
	`note` text,
	`recordedBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `knowledge_skill_feedback_id` PRIMARY KEY(`id`),
	CONSTRAINT `knowledge_skill_feedback_feedbackKey_unique` UNIQUE(`feedbackKey`)
);

CREATE TABLE `knowledge_skill_review_events` (
	`id` int AUTO_INCREMENT NOT NULL,
	`eventKey` varchar(80) NOT NULL,
	`workspaceId` int NOT NULL,
	`distillationProjectId` int NOT NULL,
	`draftKey` varchar(80),
	`eventType` enum('source_selected','source_invalidated','evidence_approved','draft_created','draft_edited','conflict_detected','review_requested','approved','rejected','published','rolled_back') NOT NULL,
	`beforeSnapshot` json,
	`afterSnapshot` json,
	`reason` text,
	`actorUserId` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `knowledge_skill_review_events_id` PRIMARY KEY(`id`),
	CONSTRAINT `knowledge_skill_review_events_eventKey_unique` UNIQUE(`eventKey`)
);

CREATE TABLE `lingxing_api_logs` (
	`workspaceId` int,
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

CREATE TABLE `lingxing_config` (
	`workspaceId` int,
	`id` int AUTO_INCREMENT NOT NULL,
	`config_key` varchar(100) NOT NULL,
	`config_value` text,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `lingxing_config_id` PRIMARY KEY(`id`),
	CONSTRAINT `lingxing_config_config_key_unique` UNIQUE(`config_key`)
);

CREATE TABLE `lingxing_product_weekly` (
	`workspaceId` int,
	`id` int AUTO_INCREMENT NOT NULL,
	`import_id` int NOT NULL,
	`user_id` int NOT NULL,
	`source_kind` varchar(48) NOT NULL DEFAULT 'uploaded_parent_asin_weekly',
	`source_batch_id` int,
	`source_trace_id` varchar(128),
	`source_schema_version` varchar(32),
	`week_start_date` varchar(10) NOT NULL,
	`week_end_date` varchar(10) NOT NULL,
	`asin` varchar(2000),
	`parent_asin` varchar(500),
	`msku` varchar(200),
	`store_name` varchar(200),
	`country` varchar(50),
	`title` varchar(1000),
	`price` varchar(200),
	`operator` varchar(200),
	`product_name` varchar(500),
	`sku` varchar(200),
	`brand` varchar(200),
	`category1` varchar(200),
	`category2` varchar(200),
	`category3` varchar(200),
	`auto_tag` varchar(500),
	`listing_tag` varchar(500),
	`created_time` varchar(50),
	`sales_qty` int DEFAULT 0,
	`sales_amount` decimal(14,2) DEFAULT '0',
	`order_qty` int DEFAULT 0,
	`net_sales_amount` decimal(14,2) DEFAULT '0',
	`sales_qty_mom` varchar(20),
	`sales_amount_mom` varchar(20),
	`order_qty_mom` varchar(20),
	`sales_qty_yoy` varchar(20),
	`sales_amount_yoy` varchar(20),
	`order_qty_yoy` varchar(20),
	`avg_sales_qty` decimal(10,1) DEFAULT '0',
	`avg_price` varchar(50),
	`b2b_sales_qty` int DEFAULT 0,
	`b2b_sales_amount` decimal(14,2) DEFAULT '0',
	`b2b_order_qty` int DEFAULT 0,
	`promo_sales_qty` int DEFAULT 0,
	`promo_sales_amount` decimal(14,2) DEFAULT '0',
	`promo_order_qty` int DEFAULT 0,
	`promo_discount` decimal(12,2) DEFAULT '0',
	`fbm_buyer_shipping` decimal(12,2) DEFAULT '0',
	`bsr_main` varchar(100),
	`bsr_sub` varchar(100),
	`settlement_profit` decimal(14,2) DEFAULT '0',
	`order_profit` decimal(14,2) DEFAULT '0',
	`settlement_profit_margin` varchar(20),
	`order_profit_margin` varchar(20),
	`roi` varchar(20),
	`refund_qty` int DEFAULT 0,
	`refund_amount` decimal(12,2) DEFAULT '0',
	`refund_rate` varchar(20),
	`return_qty` int DEFAULT 0,
	`return_rate` varchar(20),
	`rating` varchar(10),
	`review_count` int DEFAULT 0,
	`review_rate` varchar(20),
	`fbm_available` int DEFAULT 0,
	`fba_available` int DEFAULT 0,
	`fba_transfer_pending` int DEFAULT 0,
	`fba_transferring` int DEFAULT 0,
	`fba_inbound` int DEFAULT 0,
	`fba_total` int DEFAULT 0,
	`fba_pending_ship` int DEFAULT 0,
	`fba_in_transit` int DEFAULT 0,
	`fba_plan_inbound` int DEFAULT 0,
	`fba_unavailable` int DEFAULT 0,
	`available_stock` int DEFAULT 0,
	`fba_days_of_supply` int DEFAULT 0,
	`fbm_days_of_supply` int DEFAULT 0,
	`awd_in_stock` int DEFAULT 0,
	`awd_available` int DEFAULT 0,
	`awd_pending_ship` int DEFAULT 0,
	`awd_in_transit` int DEFAULT 0,
	`overseas_available` int DEFAULT 0,
	`local_available` int DEFAULT 0,
	`purchase_qty` int DEFAULT 0,
	`monthly_stock_sales_ratio` varchar(50),
	`stockout_date` varchar(50),
	`sessions_browser` int DEFAULT 0,
	`sessions_browser_pct` varchar(20),
	`sessions_mobile` int DEFAULT 0,
	`sessions_mobile_pct` varchar(20),
	`sessions_total` int DEFAULT 0,
	`sessions_pct` varchar(20),
	`unit_sessions_pct` varchar(20),
	`pv_browser` int DEFAULT 0,
	`pv_browser_pct` varchar(20),
	`pv_mobile` int DEFAULT 0,
	`pv_mobile_pct` varchar(20),
	`pv_total` int DEFAULT 0,
	`pv_pct` varchar(20),
	`cvr` varchar(20),
	`sales_cvr` varchar(20),
	`buybox_rate` varchar(20),
	`ad_impressions` int DEFAULT 0,
	`ad_clicks` int DEFAULT 0,
	`ad_spend` decimal(14,2) DEFAULT '0',
	`sp_ad_spend` decimal(14,2) DEFAULT '0',
	`sb_ad_spend` decimal(14,2) DEFAULT '0',
	`sbv_ad_spend` decimal(14,2) DEFAULT '0',
	`sd_ad_spend` decimal(14,2) DEFAULT '0',
	`st_ad_spend` decimal(14,2) DEFAULT '0',
	`live_ad_spend` decimal(14,2) DEFAULT '0',
	`ad_sales` decimal(14,2) DEFAULT '0',
	`sp_ad_sales` decimal(14,2) DEFAULT '0',
	`sb_ad_sales` decimal(14,2) DEFAULT '0',
	`sbv_ad_sales` decimal(14,2) DEFAULT '0',
	`sd_ad_sales` decimal(14,2) DEFAULT '0',
	`ad_orders` int DEFAULT 0,
	`sp_ad_orders` int DEFAULT 0,
	`sb_ad_orders` int DEFAULT 0,
	`sbv_ad_orders` int DEFAULT 0,
	`sd_ad_orders` int DEFAULT 0,
	`ad_order_pct` varchar(20),
	`direct_sales` decimal(14,2) DEFAULT '0',
	`direct_orders` int DEFAULT 0,
	`ctr` varchar(20),
	`ad_cvr` varchar(20),
	`cpc` varchar(20),
	`cpm` varchar(20),
	`roas` varchar(20),
	`acos` varchar(20),
	`tacos` varchar(20),
	`acoas` varchar(20),
	`asoas` varchar(20),
	`cpo` varchar(20),
	`cpu` varchar(20),
	`organic_clicks` int DEFAULT 0,
	`organic_orders` int DEFAULT 0,
	`organic_cvr` varchar(20),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `lingxing_product_weekly_id` PRIMARY KEY(`id`)
);

CREATE TABLE `listing_bullet_candidates` (
	`id` int AUTO_INCREMENT NOT NULL,
	`candidateKey` varchar(80) NOT NULL,
	`candidateRevision` int NOT NULL DEFAULT 1,
	`parentCandidateId` int,
	`workspaceId` int NOT NULL,
	`projectId` int NOT NULL,
	`coreRevisionId` int NOT NULL,
	`jobId` int,
	`skillRunId` int,
	`promptVersion` varchar(64),
	`actualModel` varchar(128),
	`inputHash` varchar(64) NOT NULL,
	`subtitle` varchar(500),
	`fullText` text,
	`evidenceFactIdsJson` json NOT NULL,
	`gateResultJson` json NOT NULL,
	`status` enum('draft','generated','gate_failed','review_required','confirmed','rejected','stale','failed') NOT NULL DEFAULT 'draft',
	`contentHash` varchar(64) NOT NULL,
	`createdBy` int NOT NULL,
	`staleAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `listing_bullet_candidates_id` PRIMARY KEY(`id`),
	CONSTRAINT `uk_listing_bullet_lineage_revision` UNIQUE(`coreRevisionId`,`candidateKey`,`candidateRevision`)
);

CREATE TABLE `listing_complete_snapshots` (
	`id` int AUTO_INCREMENT NOT NULL,
	`workspaceId` int NOT NULL,
	`projectId` int NOT NULL,
	`listingId` int NOT NULL,
	`contentVersion` int NOT NULL,
	`fullPayloadJson` json NOT NULL,
	`fullHash` varchar(64) NOT NULL,
	`humanApprovalRef` varchar(128),
	`changeType` enum('generate','manual_edit','candidate_apply','optimize','translate','rollback') NOT NULL,
	`status` enum('draft','approved','stale','superseded','legacy_unverified') NOT NULL DEFAULT 'draft',
	`expectedListingVersion` int NOT NULL,
	`listingVersion` int NOT NULL,
	`createdBy` int NOT NULL,
	`approvedBy` int,
	`approvedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `listing_complete_snapshots_id` PRIMARY KEY(`id`),
	CONSTRAINT `uk_listing_complete_listing_version` UNIQUE(`listingId`,`contentVersion`)
);

CREATE TABLE `listing_core_revisions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`coreId` varchar(80) NOT NULL,
	`workspaceId` int NOT NULL,
	`projectId` int NOT NULL,
	`sellingPointIndex` int NOT NULL,
	`buyerReason` text NOT NULL,
	`factRevisionIdsJson` json NOT NULL,
	`keywordIdsJson` json NOT NULL,
	`status` enum('draft','confirmed','rejected','stale','superseded') NOT NULL DEFAULT 'draft',
	`revision` int NOT NULL DEFAULT 1,
	`inputHash` varchar(64) NOT NULL,
	`contentHash` varchar(64) NOT NULL,
	`createdBy` int NOT NULL,
	`confirmedBy` int,
	`confirmedAt` timestamp,
	`staleAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `listing_core_revisions_id` PRIMARY KEY(`id`),
	CONSTRAINT `uk_listing_core_project_core_revision` UNIQUE(`projectId`,`coreId`,`revision`)
);

CREATE TABLE `listing_fact_revisions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`workspaceId` int NOT NULL,
	`projectId` int NOT NULL,
	`attributeKey` varchar(160) NOT NULL,
	`value` text NOT NULL,
	`valueJson` json,
	`sourceFileId` int,
	`proofFileId` int,
	`proofSourceRef` varchar(512),
	`rawHash` varchar(64),
	`sourceLine` int,
	`sourceLineHash` varchar(64),
	`sourceLocator` varchar(512),
	`provenance` enum('manual','upload','ai','legacy') NOT NULL DEFAULT 'manual',
	`status` enum('draft','confirmed','rejected','stale','legacy_unverified') NOT NULL DEFAULT 'draft',
	`revision` int NOT NULL DEFAULT 1,
	`contentHash` varchar(64) NOT NULL,
	`createdBy` int NOT NULL,
	`confirmedBy` int,
	`confirmedAt` timestamp,
	`reviewNote` text,
	`staleAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `listing_fact_revisions_id` PRIMARY KEY(`id`),
	CONSTRAINT `uk_listing_fact_project_attribute_revision` UNIQUE(`projectId`,`attributeKey`,`revision`)
);

CREATE TABLE `listing_review_revisions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`workspaceId` int NOT NULL,
	`projectId` int NOT NULL,
	`listingId` int,
	`candidateId` int NOT NULL,
	`reviewRevision` int NOT NULL DEFAULT 1,
	`decision` enum('accepted','edited','rejected','revoked') NOT NULL,
	`status` enum('recorded','superseded') NOT NULL DEFAULT 'recorded',
	`beforeHash` varchar(64),
	`afterHash` varchar(64),
	`expectedRevision` int NOT NULL,
	`resultingCandidateId` int,
	`reason` text,
	`actorId` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `listing_review_revisions_id` PRIMARY KEY(`id`),
	CONSTRAINT `uk_listing_review_candidate_revision` UNIQUE(`candidateId`,`reviewRevision`)
);

CREATE TABLE `listingVersions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`listingId` int NOT NULL,
	`projectId` int NOT NULL,
	`userId` int NOT NULL,
	`versionNumber` int NOT NULL DEFAULT 1,
	`changeType` enum('generate','ab_apply','optimize','manual_edit','translate') NOT NULL,
	`changeDescription` text,
	`title` text,
	`itemHighlights` text,
	`bulletPoints` text,
	`description` text,
	`searchTerms` text,
	`titleCn` text,
	`itemHighlightsCn` text,
	`bulletPointsCn` text,
	`descriptionCn` text,
	`searchTermsCn` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `listingVersions_id` PRIMARY KEY(`id`)
);

CREATE TABLE `listings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`projectId` int NOT NULL,
	`title` text,
	`itemHighlights` text,
	`bulletPoints` text,
	`description` text,
	`searchTerms` text,
	`imageAdvice` text,
	`imageAdviceCn` text,
	`titleCn` text,
	`itemHighlightsCn` text,
	`bulletPointsCn` text,
	`descriptionCn` text,
	`searchTermsCn` text,
	`qaContent` text,
	`qaContentCn` text,
	`lockedSteps` text,
	`checklistScores` text,
	`agentRunId` varchar(80),
	`version` int NOT NULL DEFAULT 1,
	`isActive` int NOT NULL DEFAULT 1,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `listings_id` PRIMARY KEY(`id`)
);

CREATE TABLE `login_logs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int,
	`loginMethod` enum('password','oauth') NOT NULL,
	`loginIdentifier` varchar(320),
	`ipAddress` varchar(45),
	`userAgent` varchar(512),
	`success` int NOT NULL,
	`failReason` varchar(100),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `login_logs_id` PRIMARY KEY(`id`)
);

CREATE TABLE `meeting_records` (
	`workspaceId` int,
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`title` varchar(300),
	`audio_url` text,
	`transcript` text,
	`extracted_tasks` text,
	`meeting_status` enum('uploading','transcribing','extracting','done','error') NOT NULL DEFAULT 'uploading',
	`error_message` text,
	`duration` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `meeting_records_id` PRIMARY KEY(`id`)
);

CREATE TABLE `negativeKeywords` (
	`id` int AUTO_INCREMENT NOT NULL,
	`projectId` int NOT NULL,
	`userId` int NOT NULL,
	`keyword` varchar(500) NOT NULL,
	`isRoot` int NOT NULL DEFAULT 0,
	`reason` text,
	`reason_cn` text,
	`source` enum('auto_filter','manual','ai_suggest','word_freq') NOT NULL DEFAULT 'manual',
	`matchType` enum('exact','phrase','broad') NOT NULL DEFAULT 'exact',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `negativeKeywords_id` PRIMARY KEY(`id`)
);

CREATE TABLE `notifications` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`type` enum('review_submitted','review_approved','review_rejected','project_assigned','system_alert','todo_due_soon','todo_overdue') NOT NULL,
	`title` varchar(200) NOT NULL,
	`content` text,
	`relatedType` varchar(50),
	`relatedId` int,
	`isRead` int NOT NULL DEFAULT 0,
	`createdBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `notifications_id` PRIMARY KEY(`id`)
);

CREATE TABLE `off_ai_analysis_logs` (
	`workspaceId` int,
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`analysis_type` varchar(50) NOT NULL,
	`entity_type` varchar(50),
	`entity_id` int,
	`input_data` text,
	`output_data` text,
	`prompt_used` text,
	`tokens_used` int DEFAULT 0,
	`duration_ms` int DEFAULT 0,
	`status` varchar(30) DEFAULT 'completed',
	`error_message` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `off_ai_analysis_logs_id` PRIMARY KEY(`id`)
);

CREATE TABLE `off_attribution_links` (
	`workspaceId` int,
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`campaign_id` int,
	`collaboration_id` int,
	`influencer_id` int,
	`original_url` text NOT NULL,
	`short_url` varchar(500),
	`amazon_tag` varchar(100),
	`utm_source` varchar(100),
	`utm_medium` varchar(100),
	`utm_campaign` varchar(200),
	`utm_content` varchar(200),
	`click_count` int DEFAULT 0,
	`conversion_count` int DEFAULT 0,
	`revenue` decimal(12,2) DEFAULT '0',
	`brb_amount` decimal(12,2) DEFAULT '0',
	`last_click_at` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `off_attribution_links_id` PRIMARY KEY(`id`)
);

CREATE TABLE `off_campaign_analytics` (
	`workspaceId` int,
	`id` int AUTO_INCREMENT NOT NULL,
	`campaign_id` int NOT NULL,
	`date` varchar(20) NOT NULL,
	`impressions` int DEFAULT 0,
	`reach` int DEFAULT 0,
	`clicks` int DEFAULT 0,
	`conversions` int DEFAULT 0,
	`revenue` decimal(12,2) DEFAULT '0',
	`spend` decimal(12,2) DEFAULT '0',
	`engagements` int DEFAULT 0,
	`video_views` int DEFAULT 0,
	`shares` int DEFAULT 0,
	`comments` int DEFAULT 0,
	`saves` int DEFAULT 0,
	`brb_revenue` decimal(12,2) DEFAULT '0',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `off_campaign_analytics_id` PRIMARY KEY(`id`)
);

CREATE TABLE `off_campaigns` (
	`workspaceId` int,
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`name` varchar(300) NOT NULL,
	`description` text,
	`type` varchar(50) DEFAULT 'influencer',
	`status` varchar(30) DEFAULT 'draft',
	`target_marketplace` varchar(10),
	`target_asin` varchar(50),
	`target_product_name` varchar(300),
	`budget` decimal(12,2) DEFAULT '0',
	`spent_amount` decimal(12,2) DEFAULT '0',
	`start_date` varchar(20),
	`end_date` varchar(20),
	`goals` text,
	`kpi_targets` text,
	`tags` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `off_campaigns_id` PRIMARY KEY(`id`)
);

CREATE TABLE `off_collaborations` (
	`workspaceId` int,
	`id` int AUTO_INCREMENT NOT NULL,
	`campaign_id` int NOT NULL,
	`influencer_id` int NOT NULL,
	`user_id` int NOT NULL,
	`stage` varchar(30) DEFAULT 'contacted',
	`agreed_price` decimal(10,2) DEFAULT '0',
	`payment_status` varchar(30) DEFAULT 'pending',
	`deliverables` text,
	`deadline` varchar(20),
	`content_url` text,
	`tracking_link` text,
	`notes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `off_collaborations_id` PRIMARY KEY(`id`)
);

CREATE TABLE `off_content_calendar` (
	`workspaceId` int,
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`social_account_id` int,
	`campaign_id` int,
	`title` varchar(300) NOT NULL,
	`content_type` varchar(50),
	`platform` varchar(50) NOT NULL,
	`status` varchar(30) DEFAULT 'draft',
	`scheduled_date` varchar(20) NOT NULL,
	`scheduled_time` varchar(10),
	`published_at` timestamp,
	`content` text,
	`media_urls` text,
	`hashtags` text,
	`ai_generated_content` text,
	`metrics` text,
	`notes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `off_content_calendar_id` PRIMARY KEY(`id`)
);

CREATE TABLE `off_content_submissions` (
	`workspaceId` int,
	`id` int AUTO_INCREMENT NOT NULL,
	`collaboration_id` int,
	`influencer_id` int,
	`user_id` int NOT NULL,
	`content_type` varchar(30) DEFAULT 'post',
	`content_url` text,
	`thumbnail_url` text,
	`caption` text,
	`status` varchar(30) DEFAULT 'pending',
	`ai_review_result` text,
	`human_review_notes` text,
	`revision_count` int DEFAULT 0,
	`published_at` timestamp,
	`metrics` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `off_content_submissions_id` PRIMARY KEY(`id`)
);

CREATE TABLE `off_influencer_scores` (
	`workspaceId` int,
	`id` int AUTO_INCREMENT NOT NULL,
	`influencer_id` int NOT NULL,
	`overall_score` decimal(5,2) DEFAULT '0',
	`relevance_score` decimal(5,2) DEFAULT '0',
	`engagement_score` decimal(5,2) DEFAULT '0',
	`authenticity_score` decimal(5,2) DEFAULT '0',
	`cost_efficiency_score` decimal(5,2) DEFAULT '0',
	`audience_match_score` decimal(5,2) DEFAULT '0',
	`ai_analysis` text,
	`scored_for_product` varchar(200),
	`scored_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `off_influencer_scores_id` PRIMARY KEY(`id`)
);

CREATE TABLE `off_influencers` (
	`workspaceId` int,
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`platform` varchar(50) NOT NULL,
	`handle` varchar(200) NOT NULL,
	`display_name` varchar(200),
	`profile_url` varchar(500),
	`avatar_url` varchar(500),
	`email` varchar(320),
	`phone` varchar(50),
	`country` varchar(50),
	`language` varchar(50),
	`category` varchar(100),
	`tags` text,
	`follower_count` int DEFAULT 0,
	`avg_views` int DEFAULT 0,
	`avg_likes` int DEFAULT 0,
	`engagement_rate` decimal(5,2),
	`estimated_cpm` decimal(10,2),
	`price_range` varchar(100),
	`notes` text,
	`status` varchar(30) DEFAULT 'active',
	`source` varchar(50),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `off_influencers_id` PRIMARY KEY(`id`)
);

CREATE TABLE `off_matrix_groups` (
	`workspaceId` int,
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`name` varchar(200) NOT NULL,
	`description` text,
	`platform` varchar(50) DEFAULT 'tiktok',
	`strategy` text,
	`account_count` int DEFAULT 0,
	`total_followers` int DEFAULT 0,
	`total_views` int DEFAULT 0,
	`status` varchar(30) DEFAULT 'active',
	`ai_content_strategy` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `off_matrix_groups_id` PRIMARY KEY(`id`)
);

CREATE TABLE `off_outreach_messages` (
	`workspaceId` int,
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`influencer_id` int NOT NULL,
	`campaign_id` int,
	`collaboration_id` int,
	`channel` varchar(30) DEFAULT 'email',
	`direction` varchar(10) DEFAULT 'outbound',
	`subject` varchar(500),
	`body` text,
	`ai_generated` boolean DEFAULT false,
	`status` varchar(30) DEFAULT 'draft',
	`scheduled_at` timestamp,
	`sent_at` timestamp,
	`sequence_step` int,
	`template_id` varchar(100),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `off_outreach_messages_id` PRIMARY KEY(`id`)
);

CREATE TABLE `off_social_accounts` (
	`workspaceId` int,
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`platform` varchar(50) NOT NULL,
	`account_name` varchar(200) NOT NULL,
	`account_id` varchar(200),
	`profile_url` varchar(500),
	`avatar_url` varchar(500),
	`follower_count` int DEFAULT 0,
	`following_count` int DEFAULT 0,
	`post_count` int DEFAULT 0,
	`matrix_group_id` int,
	`status` varchar(30) DEFAULT 'active',
	`access_token` text,
	`refresh_token` text,
	`token_expires_at` timestamp,
	`last_sync_at` timestamp,
	`notes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `off_social_accounts_id` PRIMARY KEY(`id`)
);

CREATE TABLE `operator_name_mappings` (
	`workspaceId` int,
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`external_name` varchar(200) NOT NULL,
	`source_type` enum('lingxing','saihu','all') NOT NULL DEFAULT 'all',
	`system_user_name` varchar(200),
	`system_user_id` int,
	`is_confirmed` int NOT NULL DEFAULT 1,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `operator_name_mappings_id` PRIMARY KEY(`id`)
);

CREATE TABLE `ops_ad_mcp_campaign_daily_facts` (
	`workspaceId` int,
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
	`impressions` bigint,
	`clicks` bigint,
	`spend` decimal(14,2),
	`sales` decimal(14,2),
	`orders` int,
	`source_batch_id` int NOT NULL,
	`source_row_hash` varchar(64) NOT NULL,
	`source_payload_hash` varchar(64) NOT NULL,
	`version` int NOT NULL DEFAULT 1,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `ops_ad_mcp_campaign_daily_facts_id` PRIMARY KEY(`id`),
	CONSTRAINT `uk_ops_ad_mcp_campaign_daily_identity` UNIQUE(`workspaceId`,`profile_id`,`report_date`,`ad_type`,`campaign_id`)
);

CREATE TABLE `ops_ad_mcp_fact_revisions` (
	`workspaceId` int,
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

CREATE TABLE `ops_ad_mcp_product_daily_facts` (
	`workspaceId` int,
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
	CONSTRAINT `uk_ops_ad_mcp_product_daily_identity` UNIQUE(`workspaceId`,`profile_id`,`report_date`,`ad_type`,`campaign_id`,`ad_group_id`,`ad_id`,`advertised_asin`)
);

CREATE TABLE `ops_ad_mcp_profiles` (
	`workspaceId` int,
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
	CONSTRAINT `uk_ops_ad_mcp_profiles_workspace_profile` UNIQUE(`workspaceId`,`profile_id`)
);

CREATE TABLE `ops_asin_daily_snapshots` (
	`workspaceId` int,
	`id` int AUTO_INCREMENT NOT NULL,
	`import_id` int NOT NULL,
	`user_id` int NOT NULL,
	`source_type` varchar(20) NOT NULL DEFAULT 'lingxing',
	`source_store_id` varchar(64),
	`source_batch_hash` varchar(64),
	`report_date` varchar(10) NOT NULL,
	`asin` varchar(20) NOT NULL,
	`parent_asin` varchar(20) NOT NULL,
	`store_name` varchar(200) NOT NULL,
	`country` varchar(50) NOT NULL,
	`msku` varchar(200),
	`sku` varchar(200),
	`title` varchar(1000),
	`product_name` varchar(500),
	`brand` varchar(200),
	`category1` varchar(200),
	`category2` varchar(200),
	`category3` varchar(200),
	`operator` varchar(200),
	`created_time` varchar(50),
	`sales_qty` int NOT NULL DEFAULT 0,
	`order_qty` int NOT NULL DEFAULT 0,
	`sales_amount` decimal(14,2) NOT NULL DEFAULT '0',
	`net_sales_amount` decimal(14,2) NOT NULL DEFAULT '0',
	`order_profit` decimal(14,2) NOT NULL DEFAULT '0',
	`ad_spend` decimal(14,2) NOT NULL DEFAULT '0',
	`ad_sales` decimal(14,2) NOT NULL DEFAULT '0',
	`ad_orders` int NOT NULL DEFAULT 0,
	`organic_orders` int NOT NULL DEFAULT 0,
	`sessions_total` int NOT NULL DEFAULT 0,
	`ad_clicks` int NOT NULL DEFAULT 0,
	`ad_impressions` int NOT NULL DEFAULT 0,
	`return_qty` int NOT NULL DEFAULT 0,
	`fba_available` int NOT NULL DEFAULT 0,
	`fba_in_transit` int NOT NULL DEFAULT 0,
	`fba_plan_inbound` int NOT NULL DEFAULT 0,
	`fba_total` int NOT NULL DEFAULT 0,
	`available_stock` int NOT NULL DEFAULT 0,
	`fbm_available` int NOT NULL DEFAULT 0,
	`awd_available` int NOT NULL DEFAULT 0,
	`awd_in_transit` int NOT NULL DEFAULT 0,
	`overseas_available` int NOT NULL DEFAULT 0,
	`source_local_available` int NOT NULL DEFAULT 0,
	`source_row_hash` varchar(64) NOT NULL,
	`is_valid` int NOT NULL DEFAULT 1,
	`validation_reason` text,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `ops_asin_daily_snapshots_id` PRIMARY KEY(`id`)
);

CREATE TABLE `ops_asin_lifecycle_statuses` (
	`workspaceId` int,
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`asin` varchar(20) NOT NULL,
	`parent_asin` varchar(20),
	`store_name` varchar(200) NOT NULL,
	`country` varchar(50) NOT NULL,
	`status` enum('active','discontinued') NOT NULL DEFAULT 'active',
	`reason` varchar(80),
	`evidence_start_date` varchar(10),
	`evidence_end_date` varchar(10),
	`evidence_days` int NOT NULL DEFAULT 0,
	`evidence_sales_qty` int NOT NULL DEFAULT 0,
	`evidence_profit` decimal(14,2) NOT NULL DEFAULT '0',
	`evidence_max_inventory` int NOT NULL DEFAULT 0,
	`changed_by` int,
	`changed_at` timestamp NOT NULL DEFAULT (now()),
	`restored_at` timestamp,
	`restore_reason` varchar(500),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `ops_asin_lifecycle_statuses_id` PRIMARY KEY(`id`)
);

CREATE TABLE `ops_external_sync_batches` (
	`workspaceId` int,
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`source` varchar(32) NOT NULL,
	`data_domain` varchar(48) NOT NULL,
	`status` varchar(32) NOT NULL DEFAULT 'draft',
	`scope` json NOT NULL,
	`tool_run_id` varchar(128),
	`trace_id` varchar(128),
	`raw_response_hash` varchar(64),
	`raw_snapshot` json,
	`normalization_version` varchar(32) NOT NULL DEFAULT 'v1',
	`summary` json,
	`error_message` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`reviewed_at` timestamp,
	`reviewed_by` int,
	`applied_at` timestamp,
	`applied_by` int,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `ops_external_sync_batches_id` PRIMARY KEY(`id`)
);

CREATE TABLE `ops_external_sync_confirmations` (
	`workspaceId` int,
	`id` int AUTO_INCREMENT NOT NULL,
	`batch_id` int NOT NULL,
	`user_id` int NOT NULL,
	`action` varchar(32) NOT NULL,
	`selected_row_ids` json,
	`note` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `ops_external_sync_confirmations_id` PRIMARY KEY(`id`)
);

CREATE TABLE `ops_external_sync_rows` (
	`workspaceId` int,
	`id` int AUTO_INCREMENT NOT NULL,
	`batch_id` int NOT NULL,
	`entity_key` varchar(512) NOT NULL,
	`row_status` varchar(32) NOT NULL DEFAULT 'needs_review',
	`selected` int NOT NULL DEFAULT 1,
	`source_data` json NOT NULL,
	`normalized_data` json NOT NULL,
	`field_diffs` json,
	`match_info` json,
	`target_reference` json,
	`validation_errors` json,
	`applied_at` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `ops_external_sync_rows_id` PRIMARY KEY(`id`)
);

CREATE TABLE `ops_import_history` (
	`workspaceId` int,
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`import_type` enum('plan','review') NOT NULL,
	`file_name` varchar(255) NOT NULL,
	`total_count` int NOT NULL DEFAULT 0,
	`created_count` int NOT NULL DEFAULT 0,
	`updated_count` int NOT NULL DEFAULT 0,
	`skipped_count` int NOT NULL DEFAULT 0,
	`record_ids` text,
	`parent_asins` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `ops_import_history_id` PRIMARY KEY(`id`)
);

CREATE TABLE `ops_inventory_owner_assignment_audits` (
	`workspaceId` int,
	`id` int AUTO_INCREMENT NOT NULL,
	`assignment_id` int NOT NULL,
	`action` enum('created','replaced','revoked') NOT NULL,
	`previous_assignee_user_id` int,
	`previous_assignee_name` varchar(200),
	`next_assignee_user_id` int,
	`next_assignee_name` varchar(200),
	`reason` varchar(500),
	`changed_by_user_id` int NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `ops_inventory_owner_assignment_audits_id` PRIMARY KEY(`id`)
);

CREATE TABLE `ops_inventory_owner_assignments` (
	`workspaceId` int,
	`id` int AUTO_INCREMENT NOT NULL,
	`parent_asin` varchar(20) NOT NULL,
	`store_name` varchar(200) NOT NULL,
	`country` varchar(50) NOT NULL,
	`assignee_user_id` int NOT NULL,
	`assignee_name` varchar(200) NOT NULL,
	`is_active` int NOT NULL DEFAULT 1,
	`created_by_user_id` int NOT NULL,
	`updated_by_user_id` int NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `ops_inventory_owner_assignments_id` PRIMARY KEY(`id`),
	CONSTRAINT `uk_ops_inventory_owner_assignment_scope` UNIQUE(`workspaceId`,`parent_asin`,`store_name`,`country`)
);

CREATE TABLE `ops_inventory_planning_parameters` (
	`workspaceId` int,
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`scope_type` enum('workspace','store_country','parent_asin','asin') NOT NULL DEFAULT 'workspace',
	`asin` varchar(20),
	`parent_asin` varchar(20),
	`store_name` varchar(200),
	`country` varchar(50),
	`production_days` int NOT NULL DEFAULT 30,
	`shipping_days` int NOT NULL DEFAULT 30,
	`buffer_days` int NOT NULL DEFAULT 10,
	`target_cover_days` int NOT NULL DEFAULT 30,
	`moq` int NOT NULL DEFAULT 0,
	`pack_size` int NOT NULL DEFAULT 1,
	`product_cost` decimal(10,2),
	`estimated_first_leg_cost` decimal(10,2),
	`actual_first_leg_cost` decimal(10,2),
	`estimated_fba_fee` decimal(10,2),
	`actual_fba_fee` decimal(10,2),
	`selling_price` decimal(10,2),
	`estimated_dimensions` varchar(120),
	`actual_dimensions` varchar(120),
	`estimated_weight` decimal(10,3),
	`actual_weight` decimal(10,3),
	`dimension_unit` varchar(12) NOT NULL DEFAULT 'in',
	`weight_unit` varchar(12) NOT NULL DEFAULT 'lb',
	`currency` varchar(8) NOT NULL DEFAULT 'USD',
	`is_active` int NOT NULL DEFAULT 1,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `ops_inventory_planning_parameters_id` PRIMARY KEY(`id`)
);

CREATE TABLE `ops_inventory_planning_versions` (
	`workspaceId` int,
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`version` int NOT NULL,
	`source_as_of_date` varchar(10) NOT NULL,
	`inventory_planning_version_status` enum('draft','confirmed','superseded') NOT NULL DEFAULT 'draft',
	`input_snapshot` json NOT NULL,
	`result_snapshot` json NOT NULL,
	`confirmed_by` int,
	`confirmed_at` timestamp,
	`superseded_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `ops_inventory_planning_versions_id` PRIMARY KEY(`id`)
);

CREATE TABLE `ops_lingxing_sync_schedules` (
	`workspaceId` int,
	`id` int AUTO_INCREMENT NOT NULL,
	`data_domain` varchar(48) NOT NULL,
	`cadence` varchar(64) NOT NULL,
	`timezone` varchar(64) NOT NULL DEFAULT 'Asia/Shanghai',
	`cron_expression` varchar(64) NOT NULL,
	`enabled` int NOT NULL DEFAULT 0,
	`auto_apply` tinyint NOT NULL DEFAULT 0,
	`schedule_cron_task_uid` varchar(65),
	`owner_user_id` int NOT NULL,
	`last_run_key` varchar(80),
	`last_run_at` timestamp,
	`last_batch_id` int,
	`last_status` varchar(32) NOT NULL DEFAULT 'idle',
	`last_error` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `ops_lingxing_sync_schedules_id` PRIMARY KEY(`id`),
	CONSTRAINT `uk_ops_lingxing_sync_schedules_workspace_domain` UNIQUE(`workspaceId`,`data_domain`)
);

CREATE TABLE `ops_local_inventory_adjustments` (
	`workspaceId` int,
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`asin` varchar(20) NOT NULL,
	`store_name` varchar(200) NOT NULL,
	`country` varchar(50) NOT NULL,
	`effective_date` varchar(10) NOT NULL,
	`local_qty` int NOT NULL,
	`reason` varchar(500),
	`status` enum('draft','confirmed','superseded') NOT NULL DEFAULT 'draft',
	`confirmed_by` int,
	`confirmed_at` timestamp,
	`superseded_by_id` int,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `ops_local_inventory_adjustments_id` PRIMARY KEY(`id`)
);

CREATE TABLE `ops_monthly_financial_profits` (
	`workspaceId` int,
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`parent_asin` varchar(20) NOT NULL,
	`store_name` varchar(200),
	`country` varchar(50),
	`year_month` varchar(7) NOT NULL,
	`financial_profit` decimal(14,2) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `ops_monthly_financial_profits_id` PRIMARY KEY(`id`),
	CONSTRAINT `ops_monthly_financial_profit_unique` UNIQUE(`workspaceId`,`user_id`,`parent_asin`,`store_name`,`country`,`year_month`)
);

CREATE TABLE `ops_plan_actions` (
	`workspaceId` int,
	`id` int AUTO_INCREMENT NOT NULL,
	`plan_id` int NOT NULL,
	`user_id` int NOT NULL,
	`dimension` varchar(200) NOT NULL,
	`current_status` text,
	`target_action` text,
	`action_priority` enum('high','medium','low') NOT NULL DEFAULT 'medium',
	`planned_date` varchar(10),
	`assignee` varchar(100),
	`action_status` enum('not_started','in_progress','completed','delayed') NOT NULL DEFAULT 'not_started',
	`linked_todo_id` int,
	`sort_order` int DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `ops_plan_actions_id` PRIMARY KEY(`id`)
);

CREATE TABLE `ops_plan_summaries` (
	`workspaceId` int,
	`id` int AUTO_INCREMENT NOT NULL,
	`plan_id` int NOT NULL,
	`user_id` int NOT NULL,
	`period` varchar(50),
	`achievement_summary` text,
	`planner_feedback` text,
	`summary_rating` enum('excellent','good','needs_improvement'),
	`actual_industry_conv_rate` decimal(6,2),
	`actual_search_conv_rate` decimal(6,2),
	`actual_order_conv_rate` decimal(6,2),
	`actual_ad_conv_rate` decimal(6,2),
	`actual_sales` decimal(12,2),
	`actual_profit` decimal(12,2),
	`actual_profit_rate` decimal(6,2),
	`actual_ranking` int,
	`actual_rating` decimal(3,1),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `ops_plan_summaries_id` PRIMARY KEY(`id`)
);

CREATE TABLE `ops_plans` (
	`workspaceId` int,
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`product_profile_id` int NOT NULL,
	`parent_asin` varchar(20),
	`plan_name` varchar(200) NOT NULL,
	`plan_period` varchar(50),
	`project_manager` varchar(100),
	`project_members` text,
	`game_planner` varchar(100),
	`baseline_week_label` varchar(50),
	`baseline_sales` decimal(12,2),
	`baseline_subcategory_rank` int,
	`baseline_profit_rate` decimal(6,2),
	`baseline_conv_rate` decimal(6,2),
	`baseline_organic_orders` int,
	`baseline_ad_orders` int,
	`baseline_rating_score` decimal(3,1),
	`baseline_rating_count` int,
	`current_week_label` varchar(50),
	`current_sales` decimal(12,2),
	`current_subcategory_rank` int,
	`current_profit_rate` decimal(6,2),
	`current_conv_rate` decimal(6,2),
	`current_organic_orders` int,
	`current_ad_orders` int,
	`current_rating_score` decimal(3,1),
	`current_rating_count` int,
	`target_sales` decimal(12,2),
	`target_subcategory_rank` int,
	`target_profit_rate` decimal(6,2),
	`target_conv_rate` decimal(6,2),
	`target_organic_orders` int,
	`target_ad_orders` int,
	`target_rating_score` decimal(3,1),
	`target_rating_count` int,
	`plan_status` enum('draft','active','completed','archived') NOT NULL DEFAULT 'draft',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `ops_plans_id` PRIMARY KEY(`id`)
);

CREATE TABLE `ops_replenishment_plans` (
	`workspaceId` int,
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`asin` varchar(20) NOT NULL,
	`store_name` varchar(200) NOT NULL,
	`country` varchar(50) NOT NULL,
	`planned_qty` int NOT NULL,
	`estimated_available_date` varchar(10) NOT NULL,
	`notes` text,
	`replenishment_plan_status` enum('draft','confirmed','cancelled','completed') NOT NULL DEFAULT 'draft',
	`confirmed_by` int,
	`confirmed_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `ops_replenishment_plans_id` PRIMARY KEY(`id`)
);

CREATE TABLE `organizations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`slug` varchar(128) NOT NULL,
	`name` varchar(255) NOT NULL,
	`status` enum('active','disabled') NOT NULL DEFAULT 'active',
	`ownerUserId` int,
	`metadata` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `organizations_id` PRIMARY KEY(`id`),
	CONSTRAINT `organizations_slug_unique` UNIQUE(`slug`)
);

CREATE TABLE `product_basic_info` (
	`workspaceId` int,
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

CREATE TABLE `product_logs` (
	`workspaceId` int,
	`id` int AUTO_INCREMENT NOT NULL,
	`product_id` int NOT NULL,
	`user_id` int NOT NULL,
	`content` text NOT NULL,
	`log_type` enum('operation','note','issue','decision','milestone') NOT NULL DEFAULT 'note',
	`created_by` varchar(100),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `product_logs_id` PRIMARY KEY(`id`)
);

CREATE TABLE `product_monthly_summary` (
	`workspaceId` int,
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

CREATE TABLE `product_ops_daily_records` (
	`workspaceId` int,
	`id` int AUTO_INCREMENT NOT NULL,
	`plan_id` int NOT NULL,
	`record_date` varchar(10) NOT NULL,
	`actual_bsr` int,
	`actual_impressions` int,
	`actual_total_orders` int,
	`actual_ad_orders` int,
	`actual_organic_orders` int,
	`actual_acos` decimal(6,2),
	`actual_profit_margin` decimal(6,2),
	`actual_conversion_rate` decimal(6,2),
	`actual_organic_ratio` decimal(6,2),
	`actual_unit_price` decimal(10,2),
	`actual_sales` decimal(12,2),
	`actual_ad_spend` decimal(12,2),
	`notes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `product_ops_daily_records_id` PRIMARY KEY(`id`)
);

CREATE TABLE `product_ops_plans` (
	`workspaceId` int,
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`product_profile_id` int,
	`asin` varchar(20) NOT NULL,
	`plan_name` varchar(200) NOT NULL,
	`target_bsr` int,
	`target_daily_orders` decimal(10,2),
	`target_ad_orders` decimal(10,2),
	`target_organic_orders` decimal(10,2),
	`target_acos` decimal(6,2),
	`target_profit_margin` decimal(6,2),
	`target_organic_ratio` decimal(6,2),
	`target_conversion_rate` decimal(6,2),
	`promotion_cycle_days` int,
	`start_date` varchar(10),
	`end_date` varchar(10),
	`product_ops_plan_status` enum('planning','active','completed','paused') NOT NULL DEFAULT 'planning',
	`notes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `product_ops_plans_id` PRIMARY KEY(`id`)
);

CREATE TABLE `product_profiles` (
	`workspaceId` int,
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
	`chinese_name` varchar(500),
	`operator` varchar(200),
	`store_name` varchar(255),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `product_profiles_id` PRIMARY KEY(`id`)
);

CREATE TABLE `product_todos` (
	`workspaceId` int,
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
	`reminder_days` varchar(100),
	`reminder_enabled` int DEFAULT 1,
	`last_reminder_sent_at` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `product_todos_id` PRIMARY KEY(`id`)
);

CREATE TABLE `product_variants` (
	`workspaceId` int,
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

CREATE TABLE `product_weekly_ops` (
	`workspaceId` int,
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
	`ad_sales` decimal(12,2) DEFAULT '0',
	`acos` decimal(6,2) DEFAULT '0',
	`rating` decimal(3,1) DEFAULT '0',
	`review_count` int DEFAULT 0,
	`return_rate` decimal(6,2) DEFAULT '0',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `product_weekly_ops_id` PRIMARY KEY(`id`)
);

CREATE TABLE `production_config` (
	`workspaceId` int,
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`parent_asin` varchar(50) NOT NULL,
	`marketplace` varchar(10) DEFAULT 'US',
	`production_time_days` int DEFAULT 15,
	`shipping_time_days` int DEFAULT 30,
	`notes` text,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `production_config_id` PRIMARY KEY(`id`)
);

CREATE TABLE `profit_alert_rules` (
	`workspaceId` int,
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

CREATE TABLE `profit_snapshots` (
	`workspaceId` int,
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

CREATE TABLE `project_assignments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`workspaceId` int,
	`projectId` int NOT NULL,
	`projectType` enum('dev_project','listing_project') NOT NULL DEFAULT 'dev_project',
	`assignedUserId` int NOT NULL,
	`assignedBy` int NOT NULL,
	`permission` enum('read','write') NOT NULL DEFAULT 'read',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `project_assignments_id` PRIMARY KEY(`id`)
);

CREATE TABLE `projectFiles` (
	`id` int AUTO_INCREMENT NOT NULL,
	`workspaceId` int,
	`projectId` int NOT NULL,
	`userId` int NOT NULL,
	`fileType` enum('product_attributes','competitor_listings','search_term_report','aba_keywords') NOT NULL,
	`filename` varchar(500) NOT NULL,
	`fileUrl` text,
	`fileSize` int,
	`rawStorageUri` text,
	`parsedStorageUri` text,
	`analysisArtifactId` varchar(80),
	`rawContentHash` varchar(64),
	`parsedDataHash` varchar(64),
	`rawContent` text,
	`parsedData` text,
	`analysisResult` text,
	`lifecycleState` enum('hot','warm','cold','archived','deleted') NOT NULL DEFAULT 'hot',
	`archiveAfter` timestamp,
	`deleteAfter` timestamp,
	`archivedAt` timestamp,
	`status` enum('uploaded','parsing','parsed','analyzing','completed','failed') NOT NULL DEFAULT 'uploaded',
	`errorMessage` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `projectFiles_id` PRIMARY KEY(`id`)
);

CREATE TABLE `projects` (
	`id` int AUTO_INCREMENT NOT NULL,
	`workspaceId` int,
	`userId` int NOT NULL,
	`name` varchar(255) NOT NULL,
	`brand` varchar(255),
	`productName` varchar(500),
	`category` varchar(255),
	`targetMarket` varchar(100) DEFAULT 'US',
	`productFeatures` text,
	`productSpecs` text,
	`status` enum('draft','analyzing','generating','completed') NOT NULL DEFAULT 'draft',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `projects_id` PRIMARY KEY(`id`)
);

CREATE TABLE `promotion_phases` (
	`workspaceId` int,
	`id` int AUTO_INCREMENT NOT NULL,
	`plan_id` int NOT NULL,
	`phase_name` varchar(200) NOT NULL,
	`phase_type` enum('launch','growth','maturity','optimization','clearance','custom') NOT NULL DEFAULT 'custom',
	`bsr_range_start` int,
	`bsr_range_end` int,
	`duration_days` int,
	`start_date` varchar(10),
	`end_date` varchar(10),
	`ad_budget_daily` decimal(10,2),
	`target_acos` decimal(8,2),
	`key_strategy` text,
	`milestones` text,
	`status` enum('pending','active','completed','skipped') NOT NULL DEFAULT 'pending',
	`progress` int DEFAULT 0,
	`sort_order` int DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `promotion_phases_id` PRIMARY KEY(`id`)
);

CREATE TABLE `remote_usage_snapshots` (
	`id` int AUTO_INCREMENT NOT NULL,
	`instanceId` varchar(100) NOT NULL,
	`instanceName` varchar(255),
	`snapshotDate` varchar(10) NOT NULL,
	`totalUsers` int DEFAULT 0,
	`activeUsers` int DEFAULT 0,
	`aiCallCount` int DEFAULT 0,
	`aiTokensUsed` bigint DEFAULT 0,
	`scraperCallCount` int DEFAULT 0,
	`storageUsedBytes` bigint DEFAULT 0,
	`apiCallCount` int DEFAULT 0,
	`detailJson` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `remote_usage_snapshots_id` PRIMARY KEY(`id`)
);

CREATE TABLE `replenishment_predictions` (
	`workspaceId` int,
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` varchar(255) NOT NULL,
	`sku` varchar(255) NOT NULL,
	`asin` varchar(50),
	`store_name` varchar(255),
	`current_available_inventory` int NOT NULL DEFAULT 0,
	`daily_sales_avg` decimal(10,2) DEFAULT '0',
	`days_of_stock_remaining` int NOT NULL DEFAULT 0,
	`full_cycle_days` int NOT NULL DEFAULT 0,
	`recommended_quantity` int NOT NULL DEFAULT 0,
	`recommended_order_date` bigint,
	`recommended_shipping_method` varchar(100),
	`estimated_arrival_date` bigint,
	`confidence` decimal(3,2) DEFAULT '0',
	`ai_suggestion` json,
	`risk_factors` json,
	`alternative_plans` json,
	`alert_level` varchar(20),
	`alert_sent_at` bigint,
	`user_confirmed` int NOT NULL DEFAULT 0,
	`predicted_at` bigint NOT NULL,
	`updated_at` bigint NOT NULL,
	CONSTRAINT `replenishment_predictions_id` PRIMARY KEY(`id`)
);

CREATE TABLE `return_analysis_cache` (
	`workspaceId` int,
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`asin` varchar(20) NOT NULL,
	`sid` int,
	`return_rate` decimal(8,2),
	`total_returns` int,
	`total_orders` int,
	`return_reasons` json,
	`ai_root_cause_analysis` text,
	`ai_primary_causes` json,
	`ai_improvement_plan` json,
	`ai_listing_optimization` text,
	`analysis_date_start` varchar(10),
	`analysis_date_end` varchar(10),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `return_analysis_cache_id` PRIMARY KEY(`id`)
);

CREATE TABLE `reviewAggregations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`projectId` int NOT NULL,
	`userId` int NOT NULL,
	`painPoints` text,
	`itchPoints` text,
	`delightPoints` text,
	`overallSentiment` text,
	`keyThemes` text,
	`analysisCount` int DEFAULT 0,
	`status` enum('pending','analyzing','completed','failed') NOT NULL DEFAULT 'pending',
	`errorMessage` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `reviewAggregations_id` PRIMARY KEY(`id`)
);

CREATE TABLE `reviewImports` (
	`id` int AUTO_INCREMENT NOT NULL,
	`projectId` int NOT NULL,
	`userId` int NOT NULL,
	`asin` varchar(20) NOT NULL,
	`filename` varchar(500) NOT NULL,
	`fileSize` int,
	`totalRows` int,
	`parsedRows` int,
	`skippedRows` int,
	`detectedFormat` varchar(100),
	`columns` text,
	`analysisId` int,
	`status` enum('pending','analyzing','completed','failed') NOT NULL DEFAULT 'pending',
	`errorMessage` text,
	`metadata` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `reviewImports_id` PRIMARY KEY(`id`)
);

CREATE TABLE `review_records` (
	`workspaceId` int,
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`sid` int,
	`asin` varchar(20) NOT NULL,
	`review_id` varchar(100),
	`star_rating` int NOT NULL,
	`review_title` text,
	`review_content` text,
	`reviewer_name` varchar(200),
	`is_verified_purchase` int DEFAULT 0,
	`has_image` int DEFAULT 0,
	`has_video` int DEFAULT 0,
	`review_date` varchar(20),
	`ai_problem_category` varchar(100),
	`ai_severity` enum('high','medium','low'),
	`ai_key_issues` json,
	`ai_sentiment` enum('negative','neutral','positive'),
	`ai_suggested_reply` text,
	`ai_internal_action` text,
	`ai_follow_up_needed` int DEFAULT 0,
	`process_status` enum('pending','in_progress','replied','ignored') NOT NULL DEFAULT 'pending',
	`processed_by` int,
	`processed_at` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `review_records_id` PRIMARY KEY(`id`)
);

CREATE TABLE `review_replies` (
	`workspaceId` int,
	`id` int AUTO_INCREMENT NOT NULL,
	`review_record_id` int NOT NULL,
	`user_id` int NOT NULL,
	`ai_draft_reply` text,
	`edited_reply` text,
	`final_reply` text,
	`reply_language` varchar(10) DEFAULT 'en',
	`status` enum('draft','edited','confirmed','sent') NOT NULL DEFAULT 'draft',
	`confirmed_at` timestamp,
	`sent_at` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `review_replies_id` PRIMARY KEY(`id`)
);

CREATE TABLE `role_permissions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`workspaceId` int,
	`role` varchar(50) NOT NULL,
	`modules` text NOT NULL,
	`detailedPermissions` text,
	`description` varchar(200),
	`updatedBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `role_permissions_id` PRIMARY KEY(`id`),
	CONSTRAINT `role_permissions_role_unique` UNIQUE(`role`)
);

CREATE TABLE `saihu_product_weekly` (
	`workspaceId` int,
	`id` int AUTO_INCREMENT NOT NULL,
	`import_id` int NOT NULL,
	`user_id` int NOT NULL,
	`week_start_date` varchar(10) NOT NULL,
	`week_end_date` varchar(10) NOT NULL,
	`currency` varchar(10),
	`image_url` text,
	`asin` varchar(2000),
	`title` varchar(1000),
	`parent_asin` varchar(500),
	`msku` varchar(500),
	`product_name` varchar(500),
	`sku` varchar(500),
	`store_name` varchar(200),
	`site` varchar(50),
	`category` varchar(500),
	`brand` varchar(200),
	`operator` varchar(200),
	`developer` varchar(200),
	`product_tag` varchar(500),
	`listing_date` varchar(50),
	`sales_3d` int DEFAULT 0,
	`sales_7d` int DEFAULT 0,
	`sales_14d` int DEFAULT 0,
	`sales_30d` int DEFAULT 0,
	`sales_60d` int DEFAULT 0,
	`sales_90d` int DEFAULT 0,
	`gross_profit` decimal(14,2) DEFAULT '0',
	`gross_margin` decimal(8,4) DEFAULT '0',
	`avg_gross_profit` decimal(10,2) DEFAULT '0',
	`sales_qty` int DEFAULT 0,
	`fba_sales_qty` int DEFAULT 0,
	`fbm_sales_qty` int DEFAULT 0,
	`avg_sales_qty` decimal(10,1) DEFAULT '0',
	`promo_sales_qty` int DEFAULT 0,
	`b2b_sales_qty` int DEFAULT 0,
	`b2b_order_qty` int DEFAULT 0,
	`vine_sales_qty` int DEFAULT 0,
	`multi_channel_sales_qty` int DEFAULT 0,
	`order_qty` int DEFAULT 0,
	`promo_order_qty` int DEFAULT 0,
	`cancel_order_qty` int DEFAULT 0,
	`cancel_order_pct` decimal(8,4) DEFAULT '0',
	`sales_amount` decimal(14,2) DEFAULT '0',
	`net_sales_amount` decimal(14,2) DEFAULT '0',
	`promo_sales_amount` decimal(14,2) DEFAULT '0',
	`sales_revenue` decimal(14,2) DEFAULT '0',
	`avg_price` decimal(10,2) DEFAULT '0',
	`product_discount` decimal(12,2) DEFAULT '0',
	`fbm_buyer_shipping` decimal(12,2) DEFAULT '0',
	`b2b_sales_amount` decimal(14,2) DEFAULT '0',
	`refund_amount` decimal(12,2) DEFAULT '0',
	`refund_qty` int DEFAULT 0,
	`refund_rate` decimal(8,4) DEFAULT '0',
	`return_qty` int DEFAULT 0,
	`fba_return_qty` int DEFAULT 0,
	`fbm_return_qty` int DEFAULT 0,
	`return_rate` decimal(8,4) DEFAULT '0',
	`fba_return_rate` decimal(8,4) DEFAULT '0',
	`fbm_return_rate` decimal(8,4) DEFAULT '0',
	`exchange_qty` int DEFAULT 0,
	`exchange_rate` decimal(8,4) DEFAULT '0',
	`test_sales_amount` decimal(12,2) DEFAULT '0',
	`fba_available` int DEFAULT 0,
	`reserved_transfer` int DEFAULT 0,
	`reserved_processing` int DEFAULT 0,
	`inbound_receiving` int DEFAULT 0,
	`reserved_order` int DEFAULT 0,
	`inbound_processing` int DEFAULT 0,
	`inbound_shipped` int DEFAULT 0,
	`fba_unavailable` int DEFAULT 0,
	`investigating` int DEFAULT 0,
	`fba_usable` int DEFAULT 0,
	`fba_in_transit` int DEFAULT 0,
	`fba_days_of_supply` decimal(8,1) DEFAULT '0',
	`fbm_available` int DEFAULT 0,
	`fbm_days_of_supply` decimal(8,1),
	`awd_stock` int,
	`awd_available` int,
	`awd_reserved` int,
	`awd_in_transit` int,
	`awd_to_fba_in_transit` int,
	`suggested_replenish_qty` int,
	`local_warehouse_available` int,
	`overseas_warehouse_available` int,
	`age_0_to_30` int DEFAULT 0,
	`age_31_to_60` int DEFAULT 0,
	`age_61_to_90` int DEFAULT 0,
	`age_91_to_180` int DEFAULT 0,
	`age_181_to_270` int DEFAULT 0,
	`age_271_to_365` int DEFAULT 0,
	`age_365_plus` int DEFAULT 0,
	`sessions_mobile` int DEFAULT 0,
	`sessions_browser` int DEFAULT 0,
	`sessions_total` int DEFAULT 0,
	`pv_mobile` int DEFAULT 0,
	`pv_browser` int DEFAULT 0,
	`pv_total` int DEFAULT 0,
	`buybox_price` varchar(20),
	`buybox_rate` decimal(8,4),
	`cvr` decimal(8,4) DEFAULT '0',
	`order_cvr` decimal(8,4) DEFAULT '0',
	`bsr_sub` varchar(200),
	`bsr_main` varchar(200),
	`rating` decimal(3,1),
	`rating_count` int DEFAULT 0,
	`negative_review_count` int,
	`effective_review_count` int,
	`review_rate` decimal(8,4) DEFAULT '0',
	`organic_clicks` int DEFAULT 0,
	`organic_orders` int DEFAULT 0,
	`organic_cvr` decimal(8,4) DEFAULT '0',
	`organic_order_pct` decimal(8,4),
	`ad_impressions` int DEFAULT 0,
	`ad_clicks` int DEFAULT 0,
	`ad_click_rate` decimal(8,4) DEFAULT '0',
	`ad_cvr` decimal(8,4) DEFAULT '0',
	`cpc_ad_cvr` decimal(8,4) DEFAULT '0',
	`vcpm_ad_cvr` decimal(8,4) DEFAULT '0',
	`ad_spend` decimal(14,2) DEFAULT '0',
	`sp_ad_spend` decimal(14,2) DEFAULT '0',
	`sb_collection_ad_spend` decimal(14,2) DEFAULT '0',
	`sb_store_ad_spend` decimal(14,2) DEFAULT '0',
	`sb_video_ad_spend` decimal(14,2) DEFAULT '0',
	`sd_ad_spend` decimal(14,2) DEFAULT '0',
	`cpc` decimal(10,2) DEFAULT '0',
	`cpa` decimal(10,2) DEFAULT '0',
	`cpo` decimal(10,2) DEFAULT '0',
	`cpu` decimal(10,2) DEFAULT '0',
	`acos` decimal(8,4) DEFAULT '0',
	`sp_acos` decimal(8,4) DEFAULT '0',
	`sb_collection_acos` decimal(8,4) DEFAULT '0',
	`sb_store_acos` decimal(8,4) DEFAULT '0',
	`sb_video_acos` decimal(8,4) DEFAULT '0',
	`sd_acos` decimal(8,4) DEFAULT '0',
	`acoas` decimal(8,4) DEFAULT '0',
	`asoas` decimal(8,4) DEFAULT '0',
	`ad_sales_qty` int DEFAULT 0,
	`ad_orders` int DEFAULT 0,
	`sp_ad_orders` int DEFAULT 0,
	`sb_collection_ad_orders` int DEFAULT 0,
	`sb_store_ad_orders` int DEFAULT 0,
	`sb_video_ad_orders` int DEFAULT 0,
	`sd_ad_orders` int DEFAULT 0,
	`ad_order_pct` decimal(8,4) DEFAULT '0',
	`ad_sales_amount` decimal(14,2) DEFAULT '0',
	`sp_ad_sales` decimal(14,2) DEFAULT '0',
	`sb_collection_ad_sales` decimal(14,2) DEFAULT '0',
	`sb_store_ad_sales` decimal(14,2) DEFAULT '0',
	`sb_video_ad_sales` decimal(14,2) DEFAULT '0',
	`sd_ad_sales` decimal(14,2) DEFAULT '0',
	`self_ad_sales` decimal(14,2) DEFAULT '0',
	`sp_self_ad_sales` decimal(14,2) DEFAULT '0',
	`sb_collection_self_ad_sales` decimal(14,2) DEFAULT '0',
	`sb_store_self_ad_sales` decimal(14,2) DEFAULT '0',
	`sb_video_self_ad_sales` decimal(14,2) DEFAULT '0',
	`sd_self_ad_sales` decimal(14,2) DEFAULT '0',
	`self_ad_orders` int DEFAULT 0,
	`sp_self_ad_orders` int DEFAULT 0,
	`sb_collection_self_ad_orders` int DEFAULT 0,
	`sb_store_self_ad_orders` int DEFAULT 0,
	`sb_video_self_ad_orders` int DEFAULT 0,
	`sd_self_ad_orders` int DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `saihu_product_weekly_id` PRIMARY KEY(`id`)
);

CREATE TABLE `search_term_actions` (
	`workspaceId` int,
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

CREATE TABLE `security_access_policies` (
	`id` int AUTO_INCREMENT NOT NULL,
	`policyId` varchar(80) NOT NULL,
	`workspaceId` int,
	`resourceType` varchar(64) NOT NULL,
	`resourceId` varchar(128),
	`action` varchar(64) NOT NULL,
	`effect` enum('allow','deny') NOT NULL DEFAULT 'allow',
	`principalType` enum('role','user','workspace_member') NOT NULL,
	`principalId` varchar(128) NOT NULL,
	`conditions` json,
	`status` enum('active','disabled') NOT NULL DEFAULT 'active',
	`createdBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `security_access_policies_id` PRIMARY KEY(`id`),
	CONSTRAINT `security_access_policies_policyId_unique` UNIQUE(`policyId`)
);

CREATE TABLE `security_audit_logs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`auditId` varchar(80) NOT NULL,
	`workspaceId` int,
	`actorUserId` int,
	`actorRole` varchar(64),
	`action` varchar(80) NOT NULL,
	`resourceType` varchar(64) NOT NULL,
	`resourceId` varchar(128),
	`resourceName` varchar(255),
	`projectId` int,
	`agentRunId` varchar(80),
	`toolSlug` varchar(128),
	`status` enum('success','denied','failed') NOT NULL DEFAULT 'success',
	`riskLevel` enum('low','medium','high','critical') NOT NULL DEFAULT 'medium',
	`ipAddress` varchar(45),
	`userAgent` varchar(512),
	`requestId` varchar(128),
	`reason` text,
	`beforeSnapshot` json,
	`afterSnapshot` json,
	`metadata` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `security_audit_logs_id` PRIMARY KEY(`id`),
	CONSTRAINT `security_audit_logs_auditId_unique` UNIQUE(`auditId`)
);

CREATE TABLE `sellingPointDrafts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`projectId` int NOT NULL,
	`userId` int NOT NULL,
	`sellingPointCores` text,
	`generatedBullets` text,
	`confirmedBullets` text,
	`emphasis` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `sellingPointDrafts_id` PRIMARY KEY(`id`)
);

CREATE TABLE `service_tasks` (
	`workspaceId` int,
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`task_type` enum('negative_review','return_handling','email_reply','rma_processing','performance_notice','feedback_response') NOT NULL,
	`related_id` varchar(100),
	`asin` varchar(20),
	`sid` int,
	`title` varchar(500) NOT NULL,
	`description` text,
	`priority` enum('critical','high','medium','low') NOT NULL DEFAULT 'medium',
	`status` enum('open','in_progress','resolved','closed') NOT NULL DEFAULT 'open',
	`assigned_to` int,
	`due_date` varchar(10),
	`resolved_at` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `service_tasks_id` PRIMARY KEY(`id`)
);

CREATE TABLE `shipping_batches` (
	`workspaceId` int,
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` varchar(255) NOT NULL,
	`batch_name` varchar(500) NOT NULL,
	`batch_number` int NOT NULL,
	`store_name` varchar(255),
	`source_warehouse` varchar(255),
	`transit_warehouse` varchar(255),
	`destination_warehouse` varchar(255),
	`shipping_method` varchar(100),
	`current_step` int NOT NULL DEFAULT 1,
	`batch_status` enum('active','completed','cancelled','paused') NOT NULL DEFAULT 'active',
	`tracking_number` varchar(255),
	`vehicle_plate` varchar(100),
	`carrier_name` varchar(255),
	`international_tracking_number` varchar(255),
	`international_carrier` varchar(255),
	`planned_quantity` int NOT NULL DEFAULT 0,
	`ordered_quantity` int NOT NULL DEFAULT 0,
	`shipped_quantity` int NOT NULL DEFAULT 0,
	`warehouse_received_quantity` int NOT NULL DEFAULT 0,
	`international_shipped_quantity` int NOT NULL DEFAULT 0,
	`amazon_received_quantity` int NOT NULL DEFAULT 0,
	`amazon_stocked_quantity` int NOT NULL DEFAULT 0,
	`amazon_total_inventory` int NOT NULL DEFAULT 0,
	`amazon_available_inventory` int NOT NULL DEFAULT 0,
	`amazon_reserved_inventory` int NOT NULL DEFAULT 0,
	`amazon_inbound_inventory` int NOT NULL DEFAULT 0,
	`amazon_unfulfillable_inventory` int NOT NULL DEFAULT 0,
	`currency` varchar(10) NOT NULL DEFAULT 'USD',
	`total_product_cost` decimal(12,2) DEFAULT '0',
	`total_shipping_cost` decimal(12,2) DEFAULT '0',
	`total_other_cost` decimal(12,2) DEFAULT '0',
	`amazon_commission_rate` decimal(5,2),
	`batch_owner` varchar(255),
	`logistics_owner` varchar(255),
	`fba_shipment_id` varchar(255),
	`lingxing_delivery_order_id` varchar(255),
	`lingxing_purchase_order_id` varchar(255),
	`lingxing_purchase_plan_id` varchar(255),
	`created_at` bigint NOT NULL,
	`updated_at` bigint NOT NULL,
	CONSTRAINT `shipping_batches_id` PRIMARY KEY(`id`)
);

CREATE TABLE `sop_access_grants` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`skillLevel` enum('intermediate','advanced') NOT NULL,
	`grantedBy` int NOT NULL,
	`expiresAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `sop_access_grants_id` PRIMARY KEY(`id`)
);

CREATE TABLE `step_time_history` (
	`workspaceId` int,
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` varchar(255) NOT NULL,
	`batch_id` int NOT NULL,
	`step_number` int NOT NULL,
	`shipping_method` varchar(100),
	`carrier_name` varchar(255),
	`route` varchar(255),
	`expected_days` int,
	`actual_days` int,
	`month_of_year` int,
	`created_at` bigint NOT NULL,
	CONSTRAINT `step_time_history_id` PRIMARY KEY(`id`)
);

CREATE TABLE `step_time_templates` (
	`workspaceId` int,
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` varchar(255) NOT NULL,
	`template_name` varchar(200) NOT NULL,
	`shipping_method` varchar(100) NOT NULL,
	`step1_days` int NOT NULL DEFAULT 3,
	`step2_days` int NOT NULL DEFAULT 14,
	`step3_days` int NOT NULL DEFAULT 3,
	`step4_days` int NOT NULL DEFAULT 1,
	`step5_days` int NOT NULL DEFAULT 3,
	`step6_days` int NOT NULL DEFAULT 2,
	`step7_days` int NOT NULL DEFAULT 30,
	`step8_days` int NOT NULL DEFAULT 7,
	`step9_days` int NOT NULL DEFAULT 3,
	`step10_days` int NOT NULL DEFAULT 1,
	`is_default` int NOT NULL DEFAULT 0,
	`ai_suggested` int NOT NULL DEFAULT 0,
	`created_at` bigint NOT NULL,
	`updated_at` bigint NOT NULL,
	CONSTRAINT `step_time_templates_id` PRIMARY KEY(`id`)
);

CREATE TABLE `system_settings` (
	`workspaceId` int,
	`id` int AUTO_INCREMENT NOT NULL,
	`settingKey` varchar(100) NOT NULL,
	`settingValue` text,
	`description` varchar(500),
	`category` varchar(50) DEFAULT 'general',
	`isEncrypted` boolean DEFAULT false,
	`updatedBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `system_settings_id` PRIMARY KEY(`id`),
	CONSTRAINT `system_settings_settingKey_unique` UNIQUE(`settingKey`)
);

CREATE TABLE `team_tasks` (
	`workspaceId` int,
	`id` int AUTO_INCREMENT NOT NULL,
	`product_profile_id` int NOT NULL,
	`user_id` int NOT NULL,
	`title` varchar(200) NOT NULL,
	`description` text,
	`task_status` enum('backlog','todo','in_progress','review','done') NOT NULL DEFAULT 'todo',
	`task_priority_team` enum('urgent','high','medium','low') NOT NULL DEFAULT 'medium',
	`category` varchar(100),
	`assignee_id` int,
	`assignee_name` varchar(100),
	`start_date` varchar(20),
	`due_date` varchar(20),
	`completed_at` timestamp,
	`estimated_hours` decimal(5,1),
	`actual_hours` decimal(5,1),
	`linked_todo_id` int,
	`linked_plan_action_id` int,
	`tags` text,
	`sort_order` int DEFAULT 0,
	`reminder_days` varchar(100),
	`reminder_enabled` int DEFAULT 1,
	`last_reminder_sent_at` timestamp,
	`meeting_record_id` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `team_tasks_id` PRIMARY KEY(`id`)
);

CREATE TABLE `usage_stats` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int,
	`statDate` varchar(10) NOT NULL,
	`aiCallCount` int DEFAULT 0,
	`aiTokensUsed` bigint DEFAULT 0,
	`scraperCallCount` int DEFAULT 0,
	`storageUsedBytes` bigint DEFAULT 0,
	`apiCallCount` int DEFAULT 0,
	`loginCount` int DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `usage_stats_id` PRIMARY KEY(`id`)
);

CREATE TABLE `user_settings` (
	`workspaceId` int,
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`setting_key` varchar(100) NOT NULL,
	`setting_value` text,
	`created_at` bigint NOT NULL,
	`updated_at` bigint NOT NULL,
	CONSTRAINT `user_settings_id` PRIMARY KEY(`id`)
);

CREATE TABLE `users` (
	`id` int AUTO_INCREMENT NOT NULL,
	`openId` varchar(64),
	`organizationId` int,
	`defaultWorkspaceId` int,
	`name` text,
	`email` varchar(320),
	`phone` varchar(20),
	`password` varchar(256),
	`loginMethod` varchar(64),
	`role` enum('super_admin','admin','ops_manager','ops_specialist','product_dev','finance','purchaser','designer') NOT NULL DEFAULT 'ops_specialist',
	`department` varchar(100),
	`jobTitle` varchar(100),
	`status` enum('active','disabled','pending') NOT NULL DEFAULT 'active',
	`mustChangePassword` int DEFAULT 1,
	`failedLoginAttempts` int DEFAULT 0,
	`lockedUntil` timestamp,
	`invitedBy` int,
	`lastPasswordChangedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`lastSignedIn` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `users_openId_unique` UNIQUE(`openId`)
);

CREATE TABLE `video_competitor_scripts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`videoScriptId` int NOT NULL,
	`competitorName` varchar(200),
	`competitorAsin` varchar(20),
	`inputType` enum('excel_upload','video_url','knowledge_base','listing_extract') NOT NULL,
	`sourceUrl` text,
	`sourceFileKey` text,
	`sourceKbVideoId` int,
	`videoType` varchar(50),
	`totalDuration` decimal(5,1),
	`rawContent` text,
	`structureAnalysis` json,
	`visualLanguage` json,
	`copywritingAnalysis` json,
	`strengths` json,
	`weaknesses` json,
	`reusablePatterns` json,
	`userConfirmed` int DEFAULT 0,
	`userEdits` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `video_competitor_scripts_id` PRIMARY KEY(`id`)
);

CREATE TABLE `video_competitor_summary` (
	`id` int AUTO_INCREMENT NOT NULL,
	`videoScriptId` int NOT NULL,
	`competitorScriptIds` json,
	`commonStructure` json,
	`optimalDurationAllocation` json,
	`differentiableOpportunities` json,
	`recommendedStructure` json,
	`userConfirmed` int DEFAULT 0,
	`userEdits` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `video_competitor_summary_id` PRIMARY KEY(`id`)
);

CREATE TABLE `video_edit_scripts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`videoScriptId` int NOT NULL,
	`editName` varchar(200) NOT NULL,
	`videoPurpose` enum('spv_ad','sbv_ad','main_listing','aplus','social_media','other') DEFAULT 'main_listing',
	`maxDuration` decimal(5,1),
	`editStyle` varchar(100),
	`sectionMapping` json,
	`description` text,
	`sortOrder` int DEFAULT 0,
	`userConfirmed` int DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `video_edit_scripts_id` PRIMARY KEY(`id`)
);

CREATE TABLE `video_product_snapshots` (
	`id` int AUTO_INCREMENT NOT NULL,
	`videoScriptId` int NOT NULL,
	`basicInfo` json,
	`sellingPointsHierarchy` json,
	`painPoints` json,
	`keywords` json,
	`productSpecs` json,
	`productImageUrls` json,
	`dataSources` json,
	`userConfirmed` int DEFAULT 0,
	`userEdits` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `video_product_snapshots_id` PRIMARY KEY(`id`)
);

CREATE TABLE `video_script_sections` (
	`id` int AUTO_INCREMENT NOT NULL,
	`videoScriptId` int NOT NULL,
	`sectionCode` varchar(20),
	`sectionName` varchar(200) NOT NULL,
	`sectionNameEn` varchar(200),
	`shootingMethod` enum('model_narration','live_action','ai_generated','mixed','screen_recording') DEFAULT 'live_action',
	`durationBudget` decimal(5,1),
	`sellingPointRefs` json,
	`painPointRefs` json,
	`description` text,
	`shotTypeSuggestion` varchar(100),
	`propsSuggestion` json,
	`sortOrder` int DEFAULT 0,
	`userConfirmed` int DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `video_script_sections_id` PRIMARY KEY(`id`)
);

CREATE TABLE `video_script_shots` (
	`id` int AUTO_INCREMENT NOT NULL,
	`subtopicId` int NOT NULL,
	`sectionId` int NOT NULL,
	`shotCode` varchar(20),
	`duration` decimal(4,1),
	`shotDescription` text,
	`sceneLocation` varchar(100),
	`cameraAngle` enum('extreme_closeup','closeup','medium_closeup','medium','medium_wide','wide','extreme_wide'),
	`cameraMovement` varchar(100),
	`overlayTextEn` text,
	`overlayTextCn` text,
	`narrationEn` text,
	`narrationCn` text,
	`subtitleEn` text,
	`subtitleCn` text,
	`narratorType` enum('voiceover','model_narration','text_only','none') DEFAULT 'voiceover',
	`generationStrategy` enum('real_shoot','ai_image','ai_video','stock_footage','screen_record','mixed') DEFAULT 'real_shoot',
	`reuseFromShotCode` varchar(20),
	`designatedAssets` json,
	`colorScheme` varchar(200),
	`props` json,
	`notes` text,
	`referenceImageUrl` text,
	`sortOrder` int DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `video_script_shots_id` PRIMARY KEY(`id`)
);

CREATE TABLE `video_script_subtopics` (
	`id` int AUTO_INCREMENT NOT NULL,
	`sectionId` int NOT NULL,
	`subtopicName` varchar(200) NOT NULL,
	`subtopicNameEn` varchar(200),
	`durationBudget` decimal(5,1),
	`shotCount` int DEFAULT 1,
	`sellingPointRef` text,
	`sortOrder` int DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `video_script_subtopics_id` PRIMARY KEY(`id`)
);

CREATE TABLE `video_script_versions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`videoScriptId` int NOT NULL,
	`version` int NOT NULL DEFAULT 1,
	`versionNote` text,
	`snapshotData` json NOT NULL,
	`createdBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `video_script_versions_id` PRIMARY KEY(`id`)
);

CREATE TABLE `video_scripts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`projectId` int NOT NULL,
	`userId` int NOT NULL,
	`scriptName` varchar(255) NOT NULL,
	`productName` varchar(255),
	`videoType` enum('main_video','ad_spv','ad_sbv','aplus_video','social_media','other') DEFAULT 'main_video',
	`style_preset` varchar(50) DEFAULT 'minimal_white',
	`targetDuration` decimal(5,1),
	`currentStage` enum('stage_0a','stage_0b','stage_1','stage_2','stage_3','stage_4','completed') NOT NULL DEFAULT 'stage_0a',
	`stageStatus` json,
	`version` int DEFAULT 1,
	`version_note` text,
	`status` enum('draft','in_progress','completed','archived') NOT NULL DEFAULT 'draft',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `video_scripts_id` PRIMARY KEY(`id`)
);

CREATE TABLE `video_spv_segments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`videoScriptId` int NOT NULL,
	`segmentIndex` int NOT NULL DEFAULT 1,
	`segmentName` varchar(200) NOT NULL,
	`focusDimension` varchar(100),
	`descriptionText` text,
	`maxDuration` decimal(5,1) DEFAULT '25.0',
	`status` varchar(20) DEFAULT 'draft',
	`sortOrder` int DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `video_spv_segments_id` PRIMARY KEY(`id`)
);

CREATE TABLE `workspace_memberships` (
	`id` int AUTO_INCREMENT NOT NULL,
	`workspaceId` int NOT NULL,
	`userId` int NOT NULL,
	`role` varchar(64) NOT NULL,
	`status` enum('active','disabled','invited') NOT NULL DEFAULT 'active',
	`permissions` json,
	`invitedBy` int,
	`joinedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `workspace_memberships_id` PRIMARY KEY(`id`)
);

CREATE TABLE `workspaces` (
	`id` int AUTO_INCREMENT NOT NULL,
	`organizationId` int,
	`slug` varchar(128) NOT NULL,
	`name` varchar(255) NOT NULL,
	`status` enum('active','archived','disabled') NOT NULL DEFAULT 'active',
	`ownerUserId` int,
	`defaultRole` varchar(64) DEFAULT 'ops_specialist',
	`metadata` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `workspaces_id` PRIMARY KEY(`id`),
	CONSTRAINT `workspaces_slug_unique` UNIQUE(`slug`)
);

CREATE INDEX `idx_acq_asset_snapshot_status` ON `acquisition_asset_candidates` (`snapshot_id`,`review_status`);

CREATE INDEX `idx_acq_asset_content_hash` ON `acquisition_asset_candidates` (`workspace_id`,`content_hash`);

CREATE INDEX `idx_acq_confirmed_subject` ON `acquisition_confirmed_snapshots` (`workspace_id`,`marketplace`,`asin`,`is_current`);

CREATE INDEX `idx_acq_consumer_snapshot` ON `acquisition_consumer_links` (`confirmed_snapshot_id`,`status`);

CREATE INDEX `idx_acq_job_ws_status` ON `acquisition_jobs` (`workspace_id`,`status`,`created_at`);

CREATE INDEX `idx_acq_job_subject` ON `acquisition_jobs` (`workspace_id`,`marketplace`,`asin`,`created_at`);

CREATE INDEX `idx_acq_profile_ws_status` ON `acquisition_provider_profiles` (`workspace_id`,`status`);

CREATE INDEX `idx_acq_artifact_ws_run` ON `acquisition_raw_artifacts` (`workspace_id`,`run_id`);

CREATE INDEX `idx_acq_run_provider_run` ON `acquisition_runs` (`provider_profile_id`,`provider_run_id`);

CREATE INDEX `idx_acq_run_ws_status` ON `acquisition_runs` (`workspace_id`,`status`,`created_at`);

CREATE INDEX `idx_acq_revision_ws_created` ON `acquisition_snapshot_revisions` (`workspace_id`,`created_at`);

CREATE INDEX `idx_acq_snapshot_subject` ON `acquisition_source_snapshots` (`workspace_id`,`marketplace`,`asin`,`created_at`);

CREATE INDEX `idx_acq_snapshot_job` ON `acquisition_source_snapshots` (`job_id`,`status`);

CREATE INDEX `idx_ad_keyword_workspace_profile_period` ON `ad_keyword_weekly` (`workspaceId`,`source_profile_id`,`week_start_date`,`week_end_date`);

CREATE INDEX `idx_amazon_monitor_run_subject` ON `amazon_monitor_runs` (`workspace_id`,`monitor_kind`,`monitor_id`,`created_at`);

CREATE INDEX `idx_amazon_monitor_run_status` ON `amazon_monitor_runs` (`workspace_id`,`status`,`created_at`);

CREATE INDEX `idx_amazon_monitor_run_provider` ON `amazon_monitor_runs` (`provider_profile_id`,`provider_run_id`);

CREATE INDEX `idx_amazon_monitor_schedule_status` ON `amazon_monitor_schedules` (`workspace_id`,`status`,`next_run_at`);

CREATE INDEX `idx_competitor_comparison_project_selection` ON `competitorComparisonReports` (`projectId`,`selectionKey`);

CREATE INDEX `idx_competitor_comparison_workspace_status` ON `competitorComparisonReports` (`workspaceId`,`status`,`updatedAt`);

CREATE INDEX `idx_dev_reports_workspace_project` ON `dev_analysis_reports` (`workspaceId`,`projectId`,`createdAt`);

CREATE INDEX `idx_dev_stage_conflicts_project_type` ON `dev_analysis_stage_conflicts` (`projectId`,`stageType`,`createdAt`);

CREATE INDEX `idx_dev_analysis_stages_run` ON `dev_analysis_stages` (`runId`);

CREATE INDEX `idx_dev_analysis_stages_runtime` ON `dev_analysis_stages` (`stageType`,`status`,`updatedAt`);

CREATE INDEX `idx_dev_stages_workspace_project` ON `dev_analysis_stages` (`workspaceId`,`projectId`,`updatedAt`);

CREATE INDEX `idx_dev_bom_workspace_project` ON `dev_bom_items` (`workspaceId`,`projectId`,`updatedAt`);

CREATE INDEX `idx_dev_bom_summary_workspace_project` ON `dev_bom_summary` (`workspaceId`,`projectId`,`updatedAt`);

CREATE INDEX `idx_dev_external_workspace_project` ON `dev_external_data` (`workspaceId`,`projectId`,`createdAt`);

CREATE INDEX `idx_dev_global_suppliers_workspace_user` ON `dev_global_suppliers` (`workspaceId`,`userId`,`updatedAt`);

CREATE INDEX `idx_dev_import_snapshots_workspace_project` ON `dev_import_apply_snapshots` (`workspaceId`,`projectId`,`appliedAt`);

CREATE INDEX `idx_dev_import_batches_workspace_project_status` ON `dev_import_batches` (`workspaceId`,`projectId`,`status`,`createdAt`);

CREATE INDEX `idx_dev_import_batches_uploaded_file` ON `dev_import_batches` (`uploadedFileId`);

CREATE INDEX `idx_dev_import_batch_project_status` ON `dev_import_batches` (`projectId`,`status`);

CREATE INDEX `idx_dev_assets_workspace_project` ON `dev_manual_assets` (`workspaceId`,`projectId`,`createdAt`);

CREATE INDEX `idx_dev_locks_workspace_project` ON `dev_module_locks` (`workspaceId`,`projectId`,`updatedAt`);

CREATE INDEX `idx_dev_molds_workspace_project` ON `dev_mold_costs` (`workspaceId`,`projectId`,`updatedAt`);

CREATE INDEX `idx_dev_offsite_workspace_project` ON `dev_offsite_analyses` (`workspaceId`,`project_id`,`updated_at`);

CREATE INDEX `idx_dev_panorama_market_insights_workspace_project` ON `dev_panorama_market_insights` (`workspaceId`,`projectId`,`updatedAt`);

CREATE INDEX `idx_dev_panorama_market_insights_run` ON `dev_panorama_market_insights` (`runId`);

CREATE INDEX `idx_dev_panorama_workspace_project` ON `dev_panorama_status` (`workspaceId`,`projectId`,`updatedAt`);

CREATE INDEX `idx_dev_panorama_version_project_status` ON `dev_panorama_versions` (`projectId`,`status`,`confirmedAt`);

CREATE INDEX `idx_dev_manuals_workspace_project` ON `dev_product_manuals` (`workspaceId`,`projectId`,`updatedAt`);

CREATE INDEX `idx_dev_profiles_workspace_project` ON `dev_product_profiles` (`workspaceId`,`projectId`,`updatedAt`);

CREATE INDEX `idx_dev_product_tags_workspace_project` ON `dev_product_tags` (`workspaceId`,`projectId`,`createdAt`);

CREATE INDEX `idx_dev_products_workspace_project` ON `dev_products` (`workspaceId`,`projectId`,`createdAt`);

CREATE INDEX `idx_dev_profit_workspace_project` ON `dev_profit_calculations` (`workspaceId`,`projectId`,`updatedAt`);

CREATE INDEX `idx_dev_project_progress_workspace_project` ON `dev_project_progress` (`workspaceId`,`projectId`,`updatedAt`);

CREATE INDEX `idx_dev_scores_workspace_project` ON `dev_project_scores` (`workspaceId`,`projectId`,`updatedAt`);

CREATE INDEX `idx_dev_tag_categories_workspace_project` ON `dev_project_tag_categories` (`workspaceId`,`projectId`,`updatedAt`);

CREATE INDEX `idx_dev_tag_items_workspace_project` ON `dev_project_tag_items` (`workspaceId`,`projectId`,`updatedAt`);

CREATE INDEX `idx_dev_projects_workspace_status` ON `dev_projects` (`workspaceId`,`status`,`updatedAt`);

CREATE INDEX `idx_dev_projects_workspace_owner` ON `dev_projects` (`workspaceId`,`userId`,`updatedAt`);

CREATE INDEX `idx_dev_reviews_workspace_project` ON `dev_reviews` (`workspaceId`,`projectId`,`createdAt`);

CREATE INDEX `idx_dev_suppliers_workspace_project` ON `dev_suppliers` (`workspaceId`,`projectId`,`updatedAt`);

CREATE INDEX `idx_dev_dimensions_workspace_user` ON `dev_tag_dimensions` (`workspaceId`,`userId`,`createdAt`);

CREATE INDEX `idx_dev_tests_workspace_project` ON `dev_test_reports` (`workspaceId`,`projectId`,`updatedAt`);

CREATE INDEX `idx_dev_time_workspace_project` ON `dev_time_plans` (`workspaceId`,`projectId`,`updatedAt`);

CREATE INDEX `idx_dev_files_workspace_project` ON `dev_uploaded_files` (`workspaceId`,`projectId`,`createdAt`);

CREATE INDEX `idx_emperor_scheduled_tasks_workspace_managed` ON `emperor_scheduled_tasks` (`workspaceId`,`systemManaged`);

CREATE INDEX `idx_image_acq_coverage_scope_state` ON `image_acquisition_capability_coverage_revisions` (`workspaceId`,`projectId`,`coverageState`,`createdAt`);

CREATE INDEX `idx_image_acq_coverage_consumer` ON `image_acquisition_capability_coverage_revisions` (`workspaceId`,`consumerLinkId`,`createdAt`);

CREATE INDEX `idx_image_asset_policy_scope_review` ON `image_asset_policy_revisions` (`workspaceId`,`projectId`,`reviewState`,`updatedAt`);

CREATE INDEX `idx_image_asset_policy_asset_revision` ON `image_asset_policy_revisions` (`workspaceId`,`assetId`,`revision`);

CREATE INDEX `idx_image_asset_source_asset_scope` ON `image_asset_source_references` (`workspaceId`,`projectId`,`assetId`,`createdAt`);

CREATE INDEX `idx_image_asset_source_snapshot_role_position` ON `image_asset_source_references` (`workspaceId`,`sourceSnapshotId`,`sourceRole`,`sourceModule`,`sourcePosition`);

CREATE INDEX `idx_image_asset_workspace_created` ON `image_assets` (`workspaceId`,`createdAt`);

CREATE INDEX `idx_image_comp_fact_subject_status` ON `image_competitor_asset_facts` (`workspaceId`,`subjectId`,`status`);

CREATE INDEX `idx_image_comp_gallery_project_status` ON `image_competitor_gallery_analysis_versions` (`workspaceId`,`projectId`,`status`);

CREATE INDEX `idx_image_comp_gallery_selection_current` ON `image_competitor_gallery_selection_versions` (`workspaceId`,`projectId`,`subjectId`,`status`);

CREATE INDEX `idx_image_comp_subject_project_role` ON `image_competitor_research_subjects` (`workspaceId`,`projectId`,`role`,`status`);

CREATE INDEX `idx_image_expr_analysis_current` ON `image_expression_analysis_versions` (`workspaceId`,`projectId`,`groupId`,`status`);

CREATE INDEX `idx_image_expr_asset_group` ON `image_expression_asset_links` (`workspaceId`,`projectId`,`groupId`);

CREATE INDEX `idx_image_expr_selection_current` ON `image_expression_selection_versions` (`workspaceId`,`projectId`,`groupId`,`status`);

CREATE INDEX `idx_image_step0_synthesis_current` ON `image_step0_synthesis_versions` (`workspaceId`,`projectId`,`status`);

CREATE INDEX `idx_image_step0_artifact_current` ON `image_workflow_step0_artifacts` (`workspaceId`,`projectId`,`artifactType`,`status`);

CREATE INDEX `idx_claim_consistency_workspace_ledger` ON `knowledge_claim_ledger_consistency_decisions` (`workspaceId`,`ledgerKey`,`createdAt`);

CREATE INDEX `idx_claim_consistency_issue` ON `knowledge_claim_ledger_consistency_decisions` (`workspaceId`,`ledgerKey`,`issueKey`,`createdAt`);

CREATE INDEX `idx_claim_ledger_link_ledger_status` ON `knowledge_claim_ledger_links` (`ledgerKey`,`status`);

CREATE INDEX `idx_claim_ledger_workspace_project` ON `knowledge_claim_ledgers` (`workspaceId`,`businessProjectId`,`isCurrent`);

CREATE INDEX `idx_kdistill_evidence_project_status` ON `knowledge_distillation_evidence` (`distillationProjectId`,`status`);

CREATE INDEX `idx_kdistill_project_workspace_status` ON `knowledge_distillation_projects` (`workspaceId`,`status`);

CREATE INDEX `idx_kdistill_source_project_status` ON `knowledge_distillation_sources` (`distillationProjectId`,`sourceStatus`);

CREATE INDEX `idx_kdistill_source_workspace_domain` ON `knowledge_distillation_sources` (`workspaceId`,`sourceDomain`);

CREATE INDEX `idx_kdistill_draft_project_status` ON `knowledge_skill_drafts` (`distillationProjectId`,`status`);

CREATE INDEX `idx_kdistill_draft_workspace_type` ON `knowledge_skill_drafts` (`workspaceId`,`skillTypeKey`);

CREATE INDEX `idx_kdistill_feedback_skill` ON `knowledge_skill_feedback` (`workspaceId`,`skillSlug`,`createdAt`);

CREATE INDEX `idx_kdistill_review_project_created` ON `knowledge_skill_review_events` (`distillationProjectId`,`createdAt`);

CREATE INDEX `idx_kdistill_review_draft_created` ON `knowledge_skill_review_events` (`draftKey`,`createdAt`);

CREATE INDEX `lingxing_product_weekly_source_period_idx` ON `lingxing_product_weekly` (`workspaceId`,`source_kind`,`week_start_date`,`week_end_date`);

CREATE INDEX `lingxing_product_weekly_source_batch_idx` ON `lingxing_product_weekly` (`workspaceId`,`source_batch_id`);

CREATE INDEX `idx_listing_bullet_current` ON `listing_bullet_candidates` (`workspaceId`,`projectId`,`coreRevisionId`,`status`,`updatedAt`);

CREATE INDEX `idx_listing_bullet_job` ON `listing_bullet_candidates` (`workspaceId`,`jobId`,`createdAt`);

CREATE INDEX `idx_listing_complete_timeline` ON `listing_complete_snapshots` (`workspaceId`,`projectId`,`listingId`,`createdAt`);

CREATE INDEX `idx_listing_complete_approval` ON `listing_complete_snapshots` (`workspaceId`,`projectId`,`status`,`approvedAt`);

CREATE INDEX `idx_listing_core_current` ON `listing_core_revisions` (`workspaceId`,`projectId`,`sellingPointIndex`,`status`,`revision`);

CREATE INDEX `idx_listing_fact_scope_status` ON `listing_fact_revisions` (`workspaceId`,`projectId`,`status`,`updatedAt`);

CREATE INDEX `idx_listing_fact_source` ON `listing_fact_revisions` (`workspaceId`,`projectId`,`sourceFileId`,`sourceLine`);

CREATE INDEX `idx_listing_review_listing_audit` ON `listing_review_revisions` (`workspaceId`,`projectId`,`listingId`,`createdAt`);

CREATE INDEX `idx_ops_ad_mcp_campaign_week_lookup` ON `ops_ad_mcp_campaign_daily_facts` (`workspaceId`,`source_store_id`,`country`,`report_date`);

CREATE INDEX `idx_ops_ad_mcp_campaign_batch` ON `ops_ad_mcp_campaign_daily_facts` (`workspaceId`,`source_batch_id`);

CREATE INDEX `idx_ops_ad_mcp_fact_revisions_fact` ON `ops_ad_mcp_fact_revisions` (`workspaceId`,`fact_type`,`fact_id`,`created_at`);

CREATE INDEX `idx_ops_ad_mcp_fact_revisions_batch` ON `ops_ad_mcp_fact_revisions` (`workspaceId`,`source_batch_id`);

CREATE INDEX `idx_ops_ad_mcp_product_parent_week_lookup` ON `ops_ad_mcp_product_daily_facts` (`workspaceId`,`parent_asin`,`source_store_id`,`country`,`report_date`);

CREATE INDEX `idx_ops_ad_mcp_product_child_week_lookup` ON `ops_ad_mcp_product_daily_facts` (`workspaceId`,`advertised_asin`,`source_store_id`,`country`,`report_date`);

CREATE INDEX `idx_ops_ad_mcp_product_batch` ON `ops_ad_mcp_product_daily_facts` (`workspaceId`,`source_batch_id`);

CREATE INDEX `idx_ops_ad_mcp_profiles_store_country` ON `ops_ad_mcp_profiles` (`workspaceId`,`source_store_id`,`country`);

CREATE INDEX `ops_asin_daily_source_identity_idx` ON `ops_asin_daily_snapshots` (`workspaceId`,`source_store_id`,`country`,`asin`,`report_date`);

CREATE INDEX `ops_asin_daily_batch_hash_idx` ON `ops_asin_daily_snapshots` (`workspaceId`,`source_batch_hash`);

CREATE INDEX `ops_asin_lifecycle_asin_store_country_idx` ON `ops_asin_lifecycle_statuses` (`workspaceId`,`asin`,`store_name`,`country`);

CREATE INDEX `ops_asin_lifecycle_status_idx` ON `ops_asin_lifecycle_statuses` (`workspaceId`,`status`);

CREATE INDEX `idx_ops_external_sync_batches_workspace_status` ON `ops_external_sync_batches` (`workspaceId`,`status`,`createdAt`);

CREATE INDEX `idx_ops_external_sync_batches_domain` ON `ops_external_sync_batches` (`workspaceId`,`data_domain`,`createdAt`);

CREATE INDEX `idx_ops_external_sync_confirmations_batch` ON `ops_external_sync_confirmations` (`batch_id`,`createdAt`);

CREATE INDEX `idx_ops_external_sync_rows_batch` ON `ops_external_sync_rows` (`batch_id`,`row_status`);

CREATE INDEX `idx_ops_external_sync_rows_entity` ON `ops_external_sync_rows` (`workspaceId`,`entity_key`);

CREATE INDEX `idx_ops_inventory_owner_assignment_audit` ON `ops_inventory_owner_assignment_audits` (`workspaceId`,`assignment_id`,`created_at`);

CREATE INDEX `idx_ops_inventory_owner_assignment_active` ON `ops_inventory_owner_assignments` (`workspaceId`,`is_active`,`updated_at`);

CREATE INDEX `idx_ops_inventory_owner_assignment_assignee` ON `ops_inventory_owner_assignments` (`workspaceId`,`assignee_user_id`,`is_active`);

CREATE INDEX `idx_ops_lingxing_sync_schedules_task_uid` ON `ops_lingxing_sync_schedules` (`schedule_cron_task_uid`);
