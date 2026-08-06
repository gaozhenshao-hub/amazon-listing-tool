ALTER TABLE `ai_jobs`
  ADD COLUMN `recoveryOfRunId` varchar(80) NULL AFTER `deadLetterReason`,
  ADD COLUMN `recoveryReason` text NULL AFTER `recoveryOfRunId`;

CREATE INDEX `idx_ai_jobs_recovery_of`
  ON `ai_jobs` (`recoveryOfRunId`, `createdAt`);

CREATE TABLE IF NOT EXISTS `ai_operational_alerts` (
  `id` int NOT NULL AUTO_INCREMENT,
  `alertId` varchar(80) NOT NULL,
  `fingerprint` varchar(191) NOT NULL,
  `category` varchar(64) NOT NULL,
  `severity` enum('warning','critical') NOT NULL DEFAULT 'warning',
  `status` enum('open','resolved') NOT NULL DEFAULT 'open',
  `title` varchar(255) NOT NULL,
  `message` text NOT NULL,
  `occurrenceCount` int NOT NULL DEFAULT 1,
  `firstOccurredAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `lastOccurredAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `notifiedAt` timestamp NULL,
  `resolvedAt` timestamp NULL,
  `metadata` json NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_ai_operational_alert_id` (`alertId`),
  UNIQUE KEY `uniq_ai_operational_alert_fingerprint` (`fingerprint`),
  KEY `idx_ai_operational_alert_status` (`status`, `severity`, `lastOccurredAt`),
  KEY `idx_ai_operational_alert_category` (`category`, `lastOccurredAt`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
