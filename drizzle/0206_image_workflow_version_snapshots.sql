-- Phase D image workflow dependency digests and exportable approved snapshots.
-- DEDICATED RELEASE ONLY: this additive migration is intentionally excluded from
-- the default migration plan. It may run only through the explicit 0206/0207
-- production gate after deployment-owner authorization. It does not modify existing
-- sessions, Listing, acquisition, or knowledge tables; it performs no backfill,
-- provider call, or model invocation.
--
-- Apply only after the integration prerequisites in
-- docs/validation/image-workflow-phase-d-integration.md are approved.

CREATE TABLE IF NOT EXISTS `image_workflow_version_scopes` (
  `id` int NOT NULL AUTO_INCREMENT,
  `workspaceId` int NOT NULL,
  `projectId` int NOT NULL,
  `sessionId` int NOT NULL,
  `revision` int NOT NULL DEFAULT 0,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_image_workflow_version_scope` (`workspaceId`,`projectId`,`sessionId`),
  KEY `idx_image_workflow_version_scope_workspace_project` (`workspaceId`,`projectId`,`updatedAt`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `image_workflow_stage_snapshots` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `workspaceId` int NOT NULL,
  `projectId` int NOT NULL,
  `sessionId` int NOT NULL,
  `step` tinyint NOT NULL,
  `version` int NOT NULL,
  `contentOrigin` enum('human_confirmed','legacy_human_confirmed') NOT NULL,
  `contentRevision` int NOT NULL,
  `contentJson` json NOT NULL,
  `contentDigest` varchar(64) NOT NULL,
  `assetDependenciesJson` json NOT NULL,
  `assetDependencyDigest` varchar(64) NOT NULL,
  `dependenciesJson` json NOT NULL,
  `dependencyDigest` varchar(64) NOT NULL,
  `snapshotDigest` varchar(64) NOT NULL,
  `confirmedBy` int NOT NULL,
  `confirmedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_image_workflow_stage_snapshot_version` (`workspaceId`,`projectId`,`sessionId`,`step`,`version`),
  UNIQUE KEY `uk_image_workflow_stage_snapshot_digest` (`workspaceId`,`projectId`,`sessionId`,`snapshotDigest`),
  KEY `idx_image_workflow_stage_snapshot_scope_step` (`workspaceId`,`projectId`,`sessionId`,`step`,`version`),
  CONSTRAINT `chk_image_workflow_stage_snapshot_step` CHECK (`step` >= 0 AND `step` <= 6),
  CONSTRAINT `chk_image_workflow_stage_snapshot_version` CHECK (`version` > 0),
  CONSTRAINT `chk_image_workflow_stage_snapshot_content_revision` CHECK (`contentRevision` > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Snapshot content never changes. Current/invalidation state is reconstructible
-- from append-only events, preserving the superseded record for audit/export review.
CREATE TABLE IF NOT EXISTS `image_workflow_snapshot_state_events` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `workspaceId` int NOT NULL,
  `projectId` int NOT NULL,
  `sessionId` int NOT NULL,
  `snapshotDigest` varchar(64) NOT NULL,
  `state` enum('confirmed','superseded','invalidated') NOT NULL,
  `reason` enum('content_version_changed','upstream_content_version_changed','image_purpose_version_changed','snapshot_replaced') NOT NULL,
  `actorId` int NOT NULL,
  `occurredAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_image_workflow_snapshot_event_scope_digest` (`workspaceId`,`projectId`,`sessionId`,`snapshotDigest`,`id`),
  KEY `idx_image_workflow_snapshot_event_scope_state` (`workspaceId`,`projectId`,`sessionId`,`state`,`occurredAt`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
