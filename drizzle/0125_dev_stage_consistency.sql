-- Product-development analysis stage consistency v1.
-- Duplicate stage rows are archived before removal so the migration is
-- reversible by forward repair. Project IDs are globally unique, therefore
-- the project/type key also protects legacy rows whose workspace is NULL.

ALTER TABLE `dev_analysis_stages` ADD COLUMN `rowVersion` int NOT NULL DEFAULT 0;
ALTER TABLE `dev_analysis_stages` ADD COLUMN `lastMutationKey` varchar(128) NULL;

CREATE TABLE `dev_analysis_stage_conflicts` (
  `id` int NOT NULL AUTO_INCREMENT,
  `workspaceId` int NULL,
  `projectId` int NOT NULL,
  `stageType` varchar(64) NOT NULL,
  `keptStageId` int NOT NULL,
  `duplicateStageId` int NOT NULL,
  `duplicateSnapshot` json NOT NULL,
  `resolution` varchar(64) NOT NULL DEFAULT 'deduplicated_before_unique_key',
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_dev_stage_conflicts_duplicate` (`duplicateStageId`),
  KEY `idx_dev_stage_conflicts_project_type` (`projectId`,`stageType`,`createdAt`)
);

CREATE TEMPORARY TABLE `tmp_dev_analysis_stage_ranked` AS
SELECT
  `id`,
  FIRST_VALUE(`id`) OVER (
    PARTITION BY `projectId`, `stageType`
    ORDER BY
      CASE `status`
        WHEN 'confirmed' THEN 7
        WHEN 'completed' THEN 6
        WHEN 'generated' THEN 5
        WHEN 'editing' THEN 4
        WHEN 'running' THEN 3
        WHEN 'generating' THEN 2
        ELSE 1
      END DESC,
      `updatedAt` DESC,
      `id` DESC
  ) AS `keptStageId`,
  ROW_NUMBER() OVER (
    PARTITION BY `projectId`, `stageType`
    ORDER BY
      CASE `status`
        WHEN 'confirmed' THEN 7
        WHEN 'completed' THEN 6
        WHEN 'generated' THEN 5
        WHEN 'editing' THEN 4
        WHEN 'running' THEN 3
        WHEN 'generating' THEN 2
        ELSE 1
      END DESC,
      `updatedAt` DESC,
      `id` DESC
  ) AS `rowNumber`
FROM `dev_analysis_stages`;

INSERT INTO `dev_analysis_stage_conflicts`
  (`workspaceId`,`projectId`,`stageType`,`keptStageId`,`duplicateStageId`,`duplicateSnapshot`)
SELECT
  duplicate_stage.`workspaceId`,
  duplicate_stage.`projectId`,
  duplicate_stage.`stageType`,
  ranked.`keptStageId`,
  duplicate_stage.`id`,
  JSON_OBJECT(
    'id', duplicate_stage.`id`,
    'userId', duplicate_stage.`userId`,
    'status', duplicate_stage.`status`,
    'rawResult', duplicate_stage.`rawResult`,
    'editedResult', duplicate_stage.`editedResult`,
    'chartConfig', duplicate_stage.`chartConfig`,
    'runId', duplicate_stage.`runId`,
    'runProgress', duplicate_stage.`runProgress`,
    'runError', duplicate_stage.`runError`,
    'runStartedAt', duplicate_stage.`runStartedAt`,
    'runCompletedAt', duplicate_stage.`runCompletedAt`,
    'confirmedAt', duplicate_stage.`confirmedAt`,
    'createdAt', duplicate_stage.`createdAt`,
    'updatedAt', duplicate_stage.`updatedAt`
  )
FROM `tmp_dev_analysis_stage_ranked` ranked
JOIN `dev_analysis_stages` duplicate_stage ON duplicate_stage.`id` = ranked.`id`
WHERE ranked.`rowNumber` > 1;

DELETE duplicate_stage
FROM `dev_analysis_stages` duplicate_stage
JOIN `tmp_dev_analysis_stage_ranked` ranked ON ranked.`id` = duplicate_stage.`id`
WHERE ranked.`rowNumber` > 1;

DROP TEMPORARY TABLE `tmp_dev_analysis_stage_ranked`;

UPDATE `dev_analysis_stages` stage_row
JOIN `dev_projects` project_row ON project_row.`id` = stage_row.`projectId`
SET stage_row.`workspaceId` = project_row.`workspaceId`
WHERE NOT (stage_row.`workspaceId` <=> project_row.`workspaceId`);

CREATE UNIQUE INDEX `uniq_dev_stages_workspace_project_type`
  ON `dev_analysis_stages` (`workspaceId`,`projectId`,`stageType`);
CREATE UNIQUE INDEX `uniq_dev_stages_project_type`
  ON `dev_analysis_stages` (`projectId`,`stageType`);

INSERT INTO `security_audit_logs`
  (`auditId`,`workspaceId`,`action`,`resourceType`,`status`,`riskLevel`,`reason`,`metadata`)
SELECT
  CONCAT('audit_', UUID()),
  NULL,
  'product_development.stage_deduplicate',
  'dev_analysis_stages',
  'success',
  IF(COUNT(*) = 0, 'low', 'high'),
  IF(COUNT(*) = 0, 'No duplicate analysis stages required repair',
     'Duplicate analysis stages were archived before unique-key enforcement'),
  JSON_OBJECT('archivedDuplicateStages', COUNT(*), 'migration', '0125_dev_stage_consistency')
FROM `dev_analysis_stage_conflicts`;
