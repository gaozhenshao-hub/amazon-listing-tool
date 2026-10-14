-- FRESH BOOTSTRAP ONLY. New source-derived prerequisite, not recovered historical DDL.
-- Exactly the current scheduled-task columns that precede immutable migration 0180.
-- No users, schedules, provider credentials or external jobs are seeded.
CREATE TABLE `emperor_scheduled_tasks` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `slug` VARCHAR(128) NOT NULL,
  `name` VARCHAR(255) NOT NULL,
  `description` TEXT NULL,
  `skillSlug` VARCHAR(128) NOT NULL,
  `cronExpr` VARCHAR(64) NULL,
  `inputTemplate` JSON NULL,
  `isActive` INT NOT NULL DEFAULT 1,
  `lastRunAt` TIMESTAMP NULL,
  `nextRunAt` TIMESTAMP NULL,
  `lastRunStatus` ENUM('succeeded','failed','running') NULL,
  `runCount` INT NOT NULL DEFAULT 0,
  `createdByUserId` INT NULL,
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `emperor_scheduled_tasks_slug_unique` (`slug`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
