# 系统架构 7 轮优化重新审计

审计日期：2026-08-04
审计基线：`origin/main` 与 `agent/ai-job-infra` 合并后的代码

## 结论

原差距报告基于 `ef4d6301`，没有包含后续 10 个架构重构提交，因此第 1、4、5、7 轮存在大量误报。当前系统已经具备生产运行时、领域目录、租户安全、生命周期归档、Human-in-the-loop 工作流组件和 AI OS 可观测看板。剩余工作集中在“迁移覆盖率”和“旧兼容层退出”，不是从零建设。

| 轮次 | 当前状态 | 仍需完成 |
| --- | --- | --- |
| 1. 生产底座 | 已完成 | 持续演练故障恢复；维护 Heartbeat UID/密钥配置 |
| 2. 数据库治理 | 已完成本轮 | Schema 已物理分域；根级 DB helper 已删除；核心 repository 与迁移回归门禁已建立 |
| 3. 领域边界 | 部分完成 | 拆分 `adAnalysis.ts`、`operations.ts`；继续拆分 Agent Runner、Tool Gateway 内部职责 |
| 4. 租户权限安全 | 已完成本轮 | 运营/广告表已补 workspace 列、上下文写入和查询过滤；继续扩大关键业务 audit 覆盖 |
| 5. 生命周期/Artifact | 主体完成 | Listing、图片、广告、视频的最终产物统一登记到 `ai_artifacts`；继续分流大 JSON/TEXT |
| 6. 前端工作流 | 部分完成 | 广告、视频、产品开发页面从本地步骤状态切换到 Agent Run/Checkpoint/Artifact |
| 7. 可观测/QA | 主体完成 | 增加真实慢查询采样；扩充真实数据库迁移回归套件 |

## 已确认完成

- 启动配置校验：`server/_core/startupValidation.ts`
- Web/Worker/Scheduler 分工与优雅停机：`server/_core/runtime.ts`、`aiWorker.ts`、`scheduler.ts`
- Scheduler leader lock：`server/_core/leaderLock.ts`
- `/healthz`、`/readyz`、DB/Queue/Tool Secret 检查：`server/_core/runtimeHealth.ts`
- 生产 Runbook：`docs/production-runtime-runbook.md`
- 领域目录：`server/domains/{ai_os,listing,image,ops}`
- Workspace、权限策略、审计日志、Secret rotation/ref：`0114_security_tenant_governance_v1.sql` 与安全治理服务
- Artifact/Storage、TTL/归档执行与归档指标：`0115_data_lifecycle_artifacts_v1.sql` 与 `artifactLifecycle.ts`
- Workflow Shell、Checkpoint 控件、Artifact 版本选择：`client/src/components/workflow`
- Worker、数据库行数、EXPLAIN、归档健康、迁移基线看板：`EmperorObservability.tsx`
- GitHub Actions QA Gate：`.github/workflows/qa-gate.yml`

## 本次补齐

1. 合并远端 `main`，保留 CI workflow、Agent 模板版本 UI、LLM AbortSignal 和 Heartbeat Worker Tick，同时保留本地更完整的 Runtime/Observability 实现。
2. 为 `/api/scheduled/*` 增加生产请求校验：支持 Manus Task UID、`SCHEDULED_TASK_UIDS` 白名单及 `SCHEDULED_TASK_SECRET`。
3. 修复 QA 脚本合并后的重复键；普通 QA 与 `*.real.test.ts` 真实数据库测试继续隔离。
4. 将 `TOOL_SECRET_KEY` 测试改为验证启动规则，不再要求 CI runner 注入生产密钥。

## 后续实施顺序

### P1 数据访问收口

1. Auth、project asset、listing、image helper 已迁入领域 repository，根级兼容文件已删除。
2. 表定义已迁入分域 schema，统一由 `drizzle/schema/index.ts` 聚合导出。
3. 把 migration 中已有的核心索引同步回 Drizzle schema，增加 schema drift 测试。
4. 为 Listing 保存、文件与 Artifact 登记、Agent Run 创建等复合写入补 transaction。

### P2 已完成领域拆分

1. `server/routers/adAnalysis.ts` 已变为领域路由组合入口。
2. `server/routers/operations.ts` 已变为领域路由组合入口。
3. Agent Runner 已拆为 executor/checkpoint/artifact/event/scheduler 协作服务。
4. Tool Gateway 已拆为 registry/secret/executor/policy/audit/circuit-breaker 协作服务。

### P3 业务接入收口

1. 运营域 repository 与路由已全量执行 workspace scope，并由 AST 架构回归测试阻止未隔离查询进入主分支。
2. Listing、图片、广告、视频最终结果统一注册 Artifact。
3. 广告、视频、智能产品开发页面接入 Agent Run/Checkpoint/Artifact，保留现有业务操作和展示能力。

### P4 运营质量

1. 已从 MySQL `performance_schema` 采样参数归一化的慢查询 digest、耗时与扫描行数，不记录原始参数。
2. CI 真实数据库门禁覆盖治理迁移、workspace 列与索引、慢查询采样落库；部署环境需配置专用 `CI_DATABASE_URL`。
3. 对归档任务、Worker stale recovery、Agent retry 做定期故障演练。
