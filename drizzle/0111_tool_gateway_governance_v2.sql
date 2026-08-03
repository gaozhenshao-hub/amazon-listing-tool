-- Tool Gateway governance v2.
-- Turns Tools into governed external capability entries with secret references,
-- rate/circuit policy snapshots, normalized output, and failure classification.

ALTER TABLE `emperor_tools`
  ADD COLUMN `governancePolicy` json,
  ADD COLUMN `permissionPolicy` json,
  ADD COLUMN `rateLimitPolicy` json,
  ADD COLUMN `circuitBreakerPolicy` json,
  ADD COLUMN `secretRefs` json,
  ADD COLUMN `outputPolicy` json;

ALTER TABLE `emperor_tool_runs`
  ADD COLUMN `normalizedOutput` json,
  ADD COLUMN `failureKind` enum('policy','rate_limit','circuit_open','schema','auth','timeout','network','http','executor','unknown'),
  ADD COLUMN `retryable` int NOT NULL DEFAULT 0,
  ADD COLUMN `attemptCount` int NOT NULL DEFAULT 0,
  ADD COLUMN `governanceDecision` json,
  ADD COLUMN `secretRefs` json,
  ADD COLUMN `circuitState` varchar(32);

CREATE TABLE IF NOT EXISTS `emperor_tool_secrets` (
  `id` int NOT NULL AUTO_INCREMENT,
  `slug` varchar(128) NOT NULL,
  `description` text,
  `encryptedValue` text NOT NULL,
  `iv` varchar(32) NOT NULL,
  `authTag` varchar(32) NOT NULL,
  `keyVersion` varchar(64) NOT NULL DEFAULT 'v1',
  `metadata` json,
  `createdBy` int,
  `updatedBy` int,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_emperor_tool_secrets_slug` (`slug`)
);

ALTER TABLE `emperor_mcp_connectors`
  ADD COLUMN `governancePolicy` json,
  ADD COLUMN `secretRefs` json;

CREATE INDEX `idx_emperor_tool_runs_failure_created`
  ON `emperor_tool_runs` (`failureKind`, `createdAt`);

CREATE INDEX `idx_emperor_tool_runs_circuit_created`
  ON `emperor_tool_runs` (`toolSlug`, `circuitState`, `createdAt`);
