-- Dedicated Skill/Agent workbench release. No business records are modified.
CREATE TABLE `emperor_skill_workbench_drafts` (
  `id` char(36) NOT NULL,
  `workspaceId` int NOT NULL,
  `userId` int NOT NULL,
  `skillSlug` varchar(191) NOT NULL,
  `revision` int NOT NULL DEFAULT 1,
  `payload` json NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_workbench_owner` (`workspaceId`,`userId`,`skillSlug`,`updatedAt`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
