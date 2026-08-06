-- Product development workspace isolation v1.
-- Every product-development record receives an explicit tenant scope. Existing
-- project data inherits the owner's default workspace; child records inherit
-- their project's workspace. Unresolved legacy roots remain NULL and are only
-- accessible to their owner until an administrator assigns a workspace.

ALTER TABLE `dev_projects` ADD COLUMN `workspaceId` int;
ALTER TABLE `dev_uploaded_files` ADD COLUMN `workspaceId` int;
ALTER TABLE `dev_products` ADD COLUMN `workspaceId` int;
ALTER TABLE `dev_reviews` ADD COLUMN `workspaceId` int;
ALTER TABLE `dev_tag_dimensions` ADD COLUMN `workspaceId` int;
ALTER TABLE `dev_analysis_stages` ADD COLUMN `workspaceId` int;
ALTER TABLE `dev_product_tags` ADD COLUMN `workspaceId` int;
ALTER TABLE `dev_external_data` ADD COLUMN `workspaceId` int;
ALTER TABLE `dev_analysis_reports` ADD COLUMN `workspaceId` int;
ALTER TABLE `dev_project_scores` ADD COLUMN `workspaceId` int;
ALTER TABLE `dev_product_profiles` ADD COLUMN `workspaceId` int;
ALTER TABLE `dev_product_manuals` ADD COLUMN `workspaceId` int;
ALTER TABLE `dev_test_reports` ADD COLUMN `workspaceId` int;
ALTER TABLE `dev_bom_items` ADD COLUMN `workspaceId` int;
ALTER TABLE `dev_mold_costs` ADD COLUMN `workspaceId` int;
ALTER TABLE `dev_time_plans` ADD COLUMN `workspaceId` int;
ALTER TABLE `dev_suppliers` ADD COLUMN `workspaceId` int;
ALTER TABLE `dev_bom_summary` ADD COLUMN `workspaceId` int;
ALTER TABLE `dev_profit_calculations` ADD COLUMN `workspaceId` int;
ALTER TABLE `dev_global_suppliers` ADD COLUMN `workspaceId` int;
ALTER TABLE `dev_offsite_analyses` ADD COLUMN `workspaceId` int;
ALTER TABLE `dev_panorama_status` ADD COLUMN `workspaceId` int;
ALTER TABLE `dev_project_tag_categories` ADD COLUMN `workspaceId` int;
ALTER TABLE `dev_project_tag_items` ADD COLUMN `workspaceId` int;
ALTER TABLE `dev_module_locks` ADD COLUMN `workspaceId` int;
ALTER TABLE `dev_manual_assets` ADD COLUMN `workspaceId` int;

UPDATE `dev_projects` p
LEFT JOIN `users` u ON u.`id` = p.`userId`
SET p.`workspaceId` = u.`defaultWorkspaceId`
WHERE p.`workspaceId` IS NULL;

UPDATE `dev_uploaded_files` c JOIN `dev_projects` p ON p.`id` = c.`projectId`
SET c.`workspaceId` = p.`workspaceId` WHERE c.`workspaceId` IS NULL;
UPDATE `dev_products` c JOIN `dev_projects` p ON p.`id` = c.`projectId`
SET c.`workspaceId` = p.`workspaceId` WHERE c.`workspaceId` IS NULL;
UPDATE `dev_reviews` c JOIN `dev_projects` p ON p.`id` = c.`projectId`
SET c.`workspaceId` = p.`workspaceId` WHERE c.`workspaceId` IS NULL;
UPDATE `dev_analysis_stages` c JOIN `dev_projects` p ON p.`id` = c.`projectId`
SET c.`workspaceId` = p.`workspaceId` WHERE c.`workspaceId` IS NULL;
UPDATE `dev_product_tags` c JOIN `dev_projects` p ON p.`id` = c.`projectId`
SET c.`workspaceId` = p.`workspaceId` WHERE c.`workspaceId` IS NULL;
UPDATE `dev_external_data` c JOIN `dev_projects` p ON p.`id` = c.`projectId`
SET c.`workspaceId` = p.`workspaceId` WHERE c.`workspaceId` IS NULL;
UPDATE `dev_analysis_reports` c JOIN `dev_projects` p ON p.`id` = c.`projectId`
SET c.`workspaceId` = p.`workspaceId` WHERE c.`workspaceId` IS NULL;
UPDATE `dev_project_scores` c JOIN `dev_projects` p ON p.`id` = c.`projectId`
SET c.`workspaceId` = p.`workspaceId` WHERE c.`workspaceId` IS NULL;
UPDATE `dev_product_profiles` c JOIN `dev_projects` p ON p.`id` = c.`projectId`
SET c.`workspaceId` = p.`workspaceId` WHERE c.`workspaceId` IS NULL;
UPDATE `dev_product_manuals` c JOIN `dev_projects` p ON p.`id` = c.`projectId`
SET c.`workspaceId` = p.`workspaceId` WHERE c.`workspaceId` IS NULL;
UPDATE `dev_test_reports` c JOIN `dev_projects` p ON p.`id` = c.`projectId`
SET c.`workspaceId` = p.`workspaceId` WHERE c.`workspaceId` IS NULL;
UPDATE `dev_bom_items` c JOIN `dev_projects` p ON p.`id` = c.`projectId`
SET c.`workspaceId` = p.`workspaceId` WHERE c.`workspaceId` IS NULL;
UPDATE `dev_mold_costs` c JOIN `dev_projects` p ON p.`id` = c.`projectId`
SET c.`workspaceId` = p.`workspaceId` WHERE c.`workspaceId` IS NULL;
UPDATE `dev_time_plans` c JOIN `dev_projects` p ON p.`id` = c.`projectId`
SET c.`workspaceId` = p.`workspaceId` WHERE c.`workspaceId` IS NULL;
UPDATE `dev_suppliers` c JOIN `dev_projects` p ON p.`id` = c.`projectId`
SET c.`workspaceId` = p.`workspaceId` WHERE c.`workspaceId` IS NULL;
UPDATE `dev_bom_summary` c JOIN `dev_projects` p ON p.`id` = c.`projectId`
SET c.`workspaceId` = p.`workspaceId` WHERE c.`workspaceId` IS NULL;
UPDATE `dev_offsite_analyses` c JOIN `dev_projects` p ON p.`id` = c.`project_id`
SET c.`workspaceId` = p.`workspaceId` WHERE c.`workspaceId` IS NULL;
UPDATE `dev_panorama_status` c JOIN `dev_projects` p ON p.`id` = c.`projectId`
SET c.`workspaceId` = p.`workspaceId` WHERE c.`workspaceId` IS NULL;
UPDATE `dev_project_tag_categories` c JOIN `dev_projects` p ON p.`id` = c.`projectId`
SET c.`workspaceId` = p.`workspaceId` WHERE c.`workspaceId` IS NULL;
UPDATE `dev_project_tag_items` c JOIN `dev_projects` p ON p.`id` = c.`projectId`
SET c.`workspaceId` = p.`workspaceId` WHERE c.`workspaceId` IS NULL;
UPDATE `dev_module_locks` c JOIN `dev_projects` p ON p.`id` = c.`projectId`
SET c.`workspaceId` = p.`workspaceId` WHERE c.`workspaceId` IS NULL;
UPDATE `dev_manual_assets` c JOIN `dev_projects` p ON p.`id` = c.`projectId`
SET c.`workspaceId` = p.`workspaceId` WHERE c.`workspaceId` IS NULL;

UPDATE `dev_tag_dimensions` c LEFT JOIN `users` u ON u.`id` = c.`userId`
SET c.`workspaceId` = u.`defaultWorkspaceId` WHERE c.`workspaceId` IS NULL;
UPDATE `dev_global_suppliers` c LEFT JOIN `users` u ON u.`id` = c.`userId`
SET c.`workspaceId` = u.`defaultWorkspaceId` WHERE c.`workspaceId` IS NULL;
UPDATE `dev_profit_calculations` c
LEFT JOIN `dev_projects` p ON p.`id` = c.`projectId`
LEFT JOIN `users` u ON u.`id` = c.`userId`
SET c.`workspaceId` = COALESCE(p.`workspaceId`, u.`defaultWorkspaceId`)
WHERE c.`workspaceId` IS NULL;

CREATE INDEX `idx_dev_projects_workspace_status` ON `dev_projects` (`workspaceId`, `status`, `updatedAt`);
CREATE INDEX `idx_dev_projects_workspace_owner` ON `dev_projects` (`workspaceId`, `userId`, `updatedAt`);
CREATE INDEX `idx_dev_files_workspace_project` ON `dev_uploaded_files` (`workspaceId`, `projectId`, `createdAt`);
CREATE INDEX `idx_dev_products_workspace_project` ON `dev_products` (`workspaceId`, `projectId`, `createdAt`);
CREATE INDEX `idx_dev_reviews_workspace_project` ON `dev_reviews` (`workspaceId`, `projectId`, `createdAt`);
CREATE INDEX `idx_dev_dimensions_workspace_user` ON `dev_tag_dimensions` (`workspaceId`, `userId`, `createdAt`);
CREATE INDEX `idx_dev_stages_workspace_project` ON `dev_analysis_stages` (`workspaceId`, `projectId`, `updatedAt`);
CREATE INDEX `idx_dev_product_tags_workspace_project` ON `dev_product_tags` (`workspaceId`, `projectId`, `createdAt`);
CREATE INDEX `idx_dev_external_workspace_project` ON `dev_external_data` (`workspaceId`, `projectId`, `createdAt`);
CREATE INDEX `idx_dev_reports_workspace_project` ON `dev_analysis_reports` (`workspaceId`, `projectId`, `createdAt`);
CREATE INDEX `idx_dev_scores_workspace_project` ON `dev_project_scores` (`workspaceId`, `projectId`, `updatedAt`);
CREATE INDEX `idx_dev_profiles_workspace_project` ON `dev_product_profiles` (`workspaceId`, `projectId`, `updatedAt`);
CREATE INDEX `idx_dev_manuals_workspace_project` ON `dev_product_manuals` (`workspaceId`, `projectId`, `updatedAt`);
CREATE INDEX `idx_dev_tests_workspace_project` ON `dev_test_reports` (`workspaceId`, `projectId`, `updatedAt`);
CREATE INDEX `idx_dev_bom_workspace_project` ON `dev_bom_items` (`workspaceId`, `projectId`, `updatedAt`);
CREATE INDEX `idx_dev_molds_workspace_project` ON `dev_mold_costs` (`workspaceId`, `projectId`, `updatedAt`);
CREATE INDEX `idx_dev_time_workspace_project` ON `dev_time_plans` (`workspaceId`, `projectId`, `updatedAt`);
CREATE INDEX `idx_dev_suppliers_workspace_project` ON `dev_suppliers` (`workspaceId`, `projectId`, `updatedAt`);
CREATE INDEX `idx_dev_bom_summary_workspace_project` ON `dev_bom_summary` (`workspaceId`, `projectId`, `updatedAt`);
CREATE INDEX `idx_dev_profit_workspace_project` ON `dev_profit_calculations` (`workspaceId`, `projectId`, `updatedAt`);
CREATE INDEX `idx_dev_global_suppliers_workspace_user` ON `dev_global_suppliers` (`workspaceId`, `userId`, `updatedAt`);
CREATE INDEX `idx_dev_offsite_workspace_project` ON `dev_offsite_analyses` (`workspaceId`, `project_id`, `updated_at`);
CREATE INDEX `idx_dev_panorama_workspace_project` ON `dev_panorama_status` (`workspaceId`, `projectId`, `updatedAt`);
CREATE INDEX `idx_dev_tag_categories_workspace_project` ON `dev_project_tag_categories` (`workspaceId`, `projectId`, `updatedAt`);
CREATE INDEX `idx_dev_tag_items_workspace_project` ON `dev_project_tag_items` (`workspaceId`, `projectId`, `updatedAt`);
CREATE INDEX `idx_dev_locks_workspace_project` ON `dev_module_locks` (`workspaceId`, `projectId`, `updatedAt`);
CREATE INDEX `idx_dev_assets_workspace_project` ON `dev_manual_assets` (`workspaceId`, `projectId`, `createdAt`);

INSERT INTO `security_audit_logs`
  (`auditId`, `workspaceId`, `action`, `resourceType`, `status`, `riskLevel`, `reason`, `metadata`)
SELECT
  CONCAT('audit_', UUID()),
  NULL,
  'product_development.workspace_backfill',
  'dev_projects',
  'success',
  IF(COUNT(*) = 0, 'low', 'high'),
  IF(COUNT(*) = 0, 'All product development projects were assigned to a workspace',
     'Legacy projects without an owner workspace require manual assignment'),
  JSON_OBJECT('unassignedProjects', COUNT(*), 'migration', '0124_product_development_workspace_security')
FROM `dev_projects`
WHERE `workspaceId` IS NULL;
