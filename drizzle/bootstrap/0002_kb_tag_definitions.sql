-- FRESH BOOTSTRAP ONLY. Source: drizzle/schema/knowledge.ts and migrate_update.mjs.
-- System tags remain an explicit, authorized application operation; no invented user ID.
CREATE TABLE `kb_tag_definitions` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `userId` INT NOT NULL,
  `dimension` VARCHAR(50) NOT NULL,
  `parentValue` VARCHAR(100) NULL,
  `value` VARCHAR(200) NOT NULL,
  `sortOrder` INT NOT NULL DEFAULT 0,
  `isSystem` INT NOT NULL DEFAULT 0,
  `metadata` TEXT NULL,
  `usageCount` INT NOT NULL DEFAULT 0,
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB;
