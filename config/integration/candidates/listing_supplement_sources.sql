-- UNREGISTERED CANDIDATE ONLY. Do not execute or add to the migration registry.
-- Independent private original storage; no automatic retention or business delete.
CREATE TABLE listing_supplement_sources (
 source_id char(36) NOT NULL,
 workspace_id int NOT NULL, project_id int NOT NULL, user_id int NOT NULL,
 kind varchar(20) NOT NULL, original_type varchar(20) NOT NULL,
 file_name varchar(255) NOT NULL, content_type varchar(160) NOT NULL,
 byte_size int NOT NULL, content_hash char(64) NOT NULL,
 provider varchar(8) NOT NULL, domain_hash char(64) NOT NULL, object_key varchar(500) NOT NULL,
 original_state varchar(20) NOT NULL, record_state varchar(20) NOT NULL,
 manifest_version int NOT NULL, manifest_hash char(64) NOT NULL,
 preview_status varchar(20) NOT NULL, reason_code varchar(120) NULL,
 created_at timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 updated_at timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
 PRIMARY KEY (source_id),
 KEY supplement_history (workspace_id,user_id,project_id,created_at,source_id),
 KEY supplement_content_fence (workspace_id,user_id,project_id,kind,original_type,content_hash,original_state)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE listing_supplement_manifests (
 source_id char(36) NOT NULL, version int NOT NULL,
 workspace_id int NOT NULL, project_id int NOT NULL, user_id int NOT NULL,
 manifest_hash char(64) NOT NULL, previous_hash char(64) NULL,
 manifest_json longtext NOT NULL,
 created_at timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 PRIMARY KEY (source_id,version)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE listing_supplement_operations (
 operation_key char(64) NOT NULL, operation_id char(36) NOT NULL,
 workspace_id int NOT NULL, project_id int NOT NULL, user_id int NOT NULL,
 source_id char(36) NULL, action varchar(20) NULL, request_hash char(64) NULL,
 state varchar(20) NOT NULL, prepared_json longtext NULL, receipt_json longtext NULL,
 created_at timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 updated_at timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
 PRIMARY KEY (operation_key), UNIQUE KEY supplement_operation_identity (workspace_id,user_id,operation_id),
 KEY supplement_pending_source (workspace_id,user_id,project_id,source_id,state)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
