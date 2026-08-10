-- Product-development project list operating fields.
-- Calculated price, profit, people and dates remain sourced from their owning tables.

CREATE TABLE IF NOT EXISTS `dev_project_progress` (
  `id` int NOT NULL AUTO_INCREMENT,
  `workspaceId` int NULL,
  `projectId` int NOT NULL,
  `primaryCompetitorAsin` varchar(20) NULL,
  `selectorName` varchar(100) NULL,
  `landingProgress` int NOT NULL DEFAULT 0,
  `reviewStatus` enum('unreviewed','reviewing','approved','rejected') NOT NULL DEFAULT 'unreviewed',
  `assistantName` varchar(100) NULL,
  `updatedBy` int NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_dev_project_progress_project` (`projectId`),
  KEY `idx_dev_project_progress_workspace_project` (`workspaceId`,`projectId`,`updatedAt`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
