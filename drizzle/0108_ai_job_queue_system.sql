-- AI Job queue operations.
-- Adds priority scheduling, worker heartbeat state, and dead-letter records.

ALTER TABLE `ai_jobs`
  ADD COLUMN `priority` int NOT NULL DEFAULT 0,
  ADD COLUMN `queueName` varchar(64) NOT NULL DEFAULT 'default',
  ADD COLUMN `claimedAt` timestamp NULL,
  ADD COLUMN `deadLetterAt` timestamp NULL,
  ADD COLUMN `deadLetterReason` text;

CREATE INDEX `idx_ai_jobs_queue_due` ON `ai_jobs` (`status`, `queueName`, `priority`, `nextRunAt`, `createdAt`);
CREATE INDEX `idx_ai_jobs_locked_worker` ON `ai_jobs` (`lockedBy`, `status`, `leaseUntil`);
CREATE INDEX `idx_ai_jobs_dead_letter` ON `ai_jobs` (`deadLetterAt`);

CREATE TABLE IF NOT EXISTS `ai_job_workers` (
  `id` int NOT NULL AUTO_INCREMENT,
  `workerId` varchar(128) NOT NULL,
  `hostname` varchar(255),
  `pid` int,
  `role` varchar(64) NOT NULL DEFAULT 'worker',
  `status` enum('active','draining','stopped','unhealthy') NOT NULL DEFAULT 'active',
  `concurrency` int NOT NULL DEFAULT 1,
  `runningCount` int NOT NULL DEFAULT 0,
  `lastHeartbeatAt` timestamp NULL,
  `startedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `stoppedAt` timestamp NULL,
  `metadata` json,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_ai_job_workers_worker_id` (`workerId`),
  KEY `idx_ai_job_workers_status_heartbeat` (`status`, `lastHeartbeatAt`)
);

CREATE TABLE IF NOT EXISTS `ai_job_dead_letters` (
  `id` int NOT NULL AUTO_INCREMENT,
  `runId` varchar(80) NOT NULL,
  `kind` varchar(128) NOT NULL,
  `module` varchar(64) NOT NULL,
  `procedure` varchar(128),
  `status` varchar(40),
  `attempt` int NOT NULL DEFAULT 0,
  `maxAttempts` int NOT NULL DEFAULT 1,
  `userId` int,
  `projectId` int,
  `skillSlug` varchar(128),
  `errorMessage` text,
  `input` json,
  `metadata` json,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_ai_job_dead_letters_run_id` (`runId`),
  KEY `idx_ai_job_dead_letters_module_created` (`module`, `createdAt`),
  KEY `idx_ai_job_dead_letters_user_created` (`userId`, `createdAt`)
);
