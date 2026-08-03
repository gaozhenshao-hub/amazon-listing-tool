-- Security and tenant governance v1.
-- Adds organization/workspace tenancy, action-level access policy/audit tables,
-- workspace scope columns on hot records, and Tool secret key-version metadata.

CREATE TABLE IF NOT EXISTS `organizations` (
  `id` int NOT NULL AUTO_INCREMENT,
  `slug` varchar(128) NOT NULL,
  `name` varchar(255) NOT NULL,
  `status` enum('active','disabled') NOT NULL DEFAULT 'active',
  `ownerUserId` int,
  `metadata` json,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_organizations_slug` (`slug`),
  KEY `idx_organizations_status_created` (`status`, `createdAt`)
);

CREATE TABLE IF NOT EXISTS `workspaces` (
  `id` int NOT NULL AUTO_INCREMENT,
  `organizationId` int,
  `slug` varchar(128) NOT NULL,
  `name` varchar(255) NOT NULL,
  `status` enum('active','archived','disabled') NOT NULL DEFAULT 'active',
  `ownerUserId` int,
  `defaultRole` varchar(64) DEFAULT 'ops_specialist',
  `metadata` json,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_workspaces_slug` (`slug`),
  KEY `idx_workspaces_org_status` (`organizationId`, `status`, `createdAt`)
);

CREATE TABLE IF NOT EXISTS `workspace_memberships` (
  `id` int NOT NULL AUTO_INCREMENT,
  `workspaceId` int NOT NULL,
  `userId` int NOT NULL,
  `role` varchar(64) NOT NULL,
  `status` enum('active','disabled','invited') NOT NULL DEFAULT 'active',
  `permissions` json,
  `invitedBy` int,
  `joinedAt` timestamp NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_workspace_membership_user` (`workspaceId`, `userId`),
  KEY `idx_workspace_memberships_user_status` (`userId`, `status`, `workspaceId`),
  KEY `idx_workspace_memberships_role_status` (`workspaceId`, `role`, `status`)
);

CREATE TABLE IF NOT EXISTS `security_access_policies` (
  `id` int NOT NULL AUTO_INCREMENT,
  `policyId` varchar(80) NOT NULL,
  `workspaceId` int,
  `resourceType` varchar(64) NOT NULL,
  `resourceId` varchar(128),
  `action` varchar(64) NOT NULL,
  `effect` enum('allow','deny') NOT NULL DEFAULT 'allow',
  `principalType` enum('role','user','workspace_member') NOT NULL,
  `principalId` varchar(128) NOT NULL,
  `conditions` json,
  `status` enum('active','disabled') NOT NULL DEFAULT 'active',
  `createdBy` int,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_security_access_policy_id` (`policyId`),
  KEY `idx_security_policy_resource` (`workspaceId`, `resourceType`, `resourceId`, `action`, `status`),
  KEY `idx_security_policy_principal` (`principalType`, `principalId`, `status`)
);

CREATE TABLE IF NOT EXISTS `security_audit_logs` (
  `id` int NOT NULL AUTO_INCREMENT,
  `auditId` varchar(80) NOT NULL,
  `workspaceId` int,
  `actorUserId` int,
  `actorRole` varchar(64),
  `action` varchar(80) NOT NULL,
  `resourceType` varchar(64) NOT NULL,
  `resourceId` varchar(128),
  `resourceName` varchar(255),
  `projectId` int,
  `agentRunId` varchar(80),
  `toolSlug` varchar(128),
  `status` enum('success','denied','failed') NOT NULL DEFAULT 'success',
  `riskLevel` enum('low','medium','high','critical') NOT NULL DEFAULT 'medium',
  `ipAddress` varchar(45),
  `userAgent` varchar(512),
  `requestId` varchar(128),
  `reason` text,
  `beforeSnapshot` json,
  `afterSnapshot` json,
  `metadata` json,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_security_audit_id` (`auditId`),
  KEY `idx_security_audit_workspace_created` (`workspaceId`, `createdAt`),
  KEY `idx_security_audit_actor_created` (`actorUserId`, `createdAt`),
  KEY `idx_security_audit_resource_created` (`resourceType`, `resourceId`, `createdAt`),
  KEY `idx_security_audit_action_status` (`action`, `status`, `createdAt`),
  KEY `idx_security_audit_project_created` (`projectId`, `createdAt`)
);

CREATE TABLE IF NOT EXISTS `emperor_secret_key_versions` (
  `id` int NOT NULL AUTO_INCREMENT,
  `scope` enum('tool','model','system') NOT NULL DEFAULT 'tool',
  `keyVersion` varchar(64) NOT NULL,
  `status` enum('active','deprecated','retired') NOT NULL DEFAULT 'active',
  `activatedAt` timestamp NULL,
  `deprecatedAt` timestamp NULL,
  `retiredAt` timestamp NULL,
  `metadata` json,
  `createdBy` int,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_secret_key_version_scope` (`scope`, `keyVersion`),
  KEY `idx_secret_key_versions_status` (`scope`, `status`, `activatedAt`)
);

ALTER TABLE `users`
  ADD COLUMN `organizationId` int,
  ADD COLUMN `defaultWorkspaceId` int;

ALTER TABLE `role_permissions`
  ADD COLUMN `workspaceId` int;

ALTER TABLE `project_assignments`
  ADD COLUMN `workspaceId` int;

ALTER TABLE `projects`
  ADD COLUMN `workspaceId` int;

ALTER TABLE `projectFiles`
  ADD COLUMN `workspaceId` int;

ALTER TABLE `ai_jobs`
  ADD COLUMN `workspaceId` int;

ALTER TABLE `ai_job_dead_letters`
  ADD COLUMN `workspaceId` int;

ALTER TABLE `emperor_skills`
  ADD COLUMN `workspaceId` int;

ALTER TABLE `emperor_skill_runs`
  ADD COLUMN `workspaceId` int;

ALTER TABLE `emperor_agents`
  ADD COLUMN `workspaceId` int;

ALTER TABLE `emperor_agent_template_versions`
  ADD COLUMN `workspaceId` int;

ALTER TABLE `emperor_agent_runs`
  ADD COLUMN `workspaceId` int;

ALTER TABLE `emperor_agent_checkpoints`
  ADD COLUMN `workspaceId` int;

ALTER TABLE `emperor_agent_events`
  ADD COLUMN `workspaceId` int;

ALTER TABLE `emperor_agent_artifacts`
  ADD COLUMN `workspaceId` int;

ALTER TABLE `emperor_tools`
  ADD COLUMN `workspaceId` int;

ALTER TABLE `emperor_tool_runs`
  ADD COLUMN `workspaceId` int;

ALTER TABLE `emperor_tool_secrets`
  ADD COLUMN `workspaceId` int,
  ADD COLUMN `previousKeyVersion` varchar(64),
  ADD COLUMN `status` enum('active','rotating','retired') NOT NULL DEFAULT 'active',
  ADD COLUMN `rotatedAt` timestamp NULL,
  ADD COLUMN `expiresAt` timestamp NULL;

ALTER TABLE `emperor_ai_os_metrics`
  ADD COLUMN `workspaceId` int;

ALTER TABLE `emperor_ai_os_evaluations`
  ADD COLUMN `workspaceId` int;

ALTER TABLE `emperor_knowledge`
  ADD COLUMN `workspaceId` int;

ALTER TABLE `emperor_mcp_connectors`
  ADD COLUMN `workspaceId` int;

ALTER TABLE `emperor_model_providers`
  ADD COLUMN `workspaceId` int;

INSERT INTO `organizations` (`slug`, `name`, `status`, `metadata`)
VALUES ('default', 'Default Organization', 'active', JSON_OBJECT('createdByMigration', '0114_security_tenant_governance_v1'))
ON DUPLICATE KEY UPDATE `updatedAt` = `updatedAt`;

INSERT INTO `workspaces` (`organizationId`, `slug`, `name`, `status`, `metadata`)
SELECT `id`, 'default', 'Default Workspace', 'active', JSON_OBJECT('createdByMigration', '0114_security_tenant_governance_v1')
FROM `organizations`
WHERE `slug` = 'default'
ON DUPLICATE KEY UPDATE `updatedAt` = `updatedAt`;

UPDATE `users` u
JOIN `organizations` o ON o.`slug` = 'default'
JOIN `workspaces` w ON w.`slug` = 'default'
SET u.`organizationId` = COALESCE(u.`organizationId`, o.`id`),
    u.`defaultWorkspaceId` = COALESCE(u.`defaultWorkspaceId`, w.`id`);

INSERT IGNORE INTO `workspace_memberships` (`workspaceId`, `userId`, `role`, `status`, `joinedAt`)
SELECT u.`defaultWorkspaceId`, u.`id`, u.`role`, 'active', NOW()
FROM `users` u
WHERE u.`defaultWorkspaceId` IS NOT NULL;

UPDATE `projects` p
JOIN `users` u ON u.`id` = p.`userId`
SET p.`workspaceId` = COALESCE(p.`workspaceId`, u.`defaultWorkspaceId`);

UPDATE `projectFiles` pf
JOIN `projects` p ON p.`id` = pf.`projectId`
SET pf.`workspaceId` = COALESCE(pf.`workspaceId`, p.`workspaceId`);

UPDATE `project_assignments` pa
JOIN `projects` p ON p.`id` = pa.`projectId`
SET pa.`workspaceId` = COALESCE(pa.`workspaceId`, p.`workspaceId`);

UPDATE `ai_jobs` j
LEFT JOIN `projects` p ON p.`id` = j.`projectId`
LEFT JOIN `users` u ON u.`id` = j.`userId`
SET j.`workspaceId` = COALESCE(j.`workspaceId`, p.`workspaceId`, u.`defaultWorkspaceId`);

UPDATE `ai_job_dead_letters` j
LEFT JOIN `projects` p ON p.`id` = j.`projectId`
LEFT JOIN `users` u ON u.`id` = j.`userId`
SET j.`workspaceId` = COALESCE(j.`workspaceId`, p.`workspaceId`, u.`defaultWorkspaceId`);

UPDATE `emperor_skill_runs` r
LEFT JOIN `users` u ON u.`id` = r.`userId`
SET r.`workspaceId` = COALESCE(r.`workspaceId`, u.`defaultWorkspaceId`);

UPDATE `emperor_agent_runs` r
LEFT JOIN `projects` p ON p.`id` = r.`projectId`
LEFT JOIN `users` u ON u.`id` = r.`userId`
SET r.`workspaceId` = COALESCE(r.`workspaceId`, p.`workspaceId`, u.`defaultWorkspaceId`);

UPDATE `emperor_agent_checkpoints` c
JOIN `emperor_agent_runs` r ON r.`runId` = c.`runId`
SET c.`workspaceId` = COALESCE(c.`workspaceId`, r.`workspaceId`);

UPDATE `emperor_agent_events` e
JOIN `emperor_agent_runs` r ON r.`runId` = e.`runId`
SET e.`workspaceId` = COALESCE(e.`workspaceId`, r.`workspaceId`);

UPDATE `emperor_agent_artifacts` a
JOIN `emperor_agent_runs` r ON r.`runId` = a.`runId`
SET a.`workspaceId` = COALESCE(a.`workspaceId`, r.`workspaceId`);

UPDATE `emperor_tool_runs` tr
LEFT JOIN `projects` p ON p.`id` = tr.`projectId`
LEFT JOIN `users` u ON u.`id` = tr.`userId`
SET tr.`workspaceId` = COALESCE(tr.`workspaceId`, p.`workspaceId`, u.`defaultWorkspaceId`);

UPDATE `emperor_ai_os_metrics` m
LEFT JOIN `projects` p ON p.`id` = m.`projectId`
LEFT JOIN `users` u ON u.`id` = m.`userId`
SET m.`workspaceId` = COALESCE(m.`workspaceId`, p.`workspaceId`, u.`defaultWorkspaceId`);

UPDATE `emperor_ai_os_evaluations` e
LEFT JOIN `projects` p ON p.`id` = e.`projectId`
LEFT JOIN `users` u ON u.`id` = e.`userId`
SET e.`workspaceId` = COALESCE(e.`workspaceId`, p.`workspaceId`, u.`defaultWorkspaceId`);

INSERT INTO `emperor_secret_key_versions` (`scope`, `keyVersion`, `status`, `activatedAt`, `metadata`)
VALUES ('tool', 'v1', 'active', NOW(), JSON_OBJECT('source', 'migration_default'))
ON DUPLICATE KEY UPDATE `updatedAt` = `updatedAt`;

CREATE INDEX `idx_users_workspace_status` ON `users` (`defaultWorkspaceId`, `status`, `role`);
CREATE INDEX `idx_projects_workspace_status_created` ON `projects` (`workspaceId`, `status`, `createdAt`);
CREATE INDEX `idx_project_files_workspace_status` ON `projectFiles` (`workspaceId`, `status`, `createdAt`);
CREATE INDEX `idx_ai_jobs_workspace_status_priority` ON `ai_jobs` (`workspaceId`, `status`, `priority`, `createdAt`);
CREATE INDEX `idx_agent_runs_workspace_status` ON `emperor_agent_runs` (`workspaceId`, `status`, `createdAt`);
CREATE INDEX `idx_agent_artifacts_workspace_current` ON `emperor_agent_artifacts` (`workspaceId`, `runId`, `artifactKey`, `isCurrent`);
CREATE INDEX `idx_tool_runs_workspace_tool_created` ON `emperor_tool_runs` (`workspaceId`, `toolSlug`, `createdAt`);
CREATE INDEX `idx_tool_secrets_workspace_status` ON `emperor_tool_secrets` (`workspaceId`, `status`, `updatedAt`);
CREATE INDEX `idx_tools_workspace_active` ON `emperor_tools` (`workspaceId`, `isActive`, `updatedAt`);
CREATE INDEX `idx_mcp_workspace_active` ON `emperor_mcp_connectors` (`workspaceId`, `isActive`, `updatedAt`);
