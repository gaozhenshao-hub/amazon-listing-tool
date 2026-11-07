CREATE TABLE IF NOT EXISTS listing_aggregations (
  project_id INT NOT NULL PRIMARY KEY,
  workspace_id INT NOT NULL,
  data JSON NOT NULL,
  revision INT NOT NULL DEFAULT 1,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_listing_aggregation_workspace (workspace_id, project_id)
);

ALTER TABLE competitorAnalyses MODIFY COLUMN rawData MEDIUMTEXT NULL;
