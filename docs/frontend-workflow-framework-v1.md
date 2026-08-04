# Frontend Workflow Framework v1

## 目标

第 6 轮把前端长流程从“每个页面自己维护复杂流程状态”收敛为统一的人机协同 UI 框架。

核心原则：

- 业务页面保留原功能，不删生成、编辑、确认、导出等现有能力。
- 前端展示优先读取 Agent Run / Checkpoint / Artifact。
- 业务页面只沉淀最终业务结果，中间过程逐步交给 Agent / Artifact。
- Listing 2.0 已下线，不再作为工作流承载页面。

## 新增组件

位置：`client/src/components/workflow`

- `WorkflowShell`：统一页面外壳，支持标题、步骤导航、Agent Run 状态、Checkpoint 操作、Artifact 版本入口。
- `WorkflowStepProgress`：统一步骤条，可兼容旧业务状态，也可读取 Agent Checkpoint 状态。
- `WorkflowCheckpointControls`：统一执行、编辑、保存草稿、确认锁定、重跑、跳过操作。
- `WorkflowArtifactVersionPicker`：统一 Artifact 版本选择、回滚、Diff、作为下游输入。
- `useAgentWorkflowRun`：统一读取 Emperor Agent Run，并封装 execute / schedule / confirm / rerun / pause / resume / cancel。
- `workflowDefinitions`：Listing、图片、广告、视频的统一步骤定义。

## 当前接入范围

| 页面 | 接入方式 | 保留能力 |
| --- | --- | --- |
| 智能图片建议 | `WorkflowShell` | 6 步生成、编辑、确认、解锁、导出完整方案、重新开始 |
| 广告架构 | `WorkflowStepProgress` | 项目选择、AI 生成、编辑架构、CSV/Bulk Sheet 导出、矩阵/预算/否定词等视图 |
| 视频脚本生成 | `WorkflowStepProgress` | 6 阶段脚本生成、阶段确认、版本管理、回滚、Excel 导出 |

## Agent Run 接入约定

业务页面可以通过 URL query 传入 `agentRunId`：

```text
/listing/image-workflow?agentRunId=agent_run_xxx
```

传入后 `WorkflowShell` 会自动显示：

- Agent Run 状态和进度
- 当前 Checkpoint 状态
- 执行 / 重跑 / 编辑草稿 / 确认锁定 / 跳过
- Artifact 版本选择 / 回滚 / Diff

没有 `agentRunId` 时页面继续使用旧业务流程，不影响当前生产功能。

## Listing 2.0 下线范围

已移除：

- `/listing2`
- `/listing2/product/:id`
- 侧边栏“智能Listing生成2.0”
- `server.routers.listing2`
- `client/src/pages/listing2/*`
- `server/routers/listing2.ts`

未执行 DROP TABLE：

- 历史 `listing2_products` 数据不在本轮删除。
- 如果后续确认历史数据完全不要，应单独执行归档/删除迁移。

## 后续迁移建议

1. 图片工作流先把 Step 产物写入统一 `ai_artifacts`。
2. 广告架构生成接 Agent Run，让 AI 生成结果进入 Artifact，再保存最终广告架构。
3. 视频脚本各阶段从业务版本表逐步镜像到 Artifact。
4. 正式 Listing 长流程不要恢复 Listing 2.0 页面，应直接接 `listing.full.workflow` Agent。
