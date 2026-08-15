ALTER TABLE `ops_inventory_planning_parameters`
  ADD COLUMN `estimated_dimensions` varchar(120) NULL,
  ADD COLUMN `actual_dimensions` varchar(120) NULL,
  ADD COLUMN `estimated_weight` decimal(10,3) NULL,
  ADD COLUMN `actual_weight` decimal(10,3) NULL,
  ADD COLUMN `dimension_unit` varchar(12) NOT NULL DEFAULT 'in',
  ADD COLUMN `weight_unit` varchar(12) NOT NULL DEFAULT 'lb';
