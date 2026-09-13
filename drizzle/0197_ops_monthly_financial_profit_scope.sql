-- Non-destructive scope repair for the manual six-month financial-profit trend.
-- Legacy rows remain unscoped (NULL store_name/country) and are not auto-linked.
ALTER TABLE `ops_monthly_financial_profits`
  ADD COLUMN `store_name` varchar(200) NULL AFTER `parent_asin`,
  ADD COLUMN `country` varchar(50) NULL AFTER `store_name`;

ALTER TABLE `ops_monthly_financial_profits`
  DROP INDEX `ops_monthly_financial_profit_unique`;

CREATE UNIQUE INDEX `ops_monthly_financial_profit_unique`
  ON `ops_monthly_financial_profits` (`workspaceId`, `user_id`, `parent_asin`, `store_name`, `country`, `year_month`);
