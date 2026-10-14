-- FRESH BOOTSTRAP ONLY. Twenty-six current-source columns absent from the historical SQL chain.
-- Strict ADDs intentionally fail on unexpected state; no IF NOT EXISTS / silent skip.
-- Source: migrate_update.mjs and drizzle/schema/{listing,image}.ts.
ALTER TABLE `listings`
  ADD COLUMN `itemHighlights` TEXT NULL,
  ADD COLUMN `itemHighlightsCn` TEXT NULL,
  ADD COLUMN `agentRunId` VARCHAR(80) NULL;
ALTER TABLE `listingVersions`
  ADD COLUMN `itemHighlights` TEXT NULL,
  ADD COLUMN `itemHighlightsCn` TEXT NULL;
ALTER TABLE `kb_image_sets`
  ADD COLUMN `setStyle` VARCHAR(30) NULL,
  ADD COLUMN `setStyleParams` TEXT NULL,
  ADD COLUMN `setPrimaryColor` VARCHAR(20) NULL,
  ADD COLUMN `setAccentColor` VARCHAR(20) NULL,
  ADD COLUMN `setCategory` VARCHAR(30) NULL,
  ADD COLUMN `setTargetAudience` VARCHAR(200) NULL,
  ADD COLUMN `setCategoryScene` VARCHAR(200) NULL;
ALTER TABLE `kb_images`
  ADD COLUMN `tagImageBelong` VARCHAR(20) NULL,
  ADD COLUMN `tagImageBelongSub` VARCHAR(30) NULL,
  ADD COLUMN `tagImageTypeMain` VARCHAR(20) NULL,
  ADD COLUMN `tagImageTypeSub` VARCHAR(30) NULL,
  ADD COLUMN `tagSellingPointCategory` VARCHAR(20) NULL,
  ADD COLUMN `tagSellingPointDetail` VARCHAR(200) NULL,
  ADD COLUMN `tagComposition` VARCHAR(20) NULL,
  ADD COLUMN `tagColorSchemeV2` VARCHAR(30) NULL,
  ADD COLUMN `tagDesignStyleV2` VARCHAR(30) NULL;
ALTER TABLE `image_workflow_sessions`
  ADD COLUMN `step0AiResult` TEXT NULL,
  ADD COLUMN `step0UserEdit` TEXT NULL,
  ADD COLUMN `step0Confirmed` INT NOT NULL DEFAULT 0,
  ADD COLUMN `agentRunId` VARCHAR(80) NULL,
  ADD COLUMN `step5DesignerUploads` TEXT NULL;
