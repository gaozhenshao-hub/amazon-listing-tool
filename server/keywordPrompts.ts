// AI prompts for keyword module

export const KEYWORD_SEMANTIC_FILTER_PROMPT = `You are an Amazon keyword specialist. Analyze the following keywords for an Amazon product and determine which should be KEPT and which should be REMOVED.

Product Info:
{productContext}

Keywords to analyze:
{keywords}

REMOVAL RULES:
1. Remove keywords with NO purchase intent (e.g., "how to", "review", "free", "DIY", "tutorial")
2. Remove pure generic/broad words (e.g., "gift", "sale", "best", "cheap", "amazon")
3. Remove brand names that don't match the product
4. Remove keywords for completely different product categories
5. Remove misspellings that lead to wrong products

CRITICAL RULE: The "keyword" field in your response MUST contain the exact original English keyword as provided in the input. Do NOT translate, modify, or rewrite any keyword.

For each keyword, respond in JSON format:
{
  "results": [
    {
      "keyword": "the exact original English keyword",
      "action": "keep" | "remove",
      "reason": "brief reason",
      "relevance": "high" | "medium" | "low"
    }
  ]
}`;

export const KEYWORD_SCENE_TAG_PROMPT = `You are an Amazon COSMO algorithm specialist. For each keyword, assign scene and intent tags that align with Amazon's COSMO algorithm (which emphasizes scenario-based and semantic matching).

Product Info:
{productContext}

Keywords to tag:
{keywords}

TAG RULES:
1. Scene tags should describe real usage scenarios in English (e.g., "gift giving", "outdoor travel", "office desk", "kids friendly", "family gathering", "fitness workout")
2. Intent tags should describe purchase intent (e.g., "replacement", "upgrade", "first_purchase", "gift_giving", "bulk_buy")
3. Each keyword can have multiple scene tags
4. Be specific - avoid overly generic tags

CRITICAL RULE: The "keyword" field in your response MUST contain the exact original English keyword as provided in the input. Do NOT translate, modify, or rewrite any keyword.

Respond in JSON format:
{
  "results": [
    {
      "keyword": "the exact original English keyword",
      "sceneTags": ["tag1", "tag2"],
      "intentTag": "intent description"
    }
  ]
}`;

export const KEYWORD_ROOT_CLASSIFY_PROMPT = `You are an Amazon SEO expert specializing in word root analysis. Classify each keyword's root word into one of 7 categories and assess its impact level.

Product Info:
{productContext}

Keywords to classify:
{keywords}

ROOT CATEGORIES:
1. "core" - 核心词根: Product main category (e.g., juicer, blender, water bottle)
2. "function" - 功能词根: Core selling points (e.g., waterproof, fast-charging, portable)
3. "scene" - 场景词根 (COSMO重点): Usage environment (e.g., travel, outdoor, office, kitchen)
4. "audience" - 人群词根: Target audience (e.g., kids, women, elderly, professional)
5. "spec" - 规格词根: Size/capacity/packaging (e.g., 10 inch, 2 pack, 500ml)
6. "painpoint" - 痛点词根: Problems solved (e.g., anti-slip, noise-reduction, leak-proof)
7. "gift_holiday" - 节日/礼品词根: Gift attributes (e.g., christmas gift, birthday present)

IMPACT LEVELS:
- "high": Directly drives conversions, must be in Listing
- "medium": Supports main keywords, good for bullet points
- "low": Nice to have, suitable for backend search terms

CRITICAL RULE: The "keyword" field in your response MUST contain the exact original English keyword as provided in the input. Do NOT translate, modify, or rewrite any keyword. The "rootWord" should also be in English.

Respond in JSON format:
{
  "results": [
    {
      "keyword": "the exact original English keyword",
      "rootWord": "extracted root word in English",
      "rootCategory": "core|function|scene|audience|spec|painpoint|gift_holiday",
      "rootImpact": "high|medium|low"
    }
  ]
}`;

export const KEYWORD_STRATEGY_MATRIX_PROMPT = `You are an Amazon advertising strategist. Based on the three-dimensional data (traffic × relevance × competition) for each keyword, assign a strategy category and Listing placement suggestion.

Product Info:
{productContext}

Keywords with their metrics:
{keywords}

STRATEGY CATEGORIES (3D Matrix):
1. "core_main" - 核心主词: High traffic + High relevance + High competition → Mature period, title front, main ad push
2. "sub_core" - 次核心词: Medium traffic + High relevance + Medium competition → Growth period, title mid-end, supplementary ads
3. "precise_longtail" - 精准长尾词: Low/Medium traffic + High relevance + Low competition (Low SPR) → NEW PRODUCT PERIOD MAIN FORCE, title end, low-bid pickup
4. "scene_intent" - 场景意图词: Variable traffic + Strong scene relevance → All periods, A+ scene content, COSMO ad testing
5. "longtail_main" - 长尾主词: Medium traffic + Medium relevance + Low competition → Growth period, backend Search Term, broad/phrase match
6. "observe_test" - 观察测试词: High traffic + Medium/Low relevance → Budget-dependent, no core placement, small budget auto/broad test
7. "negative" - 可删除/否定词: Attribute mismatch / Pure generic → Never use, add to negative keyword library

LISTING PLACEMENT:
- "title_front": 标题前段 (for core_main)
- "title_mid": 标题中后段 (for sub_core)
- "title_end": 标题末尾 (for precise_longtail)
- "bullet_first": 五点描述首句 (for sub_core)
- "bullet_body": 五点描述自然融入 (for precise_longtail, scene_intent)
- "aplus": A+ 核心文案 (for core_main, scene_intent)
- "search_term": 后台 Search Term (for longtail_main)
- "not_use": 绝对不使用 (for negative)

CRITICAL RULE: The "keyword" field in your response MUST contain the exact original English keyword as provided in the input. Do NOT translate, modify, or rewrite any keyword.

Respond in JSON format:
{
  "results": [
    {
      "keyword": "the exact original English keyword",
      "strategyCategory": "core_main|sub_core|precise_longtail|scene_intent|longtail_main|observe_test|negative",
      "listingPlacement": "title_front|title_mid|title_end|bullet_first|bullet_body|aplus|search_term|not_use",
      "adStrategy": "brief ad strategy suggestion",
      "promotionPhase": "新品期|成长期|成熟期|全周期"
    }
  ]
}`;

export const KEYWORD_LISTING_LAYOUT_PROMPT = `You are an Amazon Listing optimization expert. Based on the classified keyword roots and strategy matrix, generate a Listing layout recommendation.

Product Info:
{productContext}

Keyword Root Classification:
{rootClassification}

Strategy Matrix Summary:
{strategyMatrix}

Generate a comprehensive Listing layout recommendation including:
1. Title formula: Which root words to combine and in what order
2. Bullet points formula: How to structure each of the 5 bullet points using keyword roots
3. A+ content suggestions: Which scene keywords to highlight
4. Backend Search Terms: Which keywords to place in ST
5. Keywords NOT to use anywhere

Respond in JSON format:
{
  "titleFormula": {
    "structure": "核心词根 + 功能词根 + 规格词根 + 场景/人群词根",
    "example": "example title using actual keywords",
    "keywordsUsed": ["kw1", "kw2"]
  },
  "bulletFormulas": [
    {
      "bulletNumber": 1,
      "structure": "痛点词根引入 + 功能词根解决",
      "keywordsUsed": ["kw1", "kw2"],
      "example": "example bullet"
    }
  ],
  "aplusKeywords": ["scene keyword 1", "scene keyword 2"],
  "searchTermKeywords": ["backend kw1", "backend kw2"],
  "doNotUse": ["negative kw1", "negative kw2"],
  "overallStrategy": "Brief overall keyword strategy summary"
}`;

export const KEYWORD_TRAFFIC_COMPETITION_CLASSIFY_PROMPT = `You are an Amazon keyword data analyst. Given a batch of keywords with their monthly search volume and SPR (Sponsored Products Rank) data, intelligently classify each keyword's traffic level and competition level based on the OVERALL DATA DISTRIBUTION of this specific dataset.

IMPORTANT: Do NOT use fixed thresholds. Instead, analyze the entire dataset's distribution (percentiles, median, mean, spread) and determine appropriate cutoff points for this specific product niche. Different niches have vastly different search volume and SPR ranges.

Product Info:
{productContext}

Keywords data (format: keyword | monthly_search_volume | SPR):
{keywordsData}

CLASSIFICATION RULES:

1. Traffic Level (based on monthly search volume distribution):
   - "high": Top tier keywords in this dataset (roughly top 20-30% by search volume)
   - "medium": Middle tier keywords (roughly middle 40-50%)
   - "low": Bottom tier keywords (roughly bottom 20-30%)
   - If a keyword has no search volume data, classify as "medium" by default

2. Competition Level (based on SPR distribution):
   - "low": Keywords that are easier to rank for (lower SPR relative to this dataset)
   - "medium": Keywords with moderate ranking difficulty
   - "high": Keywords that are hardest to rank for (higher SPR relative to this dataset)
   - If a keyword has no SPR data, classify as "medium" by default

3. Also provide the thresholds you determined:
   - trafficThresholds: { highMin, mediumMin } (search volume cutoffs)
   - competitionThresholds: { lowMax, mediumMax } (SPR cutoffs)

CRITICAL RULE: The "keyword" field in your response MUST contain the exact original English keyword as provided in the input. Do NOT translate, modify, or rewrite any keyword.

Respond in JSON format:
{
  "analysis": {
    "totalKeywords": number,
    "searchVolumeRange": { "min": number, "max": number, "median": number },
    "sprRange": { "min": number, "max": number, "median": number },
    "trafficThresholds": { "highMin": number, "mediumMin": number },
    "competitionThresholds": { "lowMax": number, "mediumMax": number }
  },
  "results": [
    {
      "keyword": "the exact original English keyword",
      "trafficLevel": "high|medium|low",
      "competition": "high|medium|low"
    }
  ]
}`;
