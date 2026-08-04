# Security Tenant Governance v1

## 目标

第 4 轮把系统从粗粒度角色控制升级到租户、资源、动作三层治理：

- Tenant: `organizations` -> `workspaces` -> `workspace_memberships`
- Permission: `resource.action` 权限矩阵，支持 DB policy 覆盖
- Audit: 关键写操作进入 `security_audit_logs`
- Secret: Tool secret 强制使用 `secret://slug` 或 `env:NAME`，支持 key version 和轮换

## 权限矩阵

资源定义在 `shared/const.ts`：

| Resource | 说明 | 典型动作 |
| --- | --- | --- |
| `project` | Listing/项目资产 | `read/create/update/delete/assign` |
| `file` | 项目文件、解析结果、版本 | `read/upload/update/delete/import/export` |
| `tool` | Tool、MCP、Tool secret | `read/create/update/delete/invoke/manage_secret/rotate_secret` |
| `agent` | Agent、Run、Checkpoint、Artifact、模板 | `read/create/update/delete/run/confirm/cancel` |
| `ops_data` | 运营域数据 | `read/import/export/update/delete/sync` |

静态矩阵是默认安全基线；`role_permissions` 可继续承接旧菜单权限；`security_access_policies` 用于 workspace/resource 级 allow/deny 覆盖，deny 优先。

## 租户模型

新增核心表：

- `organizations`: 公司/组织层
- `workspaces`: 工作区层，后续团队、品牌线、事业部可以落在这里
- `workspace_memberships`: 用户与 workspace 的角色/成员关系
- `security_access_policies`: action 级策略
- `security_audit_logs`: 关键操作审计
- `emperor_secret_key_versions`: Tool/Model/System secret key version 元数据

核心高价值表新增 `workspaceId`，包括：

- 项目与文件：`projects`, `projectFiles`, `project_assignments`
- AI OS：`ai_jobs`, `ai_job_dead_letters`, `emperor_skills`, `emperor_skill_runs`, `emperor_agents`, `emperor_agent_template_versions`, `emperor_agent_runs`, `emperor_agent_checkpoints`, `emperor_agent_events`, `emperor_agent_artifacts`, `emperor_tools`, `emperor_tool_runs`, `emperor_tool_secrets`, `emperor_ai_os_metrics`, `emperor_ai_os_evaluations`, `emperor_knowledge`, `emperor_mcp_connectors`, `emperor_model_providers`

读取策略：当前 workspace + 全局记录 (`workspaceId IS NULL`)。写入策略：新建项目、文件、Agent Run、Checkpoint、Artifact、Tool Run、Skill Run、AI Job、审计与指标尽量写当前 workspace。

用户创建/导入链路会自动确保默认 `organizations/default`、`workspaces/default` 和 `workspace_memberships` 存在，避免迁移后新增账号没有工作区导致只能看到全局记录。

## Secret 规范

生产环境必须配置：

```bash
TOOL_SECRET_KEY=...
TOOL_SECRET_KEY_VERSION=v1
```

轮换时：

```bash
TOOL_SECRET_KEY_V2=...
TOOL_SECRET_KEY_VERSION=v2
```

然后调用 `emperor.tools.rotateSecret` 逐个重加密 Tool secret。Tool/MCP 配置中的敏感字段必须使用：

- `secret://seller_sprite_api`
- `env:SELLER_SPRITE_API_KEY`
- `${secret:seller_sprite_api}`
- `${env:SELLER_SPRITE_API_KEY}`

明文 `apiKey/token/password/secret` 会被 Tool Gateway 拒绝。

## 上线顺序

1. 备份生产数据库。
2. 配置稳定的 `TOOL_SECRET_KEY` 和 `TOOL_SECRET_KEY_VERSION`。
3. 禁止继续执行 `full_migrate.mjs` 或 `run_all_migrations.mjs`。迁移只能由独立的一次性部署任务执行，Web、Worker、Scheduler 启动过程不得自动改表。
4. 首次切换到新迁移账本且生产库已手工执行至 `0117` 时，先核验数据库结构，再执行一次受控 baseline：

```bash
NODE_ENV=production \
ALLOW_PRODUCTION_MIGRATIONS=true \
ALLOW_PRODUCTION_MIGRATION_BASELINE=true \
MIGRATION_BASELINE_CONFIRM=I_UNDERSTAND_SCHEMA_BASELINE \
MIGRATION_BASELINE_THROUGH=0117_database_runtime_observability.sql \
MIGRATION_BASELINE_REASON="verified production schema before controlled ledger cutover" \
pnpm db:migrate:baseline
```

5. 后续版本先查看迁移计划，再由单个迁移任务执行：

```bash
pnpm db:migrate:plan
NODE_ENV=production ALLOW_PRODUCTION_MIGRATIONS=true pnpm db:migrate
```

迁移入口会获取 MySQL advisory lock，并在 `app_schema_migrations` 中记录文件名、SHA-256、开始/完成时间、状态和错误。失败后必须检查数据库状态并采用向前修复；不得删除或伪造迁移记录。已执行迁移文件的校验和不可修改。

6. 新环境由同一入口按受控清单执行全部迁移。已有环境不得在未核验结构时直接 baseline。
7. `0114` 至 `0117` 包含租户、安全、生命周期和数据库观测结构。
8. `0116` 会为大量运营表补列和索引，应在维护窗口执行并观察元数据锁、复制延迟与磁盘空间。
9. 重启 Web、AI Worker、Scheduler。
10. 验证默认 `organizations/default`、`workspaces/default` 和 `workspace_memberships` 已生成，且 `0116` 回填后不存在意外的空 workspace。
11. 确认 MySQL `performance_schema` 已启用，并仅授予应用账号读取 statement digest 汇总表的权限。
12. 验证 Tool、MCP、Agent、Project、File、Ops mutation 会产生 `security_audit_logs`。
13. 验证普通用户只能看到自己 workspace 范围内的项目、Agent、Tool/MCP 和运营数据。

## 缓存与外部请求

- 广告分析、运营广告、店铺列表和评分进度缓存均由请求上下文强制注入 tenant/workspace/user 作用域；禁止业务模块新增模块级业务缓存 `Map`。
- 当前进程内缓存具备 TTL、容量上限和 LRU 淘汰。多 Web 实例只把它作为可丢弃的读取加速层，不得依赖本机缓存维持业务正确性。
- 多实例部署可将 Redis 客户端注入 `DistributedScopedCache`。缓存 key 同时包含 tenant/workspace/user/namespace，用户失效和 workspace 全量失效通过 Redis generation counter 跨实例传播，不依赖 `SCAN`。
- Tool、MCP、Crawler、文件下载、Webhook、模型、OAuth、知识库导入和跨实例同步统一经过 Safe HTTP Client，逐次校验协议、凭据、域名允许列表、全部 A/AAAA 解析结果、重定向目标、超时和响应大小。
- 生产环境建议配置 `SAFE_HTTP_MAX_CONCURRENCY`，并在云防火墙层禁止访问 metadata endpoint 与内部服务网段。
- `allowPrivateNetwork` 只允许用于经过安全审查的内部 Tool；面向用户参数的 Tool 必须保持关闭，并优先配置 `allowedHosts` 或 `allowedHostSuffixes`。
- 生产 OAuth 服务位于私网时必须显式配置 `OAUTH_ALLOW_PRIVATE_NETWORK=true`；公网 OAuth 不应开启该选项。
- 自定义模型网关位于私网时必须显式配置 `MODEL_PROVIDER_ALLOW_PRIVATE_NETWORK=true`；公网模型不应开启该选项。
- 单元测试默认禁止真实网络访问。仅真实集成测试可显式设置 `ALLOW_REAL_NETWORK_IN_TESTS=1`，CI 单元门禁不得设置该变量。
- `networkEgressArchitecture.test.ts` 会阻止服务端重新引入裸 `fetch`、`axios`、`http.request`、`https.request` 或 shell `curl/wget`。

## 迁移回归门禁

- `loadMigrationPlan` 会扫描 `drizzle/*.sql`，任何未加入受控发布计划的新迁移都会直接失败，新增 `0118+` 时必须同步登记。
- GitHub `real-db-gate` 会启动一次性 MySQL 8 服务，先从空库执行完整 `pnpm db:migrate`，再运行真实数据库回归测试。
- 迁移 Runner 的真实用例覆盖空库、增量升级、失败留痕、禁止隐式重试、checksum 漂移、baseline 和并发 advisory lock。
- 本地没有 MySQL 时可只运行单元门禁；合并前必须以 GitHub `real-db-gate` 通过为准。

## 回滚注意

此迁移新增表和列，不删除旧数据。若需要应用回滚，优先回滚应用版本；数据库可保留新增字段。不要直接删除 `workspaceId` 字段，否则新版本写入的审计、AI Job、Artifact、Tool Run 会丢失租户血缘。

## 已知边界

- `emperor_tools.slug`、`emperor_tool_secrets.slug`、`emperor_agents.slug` 当前仍保持全局唯一，避免破坏旧数据；后续如需每个 workspace 同名 Tool/Agent，需要单独迁移到 `(workspaceId, slug)` 复合唯一。
- 运营与广告表已统一补齐 `workspaceId`，写入通过 workspace 上下文自动绑定，查询与更新统一使用 `opsWorkspaceCondition`；AST 架构回归测试会拒绝未隔离的表查询。
