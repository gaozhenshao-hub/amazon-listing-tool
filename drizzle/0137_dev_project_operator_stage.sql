-- Allow the project progress list to store a manually curated operator display.
-- Project stage is sourced from dev_projects.phase; landingProgress remains only for compatibility.

ALTER TABLE `dev_project_progress`
  ADD COLUMN `operatorName` varchar(255) NULL AFTER `selectorName`;
