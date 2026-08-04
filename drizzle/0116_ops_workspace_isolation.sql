-- Full workspace isolation columns for operations and advertising domains.
-- Existing rows are assigned from their owner user when possible, otherwise to the default workspace.

SET @defaultWorkspaceId = (SELECT `id` FROM `workspaces` WHERE `slug` = 'default' LIMIT 1);

ALTER TABLE `user_settings` ADD COLUMN `workspaceId` int;
UPDATE `user_settings` t LEFT JOIN `users` u ON u.`id` = t.`user_id` SET t.`workspaceId` = COALESCE(t.`workspaceId`, u.`defaultWorkspaceId`, @defaultWorkspaceId) WHERE t.`workspaceId` IS NULL;
CREATE INDEX `idx_user_settings_workspace` ON `user_settings` (`workspaceId`);

ALTER TABLE `system_settings` ADD COLUMN `workspaceId` int;
UPDATE `system_settings` SET `workspaceId` = @defaultWorkspaceId WHERE `workspaceId` IS NULL;
CREATE INDEX `idx_system_settings_workspace` ON `system_settings` (`workspaceId`);

ALTER TABLE `lingxing_config` ADD COLUMN `workspaceId` int;
UPDATE `lingxing_config` SET `workspaceId` = @defaultWorkspaceId WHERE `workspaceId` IS NULL;
CREATE INDEX `idx_lingxing_config_workspace` ON `lingxing_config` (`workspaceId`);

ALTER TABLE `lingxing_api_logs` ADD COLUMN `workspaceId` int;
UPDATE `lingxing_api_logs` t LEFT JOIN `users` u ON u.`id` = t.`userId` SET t.`workspaceId` = COALESCE(t.`workspaceId`, u.`defaultWorkspaceId`, @defaultWorkspaceId) WHERE t.`workspaceId` IS NULL;
CREATE INDEX `idx_lingxing_api_logs_workspace` ON `lingxing_api_logs` (`workspaceId`);

ALTER TABLE `inventory_config` ADD COLUMN `workspaceId` int;
UPDATE `inventory_config` t LEFT JOIN `users` u ON u.`id` = t.`userId` SET t.`workspaceId` = COALESCE(t.`workspaceId`, u.`defaultWorkspaceId`, @defaultWorkspaceId) WHERE t.`workspaceId` IS NULL;
CREATE INDEX `idx_inventory_config_workspace` ON `inventory_config` (`workspaceId`);

ALTER TABLE `inventory_snapshots` ADD COLUMN `workspaceId` int;
UPDATE `inventory_snapshots` SET `workspaceId` = @defaultWorkspaceId WHERE `workspaceId` IS NULL;
CREATE INDEX `idx_inventory_snapshots_workspace` ON `inventory_snapshots` (`workspaceId`);

ALTER TABLE `production_config` ADD COLUMN `workspaceId` int;
UPDATE `production_config` t LEFT JOIN `users` u ON u.`id` = t.`userId` SET t.`workspaceId` = COALESCE(t.`workspaceId`, u.`defaultWorkspaceId`, @defaultWorkspaceId) WHERE t.`workspaceId` IS NULL;
CREATE INDEX `idx_production_config_workspace` ON `production_config` (`workspaceId`);

ALTER TABLE `profit_snapshots` ADD COLUMN `workspaceId` int;
UPDATE `profit_snapshots` SET `workspaceId` = @defaultWorkspaceId WHERE `workspaceId` IS NULL;
CREATE INDEX `idx_profit_snapshots_workspace` ON `profit_snapshots` (`workspaceId`);

ALTER TABLE `profit_alert_rules` ADD COLUMN `workspaceId` int;
UPDATE `profit_alert_rules` t LEFT JOIN `users` u ON u.`id` = t.`userId` SET t.`workspaceId` = COALESCE(t.`workspaceId`, u.`defaultWorkspaceId`, @defaultWorkspaceId) WHERE t.`workspaceId` IS NULL;
CREATE INDEX `idx_profit_alert_rules_workspace` ON `profit_alert_rules` (`workspaceId`);

ALTER TABLE `product_profiles` ADD COLUMN `workspaceId` int;
UPDATE `product_profiles` t LEFT JOIN `users` u ON u.`id` = t.`userId` SET t.`workspaceId` = COALESCE(t.`workspaceId`, u.`defaultWorkspaceId`, @defaultWorkspaceId) WHERE t.`workspaceId` IS NULL;
CREATE INDEX `idx_product_profiles_workspace` ON `product_profiles` (`workspaceId`);

ALTER TABLE `product_variants` ADD COLUMN `workspaceId` int;
UPDATE `product_variants` SET `workspaceId` = @defaultWorkspaceId WHERE `workspaceId` IS NULL;
CREATE INDEX `idx_product_variants_workspace` ON `product_variants` (`workspaceId`);

ALTER TABLE `product_todos` ADD COLUMN `workspaceId` int;
UPDATE `product_todos` t LEFT JOIN `users` u ON u.`id` = t.`userId` SET t.`workspaceId` = COALESCE(t.`workspaceId`, u.`defaultWorkspaceId`, @defaultWorkspaceId) WHERE t.`workspaceId` IS NULL;
CREATE INDEX `idx_product_todos_workspace` ON `product_todos` (`workspaceId`);

ALTER TABLE `product_logs` ADD COLUMN `workspaceId` int;
UPDATE `product_logs` t LEFT JOIN `users` u ON u.`id` = t.`userId` SET t.`workspaceId` = COALESCE(t.`workspaceId`, u.`defaultWorkspaceId`, @defaultWorkspaceId) WHERE t.`workspaceId` IS NULL;
CREATE INDEX `idx_product_logs_workspace` ON `product_logs` (`workspaceId`);

ALTER TABLE `keyword_monitors` ADD COLUMN `workspaceId` int;
UPDATE `keyword_monitors` t LEFT JOIN `users` u ON u.`id` = t.`userId` SET t.`workspaceId` = COALESCE(t.`workspaceId`, u.`defaultWorkspaceId`, @defaultWorkspaceId) WHERE t.`workspaceId` IS NULL;
CREATE INDEX `idx_keyword_monitors_workspace` ON `keyword_monitors` (`workspaceId`);

ALTER TABLE `keyword_snapshots` ADD COLUMN `workspaceId` int;
UPDATE `keyword_snapshots` SET `workspaceId` = @defaultWorkspaceId WHERE `workspaceId` IS NULL;
CREATE INDEX `idx_keyword_snapshots_workspace` ON `keyword_snapshots` (`workspaceId`);

ALTER TABLE `ops_plans` ADD COLUMN `workspaceId` int;
UPDATE `ops_plans` t LEFT JOIN `users` u ON u.`id` = t.`userId` SET t.`workspaceId` = COALESCE(t.`workspaceId`, u.`defaultWorkspaceId`, @defaultWorkspaceId) WHERE t.`workspaceId` IS NULL;
CREATE INDEX `idx_ops_plans_workspace` ON `ops_plans` (`workspaceId`);

ALTER TABLE `ops_plan_actions` ADD COLUMN `workspaceId` int;
UPDATE `ops_plan_actions` t LEFT JOIN `users` u ON u.`id` = t.`userId` SET t.`workspaceId` = COALESCE(t.`workspaceId`, u.`defaultWorkspaceId`, @defaultWorkspaceId) WHERE t.`workspaceId` IS NULL;
CREATE INDEX `idx_ops_plan_actions_workspace` ON `ops_plan_actions` (`workspaceId`);

ALTER TABLE `ops_plan_summaries` ADD COLUMN `workspaceId` int;
UPDATE `ops_plan_summaries` t LEFT JOIN `users` u ON u.`id` = t.`userId` SET t.`workspaceId` = COALESCE(t.`workspaceId`, u.`defaultWorkspaceId`, @defaultWorkspaceId) WHERE t.`workspaceId` IS NULL;
CREATE INDEX `idx_ops_plan_summaries_workspace` ON `ops_plan_summaries` (`workspaceId`);

ALTER TABLE `conversion_comparisons` ADD COLUMN `workspaceId` int;
UPDATE `conversion_comparisons` t LEFT JOIN `users` u ON u.`id` = t.`userId` SET t.`workspaceId` = COALESCE(t.`workspaceId`, u.`defaultWorkspaceId`, @defaultWorkspaceId) WHERE t.`workspaceId` IS NULL;
CREATE INDEX `idx_conversion_comparisons_workspace` ON `conversion_comparisons` (`workspaceId`);

ALTER TABLE `conversion_check_items` ADD COLUMN `workspaceId` int;
UPDATE `conversion_check_items` t LEFT JOIN `users` u ON u.`id` = t.`userId` SET t.`workspaceId` = COALESCE(t.`workspaceId`, u.`defaultWorkspaceId`, @defaultWorkspaceId) WHERE t.`workspaceId` IS NULL;
CREATE INDEX `idx_conversion_check_items_workspace` ON `conversion_check_items` (`workspaceId`);

ALTER TABLE `check_item_overrides` ADD COLUMN `workspaceId` int;
UPDATE `check_item_overrides` t LEFT JOIN `users` u ON u.`id` = t.`userId` SET t.`workspaceId` = COALESCE(t.`workspaceId`, u.`defaultWorkspaceId`, @defaultWorkspaceId) WHERE t.`workspaceId` IS NULL;
CREATE INDEX `idx_check_item_overrides_workspace` ON `check_item_overrides` (`workspaceId`);

ALTER TABLE `conversion_scores` ADD COLUMN `workspaceId` int;
UPDATE `conversion_scores` SET `workspaceId` = @defaultWorkspaceId WHERE `workspaceId` IS NULL;
CREATE INDEX `idx_conversion_scores_workspace` ON `conversion_scores` (`workspaceId`);

ALTER TABLE `conversion_suggestions` ADD COLUMN `workspaceId` int;
UPDATE `conversion_suggestions` t LEFT JOIN `users` u ON u.`id` = t.`userId` SET t.`workspaceId` = COALESCE(t.`workspaceId`, u.`defaultWorkspaceId`, @defaultWorkspaceId) WHERE t.`workspaceId` IS NULL;
CREATE INDEX `idx_conversion_suggestions_workspace` ON `conversion_suggestions` (`workspaceId`);

ALTER TABLE `execution_reviews` ADD COLUMN `workspaceId` int;
UPDATE `execution_reviews` t LEFT JOIN `users` u ON u.`id` = t.`userId` SET t.`workspaceId` = COALESCE(t.`workspaceId`, u.`defaultWorkspaceId`, @defaultWorkspaceId) WHERE t.`workspaceId` IS NULL;
CREATE INDEX `idx_execution_reviews_workspace` ON `execution_reviews` (`workspaceId`);

ALTER TABLE `ops_import_history` ADD COLUMN `workspaceId` int;
UPDATE `ops_import_history` t LEFT JOIN `users` u ON u.`id` = t.`userId` SET t.`workspaceId` = COALESCE(t.`workspaceId`, u.`defaultWorkspaceId`, @defaultWorkspaceId) WHERE t.`workspaceId` IS NULL;
CREATE INDEX `idx_ops_import_history_workspace` ON `ops_import_history` (`workspaceId`);

ALTER TABLE `team_tasks` ADD COLUMN `workspaceId` int;
UPDATE `team_tasks` t LEFT JOIN `users` u ON u.`id` = t.`userId` SET t.`workspaceId` = COALESCE(t.`workspaceId`, u.`defaultWorkspaceId`, @defaultWorkspaceId) WHERE t.`workspaceId` IS NULL;
CREATE INDEX `idx_team_tasks_workspace` ON `team_tasks` (`workspaceId`);

ALTER TABLE `shipping_batches` ADD COLUMN `workspaceId` int;
UPDATE `shipping_batches` t LEFT JOIN `users` u ON u.`id` = t.`userId` SET t.`workspaceId` = COALESCE(t.`workspaceId`, u.`defaultWorkspaceId`, @defaultWorkspaceId) WHERE t.`workspaceId` IS NULL;
CREATE INDEX `idx_shipping_batches_workspace` ON `shipping_batches` (`workspaceId`);

ALTER TABLE `batch_step_configs` ADD COLUMN `workspaceId` int;
UPDATE `batch_step_configs` SET `workspaceId` = @defaultWorkspaceId WHERE `workspaceId` IS NULL;
CREATE INDEX `idx_batch_step_configs_workspace` ON `batch_step_configs` (`workspaceId`);

ALTER TABLE `batch_products` ADD COLUMN `workspaceId` int;
UPDATE `batch_products` SET `workspaceId` = @defaultWorkspaceId WHERE `workspaceId` IS NULL;
CREATE INDEX `idx_batch_products_workspace` ON `batch_products` (`workspaceId`);

ALTER TABLE `batch_logs` ADD COLUMN `workspaceId` int;
UPDATE `batch_logs` t LEFT JOIN `users` u ON u.`id` = t.`userId` SET t.`workspaceId` = COALESCE(t.`workspaceId`, u.`defaultWorkspaceId`, @defaultWorkspaceId) WHERE t.`workspaceId` IS NULL;
CREATE INDEX `idx_batch_logs_workspace` ON `batch_logs` (`workspaceId`);

ALTER TABLE `step_time_history` ADD COLUMN `workspaceId` int;
UPDATE `step_time_history` t LEFT JOIN `users` u ON u.`id` = t.`userId` SET t.`workspaceId` = COALESCE(t.`workspaceId`, u.`defaultWorkspaceId`, @defaultWorkspaceId) WHERE t.`workspaceId` IS NULL;
CREATE INDEX `idx_step_time_history_workspace` ON `step_time_history` (`workspaceId`);

ALTER TABLE `replenishment_predictions` ADD COLUMN `workspaceId` int;
UPDATE `replenishment_predictions` t LEFT JOIN `users` u ON u.`id` = t.`userId` SET t.`workspaceId` = COALESCE(t.`workspaceId`, u.`defaultWorkspaceId`, @defaultWorkspaceId) WHERE t.`workspaceId` IS NULL;
CREATE INDEX `idx_replenishment_predictions_workspace` ON `replenishment_predictions` (`workspaceId`);

ALTER TABLE `step_time_templates` ADD COLUMN `workspaceId` int;
UPDATE `step_time_templates` t LEFT JOIN `users` u ON u.`id` = t.`userId` SET t.`workspaceId` = COALESCE(t.`workspaceId`, u.`defaultWorkspaceId`, @defaultWorkspaceId) WHERE t.`workspaceId` IS NULL;
CREATE INDEX `idx_step_time_templates_workspace` ON `step_time_templates` (`workspaceId`);

ALTER TABLE `asin_permissions` ADD COLUMN `workspaceId` int;
UPDATE `asin_permissions` t LEFT JOIN `users` u ON u.`id` = t.`userId` SET t.`workspaceId` = COALESCE(t.`workspaceId`, u.`defaultWorkspaceId`, @defaultWorkspaceId) WHERE t.`workspaceId` IS NULL;
CREATE INDEX `idx_asin_permissions_workspace` ON `asin_permissions` (`workspaceId`);

ALTER TABLE `asin_status_cache` ADD COLUMN `workspaceId` int;
UPDATE `asin_status_cache` SET `workspaceId` = @defaultWorkspaceId WHERE `workspaceId` IS NULL;
CREATE INDEX `idx_asin_status_cache_workspace` ON `asin_status_cache` (`workspaceId`);

ALTER TABLE `asin_tag_definitions` ADD COLUMN `workspaceId` int;
UPDATE `asin_tag_definitions` t LEFT JOIN `users` u ON u.`id` = t.`userId` SET t.`workspaceId` = COALESCE(t.`workspaceId`, u.`defaultWorkspaceId`, @defaultWorkspaceId) WHERE t.`workspaceId` IS NULL;
CREATE INDEX `idx_asin_tag_definitions_workspace` ON `asin_tag_definitions` (`workspaceId`);

ALTER TABLE `asin_tag_assignments` ADD COLUMN `workspaceId` int;
UPDATE `asin_tag_assignments` t LEFT JOIN `users` u ON u.`id` = t.`userId` SET t.`workspaceId` = COALESCE(t.`workspaceId`, u.`defaultWorkspaceId`, @defaultWorkspaceId) WHERE t.`workspaceId` IS NULL;
CREATE INDEX `idx_asin_tag_assignments_workspace` ON `asin_tag_assignments` (`workspaceId`);

ALTER TABLE `asin_logs` ADD COLUMN `workspaceId` int;
UPDATE `asin_logs` t LEFT JOIN `users` u ON u.`id` = t.`userId` SET t.`workspaceId` = COALESCE(t.`workspaceId`, u.`defaultWorkspaceId`, @defaultWorkspaceId) WHERE t.`workspaceId` IS NULL;
CREATE INDEX `idx_asin_logs_workspace` ON `asin_logs` (`workspaceId`);

ALTER TABLE `product_ops_plans` ADD COLUMN `workspaceId` int;
UPDATE `product_ops_plans` t LEFT JOIN `users` u ON u.`id` = t.`userId` SET t.`workspaceId` = COALESCE(t.`workspaceId`, u.`defaultWorkspaceId`, @defaultWorkspaceId) WHERE t.`workspaceId` IS NULL;
CREATE INDEX `idx_product_ops_plans_workspace` ON `product_ops_plans` (`workspaceId`);

ALTER TABLE `product_ops_daily_records` ADD COLUMN `workspaceId` int;
UPDATE `product_ops_daily_records` SET `workspaceId` = @defaultWorkspaceId WHERE `workspaceId` IS NULL;
CREATE INDEX `idx_product_ops_daily_records_workspace` ON `product_ops_daily_records` (`workspaceId`);

ALTER TABLE `keyword_trackings` ADD COLUMN `workspaceId` int;
UPDATE `keyword_trackings` SET `workspaceId` = @defaultWorkspaceId WHERE `workspaceId` IS NULL;
CREATE INDEX `idx_keyword_trackings_workspace` ON `keyword_trackings` (`workspaceId`);

ALTER TABLE `keyword_daily_records` ADD COLUMN `workspaceId` int;
UPDATE `keyword_daily_records` SET `workspaceId` = @defaultWorkspaceId WHERE `workspaceId` IS NULL;
CREATE INDEX `idx_keyword_daily_records_workspace` ON `keyword_daily_records` (`workspaceId`);

ALTER TABLE `promotion_phases` ADD COLUMN `workspaceId` int;
UPDATE `promotion_phases` SET `workspaceId` = @defaultWorkspaceId WHERE `workspaceId` IS NULL;
CREATE INDEX `idx_promotion_phases_workspace` ON `promotion_phases` (`workspaceId`);

ALTER TABLE `review_records` ADD COLUMN `workspaceId` int;
UPDATE `review_records` t LEFT JOIN `users` u ON u.`id` = t.`userId` SET t.`workspaceId` = COALESCE(t.`workspaceId`, u.`defaultWorkspaceId`, @defaultWorkspaceId) WHERE t.`workspaceId` IS NULL;
CREATE INDEX `idx_review_records_workspace` ON `review_records` (`workspaceId`);

ALTER TABLE `review_replies` ADD COLUMN `workspaceId` int;
UPDATE `review_replies` t LEFT JOIN `users` u ON u.`id` = t.`userId` SET t.`workspaceId` = COALESCE(t.`workspaceId`, u.`defaultWorkspaceId`, @defaultWorkspaceId) WHERE t.`workspaceId` IS NULL;
CREATE INDEX `idx_review_replies_workspace` ON `review_replies` (`workspaceId`);

ALTER TABLE `email_templates` ADD COLUMN `workspaceId` int;
UPDATE `email_templates` t LEFT JOIN `users` u ON u.`id` = t.`userId` SET t.`workspaceId` = COALESCE(t.`workspaceId`, u.`defaultWorkspaceId`, @defaultWorkspaceId) WHERE t.`workspaceId` IS NULL;
CREATE INDEX `idx_email_templates_workspace` ON `email_templates` (`workspaceId`);

ALTER TABLE `email_replies` ADD COLUMN `workspaceId` int;
UPDATE `email_replies` t LEFT JOIN `users` u ON u.`id` = t.`userId` SET t.`workspaceId` = COALESCE(t.`workspaceId`, u.`defaultWorkspaceId`, @defaultWorkspaceId) WHERE t.`workspaceId` IS NULL;
CREATE INDEX `idx_email_replies_workspace` ON `email_replies` (`workspaceId`);

ALTER TABLE `return_analysis_cache` ADD COLUMN `workspaceId` int;
UPDATE `return_analysis_cache` t LEFT JOIN `users` u ON u.`id` = t.`userId` SET t.`workspaceId` = COALESCE(t.`workspaceId`, u.`defaultWorkspaceId`, @defaultWorkspaceId) WHERE t.`workspaceId` IS NULL;
CREATE INDEX `idx_return_analysis_cache_workspace` ON `return_analysis_cache` (`workspaceId`);

ALTER TABLE `service_tasks` ADD COLUMN `workspaceId` int;
UPDATE `service_tasks` t LEFT JOIN `users` u ON u.`id` = t.`userId` SET t.`workspaceId` = COALESCE(t.`workspaceId`, u.`defaultWorkspaceId`, @defaultWorkspaceId) WHERE t.`workspaceId` IS NULL;
CREATE INDEX `idx_service_tasks_workspace` ON `service_tasks` (`workspaceId`);

ALTER TABLE `custom_dashboards` ADD COLUMN `workspaceId` int;
UPDATE `custom_dashboards` t LEFT JOIN `users` u ON u.`id` = t.`userId` SET t.`workspaceId` = COALESCE(t.`workspaceId`, u.`defaultWorkspaceId`, @defaultWorkspaceId) WHERE t.`workspaceId` IS NULL;
CREATE INDEX `idx_custom_dashboards_workspace` ON `custom_dashboards` (`workspaceId`);

ALTER TABLE `dashboard_widgets` ADD COLUMN `workspaceId` int;
UPDATE `dashboard_widgets` SET `workspaceId` = @defaultWorkspaceId WHERE `workspaceId` IS NULL;
CREATE INDEX `idx_dashboard_widgets_workspace` ON `dashboard_widgets` (`workspaceId`);

ALTER TABLE `customer_profiles` ADD COLUMN `workspaceId` int;
UPDATE `customer_profiles` t LEFT JOIN `users` u ON u.`id` = t.`userId` SET t.`workspaceId` = COALESCE(t.`workspaceId`, u.`defaultWorkspaceId`, @defaultWorkspaceId) WHERE t.`workspaceId` IS NULL;
CREATE INDEX `idx_customer_profiles_workspace` ON `customer_profiles` (`workspaceId`);

ALTER TABLE `off_influencers` ADD COLUMN `workspaceId` int;
UPDATE `off_influencers` t LEFT JOIN `users` u ON u.`id` = t.`userId` SET t.`workspaceId` = COALESCE(t.`workspaceId`, u.`defaultWorkspaceId`, @defaultWorkspaceId) WHERE t.`workspaceId` IS NULL;
CREATE INDEX `idx_off_influencers_workspace` ON `off_influencers` (`workspaceId`);

ALTER TABLE `off_influencer_scores` ADD COLUMN `workspaceId` int;
UPDATE `off_influencer_scores` SET `workspaceId` = @defaultWorkspaceId WHERE `workspaceId` IS NULL;
CREATE INDEX `idx_off_influencer_scores_workspace` ON `off_influencer_scores` (`workspaceId`);

ALTER TABLE `off_campaigns` ADD COLUMN `workspaceId` int;
UPDATE `off_campaigns` t LEFT JOIN `users` u ON u.`id` = t.`userId` SET t.`workspaceId` = COALESCE(t.`workspaceId`, u.`defaultWorkspaceId`, @defaultWorkspaceId) WHERE t.`workspaceId` IS NULL;
CREATE INDEX `idx_off_campaigns_workspace` ON `off_campaigns` (`workspaceId`);

ALTER TABLE `off_collaborations` ADD COLUMN `workspaceId` int;
UPDATE `off_collaborations` t LEFT JOIN `users` u ON u.`id` = t.`userId` SET t.`workspaceId` = COALESCE(t.`workspaceId`, u.`defaultWorkspaceId`, @defaultWorkspaceId) WHERE t.`workspaceId` IS NULL;
CREATE INDEX `idx_off_collaborations_workspace` ON `off_collaborations` (`workspaceId`);

ALTER TABLE `off_outreach_messages` ADD COLUMN `workspaceId` int;
UPDATE `off_outreach_messages` t LEFT JOIN `users` u ON u.`id` = t.`userId` SET t.`workspaceId` = COALESCE(t.`workspaceId`, u.`defaultWorkspaceId`, @defaultWorkspaceId) WHERE t.`workspaceId` IS NULL;
CREATE INDEX `idx_off_outreach_messages_workspace` ON `off_outreach_messages` (`workspaceId`);

ALTER TABLE `off_content_submissions` ADD COLUMN `workspaceId` int;
UPDATE `off_content_submissions` t LEFT JOIN `users` u ON u.`id` = t.`userId` SET t.`workspaceId` = COALESCE(t.`workspaceId`, u.`defaultWorkspaceId`, @defaultWorkspaceId) WHERE t.`workspaceId` IS NULL;
CREATE INDEX `idx_off_content_submissions_workspace` ON `off_content_submissions` (`workspaceId`);

ALTER TABLE `off_social_accounts` ADD COLUMN `workspaceId` int;
UPDATE `off_social_accounts` t LEFT JOIN `users` u ON u.`id` = t.`userId` SET t.`workspaceId` = COALESCE(t.`workspaceId`, u.`defaultWorkspaceId`, @defaultWorkspaceId) WHERE t.`workspaceId` IS NULL;
CREATE INDEX `idx_off_social_accounts_workspace` ON `off_social_accounts` (`workspaceId`);

ALTER TABLE `off_content_calendar` ADD COLUMN `workspaceId` int;
UPDATE `off_content_calendar` t LEFT JOIN `users` u ON u.`id` = t.`userId` SET t.`workspaceId` = COALESCE(t.`workspaceId`, u.`defaultWorkspaceId`, @defaultWorkspaceId) WHERE t.`workspaceId` IS NULL;
CREATE INDEX `idx_off_content_calendar_workspace` ON `off_content_calendar` (`workspaceId`);

ALTER TABLE `off_attribution_links` ADD COLUMN `workspaceId` int;
UPDATE `off_attribution_links` t LEFT JOIN `users` u ON u.`id` = t.`userId` SET t.`workspaceId` = COALESCE(t.`workspaceId`, u.`defaultWorkspaceId`, @defaultWorkspaceId) WHERE t.`workspaceId` IS NULL;
CREATE INDEX `idx_off_attribution_links_workspace` ON `off_attribution_links` (`workspaceId`);

ALTER TABLE `off_campaign_analytics` ADD COLUMN `workspaceId` int;
UPDATE `off_campaign_analytics` SET `workspaceId` = @defaultWorkspaceId WHERE `workspaceId` IS NULL;
CREATE INDEX `idx_off_campaign_analytics_workspace` ON `off_campaign_analytics` (`workspaceId`);

ALTER TABLE `off_matrix_groups` ADD COLUMN `workspaceId` int;
UPDATE `off_matrix_groups` t LEFT JOIN `users` u ON u.`id` = t.`userId` SET t.`workspaceId` = COALESCE(t.`workspaceId`, u.`defaultWorkspaceId`, @defaultWorkspaceId) WHERE t.`workspaceId` IS NULL;
CREATE INDEX `idx_off_matrix_groups_workspace` ON `off_matrix_groups` (`workspaceId`);

ALTER TABLE `off_ai_analysis_logs` ADD COLUMN `workspaceId` int;
UPDATE `off_ai_analysis_logs` t LEFT JOIN `users` u ON u.`id` = t.`userId` SET t.`workspaceId` = COALESCE(t.`workspaceId`, u.`defaultWorkspaceId`, @defaultWorkspaceId) WHERE t.`workspaceId` IS NULL;
CREATE INDEX `idx_off_ai_analysis_logs_workspace` ON `off_ai_analysis_logs` (`workspaceId`);

ALTER TABLE `product_weekly_ops` ADD COLUMN `workspaceId` int;
UPDATE `product_weekly_ops` t LEFT JOIN `users` u ON u.`id` = t.`userId` SET t.`workspaceId` = COALESCE(t.`workspaceId`, u.`defaultWorkspaceId`, @defaultWorkspaceId) WHERE t.`workspaceId` IS NULL;
CREATE INDEX `idx_product_weekly_ops_workspace` ON `product_weekly_ops` (`workspaceId`);

ALTER TABLE `product_monthly_summary` ADD COLUMN `workspaceId` int;
UPDATE `product_monthly_summary` t LEFT JOIN `users` u ON u.`id` = t.`userId` SET t.`workspaceId` = COALESCE(t.`workspaceId`, u.`defaultWorkspaceId`, @defaultWorkspaceId) WHERE t.`workspaceId` IS NULL;
CREATE INDEX `idx_product_monthly_summary_workspace` ON `product_monthly_summary` (`workspaceId`);

ALTER TABLE `product_basic_info` ADD COLUMN `workspaceId` int;
UPDATE `product_basic_info` t LEFT JOIN `users` u ON u.`id` = t.`userId` SET t.`workspaceId` = COALESCE(t.`workspaceId`, u.`defaultWorkspaceId`, @defaultWorkspaceId) WHERE t.`workspaceId` IS NULL;
CREATE INDEX `idx_product_basic_info_workspace` ON `product_basic_info` (`workspaceId`);

ALTER TABLE `meeting_records` ADD COLUMN `workspaceId` int;
UPDATE `meeting_records` t LEFT JOIN `users` u ON u.`id` = t.`userId` SET t.`workspaceId` = COALESCE(t.`workspaceId`, u.`defaultWorkspaceId`, @defaultWorkspaceId) WHERE t.`workspaceId` IS NULL;
CREATE INDEX `idx_meeting_records_workspace` ON `meeting_records` (`workspaceId`);

ALTER TABLE `budget_tracking` ADD COLUMN `workspaceId` int;
UPDATE `budget_tracking` t LEFT JOIN `users` u ON u.`id` = t.`userId` SET t.`workspaceId` = COALESCE(t.`workspaceId`, u.`defaultWorkspaceId`, @defaultWorkspaceId) WHERE t.`workspaceId` IS NULL;
CREATE INDEX `idx_budget_tracking_workspace` ON `budget_tracking` (`workspaceId`);

ALTER TABLE `data_imports` ADD COLUMN `workspaceId` int;
UPDATE `data_imports` t LEFT JOIN `users` u ON u.`id` = t.`userId` SET t.`workspaceId` = COALESCE(t.`workspaceId`, u.`defaultWorkspaceId`, @defaultWorkspaceId) WHERE t.`workspaceId` IS NULL;
CREATE INDEX `idx_data_imports_workspace` ON `data_imports` (`workspaceId`);

ALTER TABLE `lingxing_product_weekly` ADD COLUMN `workspaceId` int;
UPDATE `lingxing_product_weekly` t LEFT JOIN `users` u ON u.`id` = t.`userId` SET t.`workspaceId` = COALESCE(t.`workspaceId`, u.`defaultWorkspaceId`, @defaultWorkspaceId) WHERE t.`workspaceId` IS NULL;
CREATE INDEX `idx_lingxing_product_weekly_workspace` ON `lingxing_product_weekly` (`workspaceId`);

ALTER TABLE `saihu_product_weekly` ADD COLUMN `workspaceId` int;
UPDATE `saihu_product_weekly` t LEFT JOIN `users` u ON u.`id` = t.`userId` SET t.`workspaceId` = COALESCE(t.`workspaceId`, u.`defaultWorkspaceId`, @defaultWorkspaceId) WHERE t.`workspaceId` IS NULL;
CREATE INDEX `idx_saihu_product_weekly_workspace` ON `saihu_product_weekly` (`workspaceId`);

ALTER TABLE `operator_name_mappings` ADD COLUMN `workspaceId` int;
UPDATE `operator_name_mappings` t LEFT JOIN `users` u ON u.`id` = t.`userId` SET t.`workspaceId` = COALESCE(t.`workspaceId`, u.`defaultWorkspaceId`, @defaultWorkspaceId) WHERE t.`workspaceId` IS NULL;
CREATE INDEX `idx_operator_name_mappings_workspace` ON `operator_name_mappings` (`workspaceId`);

ALTER TABLE `ad_analysis_tasks` ADD COLUMN `workspaceId` int;
UPDATE `ad_analysis_tasks` t LEFT JOIN `users` u ON u.`id` = t.`userId` SET t.`workspaceId` = COALESCE(t.`workspaceId`, u.`defaultWorkspaceId`, @defaultWorkspaceId) WHERE t.`workspaceId` IS NULL;
CREATE INDEX `idx_ad_analysis_tasks_workspace` ON `ad_analysis_tasks` (`workspaceId`);

ALTER TABLE `ad_automation_rules` ADD COLUMN `workspaceId` int;
UPDATE `ad_automation_rules` t LEFT JOIN `users` u ON u.`id` = t.`userId` SET t.`workspaceId` = COALESCE(t.`workspaceId`, u.`defaultWorkspaceId`, @defaultWorkspaceId) WHERE t.`workspaceId` IS NULL;
CREATE INDEX `idx_ad_automation_rules_workspace` ON `ad_automation_rules` (`workspaceId`);

ALTER TABLE `search_term_actions` ADD COLUMN `workspaceId` int;
UPDATE `search_term_actions` t LEFT JOIN `users` u ON u.`id` = t.`userId` SET t.`workspaceId` = COALESCE(t.`workspaceId`, u.`defaultWorkspaceId`, @defaultWorkspaceId) WHERE t.`workspaceId` IS NULL;
CREATE INDEX `idx_search_term_actions_workspace` ON `search_term_actions` (`workspaceId`);

ALTER TABLE `competitor_monitors` ADD COLUMN `workspaceId` int;
UPDATE `competitor_monitors` t LEFT JOIN `users` u ON u.`id` = t.`userId` SET t.`workspaceId` = COALESCE(t.`workspaceId`, u.`defaultWorkspaceId`, @defaultWorkspaceId) WHERE t.`workspaceId` IS NULL;
CREATE INDEX `idx_competitor_monitors_workspace` ON `competitor_monitors` (`workspaceId`);

ALTER TABLE `competitor_snapshots` ADD COLUMN `workspaceId` int;
UPDATE `competitor_snapshots` SET `workspaceId` = @defaultWorkspaceId WHERE `workspaceId` IS NULL;
CREATE INDEX `idx_competitor_snapshots_workspace` ON `competitor_snapshots` (`workspaceId`);

ALTER TABLE `competitor_reports` ADD COLUMN `workspaceId` int;
UPDATE `competitor_reports` t LEFT JOIN `users` u ON u.`id` = t.`userId` SET t.`workspaceId` = COALESCE(t.`workspaceId`, u.`defaultWorkspaceId`, @defaultWorkspaceId) WHERE t.`workspaceId` IS NULL;
CREATE INDEX `idx_competitor_reports_workspace` ON `competitor_reports` (`workspaceId`);

ALTER TABLE `competitor_ad_benchmarks` ADD COLUMN `workspaceId` int;
UPDATE `competitor_ad_benchmarks` SET `workspaceId` = @defaultWorkspaceId WHERE `workspaceId` IS NULL;
CREATE INDEX `idx_competitor_ad_benchmarks_workspace` ON `competitor_ad_benchmarks` (`workspaceId`);

ALTER TABLE `ad_portfolio_mappings` ADD COLUMN `workspaceId` int;
UPDATE `ad_portfolio_mappings` t LEFT JOIN `users` u ON u.`id` = t.`userId` SET t.`workspaceId` = COALESCE(t.`workspaceId`, u.`defaultWorkspaceId`, @defaultWorkspaceId) WHERE t.`workspaceId` IS NULL;
CREATE INDEX `idx_ad_portfolio_mappings_workspace` ON `ad_portfolio_mappings` (`workspaceId`);

ALTER TABLE `ad_report_imports` ADD COLUMN `workspaceId` int;
UPDATE `ad_report_imports` t LEFT JOIN `users` u ON u.`id` = t.`userId` SET t.`workspaceId` = COALESCE(t.`workspaceId`, u.`defaultWorkspaceId`, @defaultWorkspaceId) WHERE t.`workspaceId` IS NULL;
CREATE INDEX `idx_ad_report_imports_workspace` ON `ad_report_imports` (`workspaceId`);

ALTER TABLE `ad_keyword_weekly` ADD COLUMN `workspaceId` int;
UPDATE `ad_keyword_weekly` t LEFT JOIN `users` u ON u.`id` = t.`userId` SET t.`workspaceId` = COALESCE(t.`workspaceId`, u.`defaultWorkspaceId`, @defaultWorkspaceId) WHERE t.`workspaceId` IS NULL;
CREATE INDEX `idx_ad_keyword_weekly_workspace` ON `ad_keyword_weekly` (`workspaceId`);

ALTER TABLE `ad_keyword_meta` ADD COLUMN `workspaceId` int;
UPDATE `ad_keyword_meta` t LEFT JOIN `users` u ON u.`id` = t.`userId` SET t.`workspaceId` = COALESCE(t.`workspaceId`, u.`defaultWorkspaceId`, @defaultWorkspaceId) WHERE t.`workspaceId` IS NULL;
CREATE INDEX `idx_ad_keyword_meta_workspace` ON `ad_keyword_meta` (`workspaceId`);

ALTER TABLE `ad_competitor_ranks` ADD COLUMN `workspaceId` int;
UPDATE `ad_competitor_ranks` t LEFT JOIN `users` u ON u.`id` = t.`userId` SET t.`workspaceId` = COALESCE(t.`workspaceId`, u.`defaultWorkspaceId`, @defaultWorkspaceId) WHERE t.`workspaceId` IS NULL;
CREATE INDEX `idx_ad_competitor_ranks_workspace` ON `ad_competitor_ranks` (`workspaceId`);

ALTER TABLE `ad_report_uploads` ADD COLUMN `workspaceId` int;
UPDATE `ad_report_uploads` t LEFT JOIN `users` u ON u.`id` = t.`userId` SET t.`workspaceId` = COALESCE(t.`workspaceId`, u.`defaultWorkspaceId`, @defaultWorkspaceId) WHERE t.`workspaceId` IS NULL;
CREATE INDEX `idx_ad_report_uploads_workspace` ON `ad_report_uploads` (`workspaceId`);

ALTER TABLE `ad_search_term_reports` ADD COLUMN `workspaceId` int;
UPDATE `ad_search_term_reports` t LEFT JOIN `users` u ON u.`id` = t.`userId` SET t.`workspaceId` = COALESCE(t.`workspaceId`, u.`defaultWorkspaceId`, @defaultWorkspaceId) WHERE t.`workspaceId` IS NULL;
CREATE INDEX `idx_ad_search_term_reports_workspace` ON `ad_search_term_reports` (`workspaceId`);

ALTER TABLE `ad_campaign_reports` ADD COLUMN `workspaceId` int;
UPDATE `ad_campaign_reports` t LEFT JOIN `users` u ON u.`id` = t.`userId` SET t.`workspaceId` = COALESCE(t.`workspaceId`, u.`defaultWorkspaceId`, @defaultWorkspaceId) WHERE t.`workspaceId` IS NULL;
CREATE INDEX `idx_ad_campaign_reports_workspace` ON `ad_campaign_reports` (`workspaceId`);

ALTER TABLE `ad_placement_reports` ADD COLUMN `workspaceId` int;
UPDATE `ad_placement_reports` t LEFT JOIN `users` u ON u.`id` = t.`userId` SET t.`workspaceId` = COALESCE(t.`workspaceId`, u.`defaultWorkspaceId`, @defaultWorkspaceId) WHERE t.`workspaceId` IS NULL;
CREATE INDEX `idx_ad_placement_reports_workspace` ON `ad_placement_reports` (`workspaceId`);

ALTER TABLE `ad_hourly_reports` ADD COLUMN `workspaceId` int;
UPDATE `ad_hourly_reports` t LEFT JOIN `users` u ON u.`id` = t.`userId` SET t.`workspaceId` = COALESCE(t.`workspaceId`, u.`defaultWorkspaceId`, @defaultWorkspaceId) WHERE t.`workspaceId` IS NULL;
CREATE INDEX `idx_ad_hourly_reports_workspace` ON `ad_hourly_reports` (`workspaceId`);

ALTER TABLE `ad_order_hourly` ADD COLUMN `workspaceId` int;
UPDATE `ad_order_hourly` t LEFT JOIN `users` u ON u.`id` = t.`userId` SET t.`workspaceId` = COALESCE(t.`workspaceId`, u.`defaultWorkspaceId`, @defaultWorkspaceId) WHERE t.`workspaceId` IS NULL;
CREATE INDEX `idx_ad_order_hourly_workspace` ON `ad_order_hourly` (`workspaceId`);

ALTER TABLE `ad_dsp_reports` ADD COLUMN `workspaceId` int;
UPDATE `ad_dsp_reports` t LEFT JOIN `users` u ON u.`id` = t.`userId` SET t.`workspaceId` = COALESCE(t.`workspaceId`, u.`defaultWorkspaceId`, @defaultWorkspaceId) WHERE t.`workspaceId` IS NULL;
CREATE INDEX `idx_ad_dsp_reports_workspace` ON `ad_dsp_reports` (`workspaceId`);

ALTER TABLE `ad_daily_placement_reports` ADD COLUMN `workspaceId` int;
UPDATE `ad_daily_placement_reports` t LEFT JOIN `users` u ON u.`id` = t.`userId` SET t.`workspaceId` = COALESCE(t.`workspaceId`, u.`defaultWorkspaceId`, @defaultWorkspaceId) WHERE t.`workspaceId` IS NULL;
CREATE INDEX `idx_ad_daily_placement_reports_workspace` ON `ad_daily_placement_reports` (`workspaceId`);

ALTER TABLE `ad_daily_search_term_reports` ADD COLUMN `workspaceId` int;
UPDATE `ad_daily_search_term_reports` t LEFT JOIN `users` u ON u.`id` = t.`userId` SET t.`workspaceId` = COALESCE(t.`workspaceId`, u.`defaultWorkspaceId`, @defaultWorkspaceId) WHERE t.`workspaceId` IS NULL;
CREATE INDEX `idx_ad_daily_search_term_reports_workspace` ON `ad_daily_search_term_reports` (`workspaceId`);

ALTER TABLE `ad_daily_impression_share_reports` ADD COLUMN `workspaceId` int;
UPDATE `ad_daily_impression_share_reports` t LEFT JOIN `users` u ON u.`id` = t.`userId` SET t.`workspaceId` = COALESCE(t.`workspaceId`, u.`defaultWorkspaceId`, @defaultWorkspaceId) WHERE t.`workspaceId` IS NULL;
CREATE INDEX `idx_ad_daily_impression_share_reports_workspace` ON `ad_daily_impression_share_reports` (`workspaceId`);

ALTER TABLE `ad_daily_sb_benchmark_reports` ADD COLUMN `workspaceId` int;
UPDATE `ad_daily_sb_benchmark_reports` t LEFT JOIN `users` u ON u.`id` = t.`userId` SET t.`workspaceId` = COALESCE(t.`workspaceId`, u.`defaultWorkspaceId`, @defaultWorkspaceId) WHERE t.`workspaceId` IS NULL;
CREATE INDEX `idx_ad_daily_sb_benchmark_reports_workspace` ON `ad_daily_sb_benchmark_reports` (`workspaceId`);

ALTER TABLE `ad_daily_business_reports` ADD COLUMN `workspaceId` int;
UPDATE `ad_daily_business_reports` t LEFT JOIN `users` u ON u.`id` = t.`userId` SET t.`workspaceId` = COALESCE(t.`workspaceId`, u.`defaultWorkspaceId`, @defaultWorkspaceId) WHERE t.`workspaceId` IS NULL;
CREATE INDEX `idx_ad_daily_business_reports_workspace` ON `ad_daily_business_reports` (`workspaceId`);

ALTER TABLE `ad_product_stages` ADD COLUMN `workspaceId` int;
UPDATE `ad_product_stages` t LEFT JOIN `users` u ON u.`id` = t.`userId` SET t.`workspaceId` = COALESCE(t.`workspaceId`, u.`defaultWorkspaceId`, @defaultWorkspaceId) WHERE t.`workspaceId` IS NULL;
CREATE INDEX `idx_ad_product_stages_workspace` ON `ad_product_stages` (`workspaceId`);

ALTER TABLE `ad_keyword_tiers` ADD COLUMN `workspaceId` int;
UPDATE `ad_keyword_tiers` t LEFT JOIN `users` u ON u.`id` = t.`userId` SET t.`workspaceId` = COALESCE(t.`workspaceId`, u.`defaultWorkspaceId`, @defaultWorkspaceId) WHERE t.`workspaceId` IS NULL;
CREATE INDEX `idx_ad_keyword_tiers_workspace` ON `ad_keyword_tiers` (`workspaceId`);

ALTER TABLE `ad_diagnoses` ADD COLUMN `workspaceId` int;
UPDATE `ad_diagnoses` t LEFT JOIN `users` u ON u.`id` = t.`userId` SET t.`workspaceId` = COALESCE(t.`workspaceId`, u.`defaultWorkspaceId`, @defaultWorkspaceId) WHERE t.`workspaceId` IS NULL;
CREATE INDEX `idx_ad_diagnoses_workspace` ON `ad_diagnoses` (`workspaceId`);

ALTER TABLE `ad_report_analysis_records` ADD COLUMN `workspaceId` int;
UPDATE `ad_report_analysis_records` t LEFT JOIN `users` u ON u.`id` = t.`userId` SET t.`workspaceId` = COALESCE(t.`workspaceId`, u.`defaultWorkspaceId`, @defaultWorkspaceId) WHERE t.`workspaceId` IS NULL;
CREATE INDEX `idx_ad_report_analysis_records_workspace` ON `ad_report_analysis_records` (`workspaceId`);

ALTER TABLE `ad_sop_tasks` ADD COLUMN `workspaceId` int;
UPDATE `ad_sop_tasks` t LEFT JOIN `users` u ON u.`id` = t.`userId` SET t.`workspaceId` = COALESCE(t.`workspaceId`, u.`defaultWorkspaceId`, @defaultWorkspaceId) WHERE t.`workspaceId` IS NULL;
CREATE INDEX `idx_ad_sop_tasks_workspace` ON `ad_sop_tasks` (`workspaceId`);

ALTER TABLE `ad_clinic_records` ADD COLUMN `workspaceId` int;
UPDATE `ad_clinic_records` t LEFT JOIN `users` u ON u.`id` = t.`userId` SET t.`workspaceId` = COALESCE(t.`workspaceId`, u.`defaultWorkspaceId`, @defaultWorkspaceId) WHERE t.`workspaceId` IS NULL;
CREATE INDEX `idx_ad_clinic_records_workspace` ON `ad_clinic_records` (`workspaceId`);
