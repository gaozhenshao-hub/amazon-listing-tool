-- Store the manually selected product-development landing stage.
-- Stable codes are persisted while the UI owns localized labels and colors.

ALTER TABLE `dev_project_progress`
  ADD COLUMN `landingStage` varchar(40) NULL AFTER `operatorName`;
