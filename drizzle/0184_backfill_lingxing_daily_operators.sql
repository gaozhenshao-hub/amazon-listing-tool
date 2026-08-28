-- 已应用的领星日表现草稿原本已保留 principal_names，但旧归一化路径遗漏写入日快照 operator。
-- 仅补写空字段、仅使用单一负责人、并通过原始响应哈希严格关联同一批次；不触碰库存、销售及财务事实。
UPDATE ops_asin_daily_snapshots AS snapshot
JOIN ops_external_sync_batches AS batch
  ON batch.workspaceId = snapshot.workspaceId
 AND batch.raw_response_hash = snapshot.source_batch_hash
 AND batch.source = 'lingxing_mcp'
 AND batch.data_domain = 'product_performance_daily'
JOIN ops_external_sync_rows AS sync_row
  ON sync_row.workspaceId = batch.workspaceId
 AND sync_row.batch_id = batch.id
 AND JSON_UNQUOTE(JSON_EXTRACT(sync_row.source_data, '$.asin')) = snapshot.asin
 AND JSON_UNQUOTE(JSON_EXTRACT(sync_row.source_data, '$.sid')) = snapshot.source_store_id
 AND JSON_UNQUOTE(JSON_EXTRACT(sync_row.source_data, '$.rdate')) = snapshot.report_date
SET snapshot.operator = JSON_UNQUOTE(JSON_EXTRACT(sync_row.source_data, '$.principal_names[0]'))
WHERE snapshot.workspaceId IS NOT NULL
  AND snapshot.source_type = 'lingxing_mcp'
  AND (snapshot.operator IS NULL OR TRIM(snapshot.operator) = '')
  AND JSON_TYPE(JSON_EXTRACT(sync_row.source_data, '$.principal_names')) = 'ARRAY'
  AND JSON_LENGTH(JSON_EXTRACT(sync_row.source_data, '$.principal_names')) = 1
  AND JSON_UNQUOTE(JSON_EXTRACT(sync_row.source_data, '$.principal_names[0]')) IS NOT NULL
  AND TRIM(JSON_UNQUOTE(JSON_EXTRACT(sync_row.source_data, '$.principal_names[0]'))) <> '';
