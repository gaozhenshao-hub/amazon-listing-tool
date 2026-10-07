-- Phase C trusted controlled-upload byte ledger and human-verified license evidence.
-- DRAFT ONLY: additive DDL for authorized production migration review. This file is
-- deliberately not registered with a migration runner and must not be executed
-- without the deployment owner's explicit database-migration authorization.
-- It performs no backfill, mutation, provider call, or model invocation.

CREATE TABLE IF NOT EXISTS `image_controlled_upload_receipts` (
  `id` int NOT NULL AUTO_INCREMENT,
  `workspaceId` int NOT NULL,
  `projectId` int NOT NULL,
 `uploadedBy` int NOT NULL,
 `receiptKey` varchar(512) NOT NULL,
 `assetKind` enum('step4-ref','designer','expression-group') NOT NULL,
  `intendedUse` enum('step4_reference','designer_attachment','expression_group_research') NOT NULL,
 `storageKey` varchar(512) NOT NULL,
 `storageUri` varchar(1024) NOT NULL,
  `contentHash` varchar(64) NOT NULL,
  `contentType` varchar(128) NOT NULL,
  `sizeBytes` int NOT NULL,
  `width` int NOT NULL,
  `height` int NOT NULL,
  `expiresAt` timestamp NOT NULL,
  `revokedAt` timestamp NULL DEFAULT NULL,
  `revokedBy` int DEFAULT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_controlled_image_upload_storage_key` (`storageKey`),
  KEY `idx_controlled_image_upload_scope_receipt` (`workspaceId`,`projectId`,`uploadedBy`,`receiptKey`,`assetKind`),
  KEY `idx_controlled_image_upload_scope_hash` (`workspaceId`,`projectId`,`contentHash`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `image_asset_license_evidence_revisions` (
  `id` int NOT NULL AUTO_INCREMENT,
  `evidenceRecordId` varchar(96) NOT NULL,
  `version` int NOT NULL,
  `workspaceId` int NOT NULL,
  `projectId` int NOT NULL,
  `controlledUploadReceiptId` int NOT NULL,
  `assetId` varchar(80) NOT NULL,
  `assetContentHash` varchar(64) NOT NULL,
  `assetOriginKind` enum('own_product','designer_upload') NOT NULL,
  `proofType` varchar(64) NOT NULL,
  `proofMaterialStorageUri` varchar(1024) NOT NULL,
  `proofMaterialSha256` varchar(64) NOT NULL,
  `authorizationStatement` varchar(4096) NOT NULL,
  `status` enum('pending_review','verified','rejected','revoked') NOT NULL,
  `reviewedBy` int DEFAULT NULL,
  `reviewedAt` timestamp NULL DEFAULT NULL,
  `reviewNote` varchar(1024) DEFAULT NULL,
  `expiresAt` timestamp NULL DEFAULT NULL,
  `createdBy` int NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_image_license_evidence_record_version` (`evidenceRecordId`,`version`),
  KEY `idx_image_license_evidence_scope_asset_status` (`workspaceId`,`projectId`,`controlledUploadReceiptId`,`assetId`,`status`,`version`),
  KEY `idx_image_license_evidence_scope_review` (`workspaceId`,`projectId`,`status`,`reviewedAt`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
