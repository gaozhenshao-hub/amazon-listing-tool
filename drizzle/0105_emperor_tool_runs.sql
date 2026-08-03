-- Tool Gateway invocation audit log.
-- Tools are external capability edges for Agents, so every call should be
-- traceable by user, Agent run, node, risk level, status, and sanitized IO.

CREATE TABLE IF NOT EXISTS `emperor_tool_runs` (
  `id` int NOT NULL AUTO_INCREMENT,
  `toolRunId` varchar(80) NOT NULL,
  `toolSlug` varchar(128) NOT NULL,
  `toolName` varchar(255),
  `toolType` enum('mcp','api','internal','code') NOT NULL,
  `source` enum('builtin','emperor_tools','mcp_connector') NOT NULL,
  `status` enum('running','succeeded','failed','blocked') NOT NULL DEFAULT 'running',
  `riskLevel` enum('low','medium','high','critical') NOT NULL DEFAULT 'medium',
  `userId` int NOT NULL,
  `agentRunId` varchar(80),
  `nodeId` varchar(128),
  `projectId` int,
  `input` json,
  `output` json,
  `errorMessage` text,
  `durationMs` int,
  `httpStatus` int,
  `requestHost` varchar(255),
  `startedAt` timestamp NULL,
  `completedAt` timestamp NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_emperor_tool_runs_run_id` (`toolRunId`),
  KEY `idx_emperor_tool_runs_tool_created` (`toolSlug`, `createdAt`),
  KEY `idx_emperor_tool_runs_user_created` (`userId`, `createdAt`),
  KEY `idx_emperor_tool_runs_agent_node` (`agentRunId`, `nodeId`),
  KEY `idx_emperor_tool_runs_status_created` (`status`, `createdAt`)
);
