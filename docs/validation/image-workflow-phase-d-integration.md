# 图片建议质量治理 · 阶段 D 本地接入记录（待迁移验证、未上线）

**本轮状态（2026-10-07）：**主要确认/生成/导出路由已本地接入不可变版本和事务失效，但阶段 D **尚未在真实开发库验收，更非上线完成**。`0206_image_workflow_version_snapshots.sql` 仍是**未注册、未执行**的增量草案；本轮没有执行该迁移、触发模型/Provider、发起采集、部署或重跑历史。早期旧测试在未清空终端 `DATABASE_URL` 时出现 MySql2Session 的 `lockScope` 堆栈，不能声称整个验收过程“绝无数据库读取尝试”；后续验收命令统一使用 `env -u DATABASE_URL ALLOW_REAL_NETWORK_IN_TESTS=0`，未有意执行远程数据库写入。

当前真实路由已局部接入不可变快照策略：

- Step 0–6 的现有确认 mutation 已通过 `confirmHumanImageWorkflowStage` 写入不可变快照并在同一事务投影旧会话确认位；缺 0206 表时返回 `PRECONDITION_FAILED`，不退回旧 `step*Confirmed`。
- `getExportBundle` 与 `exportPdf` 仅接受超管、当前工作空间/项目/会话的 `getApprovedImageWorkflowExport()` 七段清单。两者不再读取旧会话草稿、AI 结果、表达组或裸 URL 作为成果回退；前端 HTML 导出仅由 `approved.sections` 生成内存投影。
- Step 0–3、Step 4 和异步 Step 5 作业在**入队前**捕获 `(scopeRevision, upstreamDigest)`，并在**模型执行前和结果写回前**重新验证；0206 缺表、上游变化、策略变化或作用域修订变化都会拒绝入队/丢弃晚到写回。同步 Step 4、同步 Step 5 与 Step 6 也在模型前后复验当前上游。
- `resetToStep`、`saveStep2Draft`、`unlockStep2`、`unlockStep5`、`saveStep6Draft`、`unlockStep6` 已使用 `invalidateImageWorkflowStages()`，在同一作用域锁和事务内追加失效事件、推进 scope revision，并清除旧会话确认投影。
- **Step 4/5 本轮补齐（仅服务端图片路由）：**`saveStep4Draft`、整体/单图解锁、参考图元数据写入、同步重优化/重新生成、Step 5 A+ 草稿优化与设计师附件增删，均改为在 `invalidateImageWorkflowStages()` 的同一范围锁、revision CAS 和数据库事务内写入兼容草稿投影及 Step 4–6/5–6 失效事件；同步模型入口在调用前捕获 worker fence，并在该原子提交内复验 revision 与上游摘要。0206 表不存在、CAS 冲突或上游变化时关闭失败，不再先失效后裸写草稿。
- `cancelStep5Generation` 和带活动任务的 `unlockStep5` 先在同一范围/CAS 事务内清除当前 `step5RunId`、记录取消态并失效 Step 5/6，再尽力取消队列任务；晚到 Worker 因 run ID 已脱离当前会话而不能写回当前分支。旧版本与历史草稿仍只读可看，但不能确认、生成当前下游或作为成果交付。
- 资产策略摘要不暴露或信任浏览器 `policyHash`：策略服务返回当前服务器授权用途、revision、用途集合、字节 SHA-256 和受控存储引用；版本层对这些服务器字段形成内部规范摘要，并在确认/导出时重新计算和校验。

## 不可变快照合同

- 固定工作流段为 **Step 0 竞品研究 + Step 1–6 制作**；每个下游确认必须显式依赖全部当前上游快照。
- 仅 `human_confirmed` 或经审核的 `legacy_human_confirmed` 可以创建快照；`ai_draft` 不得确认或导出。
- 快照正文、正文哈希、服务端资产策略摘要和上游依赖摘要均由规范化 JSON 的 SHA-256 绑定；快照正文只追加，绝不更新。
- 上游正文、上游快照或服务器资产策略变化时，旧版本为 `superseded`，当前下游为 `invalidated`；旧版本保留审计，绝不自动重确认。
- `approved_deliverable` 成果只接受七段完整、当前、人工确认且资产受控的链。裸 URL、data URI、未分类/未审核资产、缺段、失效依赖或草稿投影均失败关闭。
- 所有策略写入必须在 `(workspaceId, projectId, sessionId)` 范围锁内，并对 `image_workflow_version_scopes.revision` CAS；陈旧确认返回 `CONFLICT`。

## 本地验证（最终复测隔离数据库与外网）

已运行并通过：

```text
pnpm vitest run \
  server/domains/image/services/imageWorkflowVersionPolicy.test.ts \
  server/imageApprovedExport.router.test.ts \
  server/imageWorkflow.step4StartJob.test.ts --reporter=verbose

3 test files / 20 tests passed
```

本轮追加并通过（均以 Mock/真实 tRPC caller；最终统一复测须显式移除 `DATABASE_URL`，不执行迁移、模型或 Provider）：

```text
pnpm vitest run server/imageWorkflow.step45TransactionalRoutes.test.ts --reporter=verbose

1 test file / 5 tests passed
pnpm check --pretty false

TypeScript: passed (exit 0)
```

新增真实 tRPC 负测覆盖：Step 4 解锁将草稿投影与 Step 4–6 失效交给同一事务；0206 缺失时 Step 4 解锁与 Step 5 取消均 `PRECONDITION_FAILED` 且不退化为裸会话写/队列取消；Step 5 取消将当前 run ID CAS 清空后才尽力取消队列；草稿变更后，旧确认成果经 `getExportBundle` 直接路由调用被版本账本拒绝。

其中真实 tRPC caller 覆盖：普通管理员下载拒绝、跨工作空间超管拒绝、0206 缺表的两条下载路由 `PRECONDITION_FAILED`、草稿/未确认链拒绝，以及仅从七段 manifest 派生导出字段。策略测试覆盖 AI 草稿、跨空间、CAS 冲突、上游变更、用途策略变更、缺段与未受控图片。

整合阶段针对两个旧版 Step4/Step5 启动成功路径测试，显式 Mock 已确认的 0206 上游快照与 Job fence，而**不是**在生产代码中绕过缺表前置条件；另保留真实 tRPC 缺表拒绝负测。统一运行 `imageWorkflowVersionPolicy`、`imageApprovedExport.router`、`imageWorkflow.step45TransactionalRoutes`、`imageWorkflow.step4StartRoute`、`imageWorkflow.step5StartRoute`、`step4ReferenceDraftPersistence`：**6 文件、37 项全部通过**。共享工作树最终全量 `tsc --noEmit` 为 **0 诊断**，154 个本轮 TS/TSX/MJS 改动文件按项目 ESLint 忽略规则过滤后 **0 警告**；本地生产构建和 bundle 预算通过，仍有 Vite 大于 500 kB 的惰性块警告。

**未闭环：**Step 4 逐图确认仍依赖既有单图版本表，再由全局确认汇聚；本轮并未将每次单图确认自身合并为 0206 不可变快照事务。这不允许把旧单图确认当作 Step0–6 七段导出资格；需另行设计/在开发库证明一致性。当前 0206 缺失时真实图片确认与下载按策略失败关闭，旧历史仍可在线只读。

## 迁移前提（本任务未执行）

1. 审核 `drizzle/0206_image_workflow_version_snapshots.sql`，确认目标 MySQL 的 `CHECK` 行为或保留同等应用校验。
2. 获得单独生产变更授权后，按项目流程登记/执行。该草案未注册至迁移执行器；本轮未运行 `drizzle-kit generate`、`db:migrate`、`db:push` 或任何 SQL。
3. 为已有 `image_workflow_sessions` 延迟创建或人工补建唯一 scope；**不得**把旧 `step*AiResult` 自动回填为人工快照。
4. 历史内容仅在具备可核验人审、内容版本与资产用途证据时，由具名人工迁入 `legacy_human_confirmed`；证据缺失保持不可导出。
5. 迁移后仍需在隔离开发库完成真实 tRPC + 数据库事务回归，重点是本轮 Step 4/5 原子失效、run-ID CAS 取消/重试、回滚语义与下载审计账本。生产发布、真实模型/Provider 测试和历史重跑均不在本轮范围内。

## 邻接导出显示修复（由主任务独立完成，非本轮图片路由改动）

- `client/src/pages/imageWorkflow/exportContent.ts` 已修复：不可变 `approved.sections[].content` 是 JSON 对象时，旧渲染器按字符串再次 `JSON.parse` 会空白；现兼容对象/字符串、递归 HTML 转义，且图片 URL 仅接受 HTTPS。
- 离线 `exportContent.security.test.ts` 新增 3 项并已通过。此项是前端 HTML 内容投影的安全/可见性修复；**不构成 PDF 全面渲染验收，也不改变 approved-deliverable 的服务端版本账本门禁。**
