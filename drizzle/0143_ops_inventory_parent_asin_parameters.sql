ALTER TABLE ops_inventory_planning_parameters
  MODIFY COLUMN scope_type ENUM('workspace', 'store_country', 'parent_asin', 'asin') NOT NULL DEFAULT 'workspace',
  ADD COLUMN parent_asin VARCHAR(20) NULL AFTER asin;

CREATE INDEX idx_ops_inventory_parameters_parent_scope
  ON ops_inventory_planning_parameters (workspaceId, user_id, scope_type, parent_asin, store_name, country, is_active);
