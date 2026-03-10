// AI prompt for generating PPC ad keyword structure recommendation

export const AD_STRUCTURE_PROMPT = `你是一位拥有10年经验的亚马逊PPC广告专家。根据产品信息和关键词数据，为该产品设计一套完整的SP（Sponsored Products）广告关键词架构。

## 产品信息
{productContext}

## 已有关键词数据（含策略分类）
{keywordData}

## 竞品分析摘要
{competitorSummary}

## 要求

请按照以下广告组矩阵结构，为每个广告组推荐关键词并给出投放建议：

### 广告组类型（行维度）：
1. **核心大词组 (Core Keywords)**：高流量核心主词，竞争激烈但转化高
2. **精准长尾组 (Precise Long-tail)**：低竞争高相关长尾词，新品期主力
3. **场景意图组 (Scene Intent)**：基于使用场景和购买意图的关键词，COSMO算法重点
4. **竞品ASIN定投组 (Competitor Targeting)**：竞品ASIN和竞品品牌词
5. **品牌防御组 (Brand Defense)**：自有品牌词+品牌+品类组合
6. **自动广告组 (Auto Campaign)**：自动广告的优化建议

### 匹配类型（列维度）：
- **Exact（精准匹配）**：完全匹配，CPC最高但转化最好
- **Phrase（词组匹配）**：包含词组，平衡流量和精准度
- **Broad（广泛匹配）**：最大流量覆盖，用于拓词和测试

### ⚠️ 关键词语言规则（最高优先级）：
- **所有keyword字段必须使用英文原文**，严禁将英文关键词翻译成中文
- 从"已有关键词数据"中选取的关键词必须原样保留，不做任何翻译或改写
- negativeKeywords也必须使用英文原文
- organicRankingEstimate中的topKeywords也必须使用英文原文
- 只有策略说明、备注、优化建议等描述性文字可以使用中文

### 输出JSON格式：
{
  "adStructure": {
    "campaigns": [
      {
        "campaignName": "SP-Core-Exact",
        "campaignType": "manual",
        "adGroupType": "core_keywords",
        "matchType": "exact",
        "dailyBudget": "$XX",
        "bidStrategy": "竞价策略说明",
        "phase": "成长期/成熟期",
        "priority": "high/medium/low",
        "keywords": [
          {
            "keyword": "english keyword here",
            "suggestedBid": "$X.XX",
            "searchVolume": "高/中/低",
            "competition": "高/中/低",
            "note": "投放备注"
          }
        ],
        "negativeKeywords": ["english negative keyword"],
        "optimizationTips": "优化建议"
      }
    ],
    "autoCompaign": {
      "dailyBudget": "$XX",
      "defaultBid": "$X.XX",
      "negativeExact": ["english exact negative keyword"],
      "negativePhrase": ["english phrase negative keyword"],
      "optimizationTips": "自动广告优化建议",
      "harvestStrategy": "收词策略说明"
    }
  },
  "budgetAllocation": {
    "totalDailyBudget": "$XX",
    "breakdown": [
      {
        "campaignGroup": "核心大词",
        "percentage": 30,
        "dailyAmount": "$XX",
        "reason": "分配理由"
      }
    ]
  },
  "phaseStrategy": {
    "newProduct": {
      "duration": "1-4周",
      "focus": "重点投放的广告组",
      "budgetSplit": "预算分配比例",
      "keyActions": ["关键动作1", "关键动作2"]
    },
    "growth": {
      "duration": "1-3个月",
      "focus": "重点投放的广告组",
      "budgetSplit": "预算分配比例",
      "keyActions": ["关键动作1", "关键动作2"]
    },
    "mature": {
      "duration": "3个月+",
      "focus": "重点投放的广告组",
      "budgetSplit": "预算分配比例",
      "keyActions": ["关键动作1", "关键动作2"]
    }
  },
  "negativeKeywordStrategy": {
    "campaignLevel": ["english global negative keyword"],
    "adGroupLevel": {
      "core_keywords": ["english negative keyword for this group"],
      "precise_longtail": ["english negative keyword for this group"]
    },
    "rules": "否定词管理规则说明"
  },
  "overallStrategy": "整体广告架构策略总结，包括投放节奏、预算调整建议、ACoS目标等",
  "orderVolumeProjection": {
    "assumptions": "预估假设说明（基于关键词搜索量、预估CTR、转化率等）",
    "conversionRate": "预估转化率范围（如8%-15%）",
    "avgCPC": "$X.XX",
    "phases": {
      "newProduct": {
        "period": "第1-4周",
        "dailyAdOrders": "X-X单/天",
        "weeklyAdOrders": "X-X单/周",
        "monthlyAdOrders": "X-X单/月",
        "dailyAdSpend": "$XX-$XX",
        "estimatedACoS": "XX%-XX%",
        "dailyOrganicOrders": "X-X单/天",
        "organicOrderRatio": "XX%",
        "totalDailyOrders": "X-X单/天",
        "notes": "新品期说明"
      },
      "growth": {
        "period": "第2-3个月",
        "dailyAdOrders": "X-X单/天",
        "weeklyAdOrders": "X-X单/周",
        "monthlyAdOrders": "X-X单/月",
        "dailyAdSpend": "$XX-$XX",
        "estimatedACoS": "XX%-XX%",
        "dailyOrganicOrders": "X-X单/天",
        "organicOrderRatio": "XX%",
        "totalDailyOrders": "X-X单/天",
        "notes": "成长期说明"
      },
      "mature": {
        "period": "第4个月+",
        "dailyAdOrders": "X-X单/天",
        "weeklyAdOrders": "X-X单/周",
        "monthlyAdOrders": "X-X单/月",
        "dailyAdSpend": "$XX-$XX",
        "estimatedACoS": "XX%-XX%",
        "dailyOrganicOrders": "X-X单/天",
        "organicOrderRatio": "XX%",
        "totalDailyOrders": "X-X单/天",
        "notes": "成熟期说明"
      }
    },
    "organicRankingEstimate": {
      "topKeywords": [
        {
          "keyword": "english core keyword",
          "currentEstimatedRank": "N/A（新品）",
          "targetRankAfter30Days": "XX-XX位",
          "targetRankAfter90Days": "XX-XX位",
          "estimatedDailyOrdersAtTarget": "X-X单",
          "requiredDailySales": "需要X单/天才能稳定首页",
          "difficulty": "高/中/低"
        }
      ],
      "firstPageStrategy": "上首页策略说明，包括SPR（Sales Per Ranking）要求",
      "topOfSearchStrategy": "冲首页首位策略说明，包括需要的单量和时间"
    }
  }
}

## 注意事项：
1. 每个广告组的关键词数量控制在5-15个
2. 核心大词组只放最重要的3-5个高流量词
3. 精准长尾组重点推荐SPR低、转化好的词
4. 场景意图组要结合COSMO算法趋势
5. 竞品定投组：如果竞品分析摘要中包含竞品ASIN数据，必须将这些ASIN作为定投目标列入竞品ASIN定投组的keywords中（keyword字段填写ASIN，note字段说明该竞品的特征如价格、评分、弱点等），同时推荐竞品品牌词；如果没有竞品数据，则给出通用的竞品定投策略建议
6. 否定词策略要防止广告组之间的内部竞争
7. 预算分配要根据产品所处阶段给出不同建议
8. 竞价建议要合理，参考PPC bid数据（如果有）
9. 所有金额使用美元
10. orderVolumeProjection必须基于关键词搜索量数据合理预估，给出保守和乐观两个范围
11. organicRankingEstimate中的topKeywords选取搜索量最高的3-5个核心词，预估自然排名提升路径
12. 每个阶段的自然出单占比应随时间递增（新品期10-20%，成长期30-50%，成熟期50-70%）
13. 首页首位出单量预估要结合SPR数据和关键词搜索量
14. **【最重要】所有keyword字段、negativeKeywords字段必须保留英文原文，严禁翻译成中文。从输入数据中选取的关键词必须原样使用，不得翻译、改写或转换语言。**`;

export const AD_STRUCTURE_TRANSLATION_PROMPT = `你是一位专业的亚马逊广告翻译专家。将以下广告架构建议从中文翻译为英文，保持专业术语的准确性。

注意：
1. 广告专业术语保持英文原文（如ACoS, ROAS, CPC, SP, SB等）
2. 关键词本身如果已经是英文则不翻译
3. 策略建议和说明文字翻译为英文
4. JSON结构保持不变

原文：
{content}

请返回翻译后的完整JSON。`;
