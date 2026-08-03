-- Agent Artifact system v1.
-- Adds explicit current-version pointers and normalized file/image/table metadata.

ALTER TABLE `emperor_agent_artifacts`
  MODIFY COLUMN `artifactType` enum('json','text','markdown','html','image','file','table','other') NOT NULL DEFAULT 'json',
  ADD COLUMN `isCurrent` int NOT NULL DEFAULT 0,
  ADD COLUMN `currentSince` timestamp NULL,
  ADD COLUMN `selectedBy` int,
  ADD COLUMN `contentHash` varchar(64),
  ADD COLUMN `mimeType` varchar(128),
  ADD COLUMN `fileName` varchar(255),
  ADD COLUMN `fileSizeBytes` bigint,
  ADD COLUMN `storageUri` text;

UPDATE `emperor_agent_artifacts`
SET `isCurrent` = 1,
    `currentSince` = COALESCE(`updatedAt`, `createdAt`),
    `contentHash` = SHA2(CAST(`content` AS CHAR), 256)
WHERE `status` = 'final';

UPDATE `emperor_agent_artifacts`
SET `contentHash` = SHA2(CAST(`content` AS CHAR), 256)
WHERE `contentHash` IS NULL;

CREATE INDEX `idx_emperor_agent_artifacts_current`
  ON `emperor_agent_artifacts` (`runId`, `nodeId`, `artifactKey`, `isCurrent`);

CREATE INDEX `idx_emperor_agent_artifacts_type_current`
  ON `emperor_agent_artifacts` (`artifactType`, `isCurrent`, `createdAt`);

CREATE INDEX `idx_emperor_agent_artifacts_hash`
  ON `emperor_agent_artifacts` (`contentHash`);
