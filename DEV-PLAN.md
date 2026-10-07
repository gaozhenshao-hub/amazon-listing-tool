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

**状态（2026-09-13）**：本地完成。标准化Snapshot、竞品证据图片S3入库、逐图审核、Revision、不可变Confirmed Snapshot、Consumer Link、采集任务中心和审核页面已实现；只有确认版本可消费。0198已应用到当前开发数据库，尚未应用青岛生产数据库。采集领域25项回归通过（凭证联网测试默认跳过），ESLint、生产构建、Bundle预算及页面截图通过。

**交付物**：标准化基础信息、Listing、commerce、图片/A+/品牌故事和字段状态；下载竞品证据图片到S3并保存哈希、尺寸、图位与模块类型；实现Snapshot Revision、确认版本与Consumer Link；提供任务列表和人工审核页面。

**关键文件**：`server/domains/acquisition/services/amazonNormalizer.ts`、`server/domains/acquisition/services/assetIngestion.ts`、`server/domains/acquisition/services/snapshotReview.ts`、`server/routers/acquisition.ts`、`client/src/pages/acquisition/AcquisitionJobsPage.tsx`、`client/src/pages/acquisition/AcquisitionReviewPage.tsx`、`client/src/pages/acquisition/components/AssetReviewGrid.tsx`、`client/src/App.tsx`及测试。

**验收标准**：`null`不统一解释为没有；修正进入Revision且不覆盖原快照；只有Confirmed Snapshot可被消费；竞品资产标记“内部研究、不可作为我方素材”；桌面/移动加载、空、错和部分成功状态通过验证。

## 阶段A4：图片知识库首个消费者迁移

**状态（2026-09-13）**：本地完成。单ASIN、批量、Amazon美国站链接和局部刷新已切换统一Acquisition Job；人工确认后按能力幂等投影到现有`kb_image_sets`/`kb_images`，确认前不删除旧图，手工上传和AI重分析保持不变。18项定向回归、ESLint、生产构建、Bundle预算和桌面截图通过。青岛生产尚未迁移或发布。

**交付物**：图片知识库单ASIN、批量、链接和局部刷新改为创建Acquisition Job；确认Snapshot后投影到现有知识库或创建Consumer Link；保留ASIN卡片、完整图库、标签、共享权限和历史旧来源；移除图片知识库对`server/scraper.ts`的运行时调用。

**关键文件**：`server/routers/kbImages.ts`、`server/kbDb.ts`、`client/src/pages/knowledge/KBImages.tsx`、`client/src/pages/knowledge/KbAsinSetGrid.tsx`及采集集成测试。

**验收标准**：四类入口返回Job/审核状态而非直接抓页面；历史知识库不批量重采、不删除；局部刷新只请求选定能力；Provider失败不回退旧爬虫。

## 阶段A5：主要竞品全图分析

**状态（2026-09-13）**：本地完成。已新增0199四表与两个皇帝系统Skill、Research Subject、逐图事实、整套分析版本、不可变Step 0 Gallery Artifact、可恢复AI Job和双轨Step 0 UI。存在Research Subject时必须先确认唯一主要竞品分析；无Subject时兼容原流程。开发数据库已执行0199，青岛生产尚未迁移。11项定向回归、定向TypeScript筛选、ESLint、生产构建与Bundle预算通过；真实AI运行留待受控验收。

**交付物**：新增竞品Research Subject、逐图事实卡、全图分析版本和Step 0综合Artifact；新增0199迁移；实现主要/对标/补充角色、ASIN卡片、完整图库、事实卡编辑、覆盖门禁、逐图/分区/整套策略Skill与版本确认。

**关键文件**：`drizzle/schema/image.ts`、`drizzle/0199_competitor_gallery_research.sql`、`shared/competitorResearch.ts`、`server/domains/image/routers/competitorResearch.ts`、`server/domains/image/services/competitorGalleryJob.ts`、`server/domains/image/services/competitorGallerySchemas.ts`、`client/src/pages/imageWorkflow/CompetitorAnalysisStep.tsx`、`client/src/pages/imageWorkflow/components/CompetitorGalleryAnalysis.tsx`、`client/src/pages/imageWorkflow/components/CompetitorFactCardEditor.tsx`及测试。

**验收标准**：每项目只有一个主要竞品；改选时旧综合结论失效但历史保留；全部确认资产完成事实卡后才能生成总结；每项结论都有证据引用；竞品图片不能成为图像生成输入。

## 阶段A6：同表达卖点图片点选联动与综合结论

**状态（2026-09-13）**：本地完成。已新增0200四表与两个皇帝系统Skill、Confirmed竞品资产候选门禁、Selection Version、人工/AI推荐来源、按30张分批的可恢复表达分析Job、只组合已确认Artifact的综合Job、人工逐项选择、Composite Artifact、会话刷新/导出/重置和Step 1/2只读上下文联动。Step 0已形成“竞品全图分析 / 卖点表达方式 / 综合结论”三页签；历史手工上传仍限制1–5张，图库模式无5张上限。开发数据库已执行0200，青岛生产尚未迁移或发布；未运行真实Provider采集或真实LLM分析。

**交付物**：新增表达方向资产链接和分析版本；实现按卖点、表达方式、ASIN、角色、图位、证明方式与置信度筛选，支持批量全选、AI推荐、已选托盘、排序、去重、Selection Version和多方向引用；超过30张时分批分析全部资产；实现全图、表达和综合三页签双向回跳。

**关键文件**：`drizzle/schema/image.ts`、`drizzle/0200_image_expression_asset_linkage.sql`、`server/domains/image/expressionLinkageContracts.ts`、`server/domains/image/expressionLinkageRepository.ts`、`server/domains/image/expressionLinkageService.ts`、`server/domains/image/routers/expressionLinkage.ts`、`server/domains/image/services/expressionLinkageJob.ts`、`server/domains/image/services/stepGenerationJob.ts`、`client/src/pages/imageWorkflow/CompetitorAnalysisStep.tsx`、`client/src/pages/imageWorkflow/ExpressionAssetPicker.tsx`、`client/src/pages/imageWorkflow/Step0SynthesisPanel.tsx`及测试。

**验收标准**：图库模式不受5张硬上限约束，历史手工上传仍保持1–5张；同一Asset在同一版本只出现一次；选择变更产生新版本并使旧AI结果失效；综合结论只使用确认Artifact并由用户逐项选择是否进入后续步骤。

## 阶段A7：其他商品详情消费者迁移

**状态（2026-09-13）**：本地完成。Listing知识库、产品知识库和项目竞品分析的ASIN入口均改为统一Acquisition Job；Confirmed Snapshot确认后按消费者投影，并通过独立单节点Agent、持久化AI Job与皇帝Skill生成待人工审核草案。转化率评分会先为全部ASIN建立或复用统一采集任务，存在未确认Snapshot时立即停止评分并引导审核，全部确认后才读取Snapshot与领星广告数据。Provider失败不回退旧`scraper.ts`或`crawlerEngine.ts`。本阶段未新增数据库迁移，未执行真实Provider或LLM调用，青岛未发布。

**交付物**：迁移Listing知识库、产品知识库、项目竞品分析和转化率采集的目录数据部分；原大JSON副本改为Snapshot引用；逐模块删除旧爬虫运行时调用并增加影子对照回归。

**关键文件**：`server/domains/acquisition/legacyConsumerContracts.ts`、`server/domains/acquisition/legacyConsumerProjection.ts`、`server/domains/acquisition/legacyConsumerAgent.ts`、`server/domains/acquisition/legacyConsumerAnalysisJob.ts`、`server/domains/acquisition/postConfirmation.ts`、`server/domains/acquisition/consumerActivation.ts`、`server/routers/kbListings.ts`、`server/routers/kbProducts.ts`、`server/routers/analysis.ts`、`server/routers/conversionDataCollector.ts`、`server/domains/ops/routers/conversion.ts`及测试。

**验收标准**：模块只读取Confirmed Snapshot或历史记录；转化率采集的广告部分继续使用领星受治理事实；A7四类业务消费者对旧商品详情爬虫的运行时调用为0；排名、Coupon、Deal与系统设置旧代理入口明确留给A8处理。

## 阶段A8：监控迁移与旧爬虫退役

**状态（2026-09-14）**：监控迁移、0201迁移、旧爬虫退役、受控API连接后台、IPv4监控传输修复和替代商品详情/Offer Actor的蛇形字段兼容修复均已无迁移发布青岛；真实Heartbeat仍未创建。最新发布执行构建包和Web/Worker/Scheduler三项入口SHA-256验签，保留版本化`dist`备份并原子替换；三项服务均为`active`，本机HTTP为200。首项价格/Offer/BSR资格原Run已在Actor调用前失败，未记录Provider Run且`chargedUsd=null`，但失败的Agent/AI Job已经存在；只读审计确认该Run不再满足安全恢复条件。用户随后单独批准一条新的0.10美元上限资格Run：该Run产生0.0011美元费用并记录Provider Run，但因归档结果为0条记录而以`partial_result`失败关闭，价格、BSR、Offer均无证据。替代Actor的Run 3在生产路由1.00美元硬上限内执行，实际费用0.0008美元，原始归档的脱敏形状审计确认有1条记录，且已有`price`、`bsr_rank`、`offer_count`、`buy_box_winner`和`asin`顶层字段；失败根因是Adapter未兼容蛇形字段，而非Actor空结果。映射修复已通过定向测试并发布，但Run 3保持不可变的失败记录，Provider继续`qualification_pending`。不得重试旧Run、激活能力、创建Heartbeat或启动关键词资格任务；验证修复效果只能在后续经单独用户费用授权的一条新真实Run中进行。

**交付物**：分别验证offers、sales rank与search rank Provider能力；将竞品/关键词监控迁移为持久化Heartbeat；封锁旧`setInterval`和旧爬虫运行时入口；增加全库静态审计。

**关键文件**：`drizzle/schema/monitoring.ts`、`drizzle/0201_amazon_monitor_provider_jobs.sql`、`server/domains/acquisition/monitorProviderContracts.ts`、`server/domains/acquisition/apifyMonitorProvider.ts`、`server/domains/acquisition/monitorProviderProfileService.ts`、`server/domains/acquisition/monitorRepository.ts`、`server/domains/acquisition/monitorAgent.ts`、`server/domains/acquisition/monitorJob.ts`、`server/domains/acquisition/monitorHeartbeat.ts`、`server/routers/crawler.ts`、`server/routers/systemSettings.ts`、`server/_core/index.ts`、`client/src/pages/ops/OpsCrawlerManager.tsx`、`client/src/pages/ops/AmazonMonitorGovernancePanel.tsx`、`client/src/pages/SystemSettings.tsx`及测试。

**验收标准**：回调路径使用`/api/scheduled/amazon-monitor`并按经认证的Heartbeat`taskUid`定位业务行；回调只排队持久化Job并立即返回；资格、预算或字段证据不足时失败关闭；Provider失败不调用旧爬虫；全库业务代码对旧执行器运行时导入为0。真实资格、真实Heartbeat和生产端到端验证纳入A9受控发布阶段。

## 阶段A9：完整质量门禁与受控发布

**交付物**：运行Provider合同、采集、快照、权限、资产、图片工作流、知识库和监控回归；运行项目审计、ESLint、TypeScript、生产构建、桌面/移动截图和网络隔离测试；逐迁移审阅并按阶段受控发布；使用经批准的真实测试ASIN完成费用审计和端到端验收。

**关键文件**：`todo.md`、`docs/validation/unified-amazon-acquisition-stage-review-2026-09-13.md`、本扩展各阶段测试文件和发布审计记录。

**验收标准**：新增测试通过；项目既有失败明确隔离；迁移非破坏性且只执行一次；青岛发布执行验签、备份、原子替换、三服务与本机HTTP检查；真实验收覆盖采集、审核、知识库链接、全图分析、跨竞品选图、综合结论和证据追溯。

## 阶段A10：受控第三方 API 连接管理后台

**状态（2026-09-14）**：本地实现与青岛无迁移发布均已完成。系统设置新增“API连接管理”页，仅`super_admin`可查看脱敏状态、在空白密码输入框新增/替换密钥、执行无费用轻量校验和发起密文重加密。领星、Apify、赛狐均使用系统级`secret://integration.*`引用；值通过既有皇帝Tool AES-GCM密文存储与版本治理保存，历史值绝不回显。统一Amazon采集与监控Adapter已改为优先解析`secret://integration.apify.api_token`，旧环境变量仅为服务器端兼容回退。赛狐仍保持“待受限官方API合同”，保存后不得自动外呼或同步。

**安全边界**：密钥不得写入业务数据库明文、客户端状态持久化、Job/Run输入、日志、审计元数据、错误文本、静态构建文件或下载包。保存/校验/重加密均记录连接代码、字段名、密钥版本、时间与固定脱敏状态；未配置、验证失败、Tool主密钥不可用或Provider资格未通过时失败关闭。Apify轻量校验仅请求账户身份端点，不启动Actor；领星仅执行MCP协议初始化；赛狐本期不发起网络请求。

**关键文件**：`server/domains/apiConnections/contracts.ts`、`server/domains/apiConnections/service.ts`、`server/routers/apiConnections.ts`、`server/domains/ai_os/services/toolGateway/governanceCore.ts`、`server/domains/acquisition/apifyProvider.ts`、`server/domains/acquisition/apifyMonitorProvider.ts`、`client/src/pages/apiConnections/ApiConnectionManager.tsx`、`client/src/pages/SystemSettings.tsx`及定向测试。

**验证情况**：16项受控连接/监控定向Vitest通过；定向TypeScript新增诊断为0；ESLint、生产构建与Bundle预算通过。全项目仍存在此前已记录的历史TypeScript/契约诊断，未在本阶段掩盖或归因于该功能。受控后台已完成生产发布；Apify密钥由用户在后台保存并通过无费用轻量校验。首项资格Run曾按单次授权恢复但零计费失败；其后的新资格Run产生0.0011美元部分结果，但只读形状审计为0条记录，Provider仍未资格通过。关键词资格、Heartbeat和任何新的外部业务读取均未执行。

## 阶段A11：生产资格任务排队修复

**状态（2026-09-14）**：排队修复已无迁移发布青岛，原有首项资格Run已在受控门禁下恢复。生产只读审计确认该Run已创建Agent Run和AI Job，但在任何Provider Run之前失败，`chargedUsd=null`；费用授权仍为0.10美元且未消耗。后续根因隔离为监控Adapter未使用生产已验证的IPv4传输，相关本地传输修复另行待发布。

**修复与门禁**：监控节点已改为受支持的`http_node`并声明受控Tool标识；任何Agent/AI Job登记失败都会把已创建Monitor Run标为`failed/job_enqueue_failed`，不会静默遗留可误判为可恢复的排队记录。新增管理员恢复接口，但仅接受当前工作空间、原始发起人、资格类型、无`providerRunId`、无`agentRunId`、无`aiJobRunId`、无原始S3证据且`chargedUsd IS NULL`的既有记录。恢复复用原Run、原0.10美元上限和原始审计归属，绝不创建第二个Provider Run。

**验证情况**：监控Agent/Job定向10项和统一采集领域72项通过（另1项凭证联网测试按设计跳过）；定向TypeScript新增诊断为0、ESLint与生产构建/Bundle预算通过。发布后仅恢复既有生产Run，未创建第二条Run；首项失败前未产生Provider Run或费用，关键词资格未启动。

## 扩展迁移摘要

| 迁移 | 阶段 | 范围 |
|---|---|---|
| 0198 | A1 | 统一采集Job/Run/Artifact/Snapshot/Asset/Revision/Confirmed/Consumer Link |
| 0199 | A5 | 竞品Research Subject、事实卡、全图分析和Step 0综合Artifact |
| 0200 | A6 | 表达方向Asset Link与分析版本 |
| 0201 | A8 | 监控Heartbeat taskUid、Provider能力和幂等字段 |

## 生产运维修复记录（2026-09-17）

**采集任务错误合同**：智能图片建议 Step 0 的“创建采集任务”已完成无迁移原子发布。修复将未配置、未启用、未填受控密钥和缺少预算从普通异常转换为可读的 `PRECONDITION_FAILED`。生产受控tRPC复验确认HTTP 412、`profile_not_configured`和可读管理员操作提示，同时确保未创建采集Job、AI Job或Provider Run。构建包与Web/Worker/Scheduler入口SHA-256一致，三服务为active，本机HTTP为200。主Provider仍为`qualification_pending`，不得因该前端提示修复而启用Provider或启动关键词/Heartbeat。

**N3本品属性表模型可用性**：诊断确认失败记录源于过期的 Teamorouter `.com` 入口及其被强制送往已失联 SOCKS 隧道，而非文件解析、Skill注册、模型记录或 API Key 缺失。官方当前 OpenAI 兼容入口为 `https://api.teamorouter.cn/v1`，Qingdao 可直连并已通过受控目录读取确认 39 个文本模型。已无迁移原子发布官方端点/环境密钥引用修复，并登记 GPT‑6 Astra、Gemini 3.8 Flash、DeepSeek V4 Pro/Flash、GLM‑5.3、Grok‑4.6；同步不改变既有默认模型。随后发现泛用 `emperor.run.run` 未解析环境引用，已以第二个无迁移热修补齐并通过三服务、HTTP及入口哈希验证。经用户明确授权，一次合成、无用户数据的 `analysis.rufus.attribute` 健康运行成功（`gpt-5.5`、外部受治理路由）；未重试、读取或解析任何本品属性表，也未创建 AI Job、采集Job、Provider Run、关键词任务或Heartbeat。真实用户文件重跑仍须单独确认。

**Listing五点 Skill 提示词与质量路由**：生产审计确认`listing.bullets.generate`的数据库Prompt混入了旧中文通用/标题导向规则，且其`deepseek-chat`模型策略已停用，造成指令冲突与不稳定的备用模型路由。用户选择保留奥美资深英文文案角色、固定GPT‑6 Astra并授权一次合成验收后，已完成无迁移原子发布和受控`emperor.skills.update`。更新先补写不可变v2快照，再发布v3：运行时Prompt为单一的2,904字符奥美/FABE/200–280字符/JSON约束版本，Skill专属路由为`teamo-gpt-6-astra`。一次不含用户、项目、ASIN或上传文件的合成运行成功返回5条结构化Bullet（240、230、242、242、252字符），全部合规；没有重跑、覆盖或修改任何真实Listing。Skill编辑页现在明确运行时版本与保存前快照语义。

**高质量 Skill 全量治理修复**：用户授权全量修复后，已对已发布的80个高质量/高影响 Skill 完成无结构迁移原子发布与受控配置更新。每项保留既有业务专长和任务字段，同时写入输入证据、缺失数据、JSON草案、人工复核、推荐而非执行以及禁止自动外部动作的统一合同；质量优先预设使用已登记的`teamo-gpt-6-astra`，通用皇帝 Skill 入口也已收敛到同一Runner，避免UI与业务/Agent路由漂移。生产预览80/80，实际更新80；新增79个治理快照，另1项由不可变快照唯一约束安全去重，80项均具备历史快照覆盖。静态复验80/80治理字段有效，`listing.bullets.generate`专属路由为GPT‑6 Astra，三服务active、本机HTTP 200、入口SHA一致。未触发模型、用户文件、AI Job、采集、关键词或Heartbeat；后续如需80项合成模型评测，须按费用和样例另行明确授权。

**高质量 Skill 防漂移热修**：首次治理发布后补充创建/编辑入口的强制再治理，防止管理员普通编辑覆盖80个范围内 Skill 的证据、人审、草案、禁止自动执行或质量路由合同。已完成第二次无结构迁移原子热修并复验三服务active、HTTP 200、入口SHA一致；再核验80/80治理字段有效，无模型或业务任务调用。

**高质量 Skill 提示词恢复与 Listing 奥美统一**：用户提出提示词与历史不一致后，生产只读逐项比对确认73项仅被追加治理长文本、6项被专项改写/清理、五点生成则为用户已确认的奥美v3。按用户选择，已无结构迁移原子发布并通过事务恢复79项治理前原专业提示词，五点生成继续保持验收过的奥美v3；21项`listing.*`均新增一致、短小的奥美方法论角色层。长治理提示不再污染业务Prompt，人审、禁止自动执行、质量模型策略和审计继续由Manifest、Runner、Run记录与UI强制。恢复前建80项独立快照，静态复验79项历史匹配、五点v3、21项奥美、0无效、无模型调用；三服务active、HTTP 200、SHA一致。

## 扩展已知风险

Provider主图/A+能力必须在A0实样验证；生产Apify Secret已通过受控后台配置和轻量校验。竞品监控初始Actor在已测资格样本返回0条记录；替代Actor已返回完整必要字段，但先前Adapter存在已修复的蛇形字段兼容缺口。Provider尚未通过真实完整资格门禁，且Actor存在计费、限流、空结果与Schema漂移风险；大量图片必须逐图、分区、分批保证全覆盖；历史数据不批量重采；旧爬虫已退役且不得作为失败回退；青岛独立站每阶段仍须遵循独立的生产变更与费用授权边界。


**图片工作流 Step 4 前端崩溃（2026-09-23）**：用户截图确认 `ReferenceError: hasData is not defined`。根因是参考图确认组件将未声明的 `hasData` 传给头部组件；全局错误边界使浏览器渲染错误表现为整页崩溃。现从水合编辑数据安全派生该状态并增加契约回归。定向4个测试文件9项、ESLint、生产构建与Bundle预算通过；青岛无迁移原子发布，三服务active、本机HTTP 200、公共域名已引用新图片工作流资源。没有调用模型、重试图片任务或修改已有会话。


**双站前端未定义变量审计（2026-09-23）**：针对图片工作流的 `hasData` 崩溃进行全量扩展审计，确认并修复两个同类前端 `ReferenceError` 风险：产品开发数据上传“补录缺失产品”按钮调用过期 `setManualProductOpen`，以及产品总览财务利润卡片遗漏解构 `legacyFinancialProfitMonths`。两处均改为既有状态/安全默认值，并新增回归。修复后全量 TypeScript 从149项历史诊断降为146项，客户端 `Cannot find name` 类诊断为0；定向11项测试、ESLint、生产构建及Bundle预算通过。青岛无迁移原子发布后Web/Worker/Scheduler均active、本机HTTP200、入口SHA一致，公共入口已引用新的图片和运营产品资源；Manus托管站全部93个动态资源HTTP200。未调用模型、未重试图片任务或修改业务数据。

**托管资源一致性与构建门禁（2026-09-23）**：Manus托管发布切换期间曾观察到旧入口与新分块短暂不一致；当前无缓存入口`index-BsTxb_Xj.js`的94个动态导入资源已全部HTTP200。为避免被大量历史类型诊断掩盖的前端未声明变量再次进入构建，新增`check:client-runtime-identifiers`并接入`pnpm build`；它只拦截客户端TS2304、TS2448、TS2454、TS2552，完整构建已验证通过。


**SellerSprite竞品批量分析失败反馈与Teamorouter端点兼容修复（2026-09-23）**：用户截图显示批量导入后“0成功、18失败”，历史实现只汇总计数，未向前端提供逐条、脱敏且可行动的失败原因；因此历史18条不可在不重跑的前提下精确归因。只读目录核验确认双站受控凭据、44个模型目录、`claude-opus-5`和`gpt-6-astra`均可用；发现托管站遗留`.com`基址而青岛为`.cn`，旧入口依赖已退役SOCKS，已作为兼容风险在运行时及模型健康检查中规范为官方`.cn`。批处理现在返回ASIN级安全失败分类，成功行自动取消勾选、失败行保留但绝不自动重跑。定向Vitest、ESLint、客户端未定义标识符门禁与生产构建通过；完整tsc仍有146项既有历史诊断，新增涉及路径为0。青岛无迁移原子发布并健康/入口SHA一致；Manus托管站已切换至新版入口`index-By1CIoET.js`，其`AnalysisPage-Di_T4Mmb.js`包含失败反馈合同，94个动态资源均HTTP200。未调用模型、未重试18条、未创建Provider/采集/关键词/Heartbeat任务。


**Listing五点自检质量与0/15评分修复（2026-09-23）**：用户截图中的247字符五点文案被展示为0/15并非可信质量判定。只读审计确认自检Skill的空/键漂移响应被页面按完整评分卡渲染，并且五类自检没有显式走质量优先GPT‑6 Astra。已新增严格完整评分合同（不完整结果不计分，提示重新自检）、批量自检最新状态累积保存、五类自检的受治理`quality_first`执行预设、Q&A输出键对齐；Skill配置统一为结构化草案、人工审核、禁止自动执行并以GPT‑6 Astra作为quality/evaluation路由。青岛无迁移原子发布后Web/Worker/Scheduler active、本机HTTP 200、入口哈希一致；青岛和托管站均已静态验收五个Skill完整合同与GPT‑6 Astra活动路由。未重跑用户Listing、文件或模型。详细证据见`docs/validation/listing-checklist-quality-remediation-2026-09-23.md`。


**Listing自检未通过原因与修改建议（2026-09-23）**：针对用户提出的“显示未通过原因和修改意见”，已将五类Listing自检（五点、标题、描述、搜索词、Q&A）升级为严格的可操作反馈合同。每一维必须返回`pass`、`notes`、`reason`、`suggestion`和可选`evidenceQuote`；未通过维度的原因和建议为非空必填，且建议只能基于现有产品事实，禁止自动改写、编造数据或自动确认。前端在有未通过项时自动展开并显示“未通过原因”“对应内容”和“修改建议”；任何不完整或键漂移结果均不计分，避免模型格式故障伪装为0分。五类Skill均继续使用受治理的GPT‑6 Astra质量优先路由。青岛无迁移原子发布、五Skill配置静态验证和托管站配置应用已完成；未重跑用户内容、未调用模型。


**主图片采集 Provider 资格验证完成（2026-09-23）**：在用户一次、最高0.10 USD的明确授权下，`apify-amazon-primary` 的受控资格任务已成功完成，Run费用为0.00 USD。Profile仅自动启用经实际观察通过的`catalog_basic`和`image_gallery`，A+、品牌故事和Listing内容继续保持未资格验证、不可调用。资格样本、原始载荷、竞品图片、URL和密钥均未进入业务快照或客户端；仅保留脱敏Job/Run审计结论。三项青岛服务active、HTTP健康且入口哈希已验证；未重跑用户业务任务，未启动关键词或Heartbeat。


**图片知识库首次采集能力门禁修复（2026-09-28）**：主 Provider 已通过`catalog_basic`与`image_gallery`资格，但图片知识库的首次导入仍错误地把`aplus`、`brand_story`作为硬性请求，导致在外呼前被正确但不符合首期目标的能力门禁拒绝。现首次单ASIN、链接和批量导入仅请求已验证的基础信息与主/副图库；A+/品牌故事仍仅能经显式图位刷新请求且继续失败关闭，绝不静默降级或自行启用。定向4项回归、ESLint、客户端标识符门禁、生产构建和Bundle预算通过；青岛无迁移原子发布后，三服务active、HTTP健康、入口SHA和公共图片库分块均已静态复验。未创建业务采集、Provider Run、AI Job、关键词或Heartbeat。


**A+与品牌故事扩展资格验证（2026-09-28）**：用户授权一次最高$0.10的受控扩展资格任务后，主Provider在不撤销既有基础目录/图库能力的前提下，成功观测`catalog_basic`、`image_gallery`、`aplus`、`brand_story`四项能力；Qualification Job为confirmed、Run为succeeded、实际费用$0.00、样本及原始载荷均未持久化。Provider Profile维持active并安全扩展为四项完整图片能力；图片知识库ASIN/链接/批量导入已恢复完整四项请求。青岛Web、Worker、Scheduler均active，本机HTTP 200；未自动创建业务采集任务、未启动关键词或Heartbeat。


**统一采集任务直接录入（2026-09-28，本地实现已完成、待独立生产发布授权）**：用户确认将所有当前统一Amazon采集消费者从人工Snapshot审核改为直接录入。实现已移除采集审核页面以及`review`、`saveReview`、`confirmReview`、`rejectReview`接口；历史审核深链安全跳转至采集任务中心。Provider成功后仍必须形成原始Artifact、Source Snapshot、不可变Confirmed Snapshot、确认版本、内容哈希和Consumer Link；只有规范化成功、能力/预算门禁通过、非partial/非schema drift，且所有返回图片已安全入库（图库请求还须至少有一张主图或副图）才以`system_direct_ingestion`来源自动确认并幂等投影。失败、部分、结构漂移、资格或预算不足一律失败关闭，绝不回退旧HTML爬虫。图片知识库、图片工作流竞品图库、Listing知识库、产品知识库、项目竞品、转化采集和监控消费者均使用此入库路径。AI分析和Listing生成的可编辑人工确认仍保留，因为它们是业务草案确认而非采集审核。定向8个Vitest文件22项、零警告ESLint、客户端标识符门禁、生产构建/Bundle预算和差异检查均通过；全局`tsc`仍有143项既有诊断，本次相关文件新增为0。未调用Provider/AI、未创建业务任务、未执行迁移或生产发布。详细验证记录：`docs/validation/acquisition-direct-ingestion-2026-09-28.md`。


**统一采集任务直接录入生产发布（2026-09-28）**：用户已授权后完成青岛无迁移原子发布。发布前严格构建隐私审计发现MCP连接字段的客户端示例使用数据库URI形式，占位文本已改为非URI的受控说明；重新构建后无真实凭据、数据库URI、私钥、环境文件、数据库文件或本地路径进入发布包。发布包与远端staging的SHA-256均校验一致，旧`dist`已版本化备份，Web/Worker/Scheduler三服务均active、本机HTTP 200，公网入口与采集任务、图片工作流、图片知识库、MCP管理等更新资源均HTTP 200。未执行迁移、未调用Provider/AI、未创建业务采集、关键词或Heartbeat。发布后只读发现生产`OAUTH_SERVER_URL`、OAuth portal和App ID运行配置为空，新的Manus OAuth回调目前不能完成；该项与本次直录功能无关且会影响认证访问，未擅自修改，需单独授权后按认证配置流程修复。详细证据：`docs/validation/acquisition-direct-ingestion-2026-09-28.md`。


**历史采集任务状态澄清（2026-09-28，本地待发布）**：发布后截图显示三条旧任务仍标记`review_required`，页面右侧错误复用“等待安全校验”，易误解为还需要人工审核。只读生产审计确认三条旧Provider Run均成功且费用0.00，但Source Snapshot仍为`pending_review`、没有Confirmed Snapshot或Consumer Link；分别有1、2、23张返回图片未完成安全存储，故不满足直接入库门禁，不能伪造为已入库。已将页面文案改为：新任务`queued/running`显示“自动安全校验中（无需人工审核）”，旧`review_required`显示“历史任务：安全入库未完成”，`confirmed`保持“已直接录入”。未弱化任何资产门禁、未重跑Provider/AI或写入旧业务数据。定向8项Vitest、零警告ESLint、客户端标识符门禁、源文案扫描和生产构建/Bundle预算通过；待用户单独授权无迁移发布此纯UI澄清补丁。详见`docs/validation/acquisition-direct-ingestion-2026-09-28.md`。


**部分直接入库（2026-09-28，本地待发布）**：用户明确确认“有缺失的也直接入库”，且要展示已入库图片、提示缺口，并支持人工补充/重新采集。统一采集状态机已调整为：正常化通过且至少有一张主图/副图安全存储时，立即自动确认Snapshot、只投影安全存储资产，并在Snapshot审计注记中记录缺失计数；没有可用主图/副图、结构异常或Provider部分/失败仍安全关闭。图片知识库详情新增部分入库提示及“人工补图/重新采集”动作；重新采集仍创建新的、预算/资格受控的Job。竞品图库文案同步改为仅展示已安全保存图片。历史`review_required`任务提供认证后的一键“直接入库已保存图片”，不调用Provider、不产生费用；等待用户授权发布以及对历史业务记录执行该动作。10项定向Vitest、零警告ESLint、client标识符门禁和build/Bundle预算通过；全局tsc仍143项既有诊断、涉及文件0新增。


**部分直接入库生产发布与历史任务激活（2026-09-28）**：用户明确授权后，完成青岛无迁移原子发布，Web/Worker/Scheduler均active、本机HTTP和两个公网入口均200、运行入口和部分入库标记已复验，保留版本化`dist`回滚备份。首个SCP传输在4%卡住，未替换远端工件即停止；复验远端维持旧哈希后，以断点校验传输完成原子切换。构建隐私审计未发现真实凭据；宽松`sk-`正则仅命中第三方Emacs-Lisp语法依赖的两个固定字符串，哈希与依赖源码匹配。随后仅对截图历史任务3/4/5执行单一事务直接入库：图片知识库18张缺1、竞品图库17张缺2、图片知识库63张缺23；三条均保留一次0.00 USD成功Run，状态/快照均confirmed、消费者链接/知识库集合/竞品研究对象复验存在。没有调用Provider、AI或旧HTML爬虫，没有生成我方素材。详见`docs/validation/acquisition-direct-ingestion-2026-09-28.md`。


**图片知识库图库尺寸显示修复（2026-09-28，本地待发布）**：截图显示主/副图预览大面积空白、A+内容异常放大。证据显示这不是已入库图片URL缺失；根因是`AmazonStyleGallery`的主预览父容器没有确定高度而图片使用`h-full`，A+行也无确定预览高度，导致`object-contain`无法可靠约束比例。已只修改前端布局：主/副图区固定420px、A+图区固定320px并使用绝对定位`object-contain`，品牌故事缩略图由裁剪改为完整等比显示。没有重采集、改动图片对象、Provider调用或业务数据写入。2项回归、零警告ESLint、标识符门禁、构建与Bundle预算通过；全局tsc仍143项历史诊断且涉及文件0新增。待用户授权青岛无迁移发布。


**图片知识库图库尺寸修复生产发布（2026-09-28）**：用户授权后完成青岛无迁移原子发布；保留版本化dist回滚备份，Web/Worker/Scheduler active，`/knowledge/images`本机200、公网路由及新版KBImages懒加载资源均200，部署资源含固定A+预览框和完整等比品牌故事规则。未重采集、未调用Provider/AI、未修改已入库图片或业务数据。


**图片知识库平衡留白预览（2026-09-28，本地待发布）**：用户指出固定尺寸后源图自身留白的视觉位置仍不符合旧版参考。只读像素测量确认示例源图为近正方形画布且有效内容中心低于画布中心；因此不能用裁剪解决。已实现无损“平衡留白”预览：保留`object-contain`，在浏览器本地低分辨率检测非空白内容边界后，仅对预览作受边界约束的平移，使视觉主体更居中，同时为主/副图与A+均提供“完整画布 / 平衡留白”可逆切换。没有修改原图、图片记录、Snapshot或任务。3项回归、零警告ESLint、标识符门禁、构建及Bundle预算通过；全局tsc仍143项历史诊断且涉及文件0新增。待用户授权无迁移青岛发布。


**图片知识库平衡留白预览生产发布（2026-09-30）**：用户授权后，已将经回归、ESLint、客户端运行时标识符门禁、生产构建、Bundle预算和隐私审计验证的“平衡留白 / 完整画布”图库预览发布到青岛。采用传输SHA校验、staging入口文件哈希校验、带版本化dist回滚备份的原子替换；发布后Web/Worker/Scheduler均active，本机HTTP、知识库公网路由及新版KBImages资源均200，并静态确认平衡留白/完整画布文案存在。没有迁移、采集、Provider/AI调用或图片、业务数据写入。


**采集任务失败根因与直录映射修复（2026-10-05，本地待发布）**：用户报告智能图片建议的竞品图库任务失败。只读生产审计确认：Job/Run失败不是Apify、密钥、预算或资格问题；Provider Run实际成功（费用0.00 USD），原始结果已保存，77项候选资产中76项已安全存储。失败发生在Snapshot直录阶段：数据库中的`normalized_data`为完整JSON对象，但Worker的运行时行对象未提供`normalizedData`，结构化合同读到undefined并安全拒绝，误报`partial_result`。修复为兼容camelCase/snake_case JSON读取且拒绝畸形JSON；仅对`system_direct_ingestion_blocked`的历史快照开放可恢复直录，手动拒绝、无安全主/副图及Provider失败不放开。10项定向回归、ESLint、标识符门禁、构建和Bundle预算通过；全局TS仍143项历史诊断且改动文件无新增。待用户授权无迁移发布与对该已安全保存快照执行一次不调用Provider的恢复直录。


**竞品图库历史快照恢复成功（2026-10-05）**：在用户授权“无迁移发布 + 不重爬/不调用Provider/不新增费用”的范围内，已完成最终青岛原子发布及指定失败快照恢复。根因链经证据确定为两处直录映射缺陷：持久化JSON字段的历史物理列映射兼容，以及竞品图库投影把查询结果数组误当单行记录。两次早期恢复尝试均在同一数据库事务内自动回滚，未留下确认记录、关联或项目数据；最终修复集中JSON读取并显式选取查询首行。最终恢复前严格验证系统阻断标记、0既有确认和76项安全资产；恢复后Job/Snapshot均confirmed，76项图片已直接录入，1项缺口保留为可人工补充/受控重采集入口，竞品图库项目关联ready。唯一原Provider Run仍为USD 0.00，未新增Run、Provider或AI调用。4个定向测试文件14项通过、ESLint、标识符门禁、构建/Bundle/隐私审计通过，改动文件无新增TS诊断；最终三服务active、本机/公网HTTP 200、入口SHA一致，保留版本化dist回滚备份。

### 2026-10-06 — 智能图片建议“分析整套图片”启动失败修复（本地完成，待发布授权）
- **问题证据：** 用户截图中的“系统内部错误”发生在模型调用前。青岛只读日志将异常定位至 `startCompetitorGalleryAnalysisJob → ensureImageWorkflowAgentRun → ensureBusinessManagedRun`；`emperor_agent_runs` 的复用查询执行 `SELECT * ... ORDER BY createdAt DESC,id DESC LIMIT 1` 时，MySQL 因排序携带大型 JSON 执行载荷而返回 `Out of sort memory`。
- **最小修复：** 新增 `latestBusinessManagedRunQuery`，复用判定只读取实际所需的 `runId,status`；工作空间/Agent/项目条件、按时间/id选最新、复用状态规则和之后按`runId`完整受权读取均不变。此处不需要数据库迁移或扩大MySQL排序缓冲区。
- **影响边界：** 此共用查询亦用于 Listing、关键词和产品分析的业务托管Agent，修复对它们同样消除无关大JSON排序压力；不改变任何模型路由、Skill提示词、权限、Run状态或人审/可编辑结果合同。
- **验证：** 新增窄字段查询回归；4项Vitest、零警告ESLint、客户端未定义标识符门禁、生产构建和Bundle预算通过。全局TypeScript仍有143项已记录历史诊断，涉及两文件为0新增。生产只读最小查询已确认仅返回`runId,status`。
- **发布门槛：** 待用户授权无迁移发布青岛。发布仅做服务/静态健康验证，不点击“分析整套图片”，因为该业务动作将创建AI Job并可能调用已配置模型、产生模型费用。

### 2026-10-06 — 智能图片建议“分析整套图片”启动失败修复（青岛已发布）
用户确认后以无迁移原子流程发布 `agent-run-lookup-20261006T022213Z`。归档SHA、staging三个入口SHA均通过后才切换`dist`，旧版已保存为版本化回滚备份。Web/Worker/Scheduler均为`active`，生产入口哈希与本地候选一致，窄字段SQL标记存在，本机HTTP200；两个公网入口及图片工作流懒加载资源均HTTP200。发布后日志未发现新的`Out of sort memory`、Agent Run bridge 或未处理致命错误。没有点击“分析整套图片”，因而没有创建AI Job、调用模型/Provider、重爬或产生新费用；用户可在界面自行发起正常业务分析。


## 阶段A12：竞品图库人工分析范围治理（2026-10-06）

**目标**：保留主图、副图、A+和品牌故事的已安全保存竞品证据，但在“分析整套图片”前新增不可变、人工确认的分析范围版本。默认选择主图/副图及A+，默认不选择`brand_story`；只有范围内资产可进入逐图Skill、整套总结、表达方式候选和下游证据引用。

### Phase 1：范围数据合同与后端门禁 ✅

**完成内容**：新增`0202_competitor_gallery_analysis_scope.sql`与`image_competitor_gallery_selection_versions`；分析版本增加可空`selectionVersionId`保留历史兼容。新增范围哈希、默认角色、空/重复/跨图库资产拒绝、保存草稿/人工确认/版本替代及分析/表达/综合Artifact失效链。新Job输入强制绑定已确认`selectionVersionId`和范围哈希，运行前后均验证范围未被替代；逐图事实按内容哈希复用，仅为选中且未复用资产调用Skill。表达方式候选仅消费当前确认范围，范围外品牌故事永不进入后续候选。Skill总结Prompt明确未纳入图片不能被解释为缺失或不存在。

**安全边界**：本阶段只改本地源码与迁移草案；未应用迁移、未修改历史数据、未调用Provider或模型、未创建AI Job。实际生产迁移与发布仍需独立确认。

**验证**：竞品全图合同、范围合同、Job输入、表达联动及表达Job共14项Vitest通过；涉及文件新增TypeScript诊断为0。全量`tsc`仍有144项既有历史诊断。

### Phase 2：范围选择前端与覆盖提示（进行中）

**计划内容**：在主要竞品卡增加配置范围面板，按主图/副图、A+、品牌故事分组显示缩略图，支持默认选择、逐张/按角色批量选择、保存草稿、确认范围和启动范围内分析；在结果和图片卡展示当前范围、未纳入原因、复用/新增分析数量与范围覆盖摘要。


**Phase 2 完成（2026-10-06）**：主要竞品图库已增加“本次图片分析范围”卡片，按主图/副图、A+、品牌故事汇总并显示范围外提示；支持默认选择、全选、清空、逐图勾选、保存草稿和人工确认。分析入口更名为“分析已选图片”，无已确认范围时安全禁用。范围外图片仍可查看和保留，但不进入AI、表达候选或综合结论。16项定向Vitest、零警告ESLint、客户端标识符门禁、生产构建与Bundle预算均通过；涉及文件新增TypeScript诊断0，全局仍有143项历史诊断。未执行0202、未修改历史数据、未调用Provider/模型或产生费用。详细验证：`docs/validation/brand-story-analysis-scope-2026-10-06.md`。


**发布前隐私门禁修复（2026-10-06）**：0202候选构建审计发现用户管理创建/重置/批量导入仍有固定初始密码进入服务端bundle，已在同一候选中改为服务端随机16位临时密码。批量导入每人独立密码、仅在当前管理员窗口一次性显示；关闭后不保存明文。用户创建界面不再预填密码，首次登录仍强制修改。24项用户管理回归、涉及文件零警告ESLint、客户端门禁、生产构建/Bundle预算和凭据值审计通过；未读取或改变现有用户密码。该安全修复是0202迁移与青岛发布前置。


**竞品图库分析范围治理青岛发布（2026-10-06）**：用户已授权0202结构迁移与发布。首次staging校验因manifest包含自身被安全阻断，未迁移/未切换；修正后受控runner取得锁并以checksum `d8ee225d…`成功记录0202。不可变范围版本表及analysis selectionVersionId列已复验，随后版本化备份、原子替换dist并重启三服务。生产三服务active、本机/公网/图片工作流资源HTTP200、入口哈希匹配、近15分钟无致命前端/服务端错误。未执行采集、分析、Provider/模型调用或既有用户密码变更。


### 2026-10-06：外部知识库调用方绑定、故障恢复体验与全站类型质量（待发布）

- 外部知识库 REST 已改为由受控调用方令牌绑定一个启用 Connector、一个工作空间和服务端只读范围；不信任请求头中的工作空间，取消全局回退认证。新增 0203 专用迁移与皇帝中台的调用方登记/撤销入口；令牌仅创建时单次展示、哈希保存。未迁移前不创建调用方或外部调用。
- 静态内容哈希缓存、网络恢复横幅和全局错误边界已改善；缺失数据源页面明确显示不可用/待导入，不能显示伪零值或伪生成结果。
- 已解决全站剩余 106 项既有 TypeScript 诊断：`pnpm exec tsc --noEmit --pretty false` 为 0。客户端标识符门禁、生产构建和 Bundle 预算通过；相关专用迁移计划、授权与 UI 合同回归通过。
- 发布策略：0203 只能走显式专用执行计划，常规计划不会重放已人工发布的 0196–0202。下一步按青岛发布纪律执行：迁移前 schema/ledger 预检、0203 单独受控迁移、可验证原子 dist 切换、三服务和本机/公网入口复验；不得调用 Provider、AI 或重跑业务任务。


**青岛受控发布完成（2026-10-06）**：0203已通过专用迁移计划单独执行并成功记录在迁移账本，常规计划继续排除已人工发布的0196–0202。完整构建包经凭据与完整性检查后原子切换，旧`dist`已保存为版本化回滚副本；一次不完整归档在清单校验阶段安全终止，未发生迁移或切换。发布后Web/Worker/Scheduler均active、本机HTTP200、首页与当前哈希资源公网HTTP200，哈希资源缓存头为`public, max-age=31536000, immutable`，未授权外部知识库请求返回`401 AUTH_REQUIRED`，近窗口无新的致命前端/服务端错误。未创建调用方令牌，未调用Provider、AI或业务任务。


---

## 2026-10-06｜前端性能 P0–P4 优化与青岛发布（已完成）

### 已实施

1. **P0 静态资源**：青岛 Nginx 直接服务内容哈希 `/assets/`，一年 immutable 缓存和 gzip 协商；应用 HTML 继续 `no-store`，旧哈希保持真实 404 以触发既有懒模块恢复。
2. **P1 可观测性**：受登录、工作空间隔离和限流约束的浏览器 Web Vitals（LCP、INP、CLS、TTFB、FCP）采集；皇帝观测页展示聚合分位指标；不保存用户内容、ASIN 或图片。
3. **P2 图片路径**：非首屏图库图片延迟加载并异步解码；知识库首缩略图保留优先加载；维持现有虚拟瀑布流。
4. **P3 分包**：富文本渲染按需加载；富文本、图表与图形依赖分包，降低首屏必需负载。
5. **P4 恢复与优雅停止**：请求标识/`Server-Timing`、排空健康状态、优雅 SIGTERM、网络横幅及可恢复错误边界事件编号。

### 验证与发布

- 全量 TypeScript `tsc --noEmit`：**0 诊断**。
- 客户端标识符门禁、ESLint、生产构建与 Bundle 预算通过；P0–P4 定向 7 个测试文件、13 项回归通过。
- 生产包完成敏感字面量和禁止文件审计。暂存清单的首次跨主机默认排序差异被安全阻止，使用固定字节序复核成功后才原子切换。
- 青岛 Web/Worker/Scheduler 均 active；健康端点 `draining: false`；公网新 hash JS/CSS gzip + immutable，HTML no-store，旧资源 404，未登录性能写入 401。
- 未创建采集/AI/Provider 任务，没有产生新费用，也没有修改业务数据。
- 详细证据：`docs/validation/frontend-performance-optimization-2026-10-06.md`。

### 已知后续项

生产存在历史 Manus OAuth 基址为空的启动告警。当前健康、页面渲染与本次性能路径正常；由于没有可验证的正确 OAuth 提供方地址，本次未猜测或写入配置。若要治理该历史登录路径，应以已确认的 OAuth 提供方配置为单独变更。

## 2026-10-07｜Listing 单条卖点精雕 v6（本地及青岛生产已完成）

- [x] 统一工作流权威 `listing.bullet.step.generate` 和手动试写 `listing.bullet.single` 的奥美式自然美式英语提示词与结构化合同；角色层只注入一次，FABE 不机械输出。
- [x] 服务端工作流与优化候选统一确定性质量门禁、事实追溯、有限重试；原文/重复候选及跨工作空间访问失败关闭；人工确认边界保持。
- [x] 自检15维与人工可编辑建议、异步旧结果防护、内容指纹评分持久化、Skill用途说明；开发库三项Skill受控更新及快照，预览显示零待变更。
- [x] 定向/邻接离线回归、零警告ESLint、全量tsc、客户端标识符检查和生产构建/Bundle预算通过；见 `docs/validation/listing-single-bullet-v6-2026-10-07.md`。
- [x] 获用户独立授权后完成青岛生产三项受治理Skill事务快照及升级、版本化备份与三服务原子切换；516文件清单、本机/公网新入口、静态头及旧资源404均通过，不调用模型/Provider、不重跑历史Listing。
- [ ] 如需实测自然美式英语质量，另行授权一次合成无用户数据的受治理模型验收；当前静态测试不构成文案质量保证。

## 2026-10-07｜Listing v6 历史数据影子评估（一次性，完成）
- [x] 用户选择范围 A 且不设费用上限；只读取13个有原始属性表的历史Listing项目，生成65条独立候选，均通过生产 `listing.bullet.step.generate` v6受治理Skill Run。另5个缺属性表项目未重跑；无正式Listing覆盖、人工确认或对外发布。
- [x] 生产只读回验：13个旧Listing与原始属性文件哈希均未变化，65条任务均完成，三服务active；候选与逐项来源保存在仓库外私有审核文件。
- [x] 61/65仅通过单条确定性门禁；二次筛查发现11条误引用上传模板空白/示例，另1条同项目标题重复。扣除显著风险后最多49条需要人工复核，**不是可发布率**。历史影子输入按字段顺序匹配，未经过卖点核心确认，不能据此证明新版奥美式自然美式英语质量。
- [x] 一次性评估工具本地增加审批清单哈希、同空间活跃成员核验、原始上传及前后变更检查、数据库围栏锁、调用意图日志、私有结果目录和模板占位过滤回归。最后占位过滤是本地工具修复，不自动再调用模型或改动已发布站点。
- [ ] P0：将占位事实过滤与人工确认核心门禁纳入正式Listing前中后台流程；缺依据不允许生成可同步的候选。
- [ ] P1：五点之间同步已确认卖点作为差异化输入；对自然美式英语进行人工审校；影子候选如需在站点内选择/编辑/确认，另设计工作空间隔离和完整审核轨迹。
## 2026-10-07｜Listing 单条卖点 v7 事实与模板防护（本地已实施，青岛待授权）
- [x] 用影子评估发现的空白/示例误判构建离线回归：前端确认提示、G1核心/整套五点双阶段和单条工作流、再次优化、皇帝库手动试写共用事实拒绝策略；产品身份与AI属性分析在入模前过滤，原文模板示例即使被AI摘成裸数字也不能重新成为本品证据。
- [x] 读取最新完整原始属性上传与同源分析，4KB预览截断则走受控存储、哈希校验、最大2MB和失败关闭；同秒上传以文件ID确定顺序。旧核心草案/优化候选保持可查看但不可绕过确认，用户人工编辑不会解除陈旧标记。
- [x] Listing项目读取、版本/计划/自检/新旧生成Job统一以当前workspaceId范围解析；Worker执行期再次限定已授权Job工作空间。开发库两项受治理Skill通过事务快照由v6提示词升级为v7，二次预览无待变更；自检Skill保留原v6合同。
- [x] 本地第三轮功能复核的重试绕过已修复；19文件171项离线回归、零警告ESLint、全量TypeScript、客户端门禁、正式构建和Bundle预算通过。详见 `docs/validation/listing-single-bullet-v7-fact-safety-2026-10-07.md`；未调用真实模型或重跑旧影子候选。可恢复检查点保存后记录版本。
- [ ] 若需青岛上线，应另获独立授权：只读预检生产两Skill与服务、单次事务更新/旧版快照、版本化dist原子发布/静态健康验收；不自动重做65条影子结果或覆盖既有Listing。
- [ ] 后续单独设计服务端可验证的核心确认版本/确认人证据和五点跨条自然美式英语人工审校；现有内存确认态不能单独证明事实为真。
