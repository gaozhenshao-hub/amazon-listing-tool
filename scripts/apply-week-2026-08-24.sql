START TRANSACTION;
SET SESSION group_concat_max_len = 4096;
SELECT COUNT(*) INTO @parent_rows
FROM (
  SELECT parent_asin, store_name, country
  FROM ops_asin_daily_snapshots
  WHERE workspaceId = 1
    AND report_date BETWEEN '2026-08-24' AND '2026-08-30'
    AND source_type = 'lingxing_mcp'
    AND is_valid = 1
  GROUP BY parent_asin, store_name, country
) AS rollup_groups;

INSERT INTO data_imports (
  user_id, source_type, file_name, week_start_date, week_end_date, data_granularity,
  total_rows, imported_rows, skipped_rows, import_status,
  userId, sourceType, fileName, weekStartDate, weekEndDate, status, workspaceId
) VALUES (
  1, 'lingxing', '系统父ASIN周汇总-2026-08-24至2026-08-30', '2026-08-24', '2026-08-30', 'weekly',
  @parent_rows, @parent_rows, 0, 'completed',
  1, 'lingxing', '系统父ASIN周汇总-2026-08-24至2026-08-30', '2026-08-24', '2026-08-30', 'completed', 1
);
SET @import_id = LAST_INSERT_ID();

INSERT INTO lingxing_product_weekly (
  workspaceId, import_id, user_id, week_start_date, week_end_date, asin, parent_asin, msku,
  store_name, country, title, operator, product_name, sku,
  sales_qty, sales_amount, order_qty, order_profit, order_profit_margin,
  sessions_total, cvr, ad_cvr, organic_cvr, ad_orders, organic_orders,
  ad_clicks, ad_impressions, ctr, cpc, ad_spend, ad_sales, acos,
  return_qty, return_rate, fba_available, fba_in_transit
)
SELECT
  1, @import_id, 1, '2026-08-24', '2026-08-30',
  GROUP_CONCAT(DISTINCT asin ORDER BY asin SEPARATOR ','), parent_asin, MAX(NULLIF(msku, '')),
  store_name, country, MAX(NULLIF(title, '')), MAX(NULLIF(operator, '')), MAX(NULLIF(product_name, '')), MAX(NULLIF(sku, '')),
  SUM(COALESCE(sales_qty, 0)), SUM(COALESCE(sales_amount, 0)), SUM(COALESCE(order_qty, 0)), SUM(COALESCE(order_profit, 0)),
  CASE WHEN SUM(COALESCE(sales_amount, 0)) > 0 THEN ROUND(SUM(COALESCE(order_profit, 0)) / SUM(COALESCE(sales_amount, 0)) * 100, 4) ELSE NULL END,
  SUM(COALESCE(sessions_total, 0)),
  CASE WHEN SUM(COALESCE(sessions_total, 0)) > 0 THEN ROUND(SUM(COALESCE(order_qty, 0)) / SUM(COALESCE(sessions_total, 0)) * 100, 4) ELSE NULL END,
  CASE WHEN SUM(COALESCE(ad_clicks, 0)) > 0 THEN ROUND(SUM(COALESCE(ad_orders, 0)) / SUM(COALESCE(ad_clicks, 0)) * 100, 4) ELSE NULL END,
  NULL, SUM(COALESCE(ad_orders, 0)), SUM(COALESCE(organic_orders, 0)), SUM(COALESCE(ad_clicks, 0)), SUM(COALESCE(ad_impressions, 0)),
  CASE WHEN SUM(COALESCE(ad_impressions, 0)) > 0 THEN ROUND(SUM(COALESCE(ad_clicks, 0)) / SUM(COALESCE(ad_impressions, 0)) * 100, 4) ELSE NULL END,
  CASE WHEN SUM(COALESCE(ad_clicks, 0)) > 0 THEN ROUND(SUM(COALESCE(ad_spend, 0)) / SUM(COALESCE(ad_clicks, 0)), 4) ELSE NULL END,
  SUM(COALESCE(ad_spend, 0)), SUM(COALESCE(ad_sales, 0)),
  CASE WHEN SUM(COALESCE(ad_sales, 0)) > 0 THEN ROUND(SUM(COALESCE(ad_spend, 0)) / SUM(COALESCE(ad_sales, 0)) * 100, 4) ELSE NULL END,
  SUM(COALESCE(return_qty, 0)),
  CASE WHEN SUM(COALESCE(sales_qty, 0)) > 0 THEN ROUND(SUM(COALESCE(return_qty, 0)) / SUM(COALESCE(sales_qty, 0)) * 100, 4) ELSE NULL END,
  SUM(CASE WHEN report_date = (
    SELECT MAX(latest.report_date) FROM ops_asin_daily_snapshots AS latest
    WHERE latest.workspaceId = 1 AND latest.source_type = 'lingxing_mcp' AND latest.is_valid = 1
      AND latest.report_date BETWEEN '2026-08-24' AND '2026-08-30'
      AND latest.parent_asin = ops_asin_daily_snapshots.parent_asin
      AND latest.store_name = ops_asin_daily_snapshots.store_name
      AND latest.country = ops_asin_daily_snapshots.country
  ) THEN COALESCE(fba_available, 0) ELSE 0 END),
  SUM(CASE WHEN report_date = (
    SELECT MAX(latest.report_date) FROM ops_asin_daily_snapshots AS latest
    WHERE latest.workspaceId = 1 AND latest.source_type = 'lingxing_mcp' AND latest.is_valid = 1
      AND latest.report_date BETWEEN '2026-08-24' AND '2026-08-30'
      AND latest.parent_asin = ops_asin_daily_snapshots.parent_asin
      AND latest.store_name = ops_asin_daily_snapshots.store_name
      AND latest.country = ops_asin_daily_snapshots.country
  ) THEN COALESCE(fba_in_transit, 0) ELSE 0 END)
FROM ops_asin_daily_snapshots
WHERE workspaceId = 1
  AND report_date BETWEEN '2026-08-24' AND '2026-08-30'
  AND source_type = 'lingxing_mcp'
  AND is_valid = 1
GROUP BY parent_asin, store_name, country;

UPDATE ops_external_sync_rows
SET row_status = 'applied', selected = 1, applied_at = NOW()
WHERE batch_id = 90076 AND workspaceId = 1;

UPDATE ops_external_sync_batches
SET status = 'applied', applied_at = NOW(), applied_by = 1, error_message = NULL,
  summary = JSON_SET(COALESCE(summary, JSON_OBJECT()), '$.autoApplied', TRUE, '$.writePolicy', 'validated_weekly_auto_apply', '$.appliedRows', @parent_rows, '$.directSqlRecovery', TRUE)
WHERE id = 90076 AND workspaceId = 1 AND data_domain = 'parent_asin_weekly_rollup';
COMMIT;
