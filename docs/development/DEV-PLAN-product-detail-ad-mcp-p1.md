# 开发计划：产品详情广告 MCP 自动录入 P1

**关联规格：** `docs/product-specs/product-detail-ad-mcp-p1-product-spec.md`  
**目标：** 建设受治理的广告事实自动写入和父 ASIN 完整自然周详情展示，不引入搜索词、关键词或投放目标数据域。

## 技术基线

项目采用 React 19、TypeScript、Tailwind 4、Vite、Express 4、tRPC 11、Drizzle/MySQL 和 Vitest。广告 MCP 调用复用现有领星只读连接与 `ops_external_sync_batches`/`ops_external_sync_rows`/`ops_lingxing_sync_schedules` 的批次、行级审计和Heartbeat运行治理。每日执行由站内受管回调触发，禁止进程内定时器。

## 阶段 1：广告事实与映射基础

**交付物。** 建立广告 Profile 映射、广告商品日事实和广告活动日事实的独立模型，且每条可应用事实均可反向关联其受治理批次和来源行哈希。

**关键文件。** `drizzle/schema/ads.ts`、`drizzle/migrations/<new>_ads_mcp_facts.sql`、`server/domains/ops/adsMcpFacts.ts`、相应 Vitest。

**验收标准。** 迁移文件与schema一致，SQL通过平台数据库迁移工具应用；工作空间隔离、唯一身份、同源修订、Profile映射和批次索引均有测试覆盖；不得修改上传型广告表或ASIN日快照表。

## 阶段 2：受治理日读取、校验与自动应用

**交付物。** 将广告授权店铺、广告商品和广告活动三类报告接入既有领星同步路由和计划运行骨架。实现单Profile×单日串行分页、总计行过滤、来源哈希、Profile→SID×站点映射、子ASIN→父ASIN回溯、事实upsert和异常失败关闭。

**关键文件。** `server/routers/lingxingSync.ts`、`server/domains/ops/lingxingScheduledDrafts.ts`、`server/domains/ops/adsMcpFacts.ts`、`shared/lingxingSyncRules.ts`、`server/lingxingAdsMcp*.test.ts`。

**验收标准。** 正常完整窗口自动应用；任一覆盖或身份门禁失败不写事实；同源修订不累计；QPS=1和幂等运行键保持；不调用未纳入P1的广告报告。

## 阶段 3：父 ASIN自然周查询与详情界面

**交付物。** 新增父ASIN×店铺SID×站点×完整自然周广告查询，产品详情来源型视图呈现周度商品KPI、活动辅助列表、周范围、来源与映射覆盖状态；移除其对旧30天广告概览的权威依赖。

**关键文件。** `server/domains/ops/productOverview/dailyAggregation.ts` 或新的 `adWeeklyAggregation.ts`、`server/domains/ops/routers/products.ts`或实际详情路由、`client/src/pages/ops/OpsProductDetail.tsx`、前端契约测试。

**验收标准。** 详情默认最近完整周；所有比率在周度聚合后重算；活动指标不计入商品KPI；空/待复核/部分数据状态可解释；搜索词、关键词、投放目标没有入口或查询。

## 阶段 4：回归、发布与首周运行

**交付物。** 完成迁移、定向Vitest、变更文件 ESLint、生产构建、`git diff --check`、两阶段代码审查；保存版本后按青岛受控发布纪律发布。发布完成后再由用户单独确认首次完整自然周的真实广告读取与自动应用。

**关键文件。** 所有本期变更、`todo.md`、`docs/validation/`。

**验收标准。** 本轮文件无新增TypeScript诊断；已知历史诊断单独报告；新dist通过哈希校验、备份和原子替换后，Web/Worker/Scheduler健康；真实读取前不产生广告事实写入。

## 数据模型摘要

| 表 | 创建阶段 | 目的 |
| --- | --- | --- |
| `ops_ad_mcp_profiles` | 1 | Profile 到SID×站点的确定性目录。 |
| `ops_ad_mcp_product_daily_facts` | 1 | 广告商品/子ASIN维度的日事实，供父ASIN周度KPI使用。 |
| `ops_ad_mcp_campaign_daily_facts` | 1 | 广告活动维度的日事实，供详情辅助活动列表使用。 |
| 既有 `ops_external_sync_*` | 2 | 承载读取草稿、来源哈希、校验、确认/自动应用、Run/Trace审计。 |
| 既有 `ops_lingxing_sync_schedules` | 2 | 承载广告数据域的每日运行、幂等键与失败摘要。 |

## 已知风险与控制

| 风险 | 控制措施 |
| --- | --- |
| Profile无法唯一对应SID | 失败关闭，不使用店铺名称猜测。 |
| 报告含总计行或分页元数据变化 | 总计行隔离；截断或非预期形态不写入。 |
| 广告ASIN无父ASIN映射 | 事实保留复核证据但不进入父ASIN KPI。 |
| 同一活动关联多个商品 | 活动仅做辅助信息，禁止分摊或复制到商品KPI。 |
| 迟到归因数据修改 | 使用同源身份的版本/哈希修订，周度仅消费当前版本。 |
| 广告聚合数据双算 | 产品详情广告商品事实为广告KPI唯一来源；ASIN日快照广告字段不参与相加。 |
