-- Durable Agent artifacts.
-- Checkpoints hold execution state; artifacts hold versioned node outputs that
-- can be reused by downstream Agents, tools, exports, and audit screens.

CREATE TABLE IF NOT EXISTS `emperor_agent_artifacts` (
  `id` int NOT NULL AUTO_INCREMENT,
  `runId` varchar(80) NOT NULL,
  `agentSlug` varchar(128) NOT NULL,
  `nodeId` varchar(128) NOT NULL,
  `artifactKey` varchar(128) NOT NULL,
  `artifactType` enum('json','text','markdown','html','image','file','other') NOT NULL DEFAULT 'json',
  `status` enum('draft','final','superseded') NOT NULL DEFAULT 'draft',
  `version` int NOT NULL DEFAULT 1,
  `userId` int NOT NULL,
  `projectId` int,
  `content` json,
  `summary` text,
  `metadata` json,
  `sourceSkillRunId` varchar(80),
  `sourceAiJobRunId` varchar(80),
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_emperor_agent_artifact_version` (`runId`, `nodeId`, `artifactKey`, `version`),
  KEY `idx_emperor_agent_artifacts_run_node` (`runId`, `nodeId`),
  KEY `idx_emperor_agent_artifacts_agent_key` (`agentSlug`, `artifactKey`, `createdAt`),
  KEY `idx_emperor_agent_artifacts_project_created` (`projectId`, `createdAt`)
);
