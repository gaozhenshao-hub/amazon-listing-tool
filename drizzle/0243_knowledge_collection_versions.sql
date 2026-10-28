-- Source identity remains a valid Amazon ASIN; display aliases never reach collection.
ALTER TABLE `kb_image_sets` ADD COLUMN `sourceAsin` varchar(10) NULL;
ALTER TABLE `kb_image_sets` ADD COLUMN `collectionVersion` int NOT NULL DEFAULT 1;
UPDATE `kb_image_sets` SET `sourceAsin` = UPPER(`asin`)
WHERE `sourceAsin` IS NULL AND `asin` REGEXP '^[A-Za-z0-9]{10}$';
CREATE INDEX `kb_image_sets_source_asin_idx` ON `kb_image_sets` (`workspaceId`, `sourceAsin`);
