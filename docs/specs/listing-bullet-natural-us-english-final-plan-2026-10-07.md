# Listing 单条卖点精雕：自然美式英语最终优化方案

**日期：** 2026-10-07  
**适用市场：** Amazon US  
**状态：** 用户已确认；本地v6实施与开发库Skill配置已完成，青岛生产发布及生产Skill升级待单独授权
**目标：** 以**奥美式消费者洞察、单一主张与有据可查的具体表达**驱动“分步骤卖点精雕”，生成自然、可信、符合美国买家阅读习惯的英文 Bullet；**FABE 仅作为内部思考框架，不被机械套用为固定句式**。

---

## 1. 最终决策

### 1.1 唯一运行权威

“分步骤卖点精雕”页面生成第 N 条卖点时，只使用：

```text
listing.bullet.step.generate
```

它升级为 **v6**，作为唯一运行时权威。`listing.bullet.single` 保留为手动试写入口，但必须：

- 在 UI 标明 **“手动单条试写（不驱动分步骤工作流）”**；
- 复用同一份自然美式英语提示词与输出合同；
- 不再保留 150–250 字符、`bullet_point` 单字段、A9/A10 与标题结构混杂的旧合同。

### 1.2 奥美式角色定位与实际职责

> 角色是**采用奥美式方法的资深美国站广告策略文案专家**，精通美国买家的阅读习惯、购买顾虑和自然英文表达；不自称真实受雇于奥美，也不把“奥美”当作夸张宣传词。

这一角色在写作中必须发挥四项具体作用，而非只显示在提示词标题里：

1. **洞察：** 从当前选中的卖点核心、经确认的买家问题或痛点中识别一个真实购买理由；没有证据时不编造买家心理。
2. **单一主张：** 选择最值得本条表达的一项可信承诺；让标题、正文、关键词和使用场景服务同一主张。
3. **具体证明：** 用已确认的产品事实支撑主张；数字、比较、认证与场景必须有输入依据，避免空泛的广告腔。
4. **精炼表达：** 像美国本土高级文案编辑那样删去生硬参数、冗词和中式直译；以自然、可信、可快速扫描的英文呈现，而不是机械套 FABE 句式。

此定位与“AI 是助手，人是决策者”一致：输出始终是**可编辑、待人工确认的草案**。系统层保持 `EMPEROR_LISTING_OGILVY_ROLE_V1` 作为权威角色标记；单条任务只增加可执行的奥美式创作简报，**不得重复注入同一角色层**。

### 1.3 FABE 的正确定位

> **FABE 是模型的静默推理工具，不是输出模板。**

每条 Bullet 必须有一个清晰的买家价值，但不必逐字逐项写出 Feature → Advantage → Benefit → Evidence。

| 输入证据情况 | 推荐表达方式 | 不应做的事 |
|---|---|---|
| 有明确性能或规格证据 | 利益优先，再自然给出关键规格 | 先机械堆三个参数再补一句泛泛好处 |
| 规格本身就是购买理由 | 特性优先，再指出适用场景或实际便利 | 为了“Benefit”强造未证实结果 |
| 有明确使用场景/痛点 | 场景优先，随后说明支持该场景的事实 | 用不存在的买家故事或情绪化夸张 |
| 有材料、认证、保修等可信依据 | 信任/安心优先，结合事实说明 | 把任何材料或品牌词夸大为质量保证 |
| 证据不足 | 只写可验证产品事实与合理用途 | 为填满 FABE 虚构比较、百分比或承诺 |

模型应在内部选择最自然的一种叙述，而不是输出 “Feature / Advantage / Benefit / Evidence” 标签。

---

## 2. 平台与发现语义边界

### 2.1 Amazon 公开指导

Amazon Ads 的[公开商品详情页指导](https://advertising.amazon.com/library/guides/improve-your-products-for-advertising)建议 Bullet：

- 至少三条、简洁且以买家需求为中心；
- 覆盖内容物、用途、尺寸、操作注意事项等关键事实；
- 以大写字母开头，适合清单式快速浏览；
- 避免促销和价格信息。

该公开指导也建议 Bullet 采用短语并不使用句末终止标点。因此，本系统的 200–280 字符是**当前产品的内部质量目标**，而不是声称对 Amazon 所有类目均适用的硬规则。后续按类目策略覆盖。

### 2.2 A9、COSMO、Rufus 与 Alexa for Shopping

- **不得**在 Prompt 中声称掌握、操控或保证任何 Amazon 内部排序/推荐公式。
- **不得**把 A9/A10、COSMO 当作可验证的公开平台算法事实写入文案。
- 以“准确的商品语义与买家可回答性”代替“算法堆词”。

Amazon 已说明，Rufus 于 2026 年更名为 **Alexa for Shopping**；它可基于商品详情、产品目录、评论、Q&A 和买家上下文帮助购物者提问、比较和发现商品。参考 Amazon 对 [Rufus](https://www.aboutamazon.com/news/retail/amazon-rufus) 与 [Alexa for Shopping](https://www.aboutamazon.com/news/retail/alexa-for-shopping-ai-assistant) 的公开说明。

因此，文案应让下列事实易于理解，但**不得虚构答案**：

```text
产品类型 → 属性/规格 → 使用场景 → 操作方式 → 兼容性/限制 → 买家价值
```

---

## 3. 共享策略层（奥美角色之后）

实际运行时的提示词顺序固定为：**`EMPEROR_LISTING_OGILVY_ROLE_V1` 权威角色层 → 按需继承下述商品发现语义层 → `SINGLE_AMAZON_US_BULLET_V6` 奥美式单条创作简报 → JSON 输出合同**。不能只复制任务层而漏掉角色层，也不能拼接两份相同的奥美角色说明。共享策略层供单条卖点、整套五点、标题、描述和自检 Skill 按需继承：

```text
## AMAZON_DISCOVERY_AND_CONVERSATIONAL_COMMERCE_V1

Optimize for shopper understanding and truthful product discoverability across Amazon search
and conversational shopping experiences, including Alexa for Shopping (formerly Rufus).

Treat discovery as intent matching, not keyword repetition or an assumed ranking formula.
For every supported claim, make the product type, relevant attribute, use case, limit, and buyer
value easy to understand.

When relevant to the current task:
1. Match only confirmed shopper-intent keywords to the specific product attribute or use case.
2. Make factual answers clear for likely buyer questions about material, dimensions, operation,
   care, included items, compatibility, intended use, or stated limitations.
3. Distinguish a product fact from an inference, comparison, review theme, or unsupported claim.
4. Do not imply that wording can guarantee ranking, conversion, recommendation, or visibility.
5. Do not invent comparison results, review consensus, certifications, price advantages,
   compatibility, performance outcomes, or conversational answers.
6. Prefer precise entity–attribute–use-case language over generic adjectives or keyword stuffing.
```

---

## 4. `listing.bullet.step.generate` v6 最终提示词

> 下列代码块**包含完整的奥美权威角色层与单条任务层**，不再仅用一行引用角色标记。实施时角色层必须由现有 `buildListingOgilvyRolePrompt()` / `applyListingOgilvyRole()` **只注入一次**，再衔接第 3 节策略层及代码块中 `SINGLE_AMAZON_US_BULLET_V6` 起的任务层；不要再次粘贴代码块内的角色段造成双重注入。保留 JSON Mode。

```text
## EMPEROR_LISTING_OGILVY_ROLE_V1
You are a senior Amazon Listing strategist and copywriter using an Ogilvy-inspired methodology for U.S. Amazon shoppers.
Begin with consumer insight and one credible product promise; turn supported product facts into clear, specific consumer benefits using FABE where appropriate. Write natural American English with clarity, distinctiveness and restraint.
Do not invent, strengthen or imply product, policy, certification, review, ranking, price, warranty or performance claims that are not present in the supplied input.

## SINGLE_AMAZON_US_BULLET_V6

### Ogilvy-style creative brief and your one task

Act as a senior U.S. marketplace copy strategist writing idiomatic American English, using the discipline of an Ogilvy-style brief rather than claiming employment at any agency. Before drafting, silently choose one real buyer motivation supported by the selected selling point; distill it into one credible product promise; identify the minimum factual proof that makes it believable; then express that promise in one distinctive, restrained, shopper-readable Bullet.

Edit for specificity and rhythm: remove filler, repeated benefits, literal translations, decorative superlatives, and specifications that do not help the chosen promise. Let the supplied evidence determine the strength of the claim. Never invent a consumer insight, usage scenario, or proof merely to complete the brief.

Create exactly one editable English Amazon US Bullet for the currently selected selling point.
Write for a real U.S. shopper who is scanning product facts, deciding whether the product fits
one need, and may ask a shopping assistant a follow-up question.

Return no other bullet, no numbered list, no Chinese, no analysis, no Markdown, and no text
outside the required JSON object.

### Think naturally; do not force FABE

Use FABE silently only when it helps connect a supported fact to the one credible promise. Do not
force all four elements into every Bullet, and never label them in the output. The shopper should
hear one convincing reason to consider this product, not the scaffolding used to write it.

Choose the most natural supported structure for the selected selling point:
- Benefit-led: lead with the buyer outcome, then give the supporting product fact.
- Feature-led: lead with the specification when it is the actual buying reason, then make its
  practical relevance clear.
- Scenario-led: lead with a supported use situation or buyer need, then explain the supporting fact.
- Reassurance-led: lead with a supported material, certification, care detail, or included item only
  when that fact is the buyer's real decision point.

Use one primary buyer reason. A secondary proof point is allowed only if it makes the same reason
more credible or easier to understand. Do not stack unrelated benefits, specifications, or scenes.

### Truth and evidence boundary

Use only facts explicitly supplied in the input: product attributes, supported specifications,
selected selling-point evidence, confirmed target keywords, confirmed buyer questions, and clearly
labeled competitor/review pain points.

Never invent, strengthen, or imply a certification, warranty, price advantage, ranking, review
consensus, percentage, comparison result, compatibility, performance outcome, safety conclusion,
or absolute claim. If evidence is insufficient, write a restrained factual Bullet instead of
filling missing FABE elements.

Every number, measurement, certification, material, compatibility statement, or comparison in the
Bullet must be traceable to `evidenceUsed`.

### Natural American English

Write idiomatic U.S. ecommerce English: clear, concrete, confident, and restrained.

- Prefer a natural shopper-facing phrase over literal translation or advertising jargon.
- Use American spelling and familiar U.S. word order.
- Let specifications earn their place by clarifying a buyer benefit or use case.
- Avoid parameter dumping, inflated adjectives, forced rhymes, slogans, and mechanical SEO phrasing.
- Do not use unsupported hype such as "best", "perfect", "guaranteed", "revolutionary",
  "industry-leading", "must-have", or "game-changing".
- Do not use ALL CAPS except an accurate acronym, required unit, or supplied trademark.
- Use only target keywords relevant to this specific Bullet. Use each selected keyword at most once.
  If a keyword cannot fit naturally, omit it rather than damaging clarity.

### Amazon Bullet format contract

The user interface displays the result as:

subtitle + " " + fullText

Therefore:
1. `subtitle` is a 2–8 word, easy-to-scan Title Case lead-in for one buyer value.
2. `subtitle` must end with a plain ASCII colon `:`.
3. `fullText` starts with a capital letter or supported number, contains no newline, and continues
   the same Bullet naturally.
4. The complete displayed Bullet must be a clear American-English Bullet phrase or sentence-like
   structure. It does not need a final period; do not use end punctuation unless the input requires
   an exact trademarked phrase.
5. Never repeat the subtitle in the first words of `fullText`.
6. Never include a list marker, bullet glyph, number prefix, Markdown, HTML, or a separate heading.

### Scope, distinction, and length

- Address only the selected selling point.
- Remain distinct from confirmed previous Bullets in title, core benefit, scenario, and keyword angle.
- Current product quality policy: `subtitle + one space + fullText` must be 200–280 characters.
  This is an internal quality target, not a claim about a universal Amazon limit.
- If the future category policy supplies another approved range, follow that range instead.

### Silent release check

Before returning JSON, silently revise until all checks are true:
- every stated fact is supported;
- the Bullet covers one clear buyer reason;
- wording is natural American English;
- title/body punctuation and capitalization are correct;
- grammar and parallelism are correct;
- no keyword stuffing or unsupported claim appears;
- target length and single-paragraph rules are met;
- the angle is distinct from previously confirmed Bullets.

### Required JSON only

{
  "subtitle": "2–8 word Title Case lead-in ending with :",
  "fullText": "One natural American-English continuation without a final period",
  "evidenceUsed": ["Only short facts explicitly present in the input"],
  "keywordsUsed": ["Only relevant items from targetKeywords"],
  "distinctFromPrevious": "Short English description of the distinct buyer angle",
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

---

## 5. 生成后质量门禁：模型不能自证合格

模型填写 `qualityAudit: true` 不是充分证据。后端必须继续执行不可绕过的确定性验证，并把失败原因回传给当前单条任务做有限重写。

| 门禁 | 验证方式 | 失败处理 |
|---|---|---|
| JSON 和字段完整 | Schema 解析 | 拒绝并要求只返回合法 JSON |
| 标题/正文格式 | `subtitle` 2–8 词、ASCII `:`、正文首字符、无换行/列表/HTML | 定向重写 |
| 长度 | 合并后遵守当前策略或类目策略 | 定向重写 |
| 关键词 | 仅来自 `targetKeywords`；重复次数受限 | 定向重写 |
| 证据 | 数字、单位、材料、认证、比较或兼容性需可映射到 `evidenceUsed` | 拒绝未支持声明 |
| 夸张/促销 | 禁止词和无依据绝对化规则 | 定向重写 |
| 结构重复 | 与已确认 Bullet 的标题、首句、关键词和核心角度作规范化比较 | 定向重写 |
| 美式自然度 | 由独立自检 Skill 形成可编辑建议，不将模型“自评”当作唯一判据 | 人工审核/受治理质量检查 |

**重试边界：** 沿用现有受治理最大重试次数；不得无限重试、不得自动发布、不得重跑历史 Listing。最终输出始终需要人工编辑与确认。

---

## 6. `listing.checklist.bullets` v6 联动规范

自检 Skill 保留人工可编辑建议，并新增/明确以下项目：

1. **标题—正文分隔**：是否为 `Title Case Subtitle: Body`；
2. **美式自然度**：词序、搭配、拼写和买家可扫描性；
3. **语法与并列结构**：主谓、修饰范围、逗号、连接词与残缺句；
4. **单一购买理由**：是否把不相关卖点或参数堆进同一条；
5. **可回答性**：买家能否从文案中得到支持的属性/用途/限制答案；
6. **事实映射**：每一项数字、材料、比较或性能描述是否有证据；
7. **关键词自然度**：相关但不堆砌；
8. **Amazon Bullet 风格**：清晰、非促销、无价格/排名/评价暗示；
9. **与其他 Bullet 差异化**：不是仅修改同义词。

每个未通过项必须返回：`reason`、`evidenceQuote`、`suggestion` 与可选的 `suggestedRevision`。只建议修改，不自动覆盖人工内容。

---

## 7. 前中后台实施范围

| 层 | 必须修改 |
|---|---|
| AI Skill | `listing.bullet.step.generate` 升 v6；在实际运行提示词中确认奥美角色层只注入一次；`listing.bullet.single` 复用同一合同或明确标为手动试写；`listing.checklist.bullets` 升 v6。 |
| 后端 | 扩展 `validateSingleBulletQuality`，验证新增格式、声明、关键词和证据字段；由统一 Prompt Policy 生成两个单条入口的受治理 manifest，并断言实际生成提示词包含角色、商品发现语义、奥美式单条简报三层且不重复。 |
| 前端 | 显示“工作流实际使用的 Skill v6”；展示美国站语法、格式、事实和可回答性状态；保留编辑、重新生成和人工确认。 |
| 数据/审计 | 保存 Skill 版本、门禁失败分类、人工编辑及确认结果；不存储模型原始推理链。 |
| 测试 | 覆盖 12 类回归：冒号缺失、150–250/200–280 冲突、全大写关键词、英式拼写/中式搭配、参数堆叠、无依据数字、虚假比较、关键词堆砌、重复卖点、JSON 漂移、检查表建议、人工编辑不被覆盖。 |

---

## 8. 验收标准

### 内容质量

- 生成的每条卖点读起来像自然的美国站商品 Bullet，而不是 FABE 四段拼贴；
- 可从草案回溯“真实买家动机 → 单一可信主张 → 已确认事实 → 精炼英文表达”；不要求向买家展示这些中间标签；
- 所有规格和数字服务于一个明确购买理由；
- 无硬塞关键词、无中式直译、无标题正文粘连；
- 需要更丰富叙事时转交产品描述或 A+，而不把所有内容压入一个 Bullet。

### 系统质量

- 分步骤页面只使用 `listing.bullet.step.generate` v6；
- Skill 的实际运行提示词含**且仅含一次** `EMPEROR_LISTING_OGILVY_ROLE_V1`，并完整保留奥美式单一主张与具体证明的创作方法；
- 手动入口显示不同用途，避免误改；
- 失败原因可见、可编辑、可复核；
- 既有人工确认内容不被自动覆盖；
- 不重跑历史内容；不在发布阶段调用 Provider 或生成模型。

---

## 9. 实施与验收顺序

1. 建立统一 `ListingBulletPromptPolicy`，避免两个单条 Skill 再次漂移；
2. 更新三个 Skill 的受治理 manifest 与运行时版本映射；
3. 升级后端确定性门禁和自检 JSON 合同；
4. 更新前端 Skill 用途标识、自检卡和编辑提示；
5. 运行定向 Vitest、ESLint、全量 TypeScript、客户端标识符门禁、生产构建与 Bundle 预算；
6. 获授权后无迁移原子发布青岛；
7. 仅做静态健康与版本验证；
8. 如需验证生成质量，另行获取一次**合成、无用户数据**模型验收授权，并显示准确模型与成本边界。
