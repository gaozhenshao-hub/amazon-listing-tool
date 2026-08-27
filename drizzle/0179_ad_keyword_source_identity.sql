-- Preserve existing keyword history unchanged; new scheduled MCP facts receive a
-- stable source identity to prevent retrying the same report date from appending
-- a second copy of the same Profile × campaign × keyword × match-type fact.
ALTER TABLE `ad_keyword_weekly`
  ADD COLUMN `source_profile_id` varchar(64) NULL AFTER `user_id`;

ALTER TABLE `ad_keyword_weekly`
  ADD COLUMN `source_identity_hash` varchar(64) NULL AFTER `source_profile_id`;

CREATE UNIQUE INDEX `uk_ad_keyword_workspace_source_identity`
  ON `ad_keyword_weekly` (`workspaceId`, `source_identity_hash`);

CREATE INDEX `idx_ad_keyword_workspace_profile_period`
  ON `ad_keyword_weekly` (`workspaceId`, `source_profile_id`, `week_start_date`, `week_end_date`);
