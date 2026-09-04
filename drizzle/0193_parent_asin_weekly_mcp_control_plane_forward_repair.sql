-- 仅在0192字段已存在后追加索引，并迁移唯一父ASIN周任务的控制面；不改写历史周事实。
ALTER TABLE `lingxing_product_weekly`
  ADD INDEX `lingxing_product_weekly_source_period_idx` (`workspaceId`, `source_kind`, `week_start_date`, `week_end_date`),
  ADD INDEX `lingxing_product_weekly_source_batch_idx` (`workspaceId`, `source_batch_id`);

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
