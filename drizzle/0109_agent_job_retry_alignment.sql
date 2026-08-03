-- Align Agent checkpoint retry state with durable AI Job attempts.
-- This prevents late stale Job attempts from mutating newer node outputs.

ALTER TABLE `emperor_agent_checkpoints`
  ADD COLUMN `aiJobAttempt` int NOT NULL DEFAULT 0,
  ADD COLUMN `aiJobClaimedAt` timestamp NULL,
  ADD COLUMN `retryCount` int NOT NULL DEFAULT 0,
  ADD COLUMN `retryScheduledAt` timestamp NULL,
  ADD COLUMN `lastFailureKind` varchar(40);

CREATE INDEX `idx_emperor_agent_checkpoints_ai_job_attempt`
  ON `emperor_agent_checkpoints` (`aiJobRunId`, `aiJobAttempt`, `status`);

CREATE INDEX `idx_emperor_agent_checkpoints_retry`
  ON `emperor_agent_checkpoints` (`status`, `retryScheduledAt`);
