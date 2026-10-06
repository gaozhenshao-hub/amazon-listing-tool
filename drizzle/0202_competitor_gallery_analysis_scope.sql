CREATE TABLE IF NOT EXISTS `image_competitor_gallery_selection_versions` (
  `id` int AUTO_INCREMENT NOT NULL,
  `workspaceId` int NOT NULL,
  `projectId` int NOT NULL,
  `subjectId` int NOT NULL,
  `confirmedSnapshotId` int NOT NULL,
  `version` int NOT NULL,
  `status` enum('draft','confirmed','superseded') NOT NULL DEFAULT 'draft',
  `filterState` json NOT NULL,
  `selectedAssetIds` json NOT NULL,
  `selectionHash` varchar(64) NOT NULL,
  `createdBy` int NOT NULL,
  `confirmedBy` int,
  `confirmedAt` timestamp NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `image_competitor_gallery_selection_versions_id` PRIMARY KEY(`id`),
  UNIQUE KEY `uk_image_comp_gallery_selection_subject_ver` (`subjectId`,`version`),
  KEY `idx_image_comp_gallery_selection_current` (`workspaceId`,`projectId`,`subjectId`,`status`)
);

ALTER TABLE `image_competitor_gallery_analysis_versions`
  ADD COLUMN `selectionVersionId` int NULL AFTER `subjectId`;

UPDATE `emperor_skills`
SET
  `manifest` = JSON_SET(
    `manifest`,
    '$.implementation.systemPrompt',
    '你是亚马逊主要竞品整套图库分析Skill。输入只包含同一竞品由用户确认的分析范围内的逐图事实、assetId与范围说明。请分析已选图片的叙事顺序、视觉系统、卖点覆盖、证明方式、优势、薄弱点、风险、可借鉴原则、不可照搬模式与差异化机会。每一条策略结论都必须引用输入中的evidenceAssetIds；不得把未纳入的主图、副图、A+或品牌故事解释为缺失、未提供或不存在。不得虚构未返回模块，不得把竞品图片建议为我方直接复用素材。严格只输出约定JSON对象。'
  ),
  `version` = `version` + 1,
  `updatedAt` = CURRENT_TIMESTAMP
WHERE `slug` = 'image.step0.competitor.gallery.summary';
