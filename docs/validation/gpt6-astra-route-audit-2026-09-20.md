# GPT‑6 Astra 上下文与质量路由审计

**审计日期：** 2026-09-20  
**方式：** 青岛生产只读查询模型注册与 Skill Manifest；未调用模型，未变更任何路由或用户数据。

## 结论

生产中 **80 个高质量/高影响 Skill 的“质量优先”预设已经全部路由到 `teamo-gpt-6-astra`**，不存在遗漏。GPT‑6 Astra 当前为激活状态，目录声明的上下文上限为 **128,000 tokens**。所有已登记 Teamorouter 文本模型也均登记为 128,000 tokens，因此没有因静态上下文窗口差异而必须把默认模型升级到 GPT‑6 Astra 的 Skill。

当前只有 `listing.bullets.generate` 把 GPT‑6 Astra 设为**标准默认模型**；其余 79 个高质量 Skill 保持原有标准模型，在用户选“质量优先”时才切换到 GPT‑6 Astra。这是合理的成本与吞吐量分层：用户需要高质量时得到 GPT‑6；高频、常规草案不被强制升级为较高质量路由。

## 生产审计摘要

| 检查项 | 结果 | 说明 |
|---|---:|---|
| 已发布 Skill | 131 | 只读统计 |
| 高质量/高影响 Skill | 80 | 固定治理范围 |
| 质量优先使用 GPT‑6 Astra | 80/80 | 无遗漏 |
| 标准默认使用 GPT‑6 Astra | 1 | `listing.bullets.generate` |
| 静态上下文压力 | 0 | 已登记 Teamorouter 模型均为 128K；Skill 提示词长度不足以触发窗口压力 |
| 本次模型调用 | 0 | 仅数据库元数据审计 |

## 可考虑的默认质量升级清单

下列 Skill 不是“必须换模型”，而是**业务后果高、证据密度高或跨维度推理复杂**。如果希望用户不必手动选择“质量优先”，可以把其标准默认路由升级为 GPT‑6 Astra；这会提升每次常规运行的模型成本，因此应由产品策略确认。

| 组别 | 推荐候选 | 理由 |
|---|---|---|
| 广告深度诊断 | `ad.deep.cross.diagnosis`、`ad.deep.impression.analysis`、`ad.deep.placement.analysis`、`ad.deep.searchterm.analysis`、`ad.deep.stage.diagnosis` | 多指标归因、预算与投放决策建议，错误解释的业务影响较高。 |
| 竞品与产品开发 | `analysis.competitor.single`、`analysis.image.recognition`、`dev.analysis.decision_dashboard`、`dev.analysis.market_overview`、`dev.analysis.product` | 需要综合多源研究材料形成可审核的产品与市场判断。 |
| Listing 与经营决策 | `listing.competitor.analyze`、`ops.competitor.analysis`、`ops.inventory.analysis`、`ops.profit.analysis` | 对后续文案、库存及利润判断有较高影响，应优先减少推理质量波动。 |

其余高频但可快速人工审阅的草案、翻译、内容拆分、视频分镜和常规运营问答，保持标准模型、在需要时选择“质量优先”更合适。

## 上下文可观测性补充

审计发现 6 个非高质量 Skill 使用 `manus-default` 或一个未登记的历史模型标识，因此注册表没有其明确的上下文上限。这是**可观测性缺口**，而不是已确认的上下文错误；其中 `manus-default` 是受支持的内置回退标识。若后续需要按实际输入长度自动路由，应先给统一 Runner 增加输入 token 预估与模型上下文余量检查，再决定是否自动升级到 GPT‑6 Astra。

> 当前建议：保持 80 个质量优先路由不变；只在确认更高的常规运行成本后，将上述 14 个高后果分析 Skill 的默认模型提升为 GPT‑6 Astra。 

## 已确认的路由决策

用户于 2026-09-20 选择**保持现状**：所有 80 个高质量 Skill 仅在用户明确选择“质量优先”时使用 GPT‑6 Astra；`listing.bullets.generate` 继续保留其已验收的 GPT‑6 Astra 标准默认路由。此次决策不修改任何 Skill、模型目录、默认模型或用户任务，也不产生模型调用费用。
