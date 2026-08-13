ALTER TABLE `ops_inventory_planning_parameters`
  ADD COLUMN `product_cost` DECIMAL(10,2) NULL,
  ADD COLUMN `estimated_first_leg_cost` DECIMAL(10,2) NULL,
  ADD COLUMN `actual_first_leg_cost` DECIMAL(10,2) NULL,
  ADD COLUMN `estimated_fba_fee` DECIMAL(10,2) NULL,
  ADD COLUMN `actual_fba_fee` DECIMAL(10,2) NULL,
  ADD COLUMN `selling_price` DECIMAL(10,2) NULL,
  ADD COLUMN `currency` VARCHAR(8) NOT NULL DEFAULT 'USD';
