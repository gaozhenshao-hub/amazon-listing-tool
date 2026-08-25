CREATE TABLE `emperor_context_source_provenance` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `provenanceId` VARCHAR(80) NOT NULL,
  `manifestId` VARCHAR(80) NOT NULL,
  `traceId` VARCHAR(80) NOT NULL,
  `sourceType` VARCHAR(40) NOT NULL,
  `sourceKey` VARCHAR(160) NOT NULL,
  `sourceHash` VARCHAR(64) NOT NULL,
  `status` VARCHAR(24) NOT NULL DEFAULT 'valid',
  `invalidationReason` VARCHAR(512) NULL,
  `invalidatedBy` INT NULL,
  `invalidatedAt` TIMESTAMP NULL,
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY `uq_emperor_context_source_provenance_manifest_source` (`manifestId`,`sourceType`,`sourceKey`),
  KEY `idx_emperor_context_source_provenance_trace` (`traceId`,`id`),
  KEY `idx_emperor_context_source_provenance_source_status` (`sourceType`,`sourceKey`,`status`)
);
