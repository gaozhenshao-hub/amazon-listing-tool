# Data Lifecycle & Artifact System v1

## 目标

第 5 轮把 AI 输出和大内容从“散落在业务表的大 JSON/TEXT 字段”升级为统一产物索引：

- `ai_artifacts`: Listing、图片、广告、视频、Agent 的统一产物索引和版本 current 指针
- `ai_storage_objects`: 文件、图片、长文本、归档包的统一 Storage 引用
- `ai_data_archive_runs` / `ai_data_archive_items`: 高增长数据归档执行记录

旧字段继续保留，用于兼容当前业务页面；新写入会同步登记 Artifact/Storage，后续业务读取可以逐步切换。

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
ai-artifact://{artifactId}@current
ai-artifact://{artifactId}@{version}
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
2. 先部署兼容代码，再执行 `drizzle/0115_data_lifecycle_artifacts_v1.sql`。
3. 重启 Web、AI Worker、Scheduler。
4. 上传一个 Listing 数据文件，确认 `ai_storage_objects`、`ai_artifacts` 有新增记录。
5. 执行 `runLifecycleSweep({ dryRun: true })`，确认 `ai_data_archive_runs` 有 dry-run 记录。
6. 观察 1 到 2 天后，再配置定时归档任务。

## 已知边界

- 当前仍保留业务表长字段，避免一次性切断旧读路径；后续再按 Listing、图片、广告、视频逐步读取 `ai_artifacts`。
- v1 归档默认是热表状态转冷，不直接物理删除；`delete` 模式需要单独上线审批。
- `ai_artifacts` 是统一索引，不替代业务表中的强查询字段；可过滤字段仍应结构化保存在业务表。
