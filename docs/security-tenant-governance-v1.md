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
3. 按编号执行 `0114_security_tenant_governance_v1.sql`、`0115_data_lifecycle_artifacts_v1.sql`、`0116_ops_workspace_isolation.sql`、`0117_database_runtime_observability.sql`。
4. `0116` 会为大量运营表补列和索引，应在维护窗口执行并观察元数据锁、复制延迟与磁盘空间。
5. 重启 Web、AI Worker、Scheduler。
6. 验证默认 `organizations/default`、`workspaces/default` 和 `workspace_memberships` 已生成，且 `0116` 回填后不存在意外的空 workspace。
7. 确认 MySQL `performance_schema` 已启用，并仅授予应用账号读取 statement digest 汇总表的权限。
8. 验证 Tool、MCP、Agent、Project、File、Ops mutation 会产生 `security_audit_logs`。
9. 验证普通用户只能看到自己 workspace 范围内的项目、Agent、Tool/MCP 和运营数据。

## 回滚注意

此迁移新增表和列，不删除旧数据。若需要应用回滚，优先回滚应用版本；数据库可保留新增字段。不要直接删除 `workspaceId` 字段，否则新版本写入的审计、AI Job、Artifact、Tool Run 会丢失租户血缘。

## 已知边界

- `emperor_tools.slug`、`emperor_tool_secrets.slug`、`emperor_agents.slug` 当前仍保持全局唯一，避免破坏旧数据；后续如需每个 workspace 同名 Tool/Agent，需要单独迁移到 `(workspaceId, slug)` 复合唯一。
- 运营与广告表已统一补齐 `workspaceId`，写入通过 workspace 上下文自动绑定，查询与更新统一使用 `opsWorkspaceCondition`；AST 架构回归测试会拒绝未隔离的表查询。
