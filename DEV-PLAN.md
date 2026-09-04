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
