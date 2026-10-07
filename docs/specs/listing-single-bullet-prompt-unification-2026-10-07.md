# 单条卖点精雕：提示词、质量门禁与美式英语统一优化方案

**日期：** 2026-10-07  
**状态：** 待人工确认后实施  
**范围：** 美国站 Listing 的“分步骤卖点精雕 → 生成第 N 条 Bullet Point”链路；不重跑任何既有 Listing，不触发模型调用。

## 1. 结论

**需要优化，且不能只修改当前画面中的提示词。**

目前存在两个相近但不同的 Skill：

| Skill | 中文名 | 实际用途 | 当前问题 |
|---|---|---|---|
| `listing.bullet.single` | 单条卖点精雕 | 皇帝 Skill 库中可直接手动运行的旧独立入口 | 150–250 字符、`bullet_point` 单字段输出、A9/A10 与两段式标题说明混入；与分步工作流不一致。 |
| `listing.bullet.step.generate` | 逐条卖点精雕 | **分步骤卖点精雕页面点击“生成第 N 条 Bullet Point”时实际调用** | 200–280 字符且事实边界较完整，但没有强制标题—正文标点、美国本土化语言审校和可执行的语法门禁。 |
| `listing.checklist.bullets` | 五点描述质量自检 | 截图中的 15 项 Check List | 已能识别部分标点问题，但没有与生成 Skill 共享同一套结构化质量字段。 |

生产元数据复核结果：三个 Skill 均为 `Released`；实际工作流的 `listing.bullet.step.generate` 为版本 5。当前系统因此属于**双轨提示词与双契约**状态：修改 `listing.bullet.single` 不会改善分步页面的“生成第 N 条”结果。

## 2. 外部规则与写作标准

[Amazon Ads《How to improve your products for advertising》](https://advertising.amazon.com/library/guides/improve-your-products-for-advertising) 对 Bullet 的公开指导包括：

- 至少提供三条 Bullet，向买家清楚说明内容物、用途、尺寸、操作注意事项等关键信息；
- 保持简洁，以买家需求为中心；
- 以大写字母开头；
- 推荐使用适合作为清单项的短语，不使用句末终止标点；
- 避免促销或价格信息。

因此：

1. **200–280 字符不能称为 Amazon 全类目硬规则。** Seller Central 的精确上限会因类目和模板而变；系统当前的 200–280 是本产品的内容质量目标。未来应让类目策略可覆盖该范围。
2. 不应把“完整句”作为硬规则。更适合 Amazon Bullet 的是：**语法完整、自然的美式英语 Bullet 短语/并列结构**，可不加句末句号。
3. 不应强制“核心关键词全部大写”。这会降低可读性，也不等于 Amazon 要求。应使用自然的 Title Case 或 sentence case 小标题。
4. 用户输入中的事实边界必须高于所有“数据化、比较、社会认同、AIDA”写作建议。

## 3. 当前提示词的具体缺口

| 当前内容 | 风险 | 建议 |
|---|---|---|
| A9/A10 算法、排名影响 | 非本条文案生成所需事实；A10 不是应写入买家文案的可验证规则 | 从单条生成 Prompt 移除；SEO 由关键词策略与独立关键词 Skill 处理。 |
| 两段式标题结构 | 与 Bullet 任务无关，造成任务干扰 | 移除。 |
| “开头大写关键词” | 易导致 ALL CAPS、机械 SEO 和本土化下降 | 改为“以易扫描、自然的 Title Case 小标题开头”。 |
| “30% lighter”范例 | 容易诱导无依据数据化 | 仅允许输入明确给出的数字、规格或已验证比较。 |
| 150–250 字符 | 与分步工作流 UI/后端 200–280 字符门禁冲突 | 分步工作流统一为 **200–280**；未来由类目策略覆盖。 |
| `bullet_point` 单字段输出 | 与实际工作流的 `subtitle + fullText`、证据字段不兼容 | 统一成实际工作流 JSON Schema。 |
| `quality_score`、`improvement_suggestions` | 生成时会浪费输出空间，且分数不可审计 | 移除；质量结论交给独立 `listing.checklist.bullets`。 |
| 未规定 subtitle 与正文标点 | 已导致截图中的标题正文粘连 | 强制 `subtitle` 以 ASCII 英文冒号 `:` 结尾；`fullText` 以大写字母或数字开头。 |
| “natural American English”仅为原则 | 没有可执行门禁 | 加入词序、搭配、美式拼写、标点、并列结构和禁用中式直译的结构化审校字段。 |

## 4. 推荐的统一设计

### 4.1 正式运行入口

保留 `listing.bullet.step.generate` 为唯一的**分步骤工作流生成 Skill**，升级为版本 6；它是本次质量改造的唯一运行时权威。

`listing.bullet.single` 不删除历史记录，但应调整为以下两种之一：

- **推荐：** 标记为“手动试写（非工作流）”，在 UI 明确提示其不驱动“分步骤卖点精雕”；
- **替代：** 使其复用同一份 Prompt 与输出合同，从根源消除双轨。

### 4.2 输出结构（统一）

```json
{
  "subtitle": "Fresh Butter in 5–10 Minutes:",
  "fullText": "A 10,000 RPM brushless motor turns heavy cream into butter and buttermilk without manual cranking for easier breakfast prep",
  "evidenceUsed": ["10,000 RPM brushless motor"],
  "keywordsUsed": ["electric butter churn"],
  "distinctFromPrevious": "Focuses on fast butter-making rather than cleanup, capacity, or durability",
  "qualityAudit": {
    "factsGrounded": true,
    "lengthInRange": true,
    "oneClearBenefit": true,
    "noKeywordStuffing": true,
    "subtitleBodyPunctuationCorrect": true,
    "americanEnglishNatural": true,
    "grammarAndParallelismCorrect": true,
    "noUnsupportedClaims": true,
    "distinctFromPrevious": true,
    "amazonBulletStyleCompliant": true
  }
}
```

> 上述英文仅用于展示结构，不可直接作为任何产品发布文案；每一个事实必须来自当前项目输入。

### 4.3 生成 Prompt 的关键合同

1. **固定拼接合同：** `subtitle + " " + fullText`。
2. **小标题：** 2–8 个词，Title Case，自然利益导向，必须以 ASCII 冒号 `:` 结尾。
3. **正文：** 单段、无换行、以大写字母或数字开头；是自然、语法完整的美式英语 Bullet 短语或并列结构；不需要句末句号。
4. **长度：** 当前分步链路以 200–280 为门禁；后续可由类目策略覆盖。
5. **事实安全：** 不允许把“数据化”理解成编造百分比、销量、认证、评价、保证、竞品对比或性能承诺。
6. **关键词：** 只使用当前 `targetKeywords` 中真正相关的词；无法自然融入时不得强塞。
7. **美式英语：** 强制美式拼写、自然搭配、买家可扫描的短结构；禁止中式直译、夸张绝对化和工程规格堆叠。
8. **失败不输出：** 任一质量门禁不满足，自动定向重写当前一条，最多沿用既有受治理重试次数；仍失败则返回可读错误而非不合格成品。

## 5. 必须联动修改的前中后台

项目的运行原则要求不能只改文案 Prompt。需同步实施：

| 层 | 修改 |
|---|---|
| Skill/后端 | 将 `listing.bullet.step.generate` 升级为 v6；服务端 `validateSingleBulletQuality` 把新增质量字段、冒号结构和美式语言门禁纳入决定性验证。 |
| 自检 Skill | 升级 `listing.checklist.bullets`，显示“标题/正文分隔、自然美式英语、语法与并列结构、无未支持声明”的可编辑原因、证据和修改建议。 |
| 前端 | “分步骤卖点精雕”展示独立的美国站语法/格式状态；旧 `listing.bullet.single` 标记为手动入口或复用统一合同，避免误改。 |
| 数据与审计 | 保留 Skill 版本、质量门禁失败原因、人工编辑和确认记录；不回写或重跑既有 Listing。 |
| 测试 | 覆盖冒号缺失、全大写关键词、英式拼写/中式搭配、无依据比较、150–250 与 200–280 冲突、JSON 字段漂移、重复卖点、后端拒绝不合格输出。 |

## 6. 验收标准

- “生成第 N 条 Bullet Point”只调用 `listing.bullet.step.generate` v6；
- 标题与正文绝不粘连，统一呈现 `Subtitle: Body`；
- 生成输出必须满足实际类目/当前策略长度范围；
- 任何未支持的数字、认证、比较、评论、排名、保修或绝对承诺均被拒绝；
- 质量卡能显示具体英文片段、失败原因和可编辑建议；
- 修改后的文本保持美国消费者易读、自然、克制；
- 不重跑历史用户内容，不进行模型验收调用，除非后续获得针对合成无用户数据验收的单独授权。

## 7. 需要确认的实施边界

推荐实施范围为：**升级实际工作流 Skill `listing.bullet.step.generate` + 自检 Skill `listing.checklist.bullets` + 后端质量门禁 + UI 入口标识**，并把旧 `listing.bullet.single` 明确标注为手动入口，而不是静默删除。

生产实施会涉及受控 Skill 配置与代码发布，但不需要数据库结构迁移，不会重跑历史任务，也不会调用 Provider 或模型；如需做合成样例模型验收，须另行确认其模型调用费用。
