-- Data lifecycle and unified artifact system v1.
-- Keeps legacy hot columns readable, while adding storage references, artifact
-- indexing, and archive bookkeeping for high-growth AI OS records.

CREATE TABLE IF NOT EXISTS `ai_storage_objects` (
  `id` int NOT NULL AUTO_INCREMENT,
  `workspaceId` int,
  `storageId` varchar(80) NOT NULL,
  `provider` enum('forge','s3','local','external') NOT NULL DEFAULT 'forge',
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
  `retainUntil` timestamp NULL,
  `archiveAfter` timestamp NULL,
  `deleteAfter` timestamp NULL,
  `archivedAt` timestamp NULL,
  `metadata` json,
  `createdBy` int,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_ai_storage_objects_storage_id` (`storageId`),
  KEY `idx_ai_storage_workspace_lifecycle` (`workspaceId`, `lifecycleState`, `archiveAfter`),
  KEY `idx_ai_storage_source` (`sourceDomain`, `sourceType`, `sourceId`),
  KEY `idx_ai_storage_hash` (`contentHash`)
);

CREATE TABLE IF NOT EXISTS `ai_artifacts` (
  `id` int NOT NULL AUTO_INCREMENT,
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
  `currentSince` timestamp NULL,
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
  `retainUntil` timestamp NULL,
  `archiveAfter` timestamp NULL,
  `deleteAfter` timestamp NULL,
  `archivedAt` timestamp NULL,
  `metadata` json,
  `sourceSkillRunId` varchar(80),
  `sourceAiJobRunId` varchar(80),
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_ai_artifacts_artifact_id` (`artifactId`),
  KEY `idx_ai_artifacts_domain_source_current` (`workspaceId`, `domain`, `sourceTable`, `sourceRowId`, `artifactKey`, `isCurrent`),
  KEY `idx_ai_artifacts_project_current` (`workspaceId`, `projectId`, `domain`, `isCurrent`, `createdAt`),
  KEY `idx_ai_artifacts_run_node_current` (`runId`, `nodeId`, `artifactKey`, `isCurrent`),
  KEY `idx_ai_artifacts_lifecycle` (`workspaceId`, `retentionClass`, `archiveAfter`, `deleteAfter`),
  KEY `idx_ai_artifacts_storage` (`storageObjectId`),
  KEY `idx_ai_artifacts_hash` (`contentHash`)
);

CREATE TABLE IF NOT EXISTS `ai_data_archive_runs` (
  `id` int NOT NULL AUTO_INCREMENT,
  `workspaceId` int,
  `archiveRunId` varchar(80) NOT NULL,
  `policySlug` varchar(128) NOT NULL,
  `tableName` varchar(128) NOT NULL,
  `status` enum('planned','running','succeeded','failed','dry_run') NOT NULL DEFAULT 'planned',
  `mode` enum('count','archive','delete') NOT NULL DEFAULT 'archive',
  `cutoffAt` timestamp NULL,
  `batchSize` int NOT NULL DEFAULT 1000,
  `candidateCount` int NOT NULL DEFAULT 0,
  `archivedCount` int NOT NULL DEFAULT 0,
  `deletedCount` int NOT NULL DEFAULT 0,
  `storageObjectId` int,
  `storageUri` text,
  `errorMessage` text,
  `metadata` json,
  `createdBy` int,
  `startedAt` timestamp NULL,
  `completedAt` timestamp NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_ai_data_archive_runs_run_id` (`archiveRunId`),
  KEY `idx_ai_archive_runs_policy_status` (`policySlug`, `status`, `createdAt`),
  KEY `idx_ai_archive_runs_table_cutoff` (`tableName`, `cutoffAt`)
);

CREATE TABLE IF NOT EXISTS `ai_data_archive_items` (
  `id` int NOT NULL AUTO_INCREMENT,
  `workspaceId` int,
  `archiveRunId` varchar(80) NOT NULL,
  `sourceTable` varchar(128) NOT NULL,
  `sourceId` varchar(128) NOT NULL,
  `sourceCreatedAt` timestamp NULL,
  `storageObjectId` int,
  `contentHash` varchar(64),
  `status` enum('archived','deleted','failed') NOT NULL DEFAULT 'archived',
  `metadata` json,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_ai_archive_items_run` (`archiveRunId`, `status`),
  KEY `idx_ai_archive_items_source` (`sourceTable`, `sourceId`),
  KEY `idx_ai_archive_items_workspace_created` (`workspaceId`, `createdAt`)
);

ALTER TABLE `projectFiles`
  ADD COLUMN `rawStorageUri` text,
  ADD COLUMN `parsedStorageUri` text,
  ADD COLUMN `analysisArtifactId` varchar(80),
  ADD COLUMN `rawContentHash` varchar(64),
  ADD COLUMN `parsedDataHash` varchar(64),
  ADD COLUMN `lifecycleState` enum('hot','warm','cold','archived','deleted') NOT NULL DEFAULT 'hot',
  ADD COLUMN `archiveAfter` timestamp NULL,
  ADD COLUMN `deleteAfter` timestamp NULL,
  ADD COLUMN `archivedAt` timestamp NULL;

ALTER TABLE `ai_jobs`
  ADD COLUMN `retentionClass` enum('hot','warm','cold','archive') NOT NULL DEFAULT 'hot',
  ADD COLUMN `archiveAfter` timestamp NULL,
  ADD COLUMN `deleteAfter` timestamp NULL,
  ADD COLUMN `archivedAt` timestamp NULL,
  ADD COLUMN `archiveBatchId` varchar(80);

ALTER TABLE `emperor_agent_events`
  ADD COLUMN `retentionClass` enum('hot','warm','cold','archive') NOT NULL DEFAULT 'hot',
  ADD COLUMN `archiveAfter` timestamp NULL,
  ADD COLUMN `deleteAfter` timestamp NULL,
  ADD COLUMN `archivedAt` timestamp NULL,
  ADD COLUMN `archiveBatchId` varchar(80);

ALTER TABLE `emperor_agent_artifacts`
  ADD COLUMN `unifiedArtifactId` varchar(80),
  ADD COLUMN `retentionClass` enum('hot','warm','cold','archive') NOT NULL DEFAULT 'hot',
  ADD COLUMN `archiveAfter` timestamp NULL,
  ADD COLUMN `deleteAfter` timestamp NULL,
  ADD COLUMN `archivedAt` timestamp NULL;

ALTER TABLE `emperor_tool_runs`
  ADD COLUMN `retentionClass` enum('hot','warm','cold','archive') NOT NULL DEFAULT 'hot',
  ADD COLUMN `archiveAfter` timestamp NULL,
  ADD COLUMN `deleteAfter` timestamp NULL,
  ADD COLUMN `archivedAt` timestamp NULL,
  ADD COLUMN `archiveBatchId` varchar(80);

ALTER TABLE `emperor_ai_os_metrics`
  ADD COLUMN `retentionClass` enum('hot','warm','cold','archive') NOT NULL DEFAULT 'hot',
  ADD COLUMN `archiveAfter` timestamp NULL,
  ADD COLUMN `deleteAfter` timestamp NULL,
  ADD COLUMN `archivedAt` timestamp NULL,
  ADD COLUMN `archiveBatchId` varchar(80);

UPDATE `projectFiles`
SET
  `rawContentHash` = COALESCE(`rawContentHash`, SHA2(COALESCE(`rawContent`, ''), 256)),
  `parsedDataHash` = COALESCE(`parsedDataHash`, SHA2(COALESCE(`parsedData`, ''), 256)),
  `rawStorageUri` = COALESCE(`rawStorageUri`, CASE WHEN `fileUrl` IS NOT NULL AND `fileUrl` <> '' THEN `fileUrl` ELSE NULL END),
  `archiveAfter` = COALESCE(`archiveAfter`, DATE_ADD(`createdAt`, INTERVAL 180 DAY)),
  `deleteAfter` = COALESCE(`deleteAfter`, DATE_ADD(`createdAt`, INTERVAL 730 DAY));

UPDATE `ai_jobs`
SET
  `archiveAfter` = COALESCE(`archiveAfter`, DATE_ADD(`createdAt`, INTERVAL 180 DAY)),
  `deleteAfter` = COALESCE(`deleteAfter`, DATE_ADD(`createdAt`, INTERVAL 730 DAY));

UPDATE `emperor_tool_runs`
SET
  `archiveAfter` = COALESCE(`archiveAfter`, DATE_ADD(`createdAt`, INTERVAL 180 DAY)),
  `deleteAfter` = COALESCE(`deleteAfter`, DATE_ADD(`createdAt`, INTERVAL 730 DAY));

UPDATE `emperor_agent_events`
SET
  `archiveAfter` = COALESCE(`archiveAfter`, DATE_ADD(`createdAt`, INTERVAL 90 DAY)),
  `deleteAfter` = COALESCE(`deleteAfter`, DATE_ADD(`createdAt`, INTERVAL 365 DAY));

UPDATE `emperor_ai_os_metrics`
SET
  `archiveAfter` = COALESCE(`archiveAfter`, DATE_ADD(`createdAt`, INTERVAL 365 DAY)),
  `deleteAfter` = COALESCE(`deleteAfter`, DATE_ADD(`createdAt`, INTERVAL 1095 DAY));

INSERT IGNORE INTO `ai_artifacts`
  (`workspaceId`,`artifactId`,`domain`,`artifactKey`,`artifactType`,`sourceType`,`sourceId`,`sourceTable`,`sourceRowId`,`projectId`,`userId`,`status`,`version`,`isCurrent`,`currentSince`,`contentJson`,`searchableText`,`summary`,`contentHash`,`storageUri`,`mimeType`,`fileName`,`fileSizeBytes`,`retentionClass`,`archiveAfter`,`deleteAfter`,`metadata`)
SELECT
  pf.`workspaceId`,
  CONCAT('art_pf_', pf.`id`, '_raw_v1'),
  'listing',
  CONCAT('project_file.', pf.`fileType`, '.raw'),
  CASE
    WHEN pf.`fileType` IN ('search_term_report','aba_keywords') THEN 'table'
    ELSE 'text'
  END,
  'upload',
  CAST(pf.`id` AS CHAR),
  'projectFiles',
  CAST(pf.`id` AS CHAR),
  pf.`projectId`,
  pf.`userId`,
  'final',
  1,
  1,
  pf.`createdAt`,
  CASE WHEN CHAR_LENGTH(COALESCE(pf.`rawContent`, '')) <= 12000 THEN JSON_OBJECT('rawContent', pf.`rawContent`) ELSE NULL END,
  LEFT(pf.`rawContent`, 16000),
  LEFT(pf.`rawContent`, 1000),
  pf.`rawContentHash`,
  pf.`rawStorageUri`,
  'text/plain',
  pf.`filename`,
  pf.`fileSize`,
  'warm',
  pf.`archiveAfter`,
  pf.`deleteAfter`,
  JSON_OBJECT('fileType', pf.`fileType`, 'source', 'migration_0115')
FROM `projectFiles` pf
WHERE pf.`rawContent` IS NOT NULL OR pf.`fileUrl` IS NOT NULL;

INSERT IGNORE INTO `ai_artifacts`
  (`workspaceId`,`artifactId`,`domain`,`artifactKey`,`artifactType`,`sourceType`,`sourceId`,`sourceTable`,`sourceRowId`,`projectId`,`userId`,`status`,`version`,`isCurrent`,`currentSince`,`contentJson`,`summary`,`contentHash`,`storageUri`,`mimeType`,`fileName`,`fileSizeBytes`,`retentionClass`,`archiveAfter`,`deleteAfter`,`metadata`,`sourceSkillRunId`,`sourceAiJobRunId`)
SELECT
  aa.`workspaceId`,
  CONCAT('art_agent_', aa.`id`),
  'agent',
  aa.`artifactKey`,
  CASE WHEN aa.`artifactType` = 'other' THEN 'json' ELSE aa.`artifactType` END,
  'ai_output',
  CAST(aa.`id` AS CHAR),
  'emperor_agent_artifacts',
  CAST(aa.`id` AS CHAR),
  aa.`projectId`,
  aa.`userId`,
  CASE WHEN aa.`status` = 'draft' THEN 'draft' WHEN aa.`isCurrent` = 1 THEN 'final' ELSE 'superseded' END,
  aa.`version`,
  aa.`isCurrent`,
  aa.`currentSince`,
  aa.`content`,
  aa.`summary`,
  aa.`contentHash`,
  aa.`storageUri`,
  aa.`mimeType`,
  aa.`fileName`,
  aa.`fileSizeBytes`,
  'hot',
  DATE_ADD(aa.`createdAt`, INTERVAL 365 DAY),
  DATE_ADD(aa.`createdAt`, INTERVAL 1095 DAY),
  JSON_OBJECT('agentSlug', aa.`agentSlug`, 'nodeId', aa.`nodeId`, 'source', 'migration_0115'),
  aa.`sourceSkillRunId`,
  aa.`sourceAiJobRunId`
FROM `emperor_agent_artifacts` aa;

UPDATE `emperor_agent_artifacts` aa
JOIN `ai_artifacts` ua ON ua.`sourceTable` = 'emperor_agent_artifacts' AND ua.`sourceRowId` = CAST(aa.`id` AS CHAR)
SET aa.`unifiedArtifactId` = COALESCE(aa.`unifiedArtifactId`, ua.`artifactId`);

CREATE INDEX `idx_project_files_lifecycle` ON `projectFiles` (`workspaceId`, `lifecycleState`, `archiveAfter`);
CREATE INDEX `idx_project_files_analysis_artifact` ON `projectFiles` (`analysisArtifactId`);
CREATE INDEX `idx_ai_jobs_lifecycle` ON `ai_jobs` (`workspaceId`, `retentionClass`, `archiveAfter`, `deleteAfter`);
CREATE INDEX `idx_agent_events_lifecycle` ON `emperor_agent_events` (`workspaceId`, `retentionClass`, `archiveAfter`, `deleteAfter`);
CREATE INDEX `idx_agent_artifacts_unified` ON `emperor_agent_artifacts` (`unifiedArtifactId`);
CREATE INDEX `idx_agent_artifacts_lifecycle` ON `emperor_agent_artifacts` (`workspaceId`, `retentionClass`, `archiveAfter`, `deleteAfter`);
CREATE INDEX `idx_tool_runs_lifecycle` ON `emperor_tool_runs` (`workspaceId`, `retentionClass`, `archiveAfter`, `deleteAfter`);
CREATE INDEX `idx_ai_os_metrics_lifecycle` ON `emperor_ai_os_metrics` (`workspaceId`, `retentionClass`, `archiveAfter`, `deleteAfter`);
