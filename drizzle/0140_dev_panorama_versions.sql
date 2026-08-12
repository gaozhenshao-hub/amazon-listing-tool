ALTER TABLE `dev_panorama_status`
  ADD COLUMN `currentVersionId` INT NULL AFTER `confirmed`;

CREATE TABLE IF NOT EXISTS `dev_panorama_versions` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `workspaceId` INT NULL,
  `projectId` INT NOT NULL,
  `userId` INT NOT NULL,
  `version` INT NOT NULL,
  `snapshot` JSON NOT NULL,
  `sourceSummary` JSON NULL,
  `status` ENUM('confirmed','superseded') NOT NULL DEFAULT 'confirmed',
  `confirmedAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_dev_panorama_version` (`workspaceId`, `projectId`, `version`),
  KEY `idx_dev_panorama_version_project_status` (`projectId`, `status`, `confirmedAt`)
);
