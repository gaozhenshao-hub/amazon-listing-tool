ALTER TABLE `emperor_conversation_plan_steps`
  ADD COLUMN `stateVersion` INT NOT NULL DEFAULT 0 AFTER `status`,
  ADD COLUMN `recoverySnapshotId` VARCHAR(80) NULL AFTER `traceId`;

CREATE TABLE IF NOT EXISTS `emperor_execution_state_snapshots` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `snapshotId` VARCHAR(80) NOT NULL,
  `workspaceId` INT NULL,
  `traceId` VARCHAR(80) NULL,
  `targetType` VARCHAR(40) NOT NULL,
  `targetId` VARCHAR(128) NOT NULL,
  `stateVersion` INT NOT NULL,
  `status` VARCHAR(40) NOT NULL DEFAULT 'captured',
  `planId` VARCHAR(80) NULL,
  `planVersion` INT NULL,
  `capabilityType` VARCHAR(24) NULL,
  `capabilitySlug` VARCHAR(128) NULL,
  `capabilityVersion` VARCHAR(80) NULL,
  `approvalState` VARCHAR(40) NULL,
  `contextManifestHash` VARCHAR(64) NULL,
  `inputHash` VARCHAR(64) NULL,
  `snapshot` JSON NOT NULL,
  `createdBy` INT NULL,
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY `uq_emperor_execution_snapshots_snapshotId` (`snapshotId`),
  UNIQUE KEY `uq_emperor_execution_snapshots_target_version` (`targetType`, `targetId`, `stateVersion`),
  KEY `idx_emperor_execution_snapshots_trace` (`traceId`, `id`),
  KEY `idx_emperor_execution_snapshots_workspace_target` (`workspaceId`, `targetType`, `targetId`)
);

CREATE TABLE IF NOT EXISTS `emperor_execution_recovery_requests` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `recoveryId` VARCHAR(80) NOT NULL,
  `idempotencyKey` VARCHAR(64) NOT NULL,
  `snapshotId` VARCHAR(80) NOT NULL,
  `traceId` VARCHAR(80) NULL,
  `targetType` VARCHAR(40) NOT NULL,
  `targetId` VARCHAR(128) NOT NULL,
  `requestedAction` VARCHAR(40) NOT NULL,
  `expectedStateVersion` INT NOT NULL,
  `status` VARCHAR(40) NOT NULL DEFAULT 'requested',
  `reasonCode` VARCHAR(80) NULL,
  `result` JSON NULL,
  `requestedBy` INT NULL,
  `completedAt` TIMESTAMP NULL,
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY `uq_emperor_execution_recovery_recoveryId` (`recoveryId`),
  UNIQUE KEY `uq_emperor_execution_recovery_idempotency` (`idempotencyKey`),
  KEY `idx_emperor_execution_recovery_snapshot` (`snapshotId`, `createdAt`),
  KEY `idx_emperor_execution_recovery_target` (`targetType`, `targetId`, `createdAt`)
);
