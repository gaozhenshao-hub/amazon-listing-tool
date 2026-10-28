CREATE TABLE IF NOT EXISTS ops_work_journals (
  id bigint unsigned NOT NULL AUTO_INCREMENT PRIMARY KEY,
  workspace_id int NOT NULL,
  owner_id int NOT NULL,
  kind varchar(12) NOT NULL,
  period_date date NOT NULL,
  content json NOT NULL,
  revision int unsigned NOT NULL DEFAULT 1,
  last_request_id varchar(36) NOT NULL,
  updated_by int NOT NULL,
  created_at datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY ops_journal_owner_period (workspace_id,owner_id,kind,period_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
