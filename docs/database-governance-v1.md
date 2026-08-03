# Database Governance v1

本轮目标是把数据库从“表集合”推进到“数据平台”：领域入口清晰、核心写入可事务化、关系可审计、索引和归档有基线。

## 已落地

- `server/repositories/dbClient.ts`：统一 `getDb`、`requireDb`、`withDbTransaction`。
- `server/repositories/ai_os`：AI Job 队列、worker、dead letter 读写已从 `server/db.ts` 抽离。
- `server/repositories/project`：项目增删改查、管理员项目列表已从 `server/db.ts` 抽离；删除项目使用事务保护。
- `drizzle/schema/{auth,project,listing,image,ads,ops,ai_os}.ts`：按领域提供 schema 导入入口，当前仍复用 `drizzle/schema.ts` 作为兼容源。
- `drizzle/relations.ts`：补齐用户、项目、Listing、图片工作流、AI OS、Tool Run 的 Drizzle relations 基线。
- `server/repositories/dbGovernance.ts`：机器可读的 domain、软 FK、索引、归档策略基线。
- `auditSoftForeignKeys()`：可执行的软 FK 孤儿数据审计入口，上线前可按策略逐项检查。
- `drizzle/0113_database_governance_v1.sql`：热路径索引基线迁移。

## 领域边界

| Domain | Schema | Repository | 当前策略 |
| --- | --- | --- | --- |
| auth | `drizzle/schema/auth` | `server/repositories/auth` | legacy compat |
| project | `drizzle/schema/project` | `server/repositories/project` | repository required |
| listing | `drizzle/schema/listing` | `server/repositories/listing` | legacy compat |
| image | `drizzle/schema/image` | `server/repositories/image` | legacy compat |
| ads | `drizzle/schema/ads` | `server/repositories/ads` | legacy compat |
| ops | `drizzle/schema/ops` | `server/repositories/ops` | legacy compat |
| ai_os | `drizzle/schema/ai_os` | `server/repositories/ai_os` | repository required |

`legacy compat` 表示还保留 `server/db.ts` 兼容出口，避免一次性迁移所有业务路由造成大面积回归；新增和重构代码应优先走对应 repository。

## 关系策略

本轮选择“软 FK 优先”：在 repository、Agent 状态机、worker runtime 中做存在性和所有权校验，并用 `drizzle/relations.ts` 建立类型层关系。暂不直接给历史表批量加硬 FK，原因是当前库已有大量历史迁移和跨模块表，生产上需要先跑孤儿数据审计，避免上线时锁表或失败。

下一步硬 FK 的推荐顺序：

1. 新表和增长中的 AI OS 表先补硬 FK。
2. 项目域核心表先审计孤儿数据，再按低峰期加 FK。
3. 广告和运营高增长明细表保留软 FK，优先靠 upload/user/date 维度治理。

## 索引基线

索引规范按四类字段建立：`userId/projectId/status/createdAt/reportDate`。

已进入迁移的热路径：

- 项目列表：`projects(userId,status,updatedAt)`、`projects(status,createdAt)`
- Listing 前置数据：`projectFiles(projectId,fileType,status,createdAt)`、`keywords(projectId,status,createdAt)`
- 图片工作流：`image_workflow_sessions(projectId,userId,status,updatedAt)`
- AI OS：`ai_jobs(projectId,status,createdAt)`、`emperor_agent_runs(userId,status,createdAt)`、`emperor_agent_events(eventType,createdAt)`
- 广告报表：上传记录、周报、日报按 `user_id` + 日期/周期 + `product_id`
- 运营报表：领星/赛狐周报按 `user_id` + `week_start_date`；`asin` 字段长度较大，不直接进入复合索引，后续如需要 ASIN 精确检索，应补 `asin_hash` 短列。

上线前建议在生产执行 `EXPLAIN` 验证最常用查询是否命中新索引，尤其是广告报表和运营周报。

## 归档策略

高增长表不建议永久留在热表：

- `emperor_agent_events`：30 天热数据，90 天后归档，365 天后可删除明细。
- `ai_jobs`、`emperor_tool_runs`：90 天热数据，180 天后归档，730 天后可删除明细。
- 广告搜索词/日报明细：180 天热数据，365 天后归档。
- 领星/赛狐周报：365 天热数据，730 天后归档，保留年度同比窗口。

归档实现建议用单独 worker 或数据库定时任务：先写 archive 表或对象存储，再批量删除热表，批量大小控制在 1,000 到 5,000 行。

## 剩余债务

- `server/db.ts` 仍承担 Auth、Listing、Image 的历史兼容出口。
- `server/devDb.ts`、`server/kbDb.ts`、`server/offsiteDb.ts` 仍是独立 DB helper，后续应按 project/ops/kb/offsite 域继续收口。
- 硬 FK 尚未直接落库，需要生产孤儿数据审计后分批执行。
- 归档策略已标准化，但归档 worker 尚未实现。
