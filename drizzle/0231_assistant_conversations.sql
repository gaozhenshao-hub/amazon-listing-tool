-- Explicit P5-A candidate only. Not registered, executed, seeded, or enabled by importing code.
-- Private tables deliberately do not reuse generic conversation/ai_jobs endpoints.
CREATE TABLE assistant_conversation_threads (
 id INT NOT NULL AUTO_INCREMENT PRIMARY KEY, workspace_id INT NOT NULL, user_id INT NOT NULL,
 thread_id CHAR(36) NOT NULL, agent_key VARCHAR(32) NOT NULL, title VARCHAR(80) NOT NULL,
 creation_hash CHAR(64) NOT NULL, version INT NOT NULL, next_sequence INT NOT NULL, active_turn CHAR(36) NULL,
 created_at DATETIME(3) NOT NULL, updated_at DATETIME(3) NOT NULL,
 UNIQUE KEY uq_assistant_thread_identity(workspace_id,user_id,thread_id),
 KEY ix_assistant_thread_history(workspace_id,user_id,agent_key,id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
--> statement-breakpoint
CREATE TABLE assistant_conversation_turns (
 id INT NOT NULL AUTO_INCREMENT PRIMARY KEY, workspace_id INT NOT NULL, user_id INT NOT NULL,
 operation_id CHAR(36) NOT NULL, thread_id CHAR(36) NOT NULL, agent_key VARCHAR(32) NOT NULL,
 sequence INT NULL, expected_thread_version INT NULL, request_hash CHAR(64) NULL, snapshot_hash CHAR(64) NULL,
 mode ENUM('work','coach') NULL, request_snapshot JSON NULL, configuration_snapshot JSON NULL, runtime_snapshot JSON NULL,
 state ENUM('queued','route_dispatched','route_ready','reply_dispatched','reply_ready','succeeded','failed','canceled','unknown') NOT NULL,
 lease_token CHAR(36) NULL, lease_owner VARCHAR(128) NULL, attempt INT NOT NULL,
 lease_expires_at DATETIME(3) NULL, heartbeat_at DATETIME(3) NULL,
 route_dispatch JSON NULL, route_result JSON NULL, reply_dispatch JSON NULL, reply_result JSON NULL, proposal JSON NULL,
 error_code VARCHAR(100) NULL, created_at DATETIME(3) NOT NULL, updated_at DATETIME(3) NOT NULL, completed_at DATETIME(3) NULL,
 UNIQUE KEY uq_assistant_turn_operation(workspace_id,user_id,operation_id),
 UNIQUE KEY uq_assistant_turn_sequence(workspace_id,user_id,thread_id,sequence),
 KEY ix_assistant_turn_queue(state,lease_expires_at,id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
--> statement-breakpoint
CREATE TABLE assistant_conversation_attachments (
 id INT NOT NULL AUTO_INCREMENT PRIMARY KEY, workspace_id INT NOT NULL, user_id INT NOT NULL,
 operation_id CHAR(36) NOT NULL, ordinal INT NOT NULL, file_name VARCHAR(180) NOT NULL, mime_type VARCHAR(128) NOT NULL,
 byte_size INT NOT NULL, content_hash CHAR(64) NOT NULL, original_bytes MEDIUMBLOB NOT NULL, extraction JSON NOT NULL,
 created_at DATETIME(3) NOT NULL,
 UNIQUE KEY uq_assistant_attachment_ordinal(workspace_id,user_id,operation_id,ordinal)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
