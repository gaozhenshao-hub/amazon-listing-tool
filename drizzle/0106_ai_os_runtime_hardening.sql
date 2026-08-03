-- AI Operating System runtime hardening.
-- Adds worker leases/retries/timeouts for durable AI jobs, pause support for
-- Agent runs, and execution locks for Agent checkpoints.

ALTER TABLE `ai_jobs`
  ADD COLUMN `attempt` int NOT NULL DEFAULT 0,
  ADD COLUMN `maxAttempts` int NOT NULL DEFAULT 1,
  ADD COLUMN `timeoutSeconds` int NOT NULL DEFAULT 600,
  ADD COLUMN `nextRunAt` timestamp NULL,
  ADD COLUMN `leaseUntil` timestamp NULL,
  ADD COLUMN `lockedBy` varchar(128),
  ADD COLUMN `lastHeartbeatAt` timestamp NULL;

CREATE INDEX `idx_ai_jobs_due` ON `ai_jobs` (`status`, `nextRunAt`, `createdAt`);
CREATE INDEX `idx_ai_jobs_lease` ON `ai_jobs` (`status`, `leaseUntil`);

ALTER TABLE `emperor_agent_runs`
  MODIFY COLUMN `status` enum('running','waiting_human','paused','completed','failed','canceled') NOT NULL DEFAULT 'waiting_human';

ALTER TABLE `emperor_agent_checkpoints`
  ADD COLUMN `maxAttempts` int NOT NULL DEFAULT 1,
  ADD COLUMN `lockToken` varchar(80),
  ADD COLUMN `lockedAt` timestamp NULL,
  ADD COLUMN `timeoutAt` timestamp NULL;

CREATE INDEX `idx_emperor_agent_checkpoints_lock` ON `emperor_agent_checkpoints` (`runId`, `nodeId`, `lockToken`);
CREATE INDEX `idx_emperor_agent_checkpoints_timeout` ON `emperor_agent_checkpoints` (`status`, `timeoutAt`);

CREATE TABLE IF NOT EXISTS `emperor_agent_template_versions` (
  `id` int NOT NULL AUTO_INCREMENT,
  `agentSlug` varchar(128) NOT NULL,
  `agentName` varchar(255),
  `versionNumber` int NOT NULL,
  `version` varchar(40) NOT NULL,
  `dagHash` varchar(64) NOT NULL,
  `status` enum('draft','released','deprecated') NOT NULL DEFAULT 'released',
  `dagDefinition` json NOT NULL,
  `releaseNotes` text,
  `createdBy` int,
  `releasedAt` timestamp NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_agent_template_version` (`agentSlug`, `version`),
  UNIQUE KEY `uk_agent_template_hash` (`agentSlug`, `dagHash`),
  KEY `idx_agent_template_status` (`agentSlug`, `status`, `versionNumber`)
);

ALTER TABLE `emperor_agent_runs`
  ADD COLUMN `templateVersionId` int,
  ADD COLUMN `templateVersion` varchar(40),
  ADD COLUMN `dagHash` varchar(64);

CREATE INDEX `idx_emperor_agent_runs_template_version` ON `emperor_agent_runs` (`agentSlug`, `templateVersion`);
