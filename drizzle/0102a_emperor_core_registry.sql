-- Emperor AI OS core registries.
-- These tables predate the governed migration ledger and must exist before
-- Agent, Tool Gateway, tenant governance, and Skill seed migrations run.

CREATE TABLE IF NOT EXISTS `emperor_skills` (
  `id` int NOT NULL AUTO_INCREMENT,
  `slug` varchar(128) NOT NULL,
  `name` varchar(255) NOT NULL,
  `description` text,
  `category` varchar(64) NOT NULL DEFAULT '通用',
  `owner` varchar(64) DEFAULT 'system',
  `riskTier` enum('L0','L1','L2','L3') NOT NULL DEFAULT 'L1',
  `status` enum('Draft','Validated','Approved','Released','Deprecated') NOT NULL DEFAULT 'Released',
  `scope` enum('global','private','shared') NOT NULL DEFAULT 'global',
  `version` int NOT NULL DEFAULT 1,
  `isSystem` int NOT NULL DEFAULT 1,
  `callCount` int NOT NULL DEFAULT 0,
  `manifest` json NOT NULL,
  `modelOverride` varchar(128),
  `when_to_use` text,
  `timeout_seconds` int NOT NULL DEFAULT 120,
  `execution_mode` enum('inline','fork','background') NOT NULL DEFAULT 'inline',
  `allowed_tools` json,
  `disallowed_tools` json,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_emperor_skills_slug` (`slug`),
  KEY `idx_emperor_skills_status_category` (`status`, `category`)
);

CREATE TABLE IF NOT EXISTS `emperor_skill_runs` (
  `id` int NOT NULL AUTO_INCREMENT,
  `runId` varchar(64) NOT NULL,
  `skillSlug` varchar(128) NOT NULL,
  `skillName` varchar(255),
  `userId` int,
  `input` json,
  `output` json,
  `status` enum('queued','running','succeeded','failed','canceled') NOT NULL DEFAULT 'queued',
  `errorMessage` text,
  `modelSlug` varchar(128),
  `inputTokens` int DEFAULT 0,
  `outputTokens` int DEFAULT 0,
  `durationMs` int DEFAULT 0,
  `costCents` int DEFAULT 0,
  `traceId` varchar(64),
  `startedAt` timestamp NULL,
  `completedAt` timestamp NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_emperor_skill_runs_run_id` (`runId`),
  KEY `idx_emperor_skill_runs_skill_created` (`skillSlug`, `createdAt`),
  KEY `idx_emperor_skill_runs_user_created` (`userId`, `createdAt`)
);

CREATE TABLE IF NOT EXISTS `emperor_knowledge` (
  `id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `project_id` varchar(128),
  `title` varchar(512) NOT NULL,
  `content` text NOT NULL,
  `memory_type` enum('feedback','fact','project','reference') NOT NULL DEFAULT 'fact',
  `source` varchar(1024),
  `tags` json,
  `is_active` int NOT NULL DEFAULT 1,
  `confidence` decimal(4,3) DEFAULT 1.000,
  `created_at` bigint NOT NULL,
  `updated_at` bigint NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_emperor_knowledge_user_active` (`user_id`, `is_active`),
  KEY `idx_emperor_knowledge_project_type` (`project_id`, `memory_type`)
);

CREATE TABLE IF NOT EXISTS `emperor_mcp_connectors` (
  `id` int NOT NULL AUTO_INCREMENT,
  `slug` varchar(128) NOT NULL,
  `name` varchar(255) NOT NULL,
  `description` text,
  `connectionType` enum('http_api','database','webhook','internal','script') NOT NULL DEFAULT 'http_api',
  `config` json,
  `isActive` int NOT NULL DEFAULT 1,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_emperor_mcp_connectors_slug` (`slug`),
  KEY `idx_emperor_mcp_connectors_active` (`isActive`, `updatedAt`)
);

CREATE TABLE IF NOT EXISTS `emperor_model_providers` (
  `id` int NOT NULL AUTO_INCREMENT,
  `slug` varchar(64) NOT NULL,
  `name` varchar(128) NOT NULL,
  `provider` enum('manus_builtin','openai','deepseek','anthropic','custom') NOT NULL DEFAULT 'manus_builtin',
  `baseUrl` varchar(512),
  `apiKeyRef` varchar(256),
  `modelId` varchar(128) NOT NULL,
  `displayName` varchar(128),
  `isDefault` int NOT NULL DEFAULT 0,
  `isActive` int NOT NULL DEFAULT 1,
  `capabilityTags` json,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_emperor_model_providers_slug` (`slug`),
  KEY `idx_emperor_model_providers_default_active` (`isDefault`, `isActive`)
);
