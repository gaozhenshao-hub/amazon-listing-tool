# 生产上线完整 Runbook（0122-0130）

本文档适用于本轮 AI OS、产品开发 Agent、Artifact、Skill 治理、Job 恢复、自动归档与告警优化的生产发布。

## 1. 发布范围

本次发布包含：

- 产品开发七阶段 AI Job 与 `product-development.analysis.workflow` Agent 主链路
- Listing、图片、广告、视频和产品开发统一 Artifact 下游输入
- 皇帝数据库 Skill 作为业务 AI 的唯一运行入口和 Prompt 方案 A 治理
- Job 历史、取消、失败恢复、Worker 心跳与失败告警
- 自动数据归档、运行告警和真实 MySQL 集成测试
- Web、AI Worker、Scheduler 三种独立生产进程
- `0122_image_outline_reliability.sql` 至 `0130_ai_operations_runtime.sql`

## 2. 上线前硬性条件

以下任一项不满足时不得开始生产迁移：

- 已创建数据库全量备份，并实际验证可以恢复
- 已备份对象存储中的上传文件、图片和 Artifact 大对象
- 当前生产代码 commit、数据库版本和回滚 commit 已记录
- GitHub CI 的 TypeScript、单测、E2E、构建和真实 MySQL Gate 全部通过
- 生产环境已准备独立 Web、Worker、Scheduler 进程
- 所有进程使用同一个 `DATABASE_URL`、`JWT_SECRET` 和 Tool 密钥版本
- 发布窗口内暂停新建 AI 长任务，并等待正在执行的任务结束或主动取消

迁移前检查运行中任务：

```sql
SELECT status, COUNT(*) AS jobCount
FROM ai_jobs
WHERE status IN ('queued', 'running')
GROUP BY status;
```

迁移 `0125` 会归档并清理重复分析阶段。先记录预计影响量：

```sql
SELECT projectId, stageType, COUNT(*) AS duplicateCount
FROM dev_analysis_stages
GROUP BY projectId, stageType
HAVING COUNT(*) > 1;
```

## 3. 生产环境变量

### 必需变量

| 变量 | 要求 |
| --- | --- |
| `NODE_ENV` | 固定为 `production` |
| `DATABASE_URL` | MySQL 8 生产连接串；迁移账号需要 DDL 权限，运行账号建议最小权限 |
| `JWT_SECRET` | 稳定的高强度会话签名密钥，不得随部署变化 |
| `TOOL_SECRET_KEY` | 至少 32 字符，三个进程必须一致，不得原地替换 |
| `TOOL_SECRET_KEY_VERSION` | 当前密钥版本，例如 `v1` |
| `APP_PROCESS_ROLE` | 按进程设置为 `web`、`worker` 或 `scheduler` |

### Web 建议配置

```bash
APP_PROCESS_ROLE=web
AI_JOB_IN_PROCESS=false
REQUIRE_AI_JOB_WORKER=true
```

生产 Web 不应在请求进程中执行 AI 长任务。

### Worker 建议配置

```bash
APP_PROCESS_ROLE=worker
AI_JOB_RUNNER_MODE=worker
AI_JOB_MAX_CONCURRENCY=2
AI_JOB_WORKER_POLL_MS=5000
AI_JOB_WORKER_LIMIT=25
AI_JOB_WORKER_HEARTBEAT_MS=15000
AI_JOB_WORKER_STALE_MS=120000
AI_JOB_WORKER_SHUTDOWN_GRACE_MS=30000
AGENT_NODE_RECOVERY_LIMIT=50
```

先以低并发上线，再依据数据库连接池、模型限流和平均耗时逐步增加并发。

### Scheduler 建议配置

```bash
APP_PROCESS_ROLE=scheduler
SCHEDULER_LEADER_LOCK_NAME=amazon-listing-tool:scheduler
SCHEDULER_LEADER_LOCK_TIMEOUT_SECONDS=10
SCHEDULER_SHUTDOWN_GRACE_MS=10000
AI_OS_HEALTH_CHECK_INTERVAL_MS=300000
DATA_LIFECYCLE_SWEEP_INTERVAL_MS=86400000
DATA_LIFECYCLE_BATCH_SIZE=1000
AI_OS_FAILED_JOB_ALERT_THRESHOLD=1
AI_OS_ALERT_COOLDOWN_MS=21600000
```

可以运行多个 Scheduler 副本，但必须共享数据库和相同 leader lock 名称，只有持锁进程会启动定时器。

### 定时任务与通知

- 推荐配置 `SCHEDULED_TASK_SECRET`，外部调度请求通过 `x-scheduled-task-secret` 或 Bearer Token 发送。
- Manus Heartbeat 可同时配置 `SCHEDULED_TASK_UIDS` 白名单。
- Owner 告警通知需要 `OWNER_OPEN_ID`、`BUILT_IN_FORGE_API_URL` 和 `BUILT_IN_FORGE_API_KEY`。
- 未配置通知通道时告警仍会写入 `ai_operational_alerts`，但不会成功外发。

### Tool 密钥轮换

不要直接覆盖旧密钥。正确顺序：

1. 保留 `TOOL_SECRET_KEY_V1=<旧密钥>`。
2. 新增 `TOOL_SECRET_KEY_V2=<新密钥>`。
3. 将 `TOOL_SECRET_KEY_VERSION` 改为 `v2`。
4. 完成 secret 重加密并验证后，才能删除旧版本密钥。

直接更换 `TOOL_SECRET_KEY` 会导致历史 Tool secret 无法解密。

## 4. 构建与发布前验证

在准备发布的 commit 上执行：

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm check
pnpm lint
pnpm audit:business-skills
pnpm audit:domain-layers
pnpm test
pnpm test:e2e
pnpm build
pnpm db:migrate:plan
```

`db:migrate:plan` 只打印受控迁移及 checksum，不修改数据库。禁止修改已经在任何环境执行过的 SQL 文件。

## 5. 数据库迁移顺序

始终使用受控迁移器执行全部 pending migration，不要手工挑选 SQL：

```bash
NODE_ENV=production \
ALLOW_PRODUCTION_MIGRATIONS=true \
pnpm db:migrate
```

生产机的环境变量应由 Secret Manager 或部署平台注入，不要把密钥直接写进 shell history。

本轮迁移说明：

| 顺序 | 文件 | 主要影响与注意事项 |
| --- | --- | --- |
| 1 | `0122_image_outline_reliability.sql` | 更新皇帝图片大纲 Skill Prompt；确认数据库 Prompt 与代码审计一致 |
| 2 | `0123_dev_information_summary_jobs.sql` | 汇总分析增加 Job 状态字段；旧数据保持兼容 |
| 3 | `0124_product_development_workspace_security.sql` | 大量产品开发表补 `workspaceId` 并回填；数据量大时可能持锁，安排低峰窗口 |
| 4 | `0125_dev_stage_consistency.sql` | 重复阶段先写入 `dev_analysis_stage_conflicts` 再删除，并增加唯一索引 |
| 5 | `0126_product_analysis_stage_jobs.sql` | 七阶段迁移到皇帝 Skill 和持久化 Job |
| 6 | `0127_product_development_analysis_agent.sql` | 发布版本化产品开发 Agent 模板 |
| 7 | `0128_artifact_source_of_truth.sql` | 增加 Artifact 选择事件和消费溯源，统一下游版本输入 |
| 8 | `0129_business_skill_governance.sql` | 增加 Skill 版本、Prompt hash、Provider 和迁移来源治理字段 |
| 9 | `0130_ai_operations_runtime.sql` | 增加 Job 恢复关系和持久化运行告警表 |

迁移器使用 `app_schema_migrations` 保存状态和 checksum。执行后检查：

```sql
SELECT migrationName, LEFT(checksum, 12) AS checksum, status, error, finishedAt
FROM app_schema_migrations
ORDER BY createdAt DESC
LIMIT 12;
```

所有本轮迁移必须是 `succeeded`。不要通过 baseline 跳过失败迁移，也不要手工修改 ledger。

## 6. 进程部署与启动顺序

构建会产生三个独立入口：

```bash
pnpm build
```

- Web：`dist/index.js`
- Worker：`dist/aiWorker.js`
- Scheduler：`dist/scheduler.js`

推荐发布顺序：

1. 将 Web 切换到维护模式，停止旧 Worker 和旧 Scheduler。
2. 等待 Worker graceful shutdown，确认没有遗留 `running` Job。
3. 备份数据库和 Storage。
4. 执行 `pnpm db:migrate:plan` 并保存输出。
5. 使用一次性 migration process 执行 `pnpm db:migrate`。
6. 部署同一 commit 构建出的 Web、Worker、Scheduler Artifact。
7. 先启动至少一个 Worker：`pnpm start:worker:ai`。
8. 再启动 Scheduler：`pnpm start:scheduler`，确认获得 leader lock。
9. 最后启动 Web：`pnpm start`，再解除维护模式。

不得让不同 commit 的 Web、Worker、Scheduler 长时间混跑。

## 7. 上线后验收

### 基础健康检查

```bash
curl -fsS https://<host>/healthz
curl -fsS https://<host>/readyz
```

`readyz` 必须满足：数据库正常、环境校验通过、Tool 密钥有效。AI Queue 不健康会显示 warning，需要继续检查 Worker 心跳。

### Worker 与 Scheduler

- 皇帝可观测页面至少显示一个健康 Worker。
- `ai_job_workers` 的心跳持续更新，没有 stale Worker。
- Scheduler 日志包含成功获得 leader lock，其他副本应退出或保持不启动定时器。
- `ai_operational_alerts` 没有未处理的 critical 告警。
- 自动归档后 `ai_data_archive_runs` 出现成功记录。

### 核心业务冒烟

1. 产品开发：启动任一分析阶段，切换页面后任务继续，返回后可恢复并确认。
2. 产品开发 Agent：页面自动关联 Run，不要求用户输入原始 Run ID，Checkpoint 状态与业务页一致。
3. Listing：确认标题、五点、描述等节点后，下游读取 confirmed/current Artifact。
4. 图片建议：Step 2 能生成主图和辅图 2-7，A+ 模块选择、编辑、确认、重跑正常。
5. 广告与视频：AI Job 历史可见，失败任务可以恢复，旧失败记录仍保留。
6. Artifact：人工编辑产生新版本，切换或回滚版本后，下游重跑明确使用所选版本。
7. Tool：执行一个非生产破坏性的 Tool 测试，确认 secret ref 可以解密且调用日志完整。

## 8. 监控与告警

发布后至少持续观察 24 小时：

- Job queued/running 数量、平均等待时间、失败率、重试率和 dead letter 数量
- Worker healthy/stale/unhealthy 数量和最后心跳
- Agent waiting_human、failed、timeout 节点数量
- Skill Token、成本、平均耗时和 Prompt hash
- 人工编辑率、确认率和 Artifact 版本增长
- 归档成功率、归档行数、核心表行数趋势和慢查询
- MySQL 连接池、锁等待、CPU、磁盘和复制延迟

告警至少覆盖：

- 无健康 Worker
- Worker 心跳过期
- 最近一小时出现 dead letter
- 最近 24 小时归档失败
- 数据库迁移失败或 checksum 不一致
- `/readyz` 返回 503

## 9. 回滚策略

### 迁移前失败

- 不修改生产流量，修复代码或配置后重新验证。
- 不要修改已发布迁移文件的内容或 checksum。

### 迁移执行中失败

1. 保持维护模式，不启动新版本进程。
2. 保存 `app_schema_migrations.error`、数据库日志和失败 SQL。
3. 从快照恢复到迁移前数据库，或编写新的前向修复迁移。
4. 不得把失败记录手工改成 `succeeded`。

### 迁移成功但应用异常

- 优先修复配置、进程角色和 Worker/Scheduler 启动问题。
- 本轮表和字段多数为增量结构，必要时可回滚应用 commit 并保留新 schema，但必须先做兼容性验证。
- 不建议直接反向删除新表或字段。
- `0125` 清理的重复阶段保存在 `dev_analysis_stage_conflicts`，只能通过审计后的前向修复恢复。
- Tool 密钥问题必须恢复旧 key version，不能生成一个新密钥冒充旧版本。

### 紧急降级

- 停止 Worker 可暂停 AI 长任务消费，Web 仍可读取历史数据。
- 停止 Scheduler 可暂停自动归档和周期任务，不影响 Web 查询。
- 不要把 `AI_JOB_IN_PROCESS` 临时改回 `true` 作为生产补救，避免 Web 进程再次承载长任务。

## 10. 发布完成标准

- `0122` 至 `0130` 全部迁移成功且 checksum 一致
- Web `/readyz` 为 200
- 至少一个 Worker 健康并能完成一条真实 Job
- Scheduler leader lock 正常且归档任务成功
- 产品开发、Listing、图片、广告、视频冒烟通过
- Job 取消、失败恢复和 Artifact 版本回滚通过
- 皇帝 Skill 调用、成本和错误记录可查询
- 24 小时内无新增 critical 告警和异常数据增长
