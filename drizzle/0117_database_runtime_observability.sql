-- Runtime database observability.
-- Stores parameter-normalized statement digests sampled from performance_schema.

CREATE TABLE IF NOT EXISTS `database_slow_query_samples` (
  `id` int NOT NULL AUTO_INCREMENT,
  `sampleId` varchar(80) NOT NULL,
  `databaseSchema` varchar(128) NOT NULL,
  `digest` varchar(128) NOT NULL,
  `digestText` text NOT NULL,
  `executionCount` bigint NOT NULL DEFAULT 0,
  `avgTimerWaitMs` decimal(18,3) NOT NULL DEFAULT 0.000,
  `maxTimerWaitMs` decimal(18,3) NOT NULL DEFAULT 0.000,
  `totalRowsExamined` bigint NOT NULL DEFAULT 0,
  `totalRowsSent` bigint NOT NULL DEFAULT 0,
  `firstSeen` timestamp NULL,
  `lastSeen` timestamp NULL,
  `sampledAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `source` varchar(64) NOT NULL DEFAULT 'performance_schema',
  `metadata` json,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_db_slow_query_samples_sample_id` (`sampleId`),
  KEY `idx_db_slow_samples_digest_sampled` (`digest`, `sampledAt`),
  KEY `idx_db_slow_samples_schema_avg` (`databaseSchema`, `avgTimerWaitMs`, `sampledAt`),
  KEY `idx_db_slow_samples_sampled` (`sampledAt`)
);
