ALTER TABLE `competitorAnalyses`
  ADD COLUMN `aiSummary` text NULL AFTER `rawData`,
  ADD COLUMN `summary` text NULL AFTER `aiSummary`,
  ADD COLUMN `summaryStatus` enum('draft','confirmed') NOT NULL DEFAULT 'draft' AFTER `summary`,
  ADD COLUMN `summaryVersion` int NOT NULL DEFAULT 1 AFTER `summaryStatus`,
  ADD COLUMN `summaryConfirmedBy` int NULL AFTER `summaryVersion`,
  ADD COLUMN `summaryConfirmedAt` timestamp NULL AFTER `summaryConfirmedBy`,
  ADD COLUMN `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER `createdAt`;

CREATE TABLE `competitorComparisonReports` (
  `id` int NOT NULL AUTO_INCREMENT,
  `workspaceId` int NULL,
  `projectId` int NOT NULL,
  `userId` int NOT NULL,
  `selectionKey` varchar(500) NOT NULL,
  `analysisIds` text NOT NULL,
  `analyzedAsins` text NOT NULL,
  `aiSummary` text NOT NULL,
  `summary` text NOT NULL,
  `sellingPointRows` text NOT NULL,
  `status` enum('draft','confirmed') NOT NULL DEFAULT 'draft',
  `version` int NOT NULL DEFAULT 1,
  `confirmedBy` int NULL,
  `confirmedAt` timestamp NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_competitor_comparison_project_selection` (`projectId`, `selectionKey`),
  KEY `idx_competitor_comparison_workspace_status` (`workspaceId`, `status`, `updatedAt`),
  CONSTRAINT `fk_competitor_comparison_project`
    FOREIGN KEY (`projectId`) REFERENCES `projects` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
