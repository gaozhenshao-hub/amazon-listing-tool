-- Artifact source-of-truth v2: immutable version lineage, pointer history and
-- exact downstream-consumption provenance across business domains.

CREATE TABLE IF NOT EXISTS `ai_artifact_selection_events` (
  `id` int NOT NULL AUTO_INCREMENT,
  `selectionId` varchar(80) NOT NULL,
  `workspaceId` int,
  `projectId` int,
  `artifactKey` varchar(128) NOT NULL,
  `sourceTable` varchar(128),
  `sourceRowId` varchar(128),
  `fromArtifactId` varchar(80),
  `fromVersion` int,
  `toArtifactId` varchar(80) NOT NULL,
  `toVersion` int NOT NULL,
  `action` enum('select','rollback','confirm') NOT NULL,
  `userId` int,
  `reason` text,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_ai_artifact_selection_id` (`selectionId`),
  KEY `idx_ai_artifact_selection_scope` (`workspaceId`,`sourceTable`,`sourceRowId`,`artifactKey`,`createdAt`),
  KEY `idx_ai_artifact_selection_project` (`workspaceId`,`projectId`,`createdAt`),
  KEY `idx_ai_artifact_selection_target` (`toArtifactId`,`toVersion`)
);

CREATE TABLE IF NOT EXISTS `ai_artifact_consumptions` (
  `id` int NOT NULL AUTO_INCREMENT,
  `consumptionId` varchar(80) NOT NULL,
  `workspaceId` int,
  `projectId` int,
  `artifactId` varchar(80) NOT NULL,
  `artifactKey` varchar(128) NOT NULL,
  `artifactVersion` int NOT NULL,
  `artifactRef` varchar(192) NOT NULL,
  `consumerDomain` enum('listing','image','ads','video','agent','project','file','ops','tool','other') NOT NULL,
  `consumerType` enum('agent_node','ai_job','skill_run','business_operation') NOT NULL,
  `consumerId` varchar(128) NOT NULL,
  `runId` varchar(80),
  `nodeId` varchar(128),
  `metadata` json,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_ai_artifact_consumption_id` (`consumptionId`),
  KEY `idx_ai_artifact_consumption_consumer` (`workspaceId`,`consumerType`,`consumerId`,`createdAt`),
  KEY `idx_ai_artifact_consumption_artifact` (`artifactId`,`artifactVersion`,`createdAt`),
  KEY `idx_ai_artifact_consumption_project` (`workspaceId`,`projectId`,`consumerDomain`,`createdAt`)
);

-- Repair the old draft/current combination. Drafts remain visible as history,
-- while only confirmed versions are eligible for downstream resolution.
UPDATE `ai_artifacts`
SET `isCurrent`=0, `currentSince`=NULL
WHERE `status`='draft' AND `isCurrent`=1;

-- Pick the newest confirmed version for any lineage that lost its pointer.
CREATE TEMPORARY TABLE `tmp_ai_artifact_current_repair` AS
  SELECT workspaceId,domain,sourceTable,sourceRowId,artifactKey,MAX(version) AS selectedVersion
  FROM `ai_artifacts`
  WHERE `status` IN ('final','superseded')
    AND sourceTable IS NOT NULL
    AND sourceRowId IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM `ai_artifacts` current_version
      WHERE current_version.workspaceId <=> `ai_artifacts`.workspaceId
        AND current_version.domain=`ai_artifacts`.domain
        AND current_version.sourceTable=`ai_artifacts`.sourceTable
        AND current_version.sourceRowId=`ai_artifacts`.sourceRowId
        AND current_version.artifactKey=`ai_artifacts`.artifactKey
        AND current_version.isCurrent=1
        AND current_version.status='final'
    )
  GROUP BY workspaceId,domain,sourceTable,sourceRowId,artifactKey
;

UPDATE `ai_artifacts` target
JOIN `tmp_ai_artifact_current_repair` selected
  ON target.workspaceId <=> selected.workspaceId
 AND target.domain=selected.domain
 AND target.sourceTable=selected.sourceTable
 AND target.sourceRowId=selected.sourceRowId
 AND target.artifactKey=selected.artifactKey
 AND target.version=selected.selectedVersion
SET target.status='final',target.isCurrent=1,target.currentSince=COALESCE(target.currentSince,NOW());

DROP TEMPORARY TABLE `tmp_ai_artifact_current_repair`;

CREATE INDEX `idx_ai_artifacts_project_key_current`
  ON `ai_artifacts` (`workspaceId`,`projectId`,`artifactKey`,`status`,`isCurrent`,`version`);

CREATE INDEX `idx_ai_artifacts_lineage_version`
  ON `ai_artifacts` (`workspaceId`,`sourceTable`,`sourceRowId`,`artifactKey`,`version`);
