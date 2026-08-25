-- Align the lifecycle storage enum with the existing S3-compatible OSS provider.
-- This only broadens an enum; existing storage rows and object permissions are unchanged.
ALTER TABLE `ai_storage_objects`
  MODIFY COLUMN `provider` enum('forge','s3','oss','local','external') NOT NULL DEFAULT 'forge';
