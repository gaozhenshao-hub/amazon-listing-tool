-- 既有dev_import_batches表保留draft/confirmed/superseded/rolled_back历史语义，以下变更只增补治理字段。
ALTER TABLE dev_import_batches
  MODIFY COLUMN status ENUM('draft','validated','confirmed','applying','applied','superseded','rolled_back','rejected','failed') NOT NULL DEFAULT 'draft',
  ADD COLUMN uploadedFileId INT NULL,
  ADD COLUMN fileType ENUM('sales','reviews') NULL,
  ADD COLUMN fileName VARCHAR(500) NULL,
  ADD COLUMN fileHash VARCHAR(128) NULL,
  ADD COLUMN totalRows INT NOT NULL DEFAULT 0,
  ADD COLUMN validRows INT NOT NULL DEFAULT 0,
  ADD COLUMN warningRows INT NOT NULL DEFAULT 0,
  ADD COLUMN errorRows INT NOT NULL DEFAULT 0,
  ADD COLUMN validationSummary TEXT NULL,
  ADD COLUMN normalizedRows TEXT NULL,
  ADD COLUMN appliedBy INT NULL,
  ADD COLUMN appliedAt TIMESTAMP NULL,
  ADD COLUMN rollbackReason TEXT NULL,
  ADD COLUMN rolledBackBy INT NULL;

CREATE INDEX idx_dev_import_batches_workspace_project_status ON dev_import_batches (workspaceId, projectId, status, createdAt);
CREATE INDEX idx_dev_import_batches_uploaded_file ON dev_import_batches (uploadedFileId);

CREATE TABLE dev_import_apply_snapshots (
  id INT AUTO_INCREMENT PRIMARY KEY,
  workspaceId INT NOT NULL,
  projectId INT NOT NULL,
  batchId INT NOT NULL,
  resourceType ENUM('products','reviews') NOT NULL,
  beforeSnapshot TEXT NOT NULL,
  appliedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  rolledBackAt TIMESTAMP NULL,
  rolledBackBy INT NULL,
  rollbackBlockedReason TEXT NULL,
  createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_dev_import_snapshot_batch (batchId),
  INDEX idx_dev_import_snapshots_workspace_project (workspaceId, projectId, appliedAt)
);
