-- 补齐早期导入批次表的基础建表迁移；0149在此基础上增加治理字段与索引。
CREATE TABLE IF NOT EXISTS dev_import_batches (
  id INT AUTO_INCREMENT PRIMARY KEY,
  workspaceId INT NULL,
  projectId INT NOT NULL,
  userId INT NOT NULL,
  status ENUM('draft','confirmed','superseded','rolled_back') NOT NULL DEFAULT 'draft',
  replacesBatchId INT NULL,
  snapshot TEXT NULL,
  confirmedBy INT NULL,
  confirmedAt TIMESTAMP NULL,
  rolledBackAt TIMESTAMP NULL,
  createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_dev_import_batch_project_status (projectId, status)
);
