CREATE TABLE IF NOT EXISTS emperor_skill_rollout_plans (
  planId VARCHAR(64) NOT NULL PRIMARY KEY,
  workspaceId INT NULL,
  skillSlug VARCHAR(255) NOT NULL,
  snapshotId VARCHAR(64) NOT NULL,
  skillVersion VARCHAR(64) NOT NULL,
  snapshotHash VARCHAR(128) NOT NULL,
  status ENUM('draft','approved','active','paused','rolled_back','completed') NOT NULL DEFAULT 'draft',
  rolloutPercent INT NOT NULL DEFAULT 0,
  allowedUserIds JSON NULL,
  allowedProjectIds JSON NULL,
  decisionNote TEXT NULL,
  evidenceResultId VARCHAR(64) NULL,
  createdBy INT NULL,
  approvedBy INT NULL,
  activatedBy INT NULL,
  rolledBackBy INT NULL,
  createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  approvedAt TIMESTAMP NULL,
  activatedAt TIMESTAMP NULL,
  pausedAt TIMESTAMP NULL,
  rolledBackAt TIMESTAMP NULL,
  KEY idx_skill_rollout_plans_skill_status (skillSlug, status),
  KEY idx_skill_rollout_plans_snapshot (snapshotId),
  KEY idx_skill_rollout_plans_workspace (workspaceId)
);

CREATE TABLE IF NOT EXISTS emperor_skill_rollout_decisions (
  decisionId VARCHAR(64) NOT NULL PRIMARY KEY,
  planId VARCHAR(64) NOT NULL,
  action ENUM('created','approved','activated','rollout_changed','paused','rolled_back','completed') NOT NULL,
  actorId INT NULL,
  reason TEXT NULL,
  metadata JSON NULL,
  createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_skill_rollout_decisions_plan_time (planId, createdAt)
);
