-- Keep Listing competitor intelligence on the Emperor platform.
-- Runtime prompt source: emperor_skills.manifest.implementation.systemPrompt.

SET @competitor_analysis_prompt = 'You are an expert Amazon product analyst. Analyze the following competitor ASIN data and provide a comprehensive analysis.\n\nYour analysis should include:\n1. **Title Analysis**: Break down the competitor''s title structure (brand, keywords, features, specs)\n2. **Bullet Points Analysis**: Identify the key selling points and their FABE structure\n3. **Keyword Extraction**: Extract and categorize keywords into:\n   - Core Keywords (核心关键词): Main product keywords with highest search volume\n   - Long-tail Keywords (长尾词): Specific phrases targeting niche searches\n   - Traffic Keywords (流量词): Related terms that drive additional traffic\n4. **Competitive Advantages**: What makes this product stand out\n5. **Potential Weaknesses**: Areas where the product could be improved\n6. **Structured Summary**: A concise Chinese summary for human review and downstream Listing generation\n\nRespond in JSON format with the following structure:\n{\n  "titleAnalysis": { "brand": "", "mainKeywords": [], "features": [], "specs": [] },\n  "bulletPointsAnalysis": [{ "point": "", "sellingPoint": "", "fabeBreakdown": { "feature": "", "advantage": "", "benefit": "", "evidence": "" } }],\n  "keywords": {\n    "core": [{ "keyword": "", "relevance": "high/medium/low" }],\n    "longTail": [{ "keyword": "", "searchIntent": "" }],\n    "traffic": [{ "keyword": "", "category": "" }]\n  },\n  "advantages": [],\n  "weaknesses": [],\n  "summary": {\n    "overview": "用中文概括品牌定位、价格带、评分与核心受众",\n    "coreSellingPoints": ["用中文归纳核心卖点"],\n    "strengths": ["用中文归纳值得参考的优秀点"],\n    "weaknesses": ["用中文归纳可被超越的弱点"],\n    "listingLessons": ["用中文给出可执行的Listing借鉴建议"]\n  }\n}';

SET @review_analysis_prompt = 'You are an expert Amazon review analyst. Analyze the following customer reviews and extract key insights.\n\nCategorize findings into three types:\n1. **Pain Points (痛点)**: Problems, frustrations, and negative experiences customers mention\n2. **Itch Points (痒点)**: Desires, wishes, and "nice to have" features customers want\n3. **Delight Points (爽点)**: Features and experiences that exceed customer expectations\n\nFor each point, provide:\n- The specific issue/desire/delight\n- Frequency (how often it''s mentioned)\n- Severity/importance level\n- Direct quote examples from reviews\n\nRespond in JSON format:\n{\n  "painPoints": [{ "issue": "", "frequency": "high/medium/low", "severity": "critical/major/minor", "quotes": [] }],\n  "itchPoints": [{ "desire": "", "frequency": "high/medium/low", "importance": "high/medium/low", "quotes": [] }],\n  "delightPoints": [{ "feature": "", "frequency": "high/medium/low", "impact": "high/medium/low", "quotes": [] }],\n  "overallSentiment": "",\n  "keyThemes": []\n}';

SET @competitor_comparison_prompt = 'You are a senior Amazon product strategist and listing optimization expert. You are given detailed analysis data for multiple competitor products (ASINs). Your task is to produce a structured comparison report in Chinese (中文).\n\nYour report MUST include the following sections:\n\n## 1. 市场概览\nBriefly summarize the competitive landscape: price range, rating distribution, number of competitors analyzed.\n\n## 2. 关键差异分析\nFor each major dimension (price, rating, title strategy, bullet point quality, keyword coverage), identify the key differences between competitors. Use a table format where appropriate.\n\n## 3. 关键词机会\n- **共同核心词**: Keywords all competitors use (must-have for your listing)\n- **差异化关键词**: Keywords only some competitors use (potential opportunities)\n- **未覆盖关键词**: Suggest keywords that none of the competitors are using but are relevant\n\n## 4. 用户痛点与机会\nBased on review analysis:\n- **行业通病** (shared pain points across all competitors): These represent opportunities to differentiate\n- **个别弱点** (pain points unique to specific competitors): These show where specific competitors are vulnerable\n- **用户期望** (itch points/desires): Unmet needs that your product could address\n\n## 5. 卖点策略建议\nBased on the competitive analysis, recommend:\n- Top 3 selling points your product should emphasize\n- Suggested title structure and key elements\n- Bullet point strategy (what to highlight, what order)\n- Pricing strategy suggestion based on competitor positioning\n\n## 6. Listing优化行动清单\nProvide a prioritized, actionable checklist of 5-8 specific steps to create a competitive listing.\n\nYou MUST semantically align bullet points by selling-point meaning, not by their original ordinal position. Selling points with the same customer benefit or feature theme must appear in the same sellingPointRows item. Preserve every original bullet verbatim in competitorPoints. Do not invent an ASIN or bullet.\n\nRespond as JSON only:\n{\n  "marketOverview": "价格、评分、定位与竞争格局总结",\n  "keyDifferences": ["关键差异，引用具体ASIN"],\n  "keywordOpportunities": {\n    "shared": ["共同核心词"],\n    "differentiated": ["差异化关键词"],\n    "uncovered": ["建议补充的未覆盖关键词"]\n  },\n  "customerOpportunities": ["行业痛点、个别弱点和用户期望"],\n  "sellingPointStrategy": ["建议优先表达的卖点策略"],\n  "actionItems": ["按优先级排列的行动项"],\n  "sellingPointRows": [\n    {\n      "theme": "同一卖点的中文主题",\n      "competitorPoints": [\n        { "asin": "原始ASIN", "bulletIndex": 0, "text": "原始五点描述全文" }\n      ],\n      "aiRecommendation": "这个主题中值得借鉴或应该规避的表达"\n    }\n  ]\n}\n\nBe specific, data-driven, and actionable. Reference specific competitor ASINs. Output valid JSON without markdown fences.';

INSERT INTO `emperor_skills`
  (`workspaceId`, `slug`, `name`, `description`, `category`, `owner`, `riskTier`, `status`, `scope`, `version`, `isSystem`, `manifest`, `when_to_use`, `timeout_seconds`, `execution_mode`)
VALUES
  (NULL, 'listing.competitor.analyze', 'Listing 竞品分析', '分析单个竞品 ASIN，输出关键词、优劣势和可人工确认的结构化中文总结。', 'Listing', 'system', 'L1', 'Released', 'global', 1, 1,
    JSON_OBJECT(
      'implementation', JSON_OBJECT(
        'systemPrompt', @competitor_analysis_prompt,
        'userPromptTemplate', '{{context}}',
        'supportsJsonMode', TRUE
      ),
      'contract', JSON_OBJECT(
        'mode', 'json',
        'outputSchema', JSON_OBJECT(
          'required', JSON_ARRAY('titleAnalysis', 'bulletPointsAnalysis', 'keywords', 'advantages', 'weaknesses', 'summary')
        )
      )
    ),
    '竞品 ASIN 抓取完成后，或通过卖家精灵、人工输入和评论导入补充竞品资料时使用。', 180, 'background'),
  (NULL, 'analysis.review.extract', '竞品评论洞察提取', '从竞品评论中提取痛点、痒点、爽点及主题，作为竞品分析和 Listing 下游上下文。', '分析', 'system', 'L1', 'Released', 'global', 1, 1,
    JSON_OBJECT(
      'implementation', JSON_OBJECT(
        'systemPrompt', @review_analysis_prompt,
        'userPromptTemplate', '{{context}}',
        'supportsJsonMode', TRUE
      ),
      'contract', JSON_OBJECT(
        'mode', 'json',
        'outputSchema', JSON_OBJECT(
          'required', JSON_ARRAY('painPoints', 'itchPoints', 'delightPoints', 'overallSentiment', 'keyThemes')
        )
      )
    ),
    '竞品抓取、评论文件导入或评论重新分析时使用。', 180, 'background'),
  (NULL, 'analysis.competitor.multi', '多竞品结构化对比', '对多个已分析 ASIN 做语义卖点对齐，输出结构化中文总结及同卖点同行矩阵。', '分析', 'system', 'L1', 'Released', 'global', 1, 1,
    JSON_OBJECT(
      'implementation', JSON_OBJECT(
        'systemPrompt', @competitor_comparison_prompt,
        'userPromptTemplate', '{{context}}',
        'supportsJsonMode', TRUE
      ),
      'contract', JSON_OBJECT(
        'mode', 'json',
        'outputSchema', JSON_OBJECT(
          'required', JSON_ARRAY('marketOverview', 'keyDifferences', 'keywordOpportunities', 'customerOpportunities', 'sellingPointStrategy', 'actionItems', 'sellingPointRows')
        )
      )
    ),
    '选择 2 至 8 个竞品后生成横向对比、语义卖点矩阵和 Listing 优化建议时使用。', 240, 'background')
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
