CREATE TABLE IF NOT EXISTS ops_inventory_owner_assignments (
  workspaceId int NULL,
  id int NOT NULL AUTO_INCREMENT,
  parent_asin varchar(20) NOT NULL,
  store_name varchar(200) NOT NULL,
  country varchar(50) NOT NULL,
  assignee_user_id int NOT NULL,
  assignee_name varchar(200) NOT NULL,
  is_active int NOT NULL DEFAULT 1,
  created_by_user_id int NOT NULL,
  updated_by_user_id int NOT NULL,
  created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_ops_inventory_owner_assignment_scope (workspaceId, parent_asin, store_name, country),
  KEY idx_ops_inventory_owner_assignment_active (workspaceId, is_active, updated_at),
  KEY idx_ops_inventory_owner_assignment_assignee (workspaceId, assignee_user_id, is_active)
);

CREATE TABLE IF NOT EXISTS ops_inventory_owner_assignment_audits (
  workspaceId int NULL,
  id int NOT NULL AUTO_INCREMENT,
  assignment_id int NOT NULL,
  action enum('created', 'replaced', 'revoked') NOT NULL,
  previous_assignee_user_id int NULL,
  previous_assignee_name varchar(200) NULL,
  next_assignee_user_id int NULL,
  next_assignee_name varchar(200) NULL,
  reason varchar(500) NULL,
  changed_by_user_id int NOT NULL,
  created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_ops_inventory_owner_assignment_audit (workspaceId, assignment_id, created_at)
);
