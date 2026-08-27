# 皇帝定时任务与领星MCP计划统一验收记录

**验收日期：** 2026-08-27  
**范围：** 工作空间1的ASIN日表现、FBA库存、广告关键词历史与父ASIN周汇总四项领星任务。

## 迁移结论

领星任务已登记为`emperor_scheduled_tasks`中的受系统管理任务实体，保留原有`ops_lingxing_sync_schedules`行和其Heartbeat任务UID作为唯一实际触发器。迁移未创建新的外部Cron；四个任务UID与平台侧任务一一对应，实际MCP读取继续仅通过`internal.lingxing.read`的Tool Gateway执行。

| 数据域 | 皇帝任务 | 外部Heartbeat UID | UTC Cron | 执行策略 |
| --- | --- | --- | --- | --- |
| `product_performance_daily` | 领星 · 每日ASIN产品表现 | `Gu5NVZ7EUCj3XERAfVUHdQ` | `0 0 9 * * *` | 完整校验后自动追加活跃日快照 |
| `fba_inventory` | 领星 · 每日FBA库存快照 | `jP7K82YktiNTnR9oKnL3zW` | `0 20 9 * * *` | 完整校验后自动追加库存历史事实 |
| `ad_keyword` | 领星 · 每日广告关键词历史 | `h8cBsYGGGzyMgdMLNfsEwt` | `0 40 9 * * *` | 完整校验后自动追加关键词历史事实 |
| `parent_asin_weekly_rollup` | 领星 · 父ASIN周汇总草稿 | `4rEeuGVc8r9WpCNJuD7bkV` | `0 10 9 * * 1` | 仅生成待审核周度草稿 |

## 前台验收

已登录会话中，皇帝“定时任务”页面从原先的0项显示为4项。选择“领星 · 每日ASIN产品表现”后，页面展示已启用状态、UTC Cron、上次运行、下次运行、最近批次`#30006`、数据域和唯一任务UID。页面仅提供“暂停/启用”和“查看同步审计”；不提供删除或即时触发，从而避免重复执行和重复写入。

领星同步页面的计划卡片已改为只读状态入口，统一跳转至皇帝“定时任务”中心管理，消除了第二个计划启停控制面。

## 验证边界

已通过的定向回归包括皇帝页面契约、领星页面契约、日同步路由和Heartbeat运行时，共33项。涉及文件ESLint无错误。完整`tsc --noEmit`仍会在当前沙箱中因资源限制而中止，未返回具体类型诊断；不据此宣称全量编译通过。

平台侧Heartbeat列表核验为4项，所有任务使用`/api/scheduled/lingxing-sync-draft`回调，均为启用状态。产品日表现的平台说明已同步更新为“校验通过自动追加活跃日快照”；四项任务的下次运行时间已通过原任务UID刷新，无新增外部触发器。

最终只读映射核验结果为4个皇帝系统任务、4个不同的Heartbeat UID、0个缺失UID、0个缺失计划映射、0个重复UID。ASIN日表现最近批次为`#30006`，父ASIN周汇总最近批次为`#30009`；库存和关键词任务为首次自然运行前的`idle`状态，未因迁移发生任何提前读取或写入。
