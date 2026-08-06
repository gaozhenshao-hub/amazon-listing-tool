-- Make the product-development information summary a recoverable AI Job.

ALTER TABLE `dev_analysis_stages`
  ADD COLUMN `runId` varchar(96) NULL AFTER `chartConfig`,
  ADD COLUMN `runProgress` int NOT NULL DEFAULT 0 AFTER `runId`,
  ADD COLUMN `runError` text NULL AFTER `runProgress`,
  ADD COLUMN `runStartedAt` timestamp NULL AFTER `runError`,
  ADD COLUMN `runCompletedAt` timestamp NULL AFTER `runStartedAt`,
  ADD INDEX `idx_dev_analysis_stages_run` (`runId`),
  ADD INDEX `idx_dev_analysis_stages_runtime` (`stageType`, `status`, `updatedAt`);

-- Older synchronous requests could leave this stage running forever after a
-- browser disconnect or process restart. Return those records to retryable state.
UPDATE `dev_analysis_stages`
SET
  `status` = 'pending',
  `runProgress` = 0,
  `runError` = '此前的信息汇总任务已中断，请重新开始分析。',
  `runCompletedAt` = NOW()
WHERE `stageType` = 'information_summary'
  AND `status` IN ('running', 'generating')
  AND `runId` IS NULL;

-- The full systemPrompt remains owned by emperor_skills (方案 A). This only
-- tunes execution limits for the compact, single-attempt background job.
UPDATE `emperor_skills`
SET
  `version` = `version` + 1,
  `manifest` = JSON_SET(
    COALESCE(`manifest`, JSON_OBJECT()),
    '$.implementation.maxTokens', 3072,
    '$.contract.executionMode', 'ai_job',
    '$.contract.maxModelAttempts', 1,
    '$.contract.maxContextCompetitors', 24
  ),
  `timeout_seconds` = 90,
  `execution_mode` = 'background'
WHERE `slug` = 'dev.analysis.information_summary';
