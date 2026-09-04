-- 父ASIN周报MCP：完整性通过后直接、幂等、可审计写入。
-- 不修改任何既有周事实、批次或失败状态；仅修正计划控制面自动应用标记。
UPDATE `ops_lingxing_sync_schedules`
SET `auto_apply` = 1
WHERE `data_domain` = 'parent_asin_weekly_mcp'
  AND `enabled` = 1;

UPDATE `emperor_scheduled_tasks`
SET `inputTemplate` = JSON_SET(
      COALESCE(`inputTemplate`, JSON_OBJECT()),
      '$.dataDomain', 'parent_asin_weekly_mcp',
      '$.autoApply', TRUE
    )
WHERE `dataDomain` = 'parent_asin_weekly_mcp'
  AND `systemManaged` = 1
  AND `isActive` = 1;
