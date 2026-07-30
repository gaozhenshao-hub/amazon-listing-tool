# 新皇帝 Skill 迁移方案

## 一、现状分析

### 当前架构
- **AI 调用方式**：所有 47 个路由文件中共 235 处直接调用 `invokeLLM()`
- **Prompt 来源**：硬编码在 `server/prompts.ts`（1056 行）和各路由文件内联
- **新皇帝 Skill 表**：`emperor_skills` 已有 110 条记录（从老皇帝迁移过来），且 systemPrompt 已完整配置
- **新皇帝运行引擎**：`emperorRunRouter.run` 已实现完整的 Skill 执行流程（读取 Skill → 渲染模板 → 调用 invokeLLM → 记录运行历史）

### 核心问题
1. **Listing 生成频繁失败**：当前直接调用 `invokeLLM` + `json_object` 模式，Forge API 兼容性问题导致返回空内容或格式异常
2. **Prompt 分散维护困难**：prompt 硬编码在代码中，修改需要重新部署
3. **无运行历史**：直接调用 LLM 没有记录，无法追踪和优化
4. **无法灵活切换模型**：每个 Skill 应该可以独立配置最优模型

### 新皇帝已有 Listing 相关 Skill（110 个中的关键 Skill）

| Slug | 名称 | systemPrompt 长度 | 状态 |
|------|------|-------------------|------|
| `listing.sellingpoints.generate` | 核心卖点提炼 | 4424 字符 | Released |
| `listing.title.generate` | Listing标题生成 | 5819 字符 | Released |
| `listing.bullets.generate` | Listing五点描述生成 | 5098 字符 | Released |
| `listing.description.generate` | Listing产品描述生成 | 1281 字符 | Released |
| `listing.searchterms.generate` | Listing搜索词生成 | Released |
| `listing.qa.generate` | Q&A问答生成 | Released |
| `listing.image.advice` | Listing图片建议 | Released |
| `listing.translate.chinese` | Listing中文翻译 | Released |
| `listing.abtest.generate` | A/B测试方案生成 | Released |
| `listing.scoring.overall` | Listing综合评分 | Released |
| `listing.checklist.qa` | Q&A质量自检 | Released |
| `analysis.rufus.attribute` | Rufus属性提取 | Released |
| `analysis.cosmo.scene` | COSMO场景映射 | Released |
| `analysis.a9.keyword.grade` | A9关键词分级 | Released |

---

## 二、迁移方案

### 方案核心：创建统一的 `executeSkill()` 函数

不再让各路由直接调用 `invokeLLM()`，而是统一通过新皇帝的 Skill 引擎执行：

```typescript
// server/services/emperorSkillRunner.ts
async function executeSkill(slug: string, context: string, options?: {
  emphasis?: string;
  variables?: Record<string, any>;
  userId?: number;
}): Promise<{ content: string; runId: string; durationMs: number }> {
  // 1. 从 emperor_skills 表读取 Skill 配置（systemPrompt, userPromptTemplate, model 等）
  // 2. 渲染 userPromptTemplate（支持 {{context}}, {{emphasis}} 等变量）
  // 3. 调用 invokeLLM（使用 Skill 配置的 model/temperature/maxTokens）
  // 4. 记录运行历史到 emperor_skill_runs 表
  // 5. 返回 AI 输出内容
}
```

### 迁移步骤

#### Phase 1：创建 Skill Runner 服务层（核心）
- 新建 `server/services/emperorSkillRunner.ts`
- 封装 `executeSkill(slug, context, options)` 函数
- 内置 JSON 解析容错（safeParseJSON）
- 内置重试机制（失败自动重试 1 次）
- 内置运行历史记录

#### Phase 2：Listing 五步流程迁移（优先级最高）
将以下 5 个核心接口从 `invokeLLM` 切换到 `executeSkill`：

| 接口 | 对应 Skill Slug | 说明 |
|------|----------------|------|
| `generateSellingPointsCores` | `listing.sellingpoints.generate` | Step 1: 卖点精雕 |
| `generateTitle` | `listing.title.generate` | Step 2: 标题生成 |
| `generateBulletPoints` | `listing.bullets.generate` | Step 3: 五点描述 |
| `generateDescription` | `listing.description.generate` | Step 4: 长描述 |
| `generateSearchTerms` | `listing.searchterms.generate` | Step 5: 搜索词 |

#### Phase 3：其他 Listing 辅助接口迁移
- `generateQA` → `listing.qa.generate`
- `generateImageAdvice` → `listing.image.advice`
- `generateChineseTranslation` → `listing.translate.chinese`
- `evaluateTitleChecklist` → 新建 `listing.checklist.title`
- `evaluateBulletChecklist` → 新建 `listing.checklist.bullet`
- `evaluateDescriptionChecklist` → 新建 `listing.checklist.description`
- `generateABTest` → `listing.abtest.generate`

#### Phase 4：全量迁移其他模块（后续逐步）
- 广告分析（7 个 Skill）
- 产品开发（13 个 Skill）
- 图片工作流（15 个 Skill）
- 知识库（12 个 Skill）
- 运营 AI（30+ 个 Skill）
- 站外营销（8 个 Skill）
- 视频脚本（8 个 Skill）

---

## 三、关键设计决策

### 1. Skill 的 systemPrompt 来源
- **方案 A**（推荐）：使用数据库中 `emperor_skills` 表已有的 systemPrompt
  - 优点：可在前端皇帝管理页面实时编辑，无需重新部署
  - 优点：已有 110 个 Skill 的完整 prompt
  - 缺点：需要确保数据库中的 prompt 与代码中的一致
  
- **方案 B**：继续使用 `server/prompts.ts` 中的硬编码 prompt
  - 优点：代码可控
  - 缺点：修改需要重新部署，失去皇帝系统的灵活性

### 2. JSON 模式处理
- 新皇帝的 `supportsJsonMode` 字段控制是否启用 JSON 模式
- 由于 Forge API 的 `json_object` 兼容问题已在 `llm.ts` 中修复（自动转为纯文本 + JSON 指令注入），Skill 可以安全使用 `supportsJsonMode: true`

### 3. 模板渲染
- 当前 `renderTemplate` 只支持简单的 `{{variable}}` 替换
- 数据库中的 Skill 使用了 Handlebars 语法（`{{#if}}`, `{{/if}}`）
- **需要升级 renderTemplate 为 Handlebars 引擎**

### 4. 失败重试策略
- Skill Runner 内置 1 次自动重试
- 记录失败原因到 `emperor_skill_runs` 表
- 前端可查看运行历史和错误详情

---

## 四、实施优先级

```
立即执行（本次）：
├── 1. 创建 emperorSkillRunner.ts 服务层
├── 2. 升级 renderTemplate 支持 Handlebars
├── 3. 迁移 Listing 五步核心流程到新皇帝 Skill
├── 4. 确保 Skill 的 systemPrompt 不为空（验证数据库）
└── 5. 端到端测试 + 保存 checkpoint

后续迭代：
├── 6. 迁移 Listing 辅助接口（QA/图片建议/翻译/自检）
├── 7. 迁移广告分析模块
├── 8. 迁移产品开发模块
├── 9. 迁移图片工作流模块
└── 10. 迁移其他模块
```

---

## 五、风险与缓解

| 风险 | 缓解措施 |
|------|----------|
| Skill 的 prompt 可能与当前代码中的不一致 | 对比验证，以数据库中的为准（更新更完整） |
| Handlebars 模板渲染可能有边界情况 | 添加 try-catch，渲染失败时降级为简单替换 |
| 运行历史记录可能影响性能 | 异步写入，不阻塞主流程 |
| 某些 Skill 可能还需要补充 | 先迁移已有的，缺失的按需创建 |

---

## 六、预期收益

1. **统一管理**：所有 AI 调用通过皇帝 Skill 系统，可在前端管理页面查看和编辑
2. **运行追踪**：每次 AI 调用都有完整的运行记录（输入/输出/耗时/Token 消耗）
3. **灵活配置**：每个 Skill 可独立配置模型、温度、最大 Token 数
4. **Prompt 热更新**：修改 Skill 的 systemPrompt 无需重新部署
5. **失败可追溯**：失败的运行记录包含完整的错误信息，便于排查
