CREATE TABLE IF NOT EXISTS `image_workflow_step4_image_versions` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `sessionId` INT NOT NULL,
  `projectId` INT NOT NULL,
  `userId` INT NOT NULL,
  `imageIndex` INT NOT NULL,
  `imageKey` VARCHAR(80) NOT NULL,
  `version` INT NOT NULL,
  `status` ENUM('confirmed', 'superseded', 'unlocked') NOT NULL DEFAULT 'confirmed',
  `isCurrent` INT NOT NULL DEFAULT 1,
  `content` TEXT NOT NULL,
  `confirmedAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_step4_image_version_current` (`sessionId`, `imageIndex`, `isCurrent`),
  KEY `idx_step4_image_version_project` (`projectId`, `imageIndex`, `confirmedAt`)
);
