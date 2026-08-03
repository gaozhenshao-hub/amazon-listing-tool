-- Emperor Agent workflow kernel.
-- Adds first-class run/checkpoint/event records for long DAG workflows with
-- human confirmation gates, and normalizes Agent status values for the canvas UI.

CREATE TABLE IF NOT EXISTS `emperor_agents` (
  `id` int NOT NULL AUTO_INCREMENT,
  `slug` varchar(128) NOT NULL,
  `name` varchar(255) NOT NULL,
  `description` text,
  `category` varchar(64) DEFAULT '通用',
  `status` enum('Draft','Validated','Released','Deprecated') NOT NULL DEFAULT 'Released',
  `dagDefinition` json NOT NULL,
  `execution_mode` enum('inline','fork','background') NOT NULL DEFAULT 'inline',
  `callCount` int NOT NULL DEFAULT 0,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_emperor_agents_slug` (`slug`)
);

ALTER TABLE `emperor_agents`
  MODIFY COLUMN `status` varchar(32) NOT NULL DEFAULT 'Released';

UPDATE `emperor_agents`
SET `status` = CASE
  WHEN `status` IN ('Released', 'Validated', 'Approved', 'active') THEN 'active'
  WHEN `status` IN ('Deprecated', 'deprecated') THEN 'deprecated'
  ELSE 'draft'
END;

ALTER TABLE `emperor_agents`
  MODIFY COLUMN `status` enum('draft','active','deprecated') NOT NULL DEFAULT 'active',
  ADD COLUMN `scope` enum('global','project','private') NOT NULL DEFAULT 'project',
  ADD COLUMN `triggerType` enum('manual','event','scheduled') NOT NULL DEFAULT 'manual',
  ADD COLUMN `maxExecutionSeconds` int NOT NULL DEFAULT 300,
  ADD COLUMN `cronExpression` varchar(120),
  ADD COLUMN `ownerUserId` int;

CREATE TABLE IF NOT EXISTS `emperor_agent_runs` (
  `id` int NOT NULL AUTO_INCREMENT,
  `runId` varchar(80) NOT NULL,
  `agentSlug` varchar(128) NOT NULL,
  `agentName` varchar(255),
  `userId` int NOT NULL,
  `projectId` int,
  `status` enum('running','waiting_human','completed','failed','canceled') NOT NULL DEFAULT 'waiting_human',
  `currentNodeId` varchar(128),
  `progress` int NOT NULL DEFAULT 0,
  `inputs` json,
  `outputs` json,
  `errorMessage` text,
  `startedAt` timestamp NULL,
  `completedAt` timestamp NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_emperor_agent_runs_run_id` (`runId`),
  KEY `idx_emperor_agent_runs_agent_created` (`agentSlug`, `createdAt`),
  KEY `idx_emperor_agent_runs_user_created` (`userId`, `createdAt`),
  KEY `idx_emperor_agent_runs_project_created` (`projectId`, `createdAt`)
);

CREATE TABLE IF NOT EXISTS `emperor_agent_checkpoints` (
  `id` int NOT NULL AUTO_INCREMENT,
  `runId` varchar(80) NOT NULL,
  `agentSlug` varchar(128) NOT NULL,
  `nodeId` varchar(128) NOT NULL,
  `nodeLabel` varchar(255),
  `nodeType` varchar(64) NOT NULL,
  `status` enum('pending','ready','running','waiting_human','confirmed','skipped','failed') NOT NULL DEFAULT 'pending',
  `attempt` int NOT NULL DEFAULT 0,
  `input` json,
  `output` json,
  `userEdit` json,
  `metadata` json,
  `skillRunId` varchar(80),
  `aiJobRunId` varchar(80),
  `reviewerUserId` int,
  `errorMessage` text,
  `startedAt` timestamp NULL,
  `completedAt` timestamp NULL,
  `confirmedAt` timestamp NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_emperor_agent_checkpoint_node` (`runId`, `nodeId`),
  KEY `idx_emperor_agent_checkpoints_run_status` (`runId`, `status`),
  KEY `idx_emperor_agent_checkpoints_agent_node` (`agentSlug`, `nodeId`)
);

CREATE TABLE IF NOT EXISTS `emperor_agent_events` (
  `id` int NOT NULL AUTO_INCREMENT,
  `runId` varchar(80) NOT NULL,
  `agentSlug` varchar(128) NOT NULL,
  `nodeId` varchar(128),
  `eventType` varchar(64) NOT NULL,
  `message` text,
  `payload` json,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_emperor_agent_events_run_created` (`runId`, `createdAt`),
  KEY `idx_emperor_agent_events_agent_node` (`agentSlug`, `nodeId`)
);

CREATE TABLE IF NOT EXISTS `emperor_tools` (
  `id` int NOT NULL AUTO_INCREMENT,
  `slug` varchar(128) NOT NULL,
  `name` varchar(255) NOT NULL,
  `description` text,
  `type` enum('mcp','api','internal','code') NOT NULL,
  `config` json,
  `inputSchema` json,
  `outputSchema` json,
  `isActive` int NOT NULL DEFAULT 1,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_emperor_tools_slug` (`slug`),
  KEY `idx_emperor_tools_type_active` (`type`, `isActive`)
);
