-- 父ASIN周事实增加来源追溯字段；历史上传和日快照聚合记录保持原样并显式归为上传周表来源。
ALTER TABLE `lingxing_product_weekly`
  ADD COLUMN `source_kind` varchar(48) NOT NULL DEFAULT 'uploaded_parent_asin_weekly' AFTER `user_id`,
  ADD COLUMN `source_batch_id` int NULL AFTER `source_kind`,
  ADD COLUMN `source_trace_id` varchar(128) NULL AFTER `source_batch_id`,
  ADD COLUMN `source_schema_version` varchar(32) NULL AFTER `source_trace_id`;

CREATE INDEX `lingxing_product_weekly_source_period_idx`
  ON `lingxing_product_weekly` (`workspaceId`, `source_kind`, `week_start_date`, `week_end_date`);

CREATE INDEX `lingxing_product_weekly_source_batch_idx`
  ON `lingxing_product_weekly` (`workspaceId`, `source_batch_id`);

-- 将控制面唯一周任务从“日快照汇总”原子地迁移到“官方MCP父ASIN周报”，复用既有任务UID，
-- 因此不会新增第二个定时器。旧事实与旧同步批次都不改写。
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
