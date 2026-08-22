CREATE TABLE IF NOT EXISTS `emperor_conversation_knowledge_refs` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `workspaceId` INT NULL,
  `referenceId` VARCHAR(80) NOT NULL UNIQUE,
  `conversationId` VARCHAR(80) NOT NULL,
  `sourceKind` ENUM('emperor_memory','amz_ops_skill') NOT NULL,
  `sourceId` INT NOT NULL,
  `title` VARCHAR(512) NOT NULL,
  `contextSummary` TEXT NOT NULL,
  `tags` JSON NULL,
  `createdBy` INT NOT NULL,
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY `emperor_conversation_knowledge_refs_source_uq` (`conversationId`,`sourceKind`,`sourceId`),
  INDEX `emperor_conversation_knowledge_refs_conversation_idx` (`conversationId`),
  INDEX `emperor_conversation_knowledge_refs_workspace_source_idx` (`workspaceId`,`sourceKind`)
);
