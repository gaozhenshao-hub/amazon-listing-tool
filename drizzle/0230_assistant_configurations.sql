-- DEDICATED RELEASE ONLY: explicit assistant configuration feature plan.
-- Never part of the default/legacy release train. No seeds, Skill updates or runtime activation.
-- Plain CREATE intentionally refuses an existing same-name table; IF NOT EXISTS is not shape proof.
CREATE TABLE `emperor_assistant_configurations` (
  `id` int NOT NULL AUTO_INCREMENT,
  `workspaceId` int NOT NULL,
  `agentKey` varchar(32) NOT NULL,
  `revision` int NOT NULL,
  `config` json NOT NULL,
  `configHash` char(64) NOT NULL,
  `updatedBy` int NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_assistant_configuration_scope` (`workspaceId`,`agentKey`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE `emperor_assistant_configuration_versions` (
  `id` int NOT NULL AUTO_INCREMENT,
  `workspaceId` int NOT NULL,
  `agentKey` varchar(32) NOT NULL,
  `revision` int NOT NULL,
  `config` json NOT NULL,
  `configHash` char(64) NOT NULL,
  `sourceRevision` int DEFAULT NULL,
  `createdBy` int NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_assistant_configuration_version_scope` (`workspaceId`,`agentKey`,`revision`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
