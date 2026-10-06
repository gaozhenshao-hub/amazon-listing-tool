CREATE TABLE IF NOT EXISTS `emperor_external_knowledge_callers` (
  `id` int AUTO_INCREMENT NOT NULL,
  `connectorId` int NOT NULL,
  `workspaceId` int NOT NULL,
  `tokenHash` varchar(64) NOT NULL,
  `tokenPrefix` varchar(20) NOT NULL,
  `scopes` json NOT NULL,
  `createdByUserId` int NOT NULL,
  `lastUsedAt` timestamp NULL,
  `revokedAt` timestamp NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `emperor_external_knowledge_callers_id` PRIMARY KEY(`id`),
  CONSTRAINT `uq_external_kb_caller_connector` UNIQUE(`connectorId`),
  CONSTRAINT `uq_external_kb_caller_token_hash` UNIQUE(`tokenHash`),
  KEY `idx_external_kb_caller_workspace_active` (`workspaceId`,`revokedAt`),
  CONSTRAINT `fk_external_kb_caller_connector`
    FOREIGN KEY (`connectorId`) REFERENCES `emperor_mcp_connectors` (`id`) ON DELETE CASCADE
);
