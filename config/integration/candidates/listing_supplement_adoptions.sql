-- Apply only after inspecting the production schema and rehearsing on a backup.
CREATE TABLE listing_supplement_adoptions (
 operation_id char(36) NOT NULL,
 workspace_id int NOT NULL, project_id int NOT NULL, user_id int NOT NULL,
 kind varchar(20) NOT NULL, version int NOT NULL,
 request_hash char(64) NOT NULL, previous_hash char(64) NULL,
 set_hash char(64) NOT NULL, set_json longtext NOT NULL, receipt_json longtext NOT NULL,
 created_at timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 PRIMARY KEY (operation_id),
 UNIQUE KEY supplement_adoption_version (workspace_id,project_id,kind,version)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
