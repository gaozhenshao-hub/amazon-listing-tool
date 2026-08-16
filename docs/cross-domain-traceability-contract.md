# 跨模块业务追踪闭环契约

## 统一目标

系统中的业务数据、人工确认和 AI 执行记录必须能够双向追溯。任何用户看到的结果，应能回答其来源于哪个业务资源、哪个版本、哪次 Agent Run、哪些 Skill/Tool 调用以及由谁在何时确认或修改。

## 统一关联记录

| 记录类型 | 关键范围 | 必填关联 | 说明 |
|---|---|---|---|
| 业务快照 | `workspaceId`、`resourceType`、`resourceId` | `snapshotVersion`、内容摘要 | 保存导入、编辑、锁定或应用前后的可还原状态。 |
| 人工确认 | `workspaceId`、资源引用 | `actorUserId`、动作、原因、前后版本 | 代表确认、解锁、回滚、选中候选等决策。 |
| 运行关联 | `workspaceId`、`agentRunId` | `aiJobRunId`、节点、尝试次数 | 将业务流程节点与队列运行关联。 |
| 生成关联 | `workspaceId`、业务资源 | `artifactId`、`skillVersion`、`toolRunId` | 记录 AI 输出与已发布业务资产的版本关系。 |

## 资源引用格式

所有新追踪写入使用统一的 `resourceRef`：

```text
{domain}:{resourceType}:{resourceId}:v{version}
```

例如：`image:workflow_step:780001-step2:v4`、`product_development:import_batch:123:v1`。引用必须同时带 `workspaceId`，查询时不可只以 ID 跨工作空间关联。

## 最小实施顺序

第一阶段不重建 AI OS 已有的 Artifact、Agent Run、Tool Run、Job Run 表，而是在三个优先业务域新增统一查询适配：产品开发导入批次、Listing 图片工作流、知识库导入。每次人工确认或回滚都写入业务审计并关联当前 Artifact/Run（存在时）；每次 AI 生成则发布可解析的业务 Artifact。

第二阶段提供“追踪链”查询：输入一个业务资源，返回快照版本、人工决策、Agent 节点、Skill 版本、Tool Run 和输出 Artifact；输入一个 Agent Run，返回影响到的业务资源与已确认版本。

> AI 负责生成与建议；业务快照和人工确认是最终可追责的决策边界。系统不得以新的 AI 输出静默覆盖已确认的业务版本。
