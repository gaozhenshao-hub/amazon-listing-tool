# DEV-PLAN：父ASIN周报MCP来源替代

## 技术栈与约束

本项目使用React 19、TypeScript、Tailwind CSS、Express 4、tRPC 11、Drizzle/MySQL和pnpm/Vitest。生产目标为青岛独立站。周报读取必须通过既有领星Tool Gateway，沿用只读白名单、1 QPS、Run/Trace、Artifact归档和单实例LeaderLock；不得创建平行调度器。

## 阶段清单

### 阶段1：来源元数据和MCP周报契约

**交付物**：为父ASIN周事实增加可审计来源元数据；增加父ASIN周报MCP的请求、标准化、分页与完整性校验合同。

**关键文件**：`drizzle/schema/ops.ts`、`drizzle/0190_parent_asin_weekly_mcp_source.sql`、`server/routers/lingxingSync.ts`、`server/domains/ops/lingxingScheduledDrafts.ts`、对应Vitest文件。

**验收标准**：周报请求固定使用完整自然周和父ASIN汇总；所有店铺覆盖、分页、Schema、身份和数值检查失败时仅生成复核批次；迁移不重写历史事实。

### 阶段2：唯一周度MCP任务与幂等写入

**交付物**：创建/迁移唯一`parent_asin_weekly_mcp`受治理任务，停用旧日快照周聚合触发器并保留历史；完成直接周事实的幂等冲突保护与Run/Trace写入。

**关键文件**：`server/domains/ops/localLingxingScheduler.ts`、`server/domains/ops/lingxingScheduledDrafts.ts`、`server/routers/lingxingSync.ts`、任务配置迁移/种子、`server/*test.ts`。

**验收标准**：周一北京时间16:10只有一个有效触发器；旧任务不再写入；重复运行不重复累计；不同内容冲突不覆盖。

### 阶段3：产品总览与详情来源隔离

**交付物**：产品总览周度查询只消费确认的MCP父ASIN周事实；上传周表仅作为显式回退；单ASIN详情和库存规划固定消费日数据；前端展示来源与同步状态。

**关键文件**：`server/routers/dataImport.ts`、`client/src/pages/ops/OpsProducts.tsx`、`client/src/pages/ops/OpsProductDetail.tsx`、库存规划查询模块、页面/路由测试。

**验收标准**：周度页不再从日快照生成父ASIN指标；日数据不丢失；缺少MCP周事实时来源回退可见；无数据时不展示硬编码0。

### 阶段4：首次只读预览、对账和青岛上线

**交付物**：对2026-08-24至2026-08-30执行一次全美国站只读预览；与用户上传父ASIN周表做聚合差异审计；批准后上线任务与页面并验证。

**关键文件**：`docs/validation/`审计记录、受治理预览/应用脚本、部署说明与回归测试。

**验收标准**：预览不写入周事实；对账差异可解释且保留；生产服务健康；页面、任务中心、批次和Trace均可回溯；失败窗口继续人工复核。

## 数据模型摘要

| 表或对象 | 阶段 | 变更用途 |
| --- | --- | --- |
| `lingxing_product_weekly` | 1 | 增加周事实来源、源批次、Schema版本和自然周窗口追溯字段 |
| `ops_external_sync_batches` | 1–2 | 记录MCP周报预览、覆盖、分页、校验和应用状态 |
| `ops_external_sync_rows` | 1–2 | 存储父ASIN规范化草稿、身份、行级异常与冲突依据 |
| `ops_lingxing_sync_schedules` / `emperor_scheduled_tasks` | 2 | 保持一对一任务控制面，替换唯一周度执行域 |

## 已知风险与限制

领星MCP目录已声明支持周维度与父ASIN汇总，但实际响应字段、店铺覆盖和分页行为仍须在第一阶段的只读预览中验证。父ASIN周报与上传周表可能因报表刷新时间、筛选条件或计算口径产生差异；系统只能审计与提示，不能自动覆盖既有事实。全量TypeScript检查已有历史错误，实施期间以新增定向Vitest、ESLint、构建和青岛只读/真实验证分别报告。

---

# 扩展DEV-PLAN：统一受控Amazon采集平台与智能图片建议双轨竞品分析

## 技术栈与实施约束

本扩展沿用React 19、TypeScript 5.9、Vite 7、TailwindCSS 4、Express 4、tRPC 11、Zod 4、Drizzle/MySQL、AI Worker和S3。Apify当前只连接到开发任务，用于Provider资格验证；青岛生产调用必须使用服务端Secret和Provider Adapter，不能依赖开发任务会话。项目已有Heartbeat SDK，但P0–P4不创建自动采集计划，监控迁移阶段才接入持久化Heartbeat。

## 依赖顺序

```text
Provider资格验证
  → 标准合同与采集Schema
  → Adapter、预算、缓存、Job/Run
  → Snapshot、S3资产与人工审核
  → 图片知识库迁移
  → 主要竞品全图分析
  → 同表达卖点点选联动与综合结论
  → 其他消费者迁移
  → 监控迁移与旧爬虫退役
```

## 阶段A0：实施基线与Provider资格验证

**状态（2026-09-13）**：主图库条件批准。一个用户授权US站样本已验证基础信息与6张主图；A+、品牌故事和变体未在该样本观察到，继续作为阳性样本待验能力，不阻塞主图库首期。

**交付物**：固化规格和计划；只读发现不超过两个Amazon商品详情候选Actor；获取真实输入/输出Schema、定价、成功率、维护状态和能力声明；用户确认测试ASIN和最高预算后运行最小资格验证，不写业务数据库。

**关键文件**：`Product-Spec.md`、`DEV-PLAN.md`、`docs/validation/amazon-acquisition-provider-qualification-2026-09-13.md`、`server/domains/acquisition/providerContracts.ts`、`server/domains/acquisition/providerContracts.test.ts`。

**验收标准**：至少验证`catalog_basic`和`image_gallery`；A+、品牌故事、变体及空值均有明确FieldStatus；Actor运行设置结果数和金额上限；输出批准、条件批准或拒绝结论；拒绝时不实施该Adapter。

## 阶段A1：统一采集Schema与核心合同

**状态（2026-09-13）**：本地完成。已新增共享合同、Provider接口、9张基础表和0198纯新增表迁移草案；7项定向回归、ESLint和生产构建通过。0198尚未执行到任何数据库。

**交付物**：新增Provider Profile、Job、Run、Raw Artifact、Source Snapshot、Asset Candidate、Revision、Confirmed Snapshot和Consumer Link；新增能力、状态、错误类别和标准化Amazon Snapshot共享合同；新增0198非破坏性迁移。

**关键文件**：`drizzle/schema/acquisition.ts`、`drizzle/schema/index.ts`、`drizzle/0198_unified_amazon_acquisition_foundation.sql`、`shared/acquisition.ts`、`server/domains/acquisition/contracts.ts`及对应测试。

**验收标准**：所有表具有工作空间隔离和必要复合索引；Secret只保存引用；原始响应只存S3引用与哈希；迁移只新增表；定向Vitest、ESLint和生产构建通过。

## 阶段A2：Provider Adapter、预算、缓存与Job/Run

**状态（2026-09-13）**：本地完成。服务端Apify Secret已通过轻量认证端点验证；Adapter固定US、单结果、无Offer/Seller，支持异步Run恢复、不可变原始Artifact和固定失败类别；24小时确认快照缓存、幂等入队、单Run/日/月预算门禁、Job/Run持久化、可恢复AI Worker处理器及超级管理员配置tRPC均已完成。0198仍未执行。

**交付物**：实现通用Provider接口和通过A0验证的Apify Actor适配器；实现成本估算、24小时缓存、幂等键、单Run/日/月预算、固定错误分类和持久化Worker任务；新增超级管理员配置与能力状态接口。

**关键文件**：`server/domains/acquisition/providers/provider.ts`、`server/domains/acquisition/providers/apifyAmazonProvider.ts`、`server/domains/acquisition/services/acquisitionPolicy.ts`、`server/domains/acquisition/services/acquisitionJobs.ts`、`server/domains/acquisition/services/acquisitionWorker.ts`、`server/domains/acquisition/repository.ts`、`server/routers/acquisitionAdmin.ts`、`server/routers.ts`、`server/_core/aiWorker.ts`及测试。

**验收标准**：无生产Secret时返回`provider_not_configured`且不调用旧爬虫；缓存键覆盖工作空间、站点、ASIN和能力集合；成功、失败和费用Run不可变；401/403、限流、超时、部分结果和Schema漂移只返回固定类别。

## 阶段A3：标准化、S3资产与人工审核

**交付物**：标准化基础信息、Listing、commerce、图片/A+/品牌故事和字段状态；下载竞品证据图片到S3并保存哈希、尺寸、图位与模块类型；实现Snapshot Revision、确认版本与Consumer Link；提供任务列表和人工审核页面。

**关键文件**：`server/domains/acquisition/services/amazonNormalizer.ts`、`server/domains/acquisition/services/assetIngestion.ts`、`server/domains/acquisition/services/snapshotReview.ts`、`server/routers/acquisition.ts`、`client/src/pages/acquisition/AcquisitionJobsPage.tsx`、`client/src/pages/acquisition/AcquisitionReviewPage.tsx`、`client/src/pages/acquisition/components/AssetReviewGrid.tsx`、`client/src/App.tsx`及测试。

**验收标准**：`null`不统一解释为没有；修正进入Revision且不覆盖原快照；只有Confirmed Snapshot可被消费；竞品资产标记“内部研究、不可作为我方素材”；桌面/移动加载、空、错和部分成功状态通过验证。

## 阶段A4：图片知识库首个消费者迁移

**交付物**：图片知识库单ASIN、批量、链接和局部刷新改为创建Acquisition Job；确认Snapshot后投影到现有知识库或创建Consumer Link；保留ASIN卡片、完整图库、标签、共享权限和历史旧来源；移除图片知识库对`server/scraper.ts`的运行时调用。

**关键文件**：`server/routers/kbImages.ts`、`server/kbDb.ts`、`client/src/pages/knowledge/KBImages.tsx`、`client/src/pages/knowledge/KbAsinSetGrid.tsx`及采集集成测试。

**验收标准**：四类入口返回Job/审核状态而非直接抓页面；历史知识库不批量重采、不删除；局部刷新只请求选定能力；Provider失败不回退旧爬虫。

## 阶段A5：主要竞品全图分析

**交付物**：新增竞品Research Subject、逐图事实卡、全图分析版本和Step 0综合Artifact；新增0199迁移；实现主要/对标/补充角色、ASIN卡片、完整图库、事实卡编辑、覆盖门禁、逐图/分区/整套策略Skill与版本确认。

**关键文件**：`drizzle/schema/image.ts`、`drizzle/0199_competitor_gallery_research.sql`、`shared/competitorResearch.ts`、`server/domains/image/routers/competitorResearch.ts`、`server/domains/image/services/competitorGalleryJob.ts`、`server/domains/image/services/competitorGallerySchemas.ts`、`client/src/pages/imageWorkflow/CompetitorAnalysisStep.tsx`、`client/src/pages/imageWorkflow/components/CompetitorGalleryAnalysis.tsx`、`client/src/pages/imageWorkflow/components/CompetitorFactCardEditor.tsx`及测试。

**验收标准**：每项目只有一个主要竞品；改选时旧综合结论失效但历史保留；全部确认资产完成事实卡后才能生成总结；每项结论都有证据引用；竞品图片不能成为图像生成输入。

## 阶段A6：同表达卖点图片点选联动与综合结论

**交付物**：新增表达方向资产链接和分析版本；实现按卖点、表达方式、ASIN、角色、图位、证明方式与置信度筛选，支持批量全选、AI推荐、已选托盘、排序、去重、Selection Version和多方向引用；超过30张时分批分析全部资产；实现全图、表达和综合三页签双向回跳。

**关键文件**：`drizzle/schema/image.ts`、`drizzle/0200_expression_group_asset_linkage.sql`、`server/domains/image/routers/expressionGroups.ts`、`server/domains/image/services/stepGenerationJob.ts`、`server/imageWorkflowPrompts.ts`、`client/src/pages/imageWorkflow/CompetitorAnalysisStep.tsx`、`client/src/pages/imageWorkflow/components/ExpressionAssetPicker.tsx`、`client/src/pages/imageWorkflow/components/Step0SynthesisPanel.tsx`及测试。

**验收标准**：图库模式不受5张硬上限约束，历史手工上传仍保持1–5张；同一Asset在同一版本只出现一次；选择变更产生新版本并使旧AI结果失效；综合结论只使用确认Artifact并由用户逐项选择是否进入后续步骤。

## 阶段A7：其他商品详情消费者迁移

**交付物**：迁移Listing知识库、产品知识库、项目竞品分析和转化率采集的目录数据部分；原大JSON副本改为Snapshot引用；逐模块删除旧爬虫运行时调用并增加影子对照回归。

**关键文件**：`server/routers/kbListings.ts`、`server/routers/kbProducts.ts`、`server/routers/analysis.ts`、`server/routers/conversionDataCollector.ts`、`server/routers/systemSettings.ts`、`server/domains/acquisition/services/consumerProjection.ts`及测试。

**验收标准**：模块只读取Confirmed Snapshot或历史记录；转化率采集的广告部分继续使用领星受治理事实；系统设置改为Provider健康、能力和预算，不再写旧代理/UA/重试配置。

## 阶段A8：监控迁移与旧爬虫退役

**交付物**：分别验证offers、sales rank与search rank Provider能力；将竞品/关键词监控迁移为持久化Heartbeat；封锁旧`setInterval`和旧爬虫运行时入口；增加全库静态审计。

**关键文件**：`server/routers/crawler.ts`、`server/crawlerEngine.ts`、`server/scraper.ts`、`server/antiBot.ts`、`server/_core/scheduledRoutes.ts`、`server/_core/index.ts`、`drizzle/0201_acquisition_monitor_schedules.sql`、`scripts/check-retired-amazon-crawler-imports.mjs`及测试。

**验收标准**：回调路径使用`/api/scheduled/*`并按Heartbeat`taskUid`定位业务行；处理幂等且两分钟内完成；Provider失败不调用旧爬虫；全库业务代码对旧执行器运行时导入为0。

## 阶段A9：完整质量门禁与受控发布

**交付物**：运行Provider合同、采集、快照、权限、资产、图片工作流、知识库和监控回归；运行项目审计、ESLint、TypeScript、生产构建、桌面/移动截图和网络隔离测试；逐迁移审阅并按阶段受控发布；使用经批准的真实测试ASIN完成费用审计和端到端验收。

**关键文件**：`todo.md`、`docs/validation/unified-amazon-acquisition-stage-review-2026-09-13.md`、本扩展各阶段测试文件和发布审计记录。

**验收标准**：新增测试通过；项目既有失败明确隔离；迁移非破坏性且只执行一次；青岛发布执行验签、备份、原子替换、三服务与本机HTTP检查；真实验收覆盖采集、审核、知识库链接、全图分析、跨竞品选图、综合结论和证据追溯。

## 扩展迁移摘要

| 迁移 | 阶段 | 范围 |
|---|---|---|
| 0198 | A1 | 统一采集Job/Run/Artifact/Snapshot/Asset/Revision/Confirmed/Consumer Link |
| 0199 | A5 | 竞品Research Subject、事实卡、全图分析和Step 0综合Artifact |
| 0200 | A6 | 表达方向Asset Link与分析版本 |
| 0201 | A8 | 监控Heartbeat taskUid、Provider能力和幂等字段 |

## 扩展已知风险

Provider主图/A+能力必须在A0实样验证；生产Token尚未配置；Actor存在计费、限流与Schema漂移；大量图片必须逐图、分区、分批保证全覆盖；历史数据不批量重采；旧爬虫需等待全部消费者迁移后才能退役；青岛独立站每阶段均需单独迁移和受控发布授权。
