CREATE TABLE IF NOT EXISTS `knowledge_claim_ledger_consistency_decisions` (
  `decisionKey` varchar(80) NOT NULL,
  `workspaceId` int NOT NULL,
  `ledgerKey` varchar(80) NOT NULL,
  `matrixFingerprint` varchar(64) NOT NULL,
  `issueKey` varchar(160) NOT NULL,
  `decision` enum('accepted','ignored','new_version') NOT NULL,
  `note` text NULL,
  `createdBy` int NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`decisionKey`),
  KEY `idx_claim_consistency_workspace_ledger` (`workspaceId`,`ledgerKey`,`createdAt`),
  KEY `idx_claim_consistency_issue` (`workspaceId`,`ledgerKey`,`issueKey`,`createdAt`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
