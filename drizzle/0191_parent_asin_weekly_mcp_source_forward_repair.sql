-- 0190在本地开发库执行时未落地字段且被迁移账本标为failed；该文件为不可变前向修复。
-- 采用同一ALTER原子追加字段和索引，历史周事实不改写、不删除。
ALTER TABLE `lingxing_product_weekly`
  ADD COLUMN `source_kind` varchar(48) NOT NULL DEFAULT 'uploaded_parent_asin_weekly',
  ADD COLUMN `source_batch_id` int NULL,
  ADD COLUMN `source_trace_id` varchar(128) NULL,
  ADD COLUMN `source_schema_version` varchar(32) NULL,
  ADD INDEX `lingxing_product_weekly_source_period_idx` (`workspaceId`, `source_kind`, `week_start_date`, `week_end_date`),
  ADD INDEX `lingxing_product_weekly_source_batch_idx` (`workspaceId`, `source_batch_id`);

-- 复用既有周任务UID，避免创建第二个父ASIN周任务。
UPDATE `ops_lingxing_sync_schedules`
SET `data_domain` = 'parent_asin_weekly_mcp',
    `cadence` = 'weekly_parent_asin_mcp_report',
    `cron_expression` = '0 10 8 * * 1',
    `last_status` = 'idle',
    `last_error` = NULL
WHERE `data_domain` = 'parent_asin_weekly_rollup';

UPDATE `emperor_scheduled_tasks`
SET `slug` = CONCAT('lingxing-sync-parent_asin_weekly_mcp-workspace-', `workspaceId`),
    `name` = '领星 · 父ASIN周报',
    `description` = '北京时间每周一16:10读取上一自然周领星MCP父ASIN周报；完整性校验通过后直接幂等追加周事实，冲突或异常阻断并保留审计',
    `cronExpr` = '0 10 8 * * 1',
    `dataDomain` = 'parent_asin_weekly_mcp',
    `inputTemplate` = JSON_SET(COALESCE(`inputTemplate`, JSON_OBJECT()), '$.dataDomain', 'parent_asin_weekly_mcp')
WHERE `dataDomain` = 'parent_asin_weekly_rollup'
  AND `systemManaged` = 1;
