# A6 同表达卖点图片点选联动与综合结论验证记录

**日期：** 2026-09-13  
**范围：** 统一受控Amazon采集平台阶段A6  
**环境：** Manus开发环境；青岛生产未迁移、未发布

## 交付摘要

A6在保留原有表达方向手工上传路径的基础上，新增了只面向Confirmed竞品研究资产的图库选择轨道。每个表达方向可以从全部已确认竞品图库中按卖点、表达方式、ASIN/竞品、竞品角色、图位、证明方式和置信度筛选，批量全选或采用AI推荐候选，并在已选托盘中去重、排序和保存Selection Version。历史手工上传继续保持每组1–5张限制，图库Selection不设置5张上限。

选择版本一旦变化，旧表达分析、综合分析和Composite Artifact立即转为`superseded`，历史版本保留但不可继续下游消费。表达分析只读取当前已确认Selection和已确认逐图事实；超过30张时按30张分批处理并合并所有批次。综合分析只读取已确认`competitor_gallery`与`expression_summary` Artifact，AI输出仅为候选，用户必须逐项选择至少一条才能确认Composite。

| 验收项 | 实现结果 |
|---|---|
| Confirmed资产门禁 | 只有已确认Research Subject、Confirmed Snapshot资产和已确认逐图事实进入候选。 |
| 工作空间与项目隔离 | tRPC入口复用项目、会话与写权限门禁；Service查询按workspace/project/group收敛。 |
| Selection版本 | 新选择生成递增版本；同一版本Asset唯一；记录人工或AI推荐来源、筛选状态和稳定哈希。 |
| AI分析覆盖 | 每批最多30张，超过30张逐批分析后再合并；不截断为前30张。 |
| 人工审核 | 表达分析和综合结论均为`review_required`；只有人工确认版本可生成Artifact。 |
| 综合决策 | 用户至少选择一项合法且证据完整的决策，只有选中项进入Composite和后续Step 1/2。 |
| 竞品图片边界 | 仅以Asset ID和文本事实作为研究证据；UI、Skill提示和下游上下文均声明不得作为我方生成素材。 |
| 会话生命周期 | 刷新与导出包含A6状态；重置Step 0只失效当前版本并保留历史。 |
| 旧流程兼容 | 原手工表达组、1–5张上传和原Step 0分析保留；未使用A6时不新增Composite门禁。 |

## 数据库与迁移

`0200_image_expression_asset_linkage.sql`只新增四张表，并幂等注册两个系统Skill。迁移不包含`DROP`、`ALTER`或业务数据重写。开发数据库已执行并只读核验四张表存在；青岛生产尚未执行。Drizzle自动生成曾因历史`execution_reviews.workspaceId`列重命名推断进入交互，已安全取消，未生成或执行无关迁移。

| 对象 | 用途 |
|---|---|
| `image_expression_selection_versions` | 表达方向图库选择版本、筛选条件、选择哈希与确认状态。 |
| `image_expression_asset_links` | Selection与Confirmed竞品Asset的有序链接及人工/AI推荐来源。 |
| `image_expression_analysis_versions` | 同表达资产分析版本、证据Asset、用户编辑和确认状态。 |
| `image_step0_synthesis_versions` | 全图与表达综合结论、人工选择决策及Composite确认版本。 |

## 自动验证

| 验证 | 结果 |
|---|---|
| A6合同、服务与Job测试 | 11项通过：去重、稳定哈希、67张分3批、表达证据、综合选择、Confirmed候选、跨项目拒绝、失效链、推荐来源和Job输入。 |
| A6及相邻工作流回归 | 15项通过，包含Step生成蒸馏绑定与Step 6既有测试。 |
| 定向TypeScript | A6新增Schema、Service、Repository、Job、路由和前端组件无诊断；项目仍保留既有全局TypeScript历史诊断，未归因于A6。 |
| 定向ESLint | 通过，无A6错误或Hook警告。 |
| 生产构建与Bundle预算 | 两次构建通过；最终客户端入口约0.89MB，Bundle预算通过。 |
| 页面验证 | 开发入口可加载；当前截图会话未选择项目，因此只能确认路由与页面壳层无崩溃，真实有Confirmed竞品数据的交互留待受控登录验收。 |

## 未执行事项

本阶段没有发起新的Amazon Provider调用、没有运行真实竞品AI分析、没有产生新的外部费用，也没有执行青岛0198/0199/0200迁移或生产发布。真实端到端验收需要后续分别获得Provider预算授权、真实LLM验收授权以及青岛迁移/发布授权。
