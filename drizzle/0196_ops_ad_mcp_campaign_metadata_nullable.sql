ALTER TABLE `ops_ad_mcp_campaign_daily_facts`
  MODIFY COLUMN `impressions` bigint,
  MODIFY COLUMN `clicks` bigint,
  MODIFY COLUMN `spend` decimal(14,2),
  MODIFY COLUMN `sales` decimal(14,2),
  MODIFY COLUMN `orders` int;
