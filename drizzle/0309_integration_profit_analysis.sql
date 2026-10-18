-- P5 candidate only: NOT registered, executed, seeded or enabled.
-- Preserves the friend's per-user saved-report ownership; no cross-user sharing.
CREATE TABLE ops_profit_analysis_reports (
 id INT NOT NULL AUTO_INCREMENT PRIMARY KEY, workspace_id INT NOT NULL, user_id INT NOT NULL,
 scope_hash CHAR(64) NOT NULL, target_snapshot JSON NOT NULL, version INT NOT NULL,
 active_operation_id CHAR(36) NULL, latest_operation_id CHAR(36) NULL, saved_operation_id CHAR(36) NULL,
 created_at DATETIME(3) NOT NULL, updated_at DATETIME(3) NOT NULL, saved_at DATETIME(3) NULL,
 UNIQUE KEY uq_profit_report_scope(workspace_id,user_id,scope_hash)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
--> statement-breakpoint
CREATE TABLE ops_profit_analysis_runs (
 id INT NOT NULL AUTO_INCREMENT PRIMARY KEY, workspace_id INT NOT NULL, user_id INT NOT NULL,
 scope_hash CHAR(64) NOT NULL, target_snapshot JSON NOT NULL, operation_id CHAR(36) NOT NULL,
 request_hash CHAR(64) NULL, snapshot_hash CHAR(64) NULL, request_snapshot JSON NULL, snapshot JSON NULL,
 state ENUM('queued','dispatched','result_ready','succeeded','failed','canceled','unknown') NOT NULL,
 lease_token CHAR(36) NULL, lease_owner VARCHAR(128) NULL, attempt INT NOT NULL,
 lease_expires_at DATETIME(3) NULL, heartbeat_at DATETIME(3) NULL, dispatch_receipt JSON NULL,
 result_snapshot JSON NULL, result_hash CHAR(64) NULL, error_code VARCHAR(100) NULL,
 created_at DATETIME(3) NOT NULL, updated_at DATETIME(3) NOT NULL, completed_at DATETIME(3) NULL,
 UNIQUE KEY uq_profit_run_operation(workspace_id,user_id,operation_id),
 KEY ix_profit_run_history(workspace_id,user_id,scope_hash,id),
 KEY ix_profit_run_queue(state,lease_expires_at,id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
--> statement-breakpoint
CREATE TABLE ops_profit_analysis_save_operations (
 id INT NOT NULL AUTO_INCREMENT PRIMARY KEY, workspace_id INT NOT NULL, user_id INT NOT NULL,
 scope_hash CHAR(64) NOT NULL, target_snapshot JSON NOT NULL, save_operation_id CHAR(36) NOT NULL,
 run_operation_id CHAR(36) NULL, request_hash CHAR(64) NULL, request_snapshot JSON NULL,
 status ENUM('committed','canceled') NOT NULL, report_version INT NULL, result_hash CHAR(64) NULL, saved_at DATETIME(3) NULL,
 created_at DATETIME(3) NOT NULL,
 UNIQUE KEY uq_profit_save_operation(workspace_id,user_id,save_operation_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
