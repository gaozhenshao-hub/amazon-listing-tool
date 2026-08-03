-- Database governance v1: baseline indexes for hot ownership/status/time queries.
-- Soft FK and archive policies are documented in server/repositories/dbGovernance.ts
-- and docs/database-governance-v1.md. Hard FK migration should follow only after
-- orphan-data audits pass in production.

CREATE INDEX `idx_projects_user_status_updated` ON `projects` (`userId`, `status`, `updatedAt`);
CREATE INDEX `idx_projects_status_created` ON `projects` (`status`, `createdAt`);

CREATE INDEX `idx_competitor_analyses_project_asin` ON `competitorAnalyses` (`projectId`, `asin`);
CREATE INDEX `idx_competitor_analyses_project_created` ON `competitorAnalyses` (`projectId`, `createdAt`);

CREATE INDEX `idx_listings_project_active_updated` ON `listings` (`projectId`, `isActive`, `updatedAt`);
CREATE INDEX `idx_review_imports_project_status_created` ON `reviewImports` (`projectId`, `status`, `createdAt`);
CREATE INDEX `idx_review_imports_user_created` ON `reviewImports` (`userId`, `createdAt`);
CREATE INDEX `idx_project_files_project_type_status` ON `projectFiles` (`projectId`, `fileType`, `status`, `createdAt`);
CREATE INDEX `idx_project_files_user_created` ON `projectFiles` (`userId`, `createdAt`);
CREATE INDEX `idx_analysis_versions_file_created` ON `analysisVersions` (`projectFileId`, `createdAt`);
CREATE INDEX `idx_keywords_project_status_created` ON `keywords` (`projectId`, `status`, `createdAt`);
CREATE INDEX `idx_keywords_user_created` ON `keywords` (`userId`, `createdAt`);
CREATE INDEX `idx_negative_keywords_project_created` ON `negativeKeywords` (`projectId`, `createdAt`);
CREATE INDEX `idx_ad_structures_project_status_created` ON `adStructures` (`projectId`, `status`, `createdAt`);
CREATE INDEX `idx_listing_versions_listing_created` ON `listingVersions` (`listingId`, `createdAt`);
CREATE INDEX `idx_review_aggregations_project_status_created` ON `reviewAggregations` (`projectId`, `status`, `createdAt`);

CREATE INDEX `idx_image_workflow_project_user_status` ON `image_workflow_sessions` (`projectId`, `userId`, `status`, `updatedAt`);
CREATE INDEX `idx_competitor_image_project_user_created` ON `competitor_image_analyses` (`projectId`, `userId`, `createdAt`);
CREATE INDEX `idx_expression_groups_project_user_created` ON `expression_groups` (`projectId`, `userId`, `createdAt`);
CREATE INDEX `idx_expression_group_images_group_created` ON `expression_group_images` (`groupId`, `createdAt`);

CREATE INDEX `idx_ai_jobs_project_status_created` ON `ai_jobs` (`projectId`, `status`, `createdAt`);
CREATE INDEX `idx_agent_runs_user_status_created` ON `emperor_agent_runs` (`userId`, `status`, `createdAt`);
CREATE INDEX `idx_agent_runs_project_status_created` ON `emperor_agent_runs` (`projectId`, `status`, `createdAt`);
CREATE INDEX `idx_agent_events_type_created` ON `emperor_agent_events` (`eventType`, `createdAt`);
CREATE INDEX `idx_ai_os_metrics_project_name_created` ON `emperor_ai_os_metrics` (`projectId`, `metricName`, `createdAt`);
CREATE INDEX `idx_ai_os_metrics_entity_created` ON `emperor_ai_os_metrics` (`entityType`, `entityId`, `createdAt`);

CREATE INDEX `idx_ad_report_uploads_user_type_status` ON `ad_report_uploads` (`user_id`, `report_type`, `upload_status`, `createdAt`);
CREATE INDEX `idx_ad_search_terms_user_week` ON `ad_search_term_reports` (`user_id`, `week_start_date`, `product_id`);
CREATE INDEX `idx_ad_search_terms_upload` ON `ad_search_term_reports` (`upload_id`, `createdAt`);
CREATE INDEX `idx_ad_campaigns_user_week` ON `ad_campaign_reports` (`user_id`, `week_start_date`, `product_id`);
CREATE INDEX `idx_ad_campaigns_upload` ON `ad_campaign_reports` (`upload_id`, `createdAt`);
CREATE INDEX `idx_ad_placements_user_week` ON `ad_placement_reports` (`user_id`, `week_start_date`, `product_id`);
CREATE INDEX `idx_ad_hourly_user_date` ON `ad_hourly_reports` (`user_id`, `report_date`, `product_id`, `hour`);
CREATE INDEX `idx_ad_order_hourly_user_date` ON `ad_order_hourly` (`user_id`, `order_date_str`, `product_id`, `order_hour`);
CREATE INDEX `idx_ad_dsp_user_week` ON `ad_dsp_reports` (`user_id`, `week_start_date`, `product_id`);
CREATE INDEX `idx_ad_daily_placement_user_date_product` ON `ad_daily_placement_reports` (`user_id`, `report_date`, `product_id`);
CREATE INDEX `idx_ad_daily_search_user_date_product` ON `ad_daily_search_term_reports` (`user_id`, `report_date`, `product_id`);
CREATE INDEX `idx_ad_daily_impression_user_date_product` ON `ad_daily_impression_share_reports` (`user_id`, `report_date`, `product_id`);
CREATE INDEX `idx_ad_daily_sb_user_date_product` ON `ad_daily_sb_benchmark_reports` (`user_id`, `report_date`, `product_id`);
CREATE INDEX `idx_ad_daily_business_user_date_product` ON `ad_daily_business_reports` (`user_id`, `report_date`, `product_id`);

CREATE INDEX `idx_lingxing_weekly_user_week` ON `lingxing_product_weekly` (`user_id`, `week_start_date`);
CREATE INDEX `idx_saihu_weekly_user_week` ON `saihu_product_weekly` (`user_id`, `week_start_date`);
CREATE INDEX `idx_product_weekly_ops_user_product_week` ON `product_weekly_ops` (`user_id`, `product_id`, `week_start_date`);
CREATE INDEX `idx_product_monthly_summary_user_product_month` ON `product_monthly_summary` (`user_id`, `product_id`, `year_month`);
