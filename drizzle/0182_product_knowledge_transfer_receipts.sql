CREATE TABLE IF NOT EXISTS `kb_transfer_item_receipts` (
  `id` int NOT NULL AUTO_INCREMENT,
  `stageId` varchar(64) NOT NULL,
  `workspaceId` int NOT NULL,
  `module` enum('products','listings','images','skills','videos') NOT NULL,
  `contentHash` varchar(64) NOT NULL,
  `targetRecordId` int NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_kb_transfer_receipt_content` (`workspaceId`,`module`,`contentHash`),
  KEY `idx_kb_transfer_receipts_stage` (`stageId`),
  KEY `idx_kb_transfer_receipts_target` (`workspaceId`,`module`,`targetRecordId`)
);
