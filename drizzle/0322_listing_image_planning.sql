-- Dedicated image-planning release. Existing project and library assets stay intact.
CREATE TABLE IF NOT EXISTS listing_image_plans (
  project_id INT NOT NULL PRIMARY KEY,
  workspace_id INT NOT NULL,
  data JSON NOT NULL,
  revision INT NOT NULL DEFAULT 1,
  job_run_id VARCHAR(128) NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_image_plan_workspace (workspace_id, project_id)
);
CREATE TABLE IF NOT EXISTS listing_image_plan_candidates (
  id CHAR(36) NOT NULL PRIMARY KEY,
  project_id INT NOT NULL,
  workspace_id INT NOT NULL,
  user_id INT NOT NULL,
  base_revision INT NOT NULL,
  source_hash CHAR(64) NOT NULL,
  mode VARCHAR(20) NOT NULL,
  selection JSON NULL,
  original_data JSON NOT NULL,
  input_data JSON NOT NULL,
  data JSON NOT NULL,
  history JSON NOT NULL,
  reply TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'open',
  improvement_id CHAR(36) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_image_plan_candidate (workspace_id,project_id,user_id,created_at)
);
