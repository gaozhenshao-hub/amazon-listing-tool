# 高质量 Skill 提示词与模型路由只读审计

**审计日期：** 2026-09-20  
**范围：** 皇帝 AI 中台中状态为 `Released` 的 131 个 Skill；其中 80 个被归入“高质量、高风险决策、精雕、评测或高阶模型路由”范围。  
**执行边界：** 仅查询受治理 Skill 注册表、版本快照和运行账本元数据；未读取用户上传文件、未发送 Prompt 至模型、未生成或重跑任何业务内容、未改动生产配置或数据库记录。

## 执行摘要

审计确认：**模型路由当前不是阻断问题。** 初步将 Teamorouter 路由别名与供应商 `/models` 返回的原始模型 ID 直接对比，会产生“模型不存在”的错误结论。应用受治理注册表已将全部 80 个高质量 Skill 的路由别名解析至活动模型记录；此前 `listing.bullets.generate` 的 GPT‑6 Astra 合成验收也已成功。因此，本报告将“路由别名与原始模型 ID 名称不同”列为治理可维护性事项，而**不**列为生产 P0 故障。

真正需要优先处理的是三类提示词合同问题。第一类是**事实、数据和效果主张没有严格证据边界**，可能迫使模型补全价格、搜索量、评分、认证、保修、市场规模、销量、预测或竞品比较。第二类是**可解析结构不足或相互矛盾**，包括“只输出 JSON”但没有对象定义、JSON 示例与 Markdown 围栏冲突，或生成范围远大于单次结构化任务可稳定承载的范围。第三类是**人机决策边界未被写入输出合同**；对 Listing 草案、广告建议和产品开发决策，应该明确为待人工审核的建议，而非可直接执行的命令。

## 审计口径与结论边界

| 维度 | 审计结论 | 说明 |
|---|---|---|
| 已发布 Skill | 131 个 | 仅审计 `Released` 状态记录 |
| 高质量/高风险范围 | 80 个 | 包含 Listing、产品开发、运营、广告、视频、站外分析和图片规划 |
| 受治理路由解析 | 80/80 可解析 | 以应用内模型注册表为准，而不是将供应商原始 ID 与路由别名直接比较 |
| 真实模型调用 | 0 次 | 本次审计没有调用模型；此前 GPT‑6 Astra 的合成验收不属于本次审计 |
| 用户业务数据 | 未读取 | 未读取文件、项目、ASIN、竞品内容或真实 Listing |
| 配置/Prompt 写入 | 0 次 | 本报告仅提出方案，不修改生产 Prompt |

> **模型 ID 的正确解释：** `teamo-gpt-6-astra`、`teamo-claude-opus-5` 等是系统中受治理的路由别名；`gpt-6-astra`、`claude-opus-5` 等是供应商模型 ID。只要应用注册表能将前者解析至已启用的后者，名称不同不是故障。

## 高优先级提示词问题

### Listing 与图片规划

| Skill | 已证实问题 | 风险 | 建议的 Prompt/Schema 改造 |
|---|---|---|---|
| `listing.checklist.bullets` | 宣称检查 15 个维度，但未定义字段、类型或必填项 | 下游无法确定是否完成全部检查，结果格式易漂移 | 定义 `dimension/status/evidence/recommendation/score` 数组、总分、阻断项和 Schema 版本 |
| `listing.image.advice` | 一次要求主图、6 张辅图、视觉规范和 A+，但无字段级结构 | 输出容易截断、结构不完整，无法稳定编辑 | 拆分为图片策略、逐图创意简报、A+ 模块规划，或采用完整版本化 JSON Schema |
| `listing.bullet.refine` | 要求冲突时“说明”，但输出只允许 `subtitle/fullText` | 解释可能混入待上架文案，或模型违反合同 | 增加 `conflictDetected`、`conflictExplanation`、`proposedRewrite` 和 `requiresHumanConfirmation` |
| `listing.translate.chinese` | 元数据显示“英文→中文”，Prompt 实际要求“中文→英文”；还强制无来源的搜索量说明 | 翻译方向错误、虚构关键词指标 | 统一源/目标语言；搜索量改为可选且仅在输入提供来源时输出 |
| `listing.sellingpoints.generate` | 强制社会认同、量化主张和保修信任点，但无证据例外 | 诱发编造数字、保修和社会认同 | 每一项加入 `sourceFact/sourceId`；缺证时输出 `evidenceGap` 和人工补证请求 |
| `listing.abtest.generate`、`listing.scoring.overall` | 要求提升百分比、质量排名、CVR 影响，却不要求基线、样本、方法或置信度 | 假设可能被误当作经营事实 | 改为 `hypothesis`/`scenarioEstimate`；要求 `baseline`、`method`、`confidence`、`evidenceSource` |
| `listing.competitor.analyze` | 输出“最高搜索量”、价格带、评分等结论，但没有来源或缺失值规则 | 从 ASIN 文本推断无输入支持的市场事实 | 增加 `source`、`observedValue`、`observedAt`；未提供即返回 `unavailable` |
| `listing.title.generate` | 将特定“两段式标题”规则表述为全局硬性平台政策 | 市场、类目或政策版本不适用时造成错误合规限制 | 采用经确认的 `marketplace/category/policyProfile`；缺少配置时只生成草案并要求人工合规复核 |

当前的 `listing.bullet.step.generate` 是值得保留的基准：它限定单条任务、仅使用输入事实、禁止补造认证/数字/比较，并返回 `evidenceUsed` 与质量审核字段。后续 Listing Prompt 应以其“**单一任务 + 事实边界 + 结构化草案 + 人工审核**”模式为标准。

### 产品开发

| Skill | 已证实问题 | 风险 | 建议的 Prompt/Schema 改造 |
|---|---|---|---|
| `dev.analysis.product` | “严格 JSON”示例仍要求 Markdown 代码围栏 | 返回值不是可直接解析的 JSON | 改为纯 JSON，并由运行层以 Schema 强校验 |
| `dev.market.opportunity`、`dev.analysis.market_overview` | 市场规模、增长、收入、FBA 费用、利润、专利风险和进入时机没有输入证据/缺失数据分支 | 把不完整数据扩展为看似确定的商业结论 | 每项加入 `sourceRef`、`assumption`、`calculationMethod`；无法计算时 `null + insufficient_data` |
| `dev.analysis.decision_dashboard` | 禁止补造成本/销量，但仍将价格、首批量、月销量、盈亏月数作为必填数字 | 指令自相矛盾，易产生伪精确计划 | 数值字段支持 `null`，并增加 `basis`、`status: confirmed|estimate|insufficient_data` |
| 全部四项 | 输出含“进入/观望/不建议”“开发建议”等决策，但无人工审批状态 | AI 结果可能被下游误作自动立项或采购指令 | 加入 `recommendationOnly`、`humanReviewRequired`、`decisionOwner`、`openQuestions` |

### 运营、广告、内容、视频与站外分析

| Skill 族 | 已证实问题 | 风险 | 建议的 Prompt/Schema 改造 |
|---|---|---|---|
| `ad.chatbot` | 同时允许文字、可视化建议，又要求纯 JSON，且没有固定对象 | 解析和调用方行为不稳定 | 拆分为诊断、指标释义、策略问答，或以 `responseType` 定义唯一 Schema |
| 10 个 `offsite.*` 分析 Skill | 声称“纯 JSON”，但没有对象、字段、空数据或证据结构 | 无法验证正常空结果与编造结构 | 每个数据源定义 JSON Schema，至少含 `inputCoverage`、`evidence`、`limitations`、`recommendations` |
| 广告预算/竞价/暂停/否定词 Skill | 会给出预算、加价、暂停、否定词等操作建议，但无“仅建议、需人工批准”合同 | 高影响动作可能被自动执行或被误用 | 固定输出 `recommendationOnly`、`humanApprovalRequired`、`preconditions`、`evidence`、`confidence`、`rollbackOrMonitoringPlan` |
| 预测类 Skill | ROI、恢复概率、互动率、市场/销售预测没有假设、方法或置信度 | 产生不可审计的确定性承诺 | 使用 `scenarioEstimate`，要求输入时间窗、方法、假设、置信等级；数据不足时 `notEstimated` |
| 全部运营/内容 Skill | 主要输入都是无类型 `{{context}}` | 无法检查市场、货币、单位、时区、归因窗口和附件是否完整 | 每个 Skill 定义最小输入 Schema 和 `missingInputs` 输出字段 |

## 治理与可维护性事项

### 路由字段漂移（P2）

许多旧 Skill 同时保留 `modelOverride` 和 `modelPolicy`，两者常不相同；个别记录还出现过字符串化对象形式的旧策略。**当前有效执行应遵循优先级：运行时显式指定 > Skill `modelOverride` > `modelPolicy` > 系统默认。** 因此这不是当前 P0 故障，但会在迁移、回退或日后编辑时造成误解。

建议在获授权后，建立一份版本化模型路由注册表，明确每个 Skill 的首选模型、允许回退模型、能力标签、成本等级、所有者和停用日期。发布前执行静态检查：路由别名必须可解析，旧策略必须标记为弃用或与当前策略同步，禁止保存损坏的配置对象。

### 历史版本快照覆盖（P2）

审计发现 130 个旧 Skill 尚无历史版本快照。这是**历史治理缺口**，不是运行故障。已上线的更新逻辑会在后续每次编辑前保存当前版本快照；不建议为历史记录自动批量改写 Prompt 或伪造快照。后续应由管理员分批确认需要建立基线的高风险 Skill，并记录基线来源和审批人。

## 建议的修复顺序

| 阶段 | 范围 | 预期产物 | 模型调用/生产变更 |
|---|---|---|---|
| 0. 标准确认 | 业务、合规、产品共同确认政策适用范围与人工审批规则 | Prompt 标准、政策 Profile、事实状态枚举 | 无模型调用；无生产改动 |
| 1. 结构与事实合同 | 优先修复 Listing 五点自检、图片建议、翻译、卖点规划、开发/广告高影响 Skill | 输入/输出 JSON Schema、`evidence`、`missingInputs`、`humanReviewRequired` | 先本地回归；不重跑用户任务 |
| 2. 决策与操作门禁 | 广告预算、竞价、暂停、否定词、产品开发和市场进入建议 | 建议态、审批态、前提、监控与回滚字段 | 不执行外部操作；审批后才可执行 |
| 3. 路由治理收敛 | 全部皇帝 Skill | 单一路由注册表、别名解析校验、旧策略弃用记录 | 静态健康检查；无推理调用 |
| 4. 历史基线治理 | 高风险 Prompt 的历史版本 | 管理员确认的快照基线与变更审计 | 不自动覆盖旧 Prompt |

## 需要确认的框架决策

本次只读审计已经完成。后续不应直接逐条改 Prompt，而应先确认以下框架：**统一的事实状态枚举**（`grounded`、`needsVerification`、`insufficientData`）、**统一的人工审批状态**、**不同市场/类目的政策 Profile**，以及**哪类业务建议可包含情景估算**。确认后，可先按阶段 1 以最小范围修复 Listing 高质量 Skill，再扩展至广告与产品开发域。

> 所有生成输出都应保持为可编辑的结构化草案；只有人工确认后的字段才能进入下一流程，任何广告、采购、上新或外部发布动作均不得由 Skill 结果自动触发。
