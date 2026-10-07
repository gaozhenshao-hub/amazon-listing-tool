-- Phase C image asset identity, allowed-use policy, source-reference, and acquisition-coverage governance.
-- Additive only: creates isolated tables and their local indexes. It does not alter
-- existing acquisition, knowledge-base, upload, project, or image-workflow tables;
-- it performs no backfill, data mutation, provider call, or model invocation.

CREATE TABLE IF NOT EXISTS `image_assets` (
  `id` int NOT NULL AUTO_INCREMENT,
  `assetId` varchar(80) NOT NULL,
  `workspaceId` int NOT NULL,
  `assetType` enum('image') NOT NULL DEFAULT 'image',
  `contentHash` varchar(64) DEFAULT NULL,
  `storageRef` varchar(1024) NOT NULL,
  `contentType` varchar(128) DEFAULT NULL,
  `sizeBytes` int DEFAULT NULL,
  `width` int DEFAULT NULL,
  `height` int DEFAULT NULL,
  `createdBy` int NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_image_asset_workspace_asset` (`workspaceId`,`assetId`),
  UNIQUE KEY `uk_image_asset_workspace_hash` (`workspaceId`,`contentHash`),
  KEY `idx_image_asset_workspace_created` (`workspaceId`,`createdAt`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `image_asset_policy_revisions` (
  `id` int NOT NULL AUTO_INCREMENT,
  `assetId` varchar(80) NOT NULL,
  `workspaceId` int NOT NULL,
  `projectId` int NOT NULL,
  `sourceReferenceId` int DEFAULT NULL,
  `originKind` enum('competitor_research','own_product','approved_knowledge_reference','designer_upload','legacy_unclassified') NOT NULL,
  `originRecordType` varchar(64) NOT NULL,
  `originRecordId` varchar(128) NOT NULL,
  `contentHash` varchar(64) DEFAULT NULL,
  `allowedUsesJson` json NOT NULL,
  `licenseEvidenceJson` json DEFAULT NULL,
  `reviewState` enum('unclassified','pending_review','approved','rejected','revoked','superseded') NOT NULL DEFAULT 'unclassified',
  `revision` int NOT NULL DEFAULT 1,
  `policyHash` varchar(64) NOT NULL,
  `createdBy` int NOT NULL,
  `reviewedBy` int DEFAULT NULL,
  `reviewedAt` timestamp NULL DEFAULT NULL,
  `reviewNote` varchar(1024) DEFAULT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_image_asset_policy_scope_asset_revision` (`workspaceId`,`projectId`,`assetId`,`revision`),
  KEY `idx_image_asset_policy_scope_review` (`workspaceId`,`projectId`,`reviewState`,`updatedAt`),
  KEY `idx_image_asset_policy_asset_revision` (`workspaceId`,`assetId`,`revision`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `image_asset_source_references` (
  `id` int NOT NULL AUTO_INCREMENT,
  `assetId` varchar(80) NOT NULL,
  `workspaceId` int NOT NULL,
  `projectId` int NOT NULL,
  `sourceSnapshotId` int DEFAULT NULL,
  `originRecordType` varchar(64) NOT NULL,
  `originRecordId` varchar(128) NOT NULL,
  `sourceRole` enum('main','secondary','aplus','brand_story','video','unknown') NOT NULL DEFAULT 'unknown',
  `sourceModule` varchar(128) NOT NULL DEFAULT '',
  `sourcePosition` int NOT NULL,
  `sourceReferenceKey` varchar(128) NOT NULL,
  `createdBy` int NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_image_asset_source_reference_scope_key` (`workspaceId`,`projectId`,`sourceReferenceKey`),
  KEY `idx_image_asset_source_asset_scope` (`workspaceId`,`projectId`,`assetId`,`createdAt`),
  KEY `idx_image_asset_source_snapshot_role_position` (`workspaceId`,`sourceSnapshotId`,`sourceRole`,`sourceModule`,`sourcePosition`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `image_acquisition_capability_coverage_revisions` (
  `id` int NOT NULL AUTO_INCREMENT,
  `workspaceId` int NOT NULL,
  `projectId` int NOT NULL,
  `sourceSnapshotId` int NOT NULL,
  `confirmedSnapshotId` int DEFAULT NULL,
  `consumerLinkId` int DEFAULT NULL,
  `capability` enum('image_gallery','aplus','brand_story') NOT NULL,
  `coverageState` enum('not_requested','returned','confirmed_absent','not_returned','provider_unsupported','download_failed','pending_supplement','manually_supplemented') NOT NULL,
  `roleCoverageJson` json NOT NULL,
  `coverageHash` varchar(64) NOT NULL,
  `revision` int NOT NULL DEFAULT 1,
  `createdBy` int NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_image_acq_coverage_snapshot_cap_revision` (`workspaceId`,`projectId`,`sourceSnapshotId`,`capability`,`revision`),
  KEY `idx_image_acq_coverage_scope_state` (`workspaceId`,`projectId`,`coverageState`,`createdAt`),
  KEY `idx_image_acq_coverage_consumer` (`workspaceId`,`consumerLinkId`,`createdAt`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
