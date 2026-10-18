-- CANDIDATE ONLY: not registered, not an approval, never executed at runtime.
-- No legacy weekly or Lingxing facts are rewritten or removed.
CREATE TABLE ops_saihu_daily_report_batches (
 id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
 workspace_id INT NOT NULL, user_id INT NOT NULL,
 run_id VARCHAR(80) NOT NULL, operation_id CHAR(36) NOT NULL,
 status VARCHAR(20) NOT NULL, source_hash CHAR(64) NOT NULL,
 preview_hash CHAR(64) NOT NULL, scope JSON NOT NULL,
 coverage JSON NOT NULL, facts JSON NOT NULL,
 created_at DATETIME(3) NOT NULL, confirmed_at DATETIME(3) NULL,
 UNIQUE KEY ops_saihu_daily_run_uq(run_id),
 KEY ops_saihu_daily_scope_idx(workspace_id,status,id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
