CREATE TABLE ops_north_america_editions (
 id int NOT NULL AUTO_INCREMENT,
 workspace_id int NOT NULL,
 month char(7) NOT NULL,
 payload longtext NOT NULL,
 payload_hash char(64) NOT NULL,
 created_at datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 updated_at datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 archived_at datetime(3) NULL,
 PRIMARY KEY(id), UNIQUE KEY north_board_month(workspace_id,month)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE ops_north_america_notes (
 workspace_id int NOT NULL, edition_id int NOT NULL,
 store_name varchar(200) NOT NULL, parent_asin varchar(20) NOT NULL,
 note text NOT NULL, version int NOT NULL,
 updated_by int NOT NULL, updated_at datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 PRIMARY KEY(workspace_id,edition_id,store_name,parent_asin)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
