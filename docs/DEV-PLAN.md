# DEV-PLAN：模块三领星 ASIN 日粒度产品总览与库存规划

## 技术栈与约束

项目使用 React 19、TypeScript、Tailwind 4、Express 4、tRPC 11、Drizzle ORM 和 MySQL/TiDB。现有 `lingxing_product_weekly` 仅用于历史兼容读取；新领星日表以标准化 ASIN 日快照表落库。所有数据库变化通过 SQL 迁移先执行，再接入后端和前端。开发完成后必须进行类型检查、Vitest 回归、服务状态核验和检查点保存。

## Phase 1：日快照与库存规划数据库基础

- **交付物**：创建 ASIN 日快照、人工本地库存、本地库存版本、库存参数、补货计划和库存规划版本表；创建必要索引与工作空间约束。
- **关键文件**：`drizzle/schema/ops.ts`、`drizzle/0142_ops_asin_daily_inventory_planning.sql`、`server/repositories/ops/asinDailyRepository.ts`、`server/repositories/ops/inventoryPlanningRepository.ts`。
- **验收标准**：迁移在数据库执行成功；Schema 与数据库一致；日快照唯一键阻止同日同 ASIN 同店铺同国家重复；默认参数 30/30/10 可被读取。
- **状态**：✅ 迁移已执行；新增 5 张表和 `data_imports` 的日粒度/替代字段已核验；Schema 契约测试 4/4 通过。

## Phase 2：领星 ASIN 日表导入和批次替代

- **交付物**：解析器映射 `日期`；预览校验日粒度主键；以导入批次记录日表；替代同日期/来源批次时保留历史追溯。
- **关键文件**：`server/excelParser.ts`、`server/routers/dataImport.ts`、`server/repositories/ops/asinDailyRepository.ts`、`server/excelParser.test.ts`、`server/routers/dataImport.test.ts`。
- **验收标准**：用户提供的 7 天领星 ASIN 表可预览；日期不会丢失；406 个 ASIN和 330 个父 ASIN的连续 7 日记录完整写入；错误行在预览可见。
- **状态**：✅ 解析器已识别 `日期` 并返回 `daily`；上传批次保留粒度与替代关系；确认导入写入 ASIN 日快照，重传同周期文件会替代当前快照且保留旧文件记录。解析与 Schema 测试 5/5 通过，导入路由 esbuild 验证通过。

## Phase 3：父 ASIN 周汇总和详情变体数据接口

- **交付物**：实现父 ASIN + 店铺 + 国家 + 自然周汇总，和子 ASIN 最近 1–4 周销量、趋势、截止日库存接口。
- **关键文件**：`server/routers/dataImport.ts`（或拆分 `server/routers/opsProductOverview.ts`）、`server/repositories/ops/asinDailyRepository.ts`、`server/routers/opsProductOverview.test.ts`。
- **验收标准**：周销量跨子 ASIN和日记录正确求和；库存仅取周截止日最新快照；比率按汇总分子/分母重算；缺少 30 天样本时明确返回覆盖日数和样本不足。
- **状态**：✅ 已提供 `getLingxingDailyOverview` 与 `getLingxingDailyVariants`；周汇总按父 ASIN、店铺、国家和自然周组织，库存仅累加各子 ASIN 截止日快照。聚合测试 2/2 通过，路由 esbuild 验证通过。

## Phase 4：库存规划计算和人工确认

- **交付物**：实现 70 天默认货期、7/30 天加权日销、人工日销覆盖、人工本地库存确认、三日断货、建议下单日与补货量计算；实现参数与规划版本接口。
- **关键文件**：`server/domains/ops/inventoryPlanning/calculator.ts`、`server/routers/inventoryPlanning.ts`、`server/repositories/ops/inventoryPlanningRepository.ts`、`server/domains/ops/inventoryPlanning/calculator.test.ts`。
- **验收标准**：总库存严格等于 FBA 可售 + FBA 在途 + 已确认本地库存；默认总货期为 70；三日断货只在三日日快照完整时判断；人工调整与确认可审计。

## Phase 5：产品总览、详情页和库存工作台替换

- **交付物**：产品总览使用父 ASIN 周汇总；详情页底部静态变体表替换为最近 1–4 周销量与库存看板；`/ops/inventory` 完全替换旧预警页面。
- **关键文件**：`client/src/pages/ops/OpsProducts.tsx`、`client/src/pages/ops/OpsProductDetail.tsx`、`client/src/pages/ops/OpsInventory.tsx`、`client/src/pages/ops/components/VariantSalesInventoryTable.tsx`、`client/src/pages/ops/components/InventoryPlanningWorkbench.tsx`。
- **验收标准**：不新增产品数据上传入口；用户可切换 1–4 周；本地库存与参数修改的影响在界面立即可见；旧库存预警逻辑和入口不再显示。

## Phase 6：数据迁移、回归与发布

- **交付物**：执行迁移；针对真实用户提供表完成导入回归；补齐单元测试；进行类型检查、状态检查和检查点保存。
- **关键文件**：上述全部变更文件及测试文件。
- **验收标准**：迁移执行成功，测试全部通过，类型检查无错误，开发服务健康；检查点自动发布后，可通过生产域名验证产品总览、详情变体和库存规划。

## 数据库摘要

| 表 | 阶段 | 目的 |
|---|---|---|
| `ops_asin_daily_snapshots` | 1 | 领星/赛狐标准化 ASIN 日粒度事实层 |
| `ops_local_inventory_adjustments` | 1 | 人工本地库存可审计版本 |
| `ops_inventory_planning_parameters` | 1 | 30/30/10 默认值及三级覆盖 |
| `ops_replenishment_plans` | 1 | 已确认未来供给计划 |
| `ops_inventory_planning_versions` | 1 | 人工确认的库存规划快照 |

## 已知风险

新领星文件当前仅覆盖 7 个完整报告日，因此 30 天日销在首次导入后须明确标记样本不足，不能伪造成完整 30 天均值。人工本地库存没有历史版本时，不能反向影响此前日期的断货判断。赛狐文件待用户后续提供，本轮必须确保其缺席不会阻塞领星流程，也不能使用模拟赛狐数据。
