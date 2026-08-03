-- Generic durable run records for long-running AI tasks.
-- Step 5 image suggestions, Listing generation, ad analysis, and operations
-- analysis can all be resumed by runId after navigation or refresh.
CREATE TABLE IF NOT EXISTS `ai_jobs` (
  `id` int NOT NULL AUTO_INCREMENT,
  `runId` varchar(80) NOT NULL,
  `kind` varchar(128) NOT NULL,
  `module` varchar(64) NOT NULL,
  `procedure` varchar(128),
  `status` enum('queued','running','succeeded','failed','canceled') NOT NULL DEFAULT 'queued',
  `progress` int NOT NULL DEFAULT 0,
  `userId` int NOT NULL,
  `projectId` int,
  `skillSlug` varchar(128),
  `input` json,
  `output` json,
  `errorMessage` text,
  `startedAt` timestamp NULL,
  `completedAt` timestamp NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_ai_jobs_run_id` (`runId`),
  KEY `idx_ai_jobs_user_created` (`userId`, `createdAt`),
  KEY `idx_ai_jobs_module_status_created` (`module`, `status`, `createdAt`),
  KEY `idx_ai_jobs_project_created` (`projectId`, `createdAt`)
);
