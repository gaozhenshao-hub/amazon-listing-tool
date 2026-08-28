# 知识蒸馏与 Listing—图片协同 Skill 底座开发计划

## 技术范围

本计划使用现有 React 19、TypeScript、Tailwind、tRPC、Drizzle/MySQL 与皇帝 AI 中台能力。统一复用 `emperor_skills`、`emperor_skill_runs`、`ai_artifacts`、`ai_artifact_consumptions` 和安全审计；所有新增数据都只保存来源引用、哈希、摘要、结构化规则和审批事件，绝不复制私有附件、下载链接、密钥或皇帝记忆。

> 本计划建设蒸馏入口、目录、治理、工作流上下文与人工确认能力。初始状态禁止对现有知识库自动蒸馏，禁止创建或发布由当前知识生成的业务 Skill。

## Phase 1：蒸馏领域模型与安全数据迁移

**交付。**建立蒸馏项目、来源引用、证据卡、草案、审批事件、反馈和 Claim Ledger 的工作空间级数据模型。新增字段均按内容哈希、创建/更新人和状态追溯；不保存知识正文或附件。

**关键文件。**

- `drizzle/schema/skillDistillation.ts`
- `drizzle/schema/index.ts`
- `drizzle/0187_skill_distillation_foundation.sql`
- `scripts/run-database-migrations.mjs`
- `server/domains/knowledge/skillDistillationContracts.ts`
- `server/domains/knowledge/skillDistillationContracts.test.ts`

**验收。**受控迁移可重复执行；固定五维 Profile、22 个受控 Skill 类型、Evidence Card、Claim Ledger 和状态迁移的契约测试通过；不存在自动来源扫描或自动 Skill 发布。

## Phase 2：蒸馏项目、证据和 Skill 目录服务端治理

**交付。**提供超级管理员创建项目、选择合格知识来源、维护证据卡、创建/编辑草案、审查冲突、申请批准、发布/回滚和记录反馈的接口。建立受控 Skill Catalog，目录条目仅为能力蓝图；具体 Skill 版本始终由审批后创建。

**关键文件。**

- `server/domains/knowledge/skillDistillationService.ts`
- `server/domains/knowledge/skillDistillationCatalog.ts`
- `server/domains/knowledge/skillDistillationAuthorization.ts`
- `server/routers/skillDistillation.ts`
- `server/routers.ts`
- `server/domains/knowledge/skillDistillationService.test.ts`

**验收。**非超级管理员不能创建项目、添加共享来源或发布/回滚；所有发布均创建新版本；来源哈希变更只标记“需复核”，不会覆盖已发布版本。

## Phase 3：Claim Ledger、Skill 选择与跨流程上下文

**交付。**为 Listing 项目和图片工作流会话建立可版本化、可锁定的 Claim Ledger Artifact；建立已发布 Skill 的 Profile 匹配与显式选择机制；输出一致性检查和变更影响 Artifact。仅当用户选择且锁定后，才能作为下游上下文。

**关键文件。**

- `server/domains/knowledge/claimLedgerService.ts`
- `server/domains/knowledge/workflowSkillContext.ts`
- `server/domains/knowledge/listingImageCoherence.ts`
- `server/routers/skillDistillation.ts`
- `server/domains/listing/listingAgentBridge.ts`
- `server/domains/image/imageWorkflowAgentBridge.ts`
- `server/domains/knowledge/claimLedgerService.test.ts`

**验收。**同一 Claim 可关联五点、A+、图片任务而不靠 ASIN 模糊匹配；品牌故事与 A+ 1–7 分离；未锁定 Claim 不进入下游生成上下文；Artifact 使用和版本均有 Run Ledger 记录。

## Phase 4：超级管理员蒸馏与 Skill 治理工作台

**交付。**在皇帝 Skill Library 中增加“知识蒸馏”受控工作台：Skill Catalog、蒸馏项目、来源与证据、草案差异、冲突审查、审批发布、回滚和反馈。页面默认显示“尚未启动蒸馏”，不主动分析已有知识。

**关键文件。**

- `client/src/pages/emperor/SkillDistillationWorkbench.tsx`
- `client/src/pages/emperor/EmperorSkillLibrary.tsx`
- `client/src/components/skillDistillation/*`
- `client/src/App.tsx`
- `client/src/components/workspace/workspaceTabState.ts`
- `client/src/pages/emperor/SkillDistillationWorkbench.test.tsx`

**验收。**超级管理员能管理目录和草案；非超级管理员不显示治理入口；所有空态、加载、错误和需要人工确认的状态明确；不出现“自动蒸馏”“自动发布”入口。

## Phase 5：Listing 与图片工作流的人工确认式消费入口

**交付。**在 Listing 内容规划与图片 Step 1/Step 2 中加入“选择已发布 Skill”“查看 Claim Ledger”“查看一致性影响”入口，使用现有 Artifact 版本选择组件并保持旧工作流可独立运行。

**关键文件。**

- `client/src/pages/listing/*`
- `client/src/pages/imageWorkflow/*`
- `client/src/components/workflow/BusinessArtifactVersionPicker.tsx`
- `client/src/components/skillDistillation/ClaimLedgerPanel.tsx`
- `client/src/components/skillDistillation/CoherenceImpactPanel.tsx`
- `server/routers/listingSkill.ts`
- `server/routers/imageWorkflow.ts`

**验收。**用户可选用已发布且 Profile 匹配的 Skill；所有结果先显示为可编辑候选；解锁/修改时可见影响清单；无法改变已锁定的另一条工作流或自动调用图片生成。

## Phase 6：安全、版本和跨流程回归

**交付。**补全权限、Profile 匹配、草案→发布→回滚、Artifact 锁定、冲突、来源失效、A+连续编号/品牌故事分离和跨流程影响的定向测试与页面验收。

**关键文件。**

- `server/domains/knowledge/*.test.ts`
- `client/src/pages/emperor/*.test.tsx`
- `client/src/pages/listing/*.test.tsx`
- `client/src/pages/imageWorkflow/*.test.tsx`
- `docs/architecture/product-knowledge-to-listing-image-skill-distillation-plan.md`

**验收。**无权限访问被服务端拒绝；未确认知识不可能作为证据；发布新版本不改变历史运行；所有人工确认节点和风险提示在页面可见；不产生任何当前知识库蒸馏运行。

## 数据表摘要

| 表 | Phase | 用途 |
|---|---:|---|
| `knowledge_distillation_projects` | 1 | 蒸馏项目容器与五维 Profile |
| `knowledge_distillation_sources` | 1 | 仅保存合格知识来源的引用与内容哈希 |
| `knowledge_distillation_evidence` | 1 | 可解释的证据卡和可信范围 |
| `knowledge_skill_drafts` | 1 | 结构化规则草案、父版本和审核状态 |
| `knowledge_skill_review_events` | 1 | 编辑、批准、拒绝、发布和回滚审计 |
| `knowledge_skill_feedback` | 1 | 工作流人工反馈，供后续人工启动下一版蒸馏 |
| `knowledge_claim_ledgers` | 1 | Listing—图片共同使用的 Claim Ledger 锚点 |
| `knowledge_claim_ledger_links` | 1 | Claim 对 Listing/A+/图片任务的显式关联 |

## 已知风险与控制

| 风险 | 控制方式 |
|---|---|
| 当前知识不够丰富导致规则质量不足 | 平台默认不自动蒸馏，且无法创建 Released 版本；先建设治理与手动入口。 |
| 规则更新导致工作流质量波动 | 新知识只生成增量 Draft；超级管理员审核后创建新版本；历史 Run 固定引用旧版本。 |
| 文案与图片脱节 | 用人工确认的 Claim Ledger 和一致性 Artifact 关联；禁止自然语言/ASIN 模糊关联。 |
| A+空模块或编号错乱 | 用严格 Schema 检查 A+ 1–7 与独立 `brandStoryCards[]`，缺证据时阻断。 |
| 共享知识越权或泄露附件 | 来源仅存引用、摘要、哈希；访问沿用工作空间权限；不持久化下载URL或文件字节。 |
