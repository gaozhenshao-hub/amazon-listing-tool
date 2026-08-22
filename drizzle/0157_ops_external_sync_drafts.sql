CREATE TABLE IF NOT EXISTS `ops_external_sync_batches` (
  `workspaceId` int NULL,
  `id` int AUTO_INCREMENT NOT NULL,
  `user_id` int NOT NULL,
  `source` varchar(32) NOT NULL,
  `data_domain` varchar(48) NOT NULL,
  `status` varchar(32) NOT NULL DEFAULT 'draft',
  `scope` json NOT NULL,
  `tool_run_id` varchar(128) NULL,
  `trace_id` varchar(128) NULL,
  `raw_response_hash` varchar(64) NULL,
  `raw_snapshot` json NULL,
  `normalization_version` varchar(32) NOT NULL DEFAULT 'v1',
  `summary` json NULL,
  `error_message` text NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `reviewed_at` timestamp NULL,
  `reviewed_by` int NULL,
  `applied_at` timestamp NULL,
  `applied_by` int NULL,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_ops_external_sync_batches_workspace_status` (`workspaceId`,`status`,`createdAt`),
  KEY `idx_ops_external_sync_batches_domain` (`workspaceId`,`data_domain`,`createdAt`)
);

CREATE TABLE IF NOT EXISTS `ops_external_sync_rows` (
  `workspaceId` int NULL,
  `id` int AUTO_INCREMENT NOT NULL,
  `batch_id` int NOT NULL,
  `entity_key` varchar(512) NOT NULL,
  `row_status` varchar(32) NOT NULL DEFAULT 'needs_review',
  `selected` int NOT NULL DEFAULT 1,
  `source_data` json NOT NULL,
  `normalized_data` json NOT NULL,
  `field_diffs` json NULL,
  `match_info` json NULL,
  `target_reference` json NULL,
  `validation_errors` json NULL,
  `applied_at` timestamp NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_ops_external_sync_rows_batch` (`batch_id`,`row_status`),
  KEY `idx_ops_external_sync_rows_entity` (`workspaceId`,`entity_key`)
);

CREATE TABLE IF NOT EXISTS `ops_external_sync_confirmations` (
  `workspaceId` int NULL,
  `id` int AUTO_INCREMENT NOT NULL,
  `batch_id` int NOT NULL,
  `user_id` int NOT NULL,
  `action` varchar(32) NOT NULL,
  `selected_row_ids` json NULL,
  `note` text NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_ops_external_sync_confirmations_batch` (`batch_id`,`createdAt`)
);
