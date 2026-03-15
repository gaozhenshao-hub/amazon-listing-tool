/**
 * AI Analysis Prompts for each stage of the product development analysis
 */

// ─── Stage 0: Attribute Tagging ───────────────────────────────

export const ATTRIBUTE_TAGGING_PROMPT = `你是亚马逊产品属性分析专家。你的任务是从产品标题和五点描述中提取该品类的关键属性维度和每个产品的属性值。

**第一步：分析所有产品，识别该品类的核心属性维度（通常5-10个）。**
- 属性维度应该是影响购买决策的关键因素
- 例如：尺寸、颜色、材质、功能特性、安装方式、认证标准、适用场景等
- 每个维度需要定义可选值的枚举列表
- 属性值应该标准化（如"52 inch"和"52英寸"统一为"52寸"）

**第二步：为每个产品标注属性值。**
- 如果产品信息中明确提到该属性，标注具体值
- 如果无法确定，标注为"未知"
- 一个产品可能在同一维度有多个值（如多种颜色选项）

**输出格式（严格JSON）：**
{
  "dimensions": [
    { "name": "属性维度名称", "values": ["值1", "值2", "值3"] }
  ],
  "products": [
    { "asin": "B0xxx", "tags": { "属性维度名称": "值1", "另一个维度": "值2" } }
  ]
}

注意：
- 维度名称使用中文
- 属性值尽量简洁（2-6个字）
- 优先提取对购买决策影响最大的属性`;

// ─── Stage 1: Market Overview AI Interpretation ───────────────

export const MARKET_OVERVIEW_PROMPT = `你是亚马逊市场分析专家。基于以下市场大盘统计数据，给出专业的市场分析解读。

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
}`;

// ─── Stage 2: Attribute Cross Analysis AI ─────────────────────

export const ATTRIBUTE_ANALYSIS_PROMPT = `你是亚马逊产品策略专家。基于以下品类的属性交叉分析数据，给出产品开发方向建议。

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
}`;

// ─── Stage 3: Price Analysis AI ───────────────────────────────

export const PRICE_ANALYSIS_PROMPT = `你是亚马逊定价策略专家。基于以下价格段分析数据，给出定价策略建议。

**分析要求：**
1. **最佳价格区间**：识别销额占比高、竞争适中的价格区间
2. **价格与评分关系**：分析不同价格段的评分差异
3. **定价策略推荐**：推荐具体的定价策略（渗透定价/价值定价/竞争定价）
4. **建议零售价**：给出具体的建议零售价范围

**输出格式（严格JSON）：**
{
  "bestPriceRange": {
    "min": 0,
    "max": 0,
    "reason": "推荐理由"
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
  "summary": "200字以内的价格分析总结"
}`;

// ─── Stage 4: Brand Competition AI ────────────────────────────

export const BRAND_COMPETITION_PROMPT = `你是亚马逊品牌竞争分析专家。基于以下品牌竞争数据，给出竞争策略建议。

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
}`;

// ─── Stage 5: Review Analysis AI (KANO Model) ────────────────

export const REVIEW_KANO_PROMPT = `你是亚马逊产品评论分析专家，精通卡洛模型（KANO Model）。基于以下竞品评论数据，进行深度分析。

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
}`;

// ─── Stage 6: Decision Dashboard AI ──────────────────────────

export const DECISION_DASHBOARD_PROMPT = `你是亚马逊产品开发决策专家。基于以下已确认的各阶段分析数据，生成最终的综合决策建议。

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
}`;
