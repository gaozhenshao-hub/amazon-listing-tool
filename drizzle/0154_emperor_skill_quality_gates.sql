CREATE TABLE IF NOT EXISTS `emperor_skill_version_snapshots` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `snapshotId` VARCHAR(80) NOT NULL,
  `workspaceId` INT NULL,
  `skillSlug` VARCHAR(128) NOT NULL,
  `skillVersion` VARCHAR(64) NOT NULL,
  `snapshotHash` VARCHAR(64) NOT NULL,
  `source` VARCHAR(32) NOT NULL DEFAULT 'update',
  `status` VARCHAR(32) NOT NULL DEFAULT 'draft',
  `manifest` JSON NOT NULL,
  `modelOverride` VARCHAR(128) NULL,
  `createdBy` INT NULL,
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY `uq_emperor_skill_version_snapshots_id` (`snapshotId`),
  UNIQUE KEY `uq_emperor_skill_version_snapshots_hash` (`skillSlug`, `skillVersion`, `snapshotHash`),
  KEY `idx_emperor_skill_version_snapshots_skill` (`skillSlug`, `createdAt`)
);

CREATE TABLE IF NOT EXISTS `emperor_skill_eval_cases` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `caseId` VARCHAR(80) NOT NULL,
  `workspaceId` INT NULL,
  `skillSlug` VARCHAR(128) NOT NULL,
  `name` VARCHAR(255) NOT NULL,
  `description` TEXT NULL,
  `status` VARCHAR(24) NOT NULL DEFAULT 'draft',
  `tags` JSON NULL,
  `inputContext` JSON NOT NULL,
  `expectedConstraints` JSON NULL,
  `rubric` JSON NOT NULL,
  `sourceArtifactId` VARCHAR(80) NULL,
  `sourceRunId` VARCHAR(80) NULL,
  `createdBy` INT NULL,
  `approvedBy` INT NULL,
  `approvedAt` TIMESTAMP NULL,
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY `uq_emperor_skill_eval_cases_id` (`caseId`),
  KEY `idx_emperor_skill_eval_cases_skill_status` (`skillSlug`, `status`)
);

CREATE TABLE IF NOT EXISTS `emperor_skill_eval_results` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `resultId` VARCHAR(80) NOT NULL,
  `workspaceId` INT NULL,
  `caseId` VARCHAR(80) NOT NULL,
  `skillSlug` VARCHAR(128) NOT NULL,
  `snapshotId` VARCHAR(80) NULL,
  `skillVersion` VARCHAR(64) NULL,
  `evaluationMode` VARCHAR(24) NOT NULL DEFAULT 'manual',
  `status` VARCHAR(24) NOT NULL DEFAULT 'completed',
  `score` DECIMAL(6,2) NULL,
  `passed` TINYINT NOT NULL DEFAULT 0,
  `humanApproved` TINYINT NOT NULL DEFAULT 0,
  `feedback` TEXT NULL,
  `dimensionScores` JSON NULL,
  `outputSummary` JSON NULL,
  `sourceArtifactId` VARCHAR(80) NULL,
  `evaluatorUserId` INT NULL,
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY `uq_emperor_skill_eval_results_id` (`resultId`),
  KEY `idx_emperor_skill_eval_results_case_snapshot` (`caseId`, `snapshotId`, `createdAt`),
  KEY `idx_emperor_skill_eval_results_skill_version` (`skillSlug`, `skillVersion`, `createdAt`)
);

CREATE TABLE IF NOT EXISTS `emperor_skill_release_gates` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `workspaceId` INT NULL,
  `skillSlug` VARCHAR(128) NOT NULL,
  `mode` VARCHAR(24) NOT NULL DEFAULT 'advisory',
  `minApprovedCases` INT NOT NULL DEFAULT 0,
  `minAverageScore` DECIMAL(6,2) NOT NULL DEFAULT 0,
  `minPassRate` DECIMAL(6,2) NOT NULL DEFAULT 0,
  `requireHumanApproval` TINYINT NOT NULL DEFAULT 0,
  `updatedBy` INT NULL,
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY `uq_emperor_skill_release_gates_skill` (`skillSlug`)
);
