CREATE TABLE IF NOT EXISTS `kb_transfer_stages` (
  `id` varchar(64) NOT NULL,
  `userId` int NOT NULL,
  `workspaceId` int NOT NULL,
  `status` enum('previewed','importing','completed','expired','failed') NOT NULL DEFAULT 'previewed',
  `packageSha256` varchar(64) NOT NULL,
  `originalFileName` varchar(255) NOT NULL,
  `manifestJson` longtext NOT NULL,
  `attachmentStorageJson` longtext NOT NULL,
  `previewJson` text NOT NULL,
  `importResultJson` text NULL,
  `expiresAt` timestamp NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_kb_transfer_stages_workspace_status` (`workspaceId`,`status`,`expiresAt`),
  KEY `idx_kb_transfer_stages_user_created` (`userId`,`createdAt`)
);
