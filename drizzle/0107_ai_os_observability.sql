-- AI Operating System observability.
-- Stores normalized metrics for Jobs, Agents, Skills, and Tools so the
-- Emperor platform can build quality, cost, latency, and failure dashboards.

CREATE TABLE IF NOT EXISTS `emperor_ai_os_metrics` (
  `id` int NOT NULL AUTO_INCREMENT,
  `entityType` varchar(40) NOT NULL,
  `entityId` varchar(128) NOT NULL,
  `metricName` varchar(80) NOT NULL,
  `metricValue` decimal(18,4),
  `status` varchar(40),
  `userId` int,
  `projectId` int,
  `agentSlug` varchar(128),
  `nodeId` varchar(128),
  `skillSlug` varchar(128),
  `toolSlug` varchar(128),
  `metadata` json,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_ai_os_metrics_entity` (`entityType`, `entityId`, `createdAt`),
  KEY `idx_ai_os_metrics_name_created` (`metricName`, `createdAt`),
  KEY `idx_ai_os_metrics_agent_node` (`agentSlug`, `nodeId`, `createdAt`),
  KEY `idx_ai_os_metrics_tool_created` (`toolSlug`, `createdAt`),
  KEY `idx_ai_os_metrics_user_created` (`userId`, `createdAt`)
);
