CREATE TABLE emperor_harness_review_requests (
  reviewId VARCHAR(64) NOT NULL PRIMARY KEY,
  workspaceId INT NULL,
  agentRunId VARCHAR(80) NULL,
  nodeId VARCHAR(128) NULL,
  requestType ENUM('review_required','approval_required','selection_required') NOT NULL,
  status ENUM('open','approved','rejected','selected','canceled') NOT NULL DEFAULT 'open',
  title VARCHAR(255) NOT NULL,
  candidateSummary JSON NULL,
  requestedBy INT NULL,
  resolvedBy INT NULL,
  requestedReason TEXT NULL,
  resolutionReason TEXT NULL,
  decision JSON NULL,
  createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolvedAt TIMESTAMP NULL,
  KEY idx_harness_review_run_status (agentRunId, status),
  KEY idx_harness_review_workspace_status (workspaceId, status)
);

CREATE TABLE emperor_harness_feedback_signals (
  signalId VARCHAR(64) NOT NULL PRIMARY KEY,
  workspaceId INT NULL,
  projectId INT NULL,
  domain VARCHAR(32) NOT NULL,
  artifactKey VARCHAR(128) NULL,
  selectionId VARCHAR(80) NULL,
  selectedArtifactId VARCHAR(80) NULL,
  candidateArtifactIds JSON NULL,
  editDiff JSON NULL,
  selectionReason TEXT NULL,
  outcomeStatus ENUM('pending','accepted','revised','rejected','published') NOT NULL DEFAULT 'pending',
  outcomeMetadata JSON NULL,
  userId INT NULL,
  createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_harness_feedback_project_domain (projectId, domain),
  KEY idx_harness_feedback_selection (selectionId)
);

CREATE TABLE emperor_execution_presets (
  presetSlug VARCHAR(64) NOT NULL PRIMARY KEY,
  workspaceId INT NULL,
  name VARCHAR(128) NOT NULL,
  description TEXT NULL,
  mode ENUM('standard','quality_first','batch_background','evaluation') NOT NULL,
  config JSON NOT NULL,
  isSystem TINYINT NOT NULL DEFAULT 0,
  isActive TINYINT NOT NULL DEFAULT 1,
  createdBy INT NULL,
  createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_execution_presets_mode_active (mode, isActive)
);

CREATE TABLE emperor_parallel_plans (
  parallelPlanId VARCHAR(64) NOT NULL PRIMARY KEY,
  workspaceId INT NULL,
  agentRunId VARCHAR(80) NOT NULL,
  parentNodeId VARCHAR(128) NULL,
  mergeNodeId VARCHAR(128) NULL,
  status ENUM('draft','approved','running','waiting_merge','completed','failed','canceled') NOT NULL DEFAULT 'draft',
  maxConcurrency INT NOT NULL DEFAULT 1,
  branchCount INT NOT NULL DEFAULT 0,
  policy JSON NULL,
  createdBy INT NULL,
  approvedBy INT NULL,
  createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_parallel_plans_run_status (agentRunId, status)
);

CREATE TABLE emperor_parallel_branches (
  branchId VARCHAR(64) NOT NULL PRIMARY KEY,
  parallelPlanId VARCHAR(64) NOT NULL,
  nodeId VARCHAR(128) NOT NULL,
  status ENUM('pending','running','succeeded','failed','canceled') NOT NULL DEFAULT 'pending',
  evidenceArtifactIds JSON NULL,
  errorSummary TEXT NULL,
  startedAt TIMESTAMP NULL,
  completedAt TIMESTAMP NULL,
  createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_parallel_branches_plan_status (parallelPlanId, status)
);
