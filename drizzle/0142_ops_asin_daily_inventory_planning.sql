ALTER TABLE `data_imports`
  ADD COLUMN `data_granularity` ENUM('weekly','daily') NOT NULL DEFAULT 'weekly' AFTER `week_end_date`;

ALTER TABLE `data_imports`
  ADD COLUMN `replaces_import_id` INT NULL AFTER `data_granularity`;

ALTER TABLE `data_imports`
  ADD COLUMN `superseded_at` TIMESTAMP NULL AFTER `replaces_import_id`;

CREATE TABLE IF NOT EXISTS `ops_asin_daily_snapshots` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `workspaceId` INT NULL,
  `import_id` INT NOT NULL,
  `user_id` INT NOT NULL,
  `source_type` VARCHAR(20) NOT NULL DEFAULT 'lingxing',
  `report_date` VARCHAR(10) NOT NULL,
  `asin` VARCHAR(20) NOT NULL,
  `parent_asin` VARCHAR(20) NOT NULL,
  `store_name` VARCHAR(200) NOT NULL,
  `country` VARCHAR(50) NOT NULL,
  `msku` VARCHAR(200) NULL,
  `sku` VARCHAR(200) NULL,
  `title` VARCHAR(1000) NULL,
  `product_name` VARCHAR(500) NULL,
  `brand` VARCHAR(200) NULL,
  `category1` VARCHAR(200) NULL,
  `category2` VARCHAR(200) NULL,
  `category3` VARCHAR(200) NULL,
  `operator` VARCHAR(200) NULL,
  `created_time` VARCHAR(50) NULL,
  `sales_qty` INT NOT NULL DEFAULT 0,
  `order_qty` INT NOT NULL DEFAULT 0,
  `sales_amount` DECIMAL(14,2) NOT NULL DEFAULT 0,
  `net_sales_amount` DECIMAL(14,2) NOT NULL DEFAULT 0,
  `order_profit` DECIMAL(14,2) NOT NULL DEFAULT 0,
  `ad_spend` DECIMAL(14,2) NOT NULL DEFAULT 0,
  `ad_sales` DECIMAL(14,2) NOT NULL DEFAULT 0,
  `ad_orders` INT NOT NULL DEFAULT 0,
  `organic_orders` INT NOT NULL DEFAULT 0,
  `sessions_total` INT NOT NULL DEFAULT 0,
  `ad_clicks` INT NOT NULL DEFAULT 0,
  `ad_impressions` INT NOT NULL DEFAULT 0,
  `return_qty` INT NOT NULL DEFAULT 0,
  `fba_available` INT NOT NULL DEFAULT 0,
  `fba_in_transit` INT NOT NULL DEFAULT 0,
  `fba_plan_inbound` INT NOT NULL DEFAULT 0,
  `fba_total` INT NOT NULL DEFAULT 0,
  `available_stock` INT NOT NULL DEFAULT 0,
  `fbm_available` INT NOT NULL DEFAULT 0,
  `awd_available` INT NOT NULL DEFAULT 0,
  `awd_in_transit` INT NOT NULL DEFAULT 0,
  `overseas_available` INT NOT NULL DEFAULT 0,
  `source_local_available` INT NOT NULL DEFAULT 0,
  `source_row_hash` VARCHAR(64) NOT NULL,
  `is_valid` TINYINT NOT NULL DEFAULT 1,
  `validation_reason` TEXT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_ops_asin_daily_snapshot` (`workspaceId`, `source_type`, `report_date`, `asin`, `store_name`, `country`),
  KEY `idx_ops_asin_daily_parent_date` (`workspaceId`, `parent_asin`, `store_name`, `country`, `report_date`),
  KEY `idx_ops_asin_daily_import` (`import_id`)
);

CREATE TABLE IF NOT EXISTS `ops_local_inventory_adjustments` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `workspaceId` INT NULL,
  `user_id` INT NOT NULL,
  `asin` VARCHAR(20) NOT NULL,
  `store_name` VARCHAR(200) NOT NULL,
  `country` VARCHAR(50) NOT NULL,
  `effective_date` VARCHAR(10) NOT NULL,
  `local_qty` INT NOT NULL,
  `reason` VARCHAR(500) NULL,
  `status` ENUM('draft','confirmed','superseded') NOT NULL DEFAULT 'draft',
  `confirmed_by` INT NULL,
  `confirmed_at` TIMESTAMP NULL,
  `superseded_by_id` INT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_ops_local_inventory_current` (`workspaceId`, `asin`, `store_name`, `country`, `status`, `effective_date`)
);

CREATE TABLE IF NOT EXISTS `ops_inventory_planning_parameters` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `workspaceId` INT NULL,
  `user_id` INT NOT NULL,
  `scope_type` ENUM('workspace','store_country','asin') NOT NULL DEFAULT 'workspace',
  `asin` VARCHAR(20) NULL,
  `store_name` VARCHAR(200) NULL,
  `country` VARCHAR(50) NULL,
  `production_days` INT NOT NULL DEFAULT 30,
  `shipping_days` INT NOT NULL DEFAULT 30,
  `buffer_days` INT NOT NULL DEFAULT 10,
  `target_cover_days` INT NOT NULL DEFAULT 30,
  `moq` INT NOT NULL DEFAULT 0,
  `pack_size` INT NOT NULL DEFAULT 1,
  `is_active` TINYINT NOT NULL DEFAULT 1,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_ops_inventory_parameter_scope` (`workspaceId`, `scope_type`, `asin`, `store_name`, `country`, `is_active`)
);

CREATE TABLE IF NOT EXISTS `ops_replenishment_plans` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `workspaceId` INT NULL,
  `user_id` INT NOT NULL,
  `asin` VARCHAR(20) NOT NULL,
  `store_name` VARCHAR(200) NOT NULL,
  `country` VARCHAR(50) NOT NULL,
  `planned_qty` INT NOT NULL,
  `estimated_available_date` VARCHAR(10) NOT NULL,
  `notes` TEXT NULL,
  `status` ENUM('draft','confirmed','cancelled','completed') NOT NULL DEFAULT 'draft',
  `confirmed_by` INT NULL,
  `confirmed_at` TIMESTAMP NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_ops_replenishment_plan` (`workspaceId`, `asin`, `store_name`, `country`, `status`, `estimated_available_date`)
);

CREATE TABLE IF NOT EXISTS `ops_inventory_planning_versions` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `workspaceId` INT NULL,
  `user_id` INT NOT NULL,
  `version` INT NOT NULL,
  `source_as_of_date` VARCHAR(10) NOT NULL,
  `status` ENUM('draft','confirmed','superseded') NOT NULL DEFAULT 'draft',
  `input_snapshot` JSON NOT NULL,
  `result_snapshot` JSON NOT NULL,
  `confirmed_by` INT NULL,
  `confirmed_at` TIMESTAMP NULL,
  `superseded_at` TIMESTAMP NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_ops_inventory_planning_version` (`workspaceId`, `version`),
  KEY `idx_ops_inventory_planning_status` (`workspaceId`, `status`, `source_as_of_date`)
);
