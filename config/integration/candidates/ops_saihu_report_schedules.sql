-- CANDIDATE ONLY. No registration, execution, seed or activation.
CREATE TABLE ops_saihu_report_schedules (
 plan_id CHAR(36) NOT NULL PRIMARY KEY, workspace_id INT NOT NULL,
 user_id INT NOT NULL, revision INT NOT NULL, status VARCHAR(20) NOT NULL,
 next_run_at BIGINT NULL, body JSON NOT NULL, body_hash CHAR(64) NOT NULL,
 created_at DATETIME(3) NOT NULL, updated_at DATETIME(3) NOT NULL,
 KEY ops_saihu_report_plan_owner_idx(workspace_id,user_id,plan_id),
 KEY ops_saihu_report_plan_due_idx(status,next_run_at,workspace_id,plan_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
