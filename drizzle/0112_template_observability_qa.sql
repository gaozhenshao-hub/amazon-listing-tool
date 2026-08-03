-- Template governance, AI output evaluation, and observability v1.
-- Adds release/rollback/canary metadata for Agent template versions and a
-- durable evaluation ledger for Skill / Agent quality scoring.

ALTER TABLE `emperor_agent_template_versions`
  ADD COLUMN `parentVersionId` int,
  ADD COLUMN `isDefault` int NOT NULL DEFAULT 0,
  ADD COLUMN `rolloutPercent` int NOT NULL DEFAULT 100,
  ADD COLUMN `rolloutPolicy` json,
  ADD COLUMN `activatedAt` timestamp NULL,
  ADD COLUMN `deprecatedAt` timestamp NULL;

CREATE INDEX `idx_agent_template_default`
  ON `emperor_agent_template_versions` (`agentSlug`, `isDefault`, `status`);

CREATE INDEX `idx_agent_template_rollout`
  ON `emperor_agent_template_versions` (`agentSlug`, `status`, `rolloutPercent`);

CREATE TABLE IF NOT EXISTS `emperor_ai_os_evaluations` (
  `id` int NOT NULL AUTO_INCREMENT,
  `evaluationId` varchar(80) NOT NULL,
  `entityType` varchar(40) NOT NULL,
  `entityId` varchar(128) NOT NULL,
  `evaluationType` varchar(80) NOT NULL DEFAULT 'heuristic_quality',
  `score` decimal(5,2) NOT NULL,
  `grade` varchar(20),
  `status` varchar(40),
  `evaluator` varchar(80) NOT NULL DEFAULT 'system.heuristic',
  `userId` int,
  `projectId` int,
  `agentSlug` varchar(128),
  `nodeId` varchar(128),
  `skillSlug` varchar(128),
  `toolSlug` varchar(128),
  `rubric` json,
  `details` json,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_ai_os_evaluations_eval_id` (`evaluationId`),
  KEY `idx_ai_os_evaluations_entity` (`entityType`, `entityId`, `createdAt`),
  KEY `idx_ai_os_evaluations_score` (`entityType`, `score`, `createdAt`),
  KEY `idx_ai_os_evaluations_agent` (`agentSlug`, `nodeId`, `createdAt`),
  KEY `idx_ai_os_evaluations_skill` (`skillSlug`, `createdAt`)
);

UPDATE `emperor_agent_template_versions` v
JOIN (
  SELECT agentSlug, MAX(versionNumber) AS maxVersion
  FROM `emperor_agent_template_versions`
  WHERE status='released'
  GROUP BY agentSlug
) latest ON latest.agentSlug = v.agentSlug AND latest.maxVersion = v.versionNumber
SET v.isDefault = 1,
    v.activatedAt = COALESCE(v.activatedAt, v.releasedAt, NOW())
WHERE v.status='released';
