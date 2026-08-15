CREATE TABLE `ops_monthly_financial_profits` (
  `workspaceId` int NOT NULL,
  `id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `parent_asin` varchar(20) NOT NULL,
  `year_month` varchar(7) NOT NULL,
  `financial_profit` decimal(14,2) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `ops_monthly_financial_profit_unique` (`workspaceId`,`user_id`,`parent_asin`,`year_month`)
);
