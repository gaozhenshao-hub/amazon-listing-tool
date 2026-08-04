-- Add the decision evidence summary stage and keep both AI steps on Emperor.
-- Runtime prompt source: emperor_skills.manifest.implementation.systemPrompt (方案 A).

ALTER TABLE `dev_analysis_stages`
  MODIFY COLUMN `stageType` enum(
    'data_parsing','tag_annotation','market_overview','product_attributes',
    'price_analysis','brand_competition','review_analysis','decision_dashboard',
    'attribute_tagging','attribute_cross','review_kano','information_summary'
  ) NOT NULL;

SET @information_summary_prompt = '你是亚马逊产品开发决策信息架构专家。你的任务不是直接做最终立项决策，而是把系统已有证据整理成一份可由人工编辑、确认和锁定的信息汇总。

必须遵守：
1. 只能使用输入中的项目、竞品和已确认分析数据；不得编造供应商报价、专利、成本、销量或负责人。
2. 缺少的信息必须放入 missingFields，不得用看似确定的文字补齐。
3. benchmarkRecommendations 只给出建议，不得代替用户勾选最终对标竞品。
4. 专利结论和经济模型由人工或外部 Tool 补充，本 Skill 不输出虚构结论。
5. 输出为中文严格 JSON，不要使用 Markdown 代码块。

输出结构：
{
  "executiveSummary": "200字以内的信息汇总摘要，不做最终立项结论",
  "benchmarkRecommendations": [{ "asin": "输入中的ASIN", "reason": "推荐作为对标竞品的证据" }],
  "marketSynthesis": {
    "salesTrend": "销量趋势结论",
    "seasonality": "季节性判断",
    "benchmarkAdvantages": ["相对竞品可建立的优势"],
    "benchmarkDisadvantages": ["需要规避的劣势"],
    "brandAnalysis": "品牌竞争格局"
  },
  "productOpportunity": {
    "mainFunctions": ["主要功能或参数"],
    "usageScenarios": ["使用场景"],
    "targetAudience": ["目标用户群体"],
    "positiveSignals": ["主要好评信号"],
    "negativeSignals": ["主要差评信号"],
    "sellingPoints": [{ "point": "主卖点", "evidence": "输入中的依据", "implementation": "实现建议" }],
    "painPoints": [{ "point": "痛点或痒点", "evidence": "输入中的依据", "resolved": false, "resolution": "建议解决方式" }]
  },
  "landingDraft": {
    "developmentSuggestions": ["开发优化建议"],
    "operationsSuggestions": ["运营优化建议"],
    "appearanceConcepts": ["外观方向草案"],
    "designConcept": "产品设计方向草案",
    "timeline": [{ "milestone": "里程碑", "targetDate": "", "note": "仅为初步建议" }]
  },
  "missingFields": ["必须由人工或Tool补充的信息"]
}';

SET @decision_dashboard_prompt = '你是亚马逊产品开发决策专家。你只能基于输入中的“已确认信息汇总 Artifact”生成最终综合决策建议。

必须遵守：
1. 不得绕过 Artifact 使用未确认阶段、草稿或历史版本。
2. 不得补造专利、供应商、成本、销量、负责人或竞品证据。
3. 信息不足时必须降低对应维度评分，并在风险或总结中说明缺口。
4. 人工选择的对标竞品优先于 AI 推荐候选。

**分析要求：**
1. **市场进入可行性评分**：综合评估市场容量、竞争强度、利润空间、差异化机会、风险等维度（每项1-10分）
2. **推荐产品定位**：给出具体的产品属性组合 + 价格区间 + 差异化方向
3. **对标竞品SWOT**：选定2-3个对标竞品进行SWOT分析
4. **产品上新计划**：规格参数、目标定价、上架时间、首批订单量、目标月销量
5. **风险与应对**：主要风险及应对策略

**输出格式（严格JSON）：**
{
  "feasibilityScore": {
    "overall": 1-10,
    "dimensions": [
      { "name": "市场容量", "score": 1-10, "reason": "评分理由" },
      { "name": "竞争强度", "score": 1-10, "reason": "评分理由" },
      { "name": "利润空间", "score": 1-10, "reason": "评分理由" },
      { "name": "差异化机会", "score": 1-10, "reason": "评分理由" },
      { "name": "进入壁垒", "score": 1-10, "reason": "评分理由" },
      { "name": "风险等级", "score": 1-10, "reason": "评分理由" }
    ],
    "recommendation": "强烈推荐|推荐|谨慎推荐|不推荐"
  },
  "productPositioning": {
    "targetAttributes": { "维度1": "值1", "维度2": "值2" },
    "priceRange": { "min": 0, "max": 0 },
    "differentiationDirection": "差异化方向描述",
    "targetAudience": "目标用户画像",
    "uniqueSellingPoints": ["USP1", "USP2", "USP3"]
  },
  "swotAnalysis": [
    {
      "competitor": "竞品ASIN或品牌",
      "strengths": ["优势1"],
      "weaknesses": ["劣势1"],
      "opportunities": ["机会1"],
      "threats": ["威胁1"]
    }
  ],
  "launchPlan": {
    "specifications": "规格参数描述",
    "targetPrice": 0,
    "bestLaunchMonth": "建议上架月份",
    "initialOrderQuantity": 0,
    "targetMonthlySales": 0,
    "estimatedBreakEvenMonths": 0,
    "keyMilestones": [
      { "month": 1, "milestone": "里程碑描述" }
    ]
  },
  "risks": [
    { "risk": "风险描述", "probability": "高|中|低", "impact": "高|中|低", "mitigation": "应对策略" }
  ],
  "summary": "300字以内的综合决策总结"
}';

INSERT INTO `emperor_skills`
  (`workspaceId`, `slug`, `name`, `description`, `category`, `owner`, `riskTier`, `status`, `scope`, `version`, `isSystem`, `manifest`, `when_to_use`, `timeout_seconds`, `execution_mode`)
VALUES
  (NULL, 'dev.analysis.information_summary', '产品开发决策前信息汇总', '整理已确认分析证据，生成可编辑、确认和版本化的决策前信息汇总。', '产品开发', 'system', 'L1', 'Released', 'global', 1, 1,
    JSON_OBJECT(
      'implementation', JSON_OBJECT('systemPrompt', @information_summary_prompt, 'userPromptTemplate', '{{context}}', 'supportsJsonMode', TRUE),
      'contract', JSON_OBJECT(
        'mode', 'json',
        'schemaVersion', '1.0',
        'humanConfirmationRequired', TRUE,
        'requiredSources', JSON_ARRAY('project', 'competitors', 'confirmed_analysis_stages'),
        'forbidFabricatedFields', JSON_ARRAY('supplierQuote', 'patentConclusion', 'cost', 'sales', 'owner')
      )
    ),
    '市场、属性交叉、价格和品牌阶段确认后，综合决策生成前使用；结果必须经过人工编辑和锁定。', 240, 'background'),
  (NULL, 'dev.analysis.decision_dashboard', '产品开发综合决策', '只读取已确认的信息汇总 Artifact，生成产品开发综合评分、定位、计划和风险。', '产品开发', 'system', 'L1', 'Released', 'global', 1, 1,
    JSON_OBJECT(
      'implementation', JSON_OBJECT('systemPrompt', @decision_dashboard_prompt, 'userPromptTemplate', '{{context}}', 'supportsJsonMode', TRUE),
      'contract', JSON_OBJECT(
        'mode', 'json',
        'schemaVersion', '1.0',
        'inputArtifactKey', 'dev.analysis.information_summary',
        'inputArtifactStatus', 'final',
        'preferHumanBenchmarkSelection', TRUE
      )
    ),
    '已确认的信息汇总 Artifact 可用后生成综合决策，不允许读取未确认草稿。', 240, 'background')
ON DUPLICATE KEY UPDATE
  `name` = VALUES(`name`),
  `description` = VALUES(`description`),
  `category` = VALUES(`category`),
  `status` = 'Released',
  `version` = `version` + 1,
  `manifest` = JSON_MERGE_PATCH(COALESCE(`manifest`, JSON_OBJECT()), VALUES(`manifest`)),
  `when_to_use` = VALUES(`when_to_use`),
  `timeout_seconds` = VALUES(`timeout_seconds`),
  `execution_mode` = VALUES(`execution_mode`);
