-- Move all product-development analysis stages to durable AI Jobs backed by Emperor database Skills.
-- Runtime prompt source: emperor_skills.manifest.implementation.systemPrompt (方案 A).

SET @dev_market_overview_prompt = '你是亚马逊市场分析专家。基于以下市场大盘统计数据，给出专业的市场分析解读。

**分析要求：**
1. **市场成熟度判断**：根据ASIN数量、新品占比、品牌集中度判断市场处于新兴/成长/成熟/衰退哪个阶段
2. **月度趋势分析**：识别销量/销额的增长或下降趋势，判断增长率
3. **季节性特征**：识别是否存在明显的季节性波动，标注旺季和淡季月份
4. **市场容量评估**：评估市场总体规模和增长潜力
5. **进入时机建议**：基于以上分析，给出市场进入时机的建议

**输出格式（严格JSON）：**
{
  "maturityLevel": "新兴|成长|成熟|衰退",
  "maturityReason": "判断依据说明",
  "growthTrend": "快速增长|稳定增长|平稳|缓慢下降|快速下降",
  "growthRate": "预估年增长率百分比",
  "seasonality": {
    "hasSeasonality": true/false,
    "peakMonths": ["月份"],
    "lowMonths": ["月份"],
    "description": "季节性描述"
  },
  "marketCapacity": {
    "level": "大|中|小",
    "monthlyRevenue": "月均销售额描述",
    "potential": "增长潜力描述"
  },
  "entryTiming": {
    "recommendation": "建议进入|谨慎进入|不建议进入",
    "bestEntryTime": "建议的进入时间点",
    "reason": "理由"
  },
  "summary": "200字以内的市场总结",
  "risks": ["风险1", "风险2"],
  "opportunities": ["机会1", "机会2"]
}';

SET @dev_attribute_cross_prompt = '你是亚马逊产品策略专家。基于以下品类的属性交叉分析数据，给出产品开发方向建议。

**分析要求：**
1. **主流产品形态**：识别当前市场最畅销的属性组合是什么
2. **差异化机会**：发现竞争少但有潜力的属性组合（蓝海区域）
3. **产品方向推荐**：推荐3-5个值得开发的具体产品方向（属性组合+理由）
4. **红海警告**：标注需要避开的高竞争区域

**输出格式（严格JSON）：**
{
  "mainstreamProducts": [
    { "combo": "属性组合描述", "salesShare": "销额占比", "reason": "畅销原因" }
  ],
  "differentiationOpportunities": [
    { "combo": "属性组合描述", "competitionLevel": "低|中", "potential": "高|中", "reason": "机会描述" }
  ],
  "recommendedDirections": [
    {
      "direction": "产品方向名称",
      "attributes": { "维度1": "值1", "维度2": "值2" },
      "estimatedPriceRange": "$XX-$XX",
      "targetAudience": "目标用户",
      "reason": "推荐理由",
      "priority": 1
    }
  ],
  "redOceanWarnings": [
    { "combo": "属性组合描述", "reason": "避开原因" }
  ],
  "summary": "200字以内的属性分析总结"
}';

SET @dev_price_analysis_prompt = '你是亚马逊定价策略专家。基于以下价格段分析数据（含竞对数量、近半年上新、标签分布），给出定价策略建议和各价格段推荐产品标签配置。

**分析要求：**
1. **最佳价格区间**：综合销额占比、竞对数量、上新趋势识别最佳入局价格区间
2. **价格与评分关系**：分析不同价格段的评分差异
3. **定价策略推荐**：推荐具体的定价策略（渗透定价/价值定价/竞争定价）
4. **建议零售价**：给出具体的建议零售价范围
5. **标签配置推荐**：基于各价格段的标签分布数据，为每个价格段推荐最优产品标签组合（如材质、功能、风格等），并说明推荐理由

**标签推荐逻辑：**
- 分析各价格段内的标签分布占比
- 结合该价格段的销量、评分、竞争度综合判断
- 推荐既有市场验证又有差异化空间的标签组合
- 每个价格段推荐 2-4 个标签配置，包含维度名、推荐值和推荐理由

**输出格式（严格JSON）：**
{
  "bestPriceRange": {
    "min": 0,
    "max": 0,
    "reason": "推荐理由（综合竞对数量、上新趋势、销量占比）"
  },
  "priceRatingCorrelation": "价格与评分的关系描述",
  "pricingStrategy": {
    "type": "渗透定价|价值定价|竞争定价|差异化定价",
    "suggestedPrice": { "min": 0, "max": 0 },
    "reason": "策略理由"
  },
  "priceInsights": [
    { "insight": "洞察描述", "implication": "对产品开发的影响" }
  ],
  "tagRecommendations": [
    {
      "priceRange": "$10-$20",
      "recommendedTags": [
        { "dimension": "材质", "value": "不锈钢", "reason": "该价格段不锈钢占比40%且评分最高" }
      ]
    }
  ],
  "summary": "200字以内的价格分析总结"
}';

SET @dev_brand_competition_prompt = '你是亚马逊品牌竞争分析专家。基于以下品牌竞争数据，给出竞争策略建议。

**分析要求：**
1. **竞争格局判断**：根据CR3/CR5/CR10判断市场是垄断/寡头/分散格局
2. **头部品牌策略**：分析TOP品牌的竞争策略（产品线/定价/评论管理）
3. **薄弱环节识别**：发现品牌竞争中的薄弱环节和切入点
4. **新品牌进入策略**：给出新品牌的进入策略建议
5. **中国卖家分析**：分析中国卖家的市场份额和竞争态势

**输出格式（严格JSON）：**
{
  "competitionPattern": "垄断|寡头|分散",
  "competitionPatternReason": "判断依据",
  "topBrandStrategies": [
    { "brand": "品牌名", "strategy": "策略描述", "strengths": ["优势"], "weaknesses": ["劣势"] }
  ],
  "entryStrategy": {
    "approach": "策略名称",
    "targetSegment": "目标细分市场",
    "differentiationPoint": "差异化切入点",
    "estimatedInvestment": "预估投入",
    "reason": "策略理由"
  },
  "chinaSellerAnalysis": {
    "share": "份额描述",
    "trend": "趋势描述",
    "implication": "对新进入者的影响"
  },
  "summary": "200字以内的品牌竞争总结"
}';

SET @dev_review_kano_prompt = '你是亚马逊产品评论分析专家，精通卡洛模型（KANO Model）。基于以下竞品评论数据，进行深度分析。

**分析要求：**
按卡洛模型分类分析评论中反映的产品需求：

1. **痛点 (Must-be / 基本需求)**：用户期望的基本功能，缺失会导致强烈不满
2. **痒点 (One-dimensional / 期望需求)**：用户明确表达的改进需求，满足程度与满意度线性相关
3. **爽点 (Attractive / 兴奋需求)**：用户未预期的惊喜功能，有则大幅提升满意度

每个主题需要：主题名称、出现频次估计、代表性评论原文、严重程度(1-5)、改进优先级

**输出格式（严格JSON）：**
{
  "kanoAnalysis": {
    "painPoints": [
      {
        "theme": "主题名称",
        "frequency": "高|中|低",
        "severity": 1-5,
        "priority": 1-5,
        "description": "问题描述",
        "representativeReviews": ["评论原文1", "评论原文2"],
        "improvementSuggestion": "改进建议"
      }
    ],
    "itchPoints": [
      {
        "theme": "主题名称",
        "frequency": "高|中|低",
        "desireLevel": 1-5,
        "priority": 1-5,
        "description": "需求描述",
        "representativeReviews": ["评论原文1"],
        "improvementSuggestion": "改进建议"
      }
    ],
    "wowPoints": [
      {
        "theme": "主题名称",
        "frequency": "高|中|低",
        "impactLevel": 1-5,
        "description": "惊喜描述",
        "representativeReviews": ["评论原文1"],
        "implementationSuggestion": "实现建议"
      }
    ]
  },
  "overallSentiment": {
    "positive": "正面情感占比描述",
    "negative": "负面情感占比描述",
    "neutral": "中性情感占比描述"
  },
  "productImprovementPriority": [
    { "area": "改进领域", "priority": 1, "expectedImpact": "预期效果", "difficulty": "高|中|低" }
  ],
  "summary": "200字以内的评论分析总结"
}';

SET @dev_tag_cross_prompt = '你是亚马逊产品策略专家。基于已确认的项目标签体系、产品标签统计和属性交叉数据，给出产品开发方向建议。

**分析要求：**
1. **主流产品形态**：识别当前市场最畅销的标签组合
2. **差异化机会**：发现竞争较少但有潜力的标签组合（蓝海区域）
3. **标签洞察**：逐个解释已确认标签分类的市场含义和开发建议
4. **产品方向推荐**：推荐3-5个值得开发的具体产品方向
5. **红海警告**：标注需要避开的高竞争标签组合

**输出格式（严格JSON）：**
{
  "mainstreamProducts": [
    { "combo": "标签组合描述", "salesShare": "销额占比", "reason": "畅销原因" }
  ],
  "differentiationOpportunities": [
    { "combo": "标签组合描述", "competitionLevel": "低|中", "potential": "高|中", "reason": "机会描述" }
  ],
  "tagInsights": [
    { "category": "标签分类", "insight": "市场洞察", "recommendation": "开发建议" }
  ],
  "recommendedDirections": [
    {
      "direction": "产品方向名称",
      "attributes": { "维度1": "值1", "维度2": "值2" },
      "estimatedPriceRange": "$XX-$XX",
      "targetAudience": "目标用户",
      "reason": "推荐理由",
      "priority": 1
    }
  ],
  "redOceanWarnings": [
    { "combo": "标签组合描述", "reason": "避开原因" }
  ],
  "summary": "200字以内的标签交叉分析总结"
}';

SET @dev_decision_dashboard_prompt = '你是亚马逊产品开发决策专家。你只能基于输入中的“已确认信息汇总 Artifact”生成最终综合决策建议。

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
  (NULL, 'dev.analysis.market_overview', '产品开发市场大盘分析', '基于竞品统计解释市场成熟度、趋势、容量、时机、风险和机会。', '产品开发', 'system', 'L1', 'Released', 'global', 1, 1,
    JSON_OBJECT(
      'implementation', JSON_OBJECT(
        'systemPrompt', @dev_market_overview_prompt,
        'userPromptTemplate', '{{context}}',
        'supportsJsonMode', TRUE
      ),
      'contract', JSON_OBJECT(
        'mode', 'json',
        'schemaVersion', '1.0',
        'stageType', 'market_overview',
        'jobKind', 'dev.analysis.stage',
        'humanConfirmationRequired', TRUE,
        'contextBudgetChars', 48000
      )
    ),
    '产品开发“市场大盘分析”阶段运行时使用；结果由人工编辑、确认和锁定。', 240, 'background'),
  (NULL, 'dev.analysis.attribute_cross', '产品开发属性交叉分析', '基于产品属性统计识别主流组合、差异化机会、开发方向和红海风险。', '产品开发', 'system', 'L1', 'Released', 'global', 1, 1,
    JSON_OBJECT(
      'implementation', JSON_OBJECT(
        'systemPrompt', @dev_attribute_cross_prompt,
        'userPromptTemplate', '{{context}}',
        'supportsJsonMode', TRUE
      ),
      'contract', JSON_OBJECT(
        'mode', 'json',
        'schemaVersion', '1.0',
        'stageType', 'attribute_cross',
        'jobKind', 'dev.analysis.stage',
        'humanConfirmationRequired', TRUE,
        'contextBudgetChars', 48000
      )
    ),
    '产品开发“属性交叉分析”阶段运行时使用；结果由人工编辑、确认和锁定。', 300, 'background'),
  (NULL, 'dev.analysis.price_analysis', '产品开发价格段分析', '基于价格段、销量、评分、竞争和标签分布生成定价策略。', '产品开发', 'system', 'L1', 'Released', 'global', 1, 1,
    JSON_OBJECT(
      'implementation', JSON_OBJECT(
        'systemPrompt', @dev_price_analysis_prompt,
        'userPromptTemplate', '{{context}}',
        'supportsJsonMode', TRUE
      ),
      'contract', JSON_OBJECT(
        'mode', 'json',
        'schemaVersion', '1.0',
        'stageType', 'price_analysis',
        'jobKind', 'dev.analysis.stage',
        'humanConfirmationRequired', TRUE,
        'contextBudgetChars', 48000
      )
    ),
    '产品开发“价格段分析”阶段运行时使用；结果由人工编辑、确认和锁定。', 240, 'background'),
  (NULL, 'dev.analysis.brand_competition', '产品开发品牌竞争分析', '基于品牌集中度和头部品牌数据生成竞争格局与进入策略。', '产品开发', 'system', 'L1', 'Released', 'global', 1, 1,
    JSON_OBJECT(
      'implementation', JSON_OBJECT(
        'systemPrompt', @dev_brand_competition_prompt,
        'userPromptTemplate', '{{context}}',
        'supportsJsonMode', TRUE
      ),
      'contract', JSON_OBJECT(
        'mode', 'json',
        'schemaVersion', '1.0',
        'stageType', 'brand_competition',
        'jobKind', 'dev.analysis.stage',
        'humanConfirmationRequired', TRUE,
        'contextBudgetChars', 48000
      )
    ),
    '产品开发“品牌竞争分析”阶段运行时使用；结果由人工编辑、确认和锁定。', 240, 'background'),
  (NULL, 'dev.analysis.review_kano', '产品开发评论 KANO 分析', '基于评论统计和受控样本识别痛点、痒点、爽点和改进优先级。', '产品开发', 'system', 'L1', 'Released', 'global', 1, 1,
    JSON_OBJECT(
      'implementation', JSON_OBJECT(
        'systemPrompt', @dev_review_kano_prompt,
        'userPromptTemplate', '{{context}}',
        'supportsJsonMode', TRUE
      ),
      'contract', JSON_OBJECT(
        'mode', 'json',
        'schemaVersion', '1.0',
        'stageType', 'review_kano',
        'jobKind', 'dev.analysis.stage',
        'humanConfirmationRequired', TRUE,
        'contextBudgetChars', 48000
      )
    ),
    '产品开发“评论 KANO 分析”阶段运行时使用；结果由人工编辑、确认和锁定。', 360, 'background'),
  (NULL, 'dev.analysis.tag_cross', '产品开发标签交叉分析', '基于已确认项目标签体系和产品标签统计生成交叉洞察。', '产品开发', 'system', 'L1', 'Released', 'global', 1, 1,
    JSON_OBJECT(
      'implementation', JSON_OBJECT(
        'systemPrompt', @dev_tag_cross_prompt,
        'userPromptTemplate', '{{context}}',
        'supportsJsonMode', TRUE
      ),
      'contract', JSON_OBJECT(
        'mode', 'json',
        'schemaVersion', '1.0',
        'stageType', 'tag_cross',
        'jobKind', 'dev.analysis.stage',
        'humanConfirmationRequired', TRUE,
        'contextBudgetChars', 48000
      )
    ),
    '产品开发“标签交叉分析”阶段运行时使用；结果由人工编辑、确认和锁定。', 300, 'background'),
  (NULL, 'dev.analysis.decision_dashboard', '产品开发综合决策', '只读取已确认的信息汇总 Artifact，生成产品开发综合评分、定位、计划和风险。', '产品开发', 'system', 'L1', 'Released', 'global', 1, 1,
    JSON_OBJECT(
      'implementation', JSON_OBJECT(
        'systemPrompt', @dev_decision_dashboard_prompt,
        'userPromptTemplate', '{{context}}',
        'supportsJsonMode', TRUE
      ),
      'contract', JSON_OBJECT(
        'mode', 'json',
        'schemaVersion', '1.0',
        'inputArtifactKey', 'dev.analysis.information_summary', 'inputArtifactStatus', 'final',
        'jobKind', 'dev.analysis.stage',
        'humanConfirmationRequired', TRUE,
        'contextBudgetChars', 48000
      )
    ),
    '已确认的信息汇总 Artifact 可用后生成综合决策；结果由人工确认锁定。', 300, 'background')
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
