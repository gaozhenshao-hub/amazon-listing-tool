# Data Lifecycle & Artifact System v2

## 目标

第 5 轮把 AI 输出和大内容从“散落在业务表的大 JSON/TEXT 字段”升级为统一产物索引：

- `ai_artifacts`: Listing、图片、广告、视频、Agent 的统一产物索引和版本 current 指针
- `ai_storage_objects`: 文件、图片、长文本、归档包的统一 Storage 引用
- `ai_data_archive_runs` / `ai_data_archive_items`: 高增长数据归档执行记录

业务表保留最终业务快照和短预览；已确认/current Artifact 是下游 AI 的真实输入源。

## Artifact 规范

Artifact 是可复用资产，不只是 checkpoint 附属字段。

核心字段：

| 字段 | 说明 |
| --- | --- |
| `domain` | `listing/image/ads/video/agent/project/file/ops/tool/other` |
| `artifactKey` | 业务稳定 key，例如 `project_file.product_attributes.analysis` |
| `artifactType` | `json/text/markdown/html/image/file/table/video/audio/other` |
| `sourceType` | `upload/ai_output/user_edit/import/tool_output/system/archive` |
| `sourceTable/sourceRowId` | 产物来源表和行 ID |
| `version/isCurrent` | 版本号和下游默认引用指针 |
| `contentJson/searchableText/summary` | 可查询或可预览内容 |
| `storageObjectId/storageUri` | 大文件、图片、长文本的 Storage 引用 |
| `retentionClass/archiveAfter/deleteAfter` | 冷热分层和 TTL |

引用格式：

```text
ai-artifact://{artifactId}@{version}
ai-artifact-scope://{base64url(scope)}@current
storage://forge/{objectKey}
```

## Storage 规范

大文件和长内容优先进入 Storage：

- 原始上传文件：保留完整 Storage 对象，热表只保留截断预览和 hash
- parsed JSON：超过业务热字段承载能力时写入 Storage，并登记 `parsedStorageUri`
- AI 输出：小结果可内联到 `contentJson`；长文本、图片、视频只在 artifact 中保留摘要和 `storageUri`

当前已接入：

- ProjectFile 上传：raw artifact + storage object
- ProjectFile parsed data：parsed artifact + 可选 parsed storage
- ProjectFile AI 分析：analysis artifact，AI 输出版本化
- ProjectFile 人工编辑/恢复：user_edit artifact，更新 current 指针
- Agent Artifact：镜像登记到 `ai_artifacts`
- 产品开发、Listing、图片、广告、视频：统一解析 confirmed/current Artifact
- `ai_artifact_selection_events`：记录选择、确认和回滚指针历史
- `ai_artifact_consumptions`：记录每次 Job/Skill/业务操作实际消费的精确版本

`@current` 使用稳定谱系引用，切换版本后会跟随 current 指针。运行审计始终保存
`ai-artifact://{artifactId}@{version}` 精确引用，保证历史结果可复现。

## 上线

先执行 `pnpm db:migrate` 应用 `0128_artifact_source_of_truth.sql`，再同时重启 Web、AI Worker 和 Scheduler。
上线后检查草稿版本均为 `isCurrent=0`，并观察 `ai_artifact_consumptions` 是否随下游重跑持续写入。

## 归档策略

执行策略定义在 `server/domains/ai_os/services/artifactLifecycle.ts`。

| Policy | 热窗口 | 删除窗口 | 说明 |
| --- | --- | --- | --- |
| `agent_events.stream` | 90 天 | 365 天 | Agent 事件流增长最快 |
| `ai_jobs.completed` | 180 天 | 730 天 | 长任务执行历史 |
| `tool_runs.completed` | 180 天 | 730 天 | Tool 调用审计 |
| `project_files.uploads` | 180 天 | 730 天 | 原始上传和解析结果 |
| `ai_os_metrics.detail` | 365 天 | 1095 天 | 观测明细 |
| `ai_artifacts.versions` | 365 天 | 1095 天 | 可复用产物版本 |

默认建议先 dry-run：

```ts
emperor.observability.runLifecycleSweep({
  dryRun: true,
  mode: "archive",
  batchSize: 1000
})
```

确认候选量后再执行：

```ts
emperor.observability.runLifecycleSweep({
  dryRun: false,
  mode: "archive",
  batchSize: 1000
})
```

`delete` 模式只建议在对象存储、审计导出和备份都验证后开启。

## 上线顺序

1. 备份生产数据库。
2. 先部署兼容代码，再按受控迁移顺序执行到 `drizzle/0130_ai_operations_runtime.sql`。
3. 重启 Web、AI Worker、Scheduler。
4. 上传一个 Listing 数据文件，确认 `ai_storage_objects`、`ai_artifacts` 有新增记录。
5. 执行 `runLifecycleSweep({ dryRun: true })`，确认 `ai_data_archive_runs` 有 dry-run 记录。
6. 确认 Scheduler 领导者锁正常后，观察自动归档、Worker 心跳和告警记录 1 到 2 天。

## 运行告警与自动归档

Scheduler 会自动执行数据生命周期归档和 AI OS 健康检查，也可以通过带
`SCHEDULED_TASK_SECRET` 的受保护接口由外部调度器触发：

- `POST /api/scheduled/data-lifecycle-sweep`
- `POST /api/scheduled/ai-os-operational-health`

生产环境建议显式配置：

| 环境变量 | 建议值 | 说明 |
| --- | --- | --- |
| `REQUIRE_AI_JOB_WORKER` | `true` | 没有健康 Worker 时产生严重告警 |
| `AI_OS_HEALTH_CHECK_INTERVAL_MS` | `300000` | Worker、失败任务和归档健康检查周期 |
| `DATA_LIFECYCLE_SWEEP_INTERVAL_MS` | `86400000` | 自动归档周期 |
| `DATA_LIFECYCLE_BATCH_SIZE` | `1000` | 单策略单次归档上限 |
| `AI_OS_FAILED_JOB_ALERT_THRESHOLD` | `1` | 一小时内死信告警阈值 |
| `AI_OS_ALERT_COOLDOWN_MS` | `21600000` | 相同告警再次通知的冷却时间 |

`ai_operational_alerts` 保存当前和历史告警，皇帝可观测页面展示未恢复告警。
Owner 通知还需要部署环境提供 Forge 通知配置；通知失败不会阻断告警入库。

## 已知边界

- 当前仍保留业务表长字段，避免一次性切断旧读路径；后续再按 Listing、图片、广告、视频逐步读取 `ai_artifacts`。
- v1 归档默认是热表状态转冷，不直接物理删除；`delete` 模式需要单独上线审批。
- `ai_artifacts` 是统一索引，不替代业务表中的强查询字段；可过滤字段仍应结构化保存在业务表。
