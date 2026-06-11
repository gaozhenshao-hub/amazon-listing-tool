// ─── Video Script Generation LLM Prompts ────────────────────────
// V2: 四种视频类型差异化提示词 + 两层提示词架构（类型适配层 + 镜头生成层）

// ═══════════════════════════════════════════════════════════════════
// 视频类型规范常量
// ═══════════════════════════════════════════════════════════════════

export const VIDEO_TYPE_SPECS: Record<string, {
  label: string;
  labelEn: string;
  minDuration: number;
  maxDuration: number;
  recommendedDuration: [number, number];
  resolution: string;
  aspectRatio: string;
  maxFileSize: string;
  subtitleRequired: boolean;
  audioNote: string;
  maxSegments?: number;
  structureLabel: string;
  structureSummary: string;
}> = {
  main_video: {
    label: "主图视频", labelEn: "Listing Video",
    minDuration: 6, maxDuration: 45, recommendedDuration: [25, 30],
    resolution: "1920×1080", aspectRatio: "16:9", maxFileSize: "5 GB",
    subtitleRequired: true, audioNote: "可选（默认静音播放）",
    structureLabel: "6幕式", structureSummary: "痛点→亮相→卖点1→卖点2→场景→CTA",
  },
  ad_spv: {
    label: "SPV 广告视频", labelEn: "Sponsored Products Video",
    minDuration: 7, maxDuration: 45, recommendedDuration: [15, 25],
    resolution: "1920×1080", aspectRatio: "16:9 / 9:16", maxFileSize: "500 MB",
    subtitleRequired: true, audioNote: "推荐有声（默认静音）", maxSegments: 5,
    structureLabel: "单功能4幕式 × N段", structureSummary: "每段聚焦一个功能，独立成篇",
  },
  ad_sbv: {
    label: "品牌推广视频 (SBV)", labelEn: "Sponsored Brands Video",
    minDuration: 6, maxDuration: 45, recommendedDuration: [15, 20],
    resolution: "1920×1080", aspectRatio: "16:9 / 9:16", maxFileSize: "500 MB",
    subtitleRequired: true, audioNote: "推荐有声（默认静音）",
    structureLabel: "5幕式品牌叙事", structureSummary: "品牌愿景→解决方案→社会证明→情感→收尾",
  },
  aplus_video: {
    label: "A+ 视频", labelEn: "A+ Content Video",
    minDuration: 30, maxDuration: 120, recommendedDuration: [45, 90],
    resolution: "960×540+", aspectRatio: "16:9", maxFileSize: "500 MB",
    subtitleRequired: false, audioNote: "可选",
    structureLabel: "7幕式教育型", structureSummary: "概览→开箱→安装→使用→高级→维护→总结",
  },
  social_media: {
    label: "社媒短视频", labelEn: "Social Media Video",
    minDuration: 5, maxDuration: 60, recommendedDuration: [15, 30],
    resolution: "1080×1920", aspectRatio: "9:16", maxFileSize: "500 MB",
    subtitleRequired: true, audioNote: "推荐有声",
    structureLabel: "快节奏3-5幕式", structureSummary: "Hook→演示→效果→CTA",
  },
};

// ═══════════════════════════════════════════════════════════════════
// 风格预设常量
// ═══════════════════════════════════════════════════════════════════

export const STYLE_PRESETS: Record<string, {
  label: string;
  description: string;
  colorTone: string;
  lighting: string;
  propsStyle: string;
  bgSuggestion: string;
}> = {
  minimal_white: {
    label: "简约白底", description: "干净、专业、突出产品本身",
    colorTone: "白色/浅灰为主，产品色为点缀", lighting: "均匀柔光，无硬阴影",
    propsStyle: "极简道具，白色/透明材质", bgSuggestion: "纯白或浅灰无缝背景纸",
  },
  warm_home: {
    label: "温馨家居", description: "温暖、生活化、有居家氛围",
    colorTone: "暖色调（米色、木色、暖黄）", lighting: "自然光或暖色灯光，柔和阴影",
    propsStyle: "木质、布艺、绿植等家居元素", bgSuggestion: "厨房台面/客厅/卧室等真实家居场景",
  },
  tech_modern: {
    label: "科技感", description: "现代、精密、高端科技产品",
    colorTone: "深色背景（黑/深蓝）+ 冷色光效", lighting: "侧光/轮廓光，突出产品线条",
    propsStyle: "金属、玻璃、LED等科技元素", bgSuggestion: "深色背景 + 渐变光效/粒子效果",
  },
  outdoor_nature: {
    label: "户外自然", description: "清新、活力、户外运动/露营",
    colorTone: "绿色、蓝色、土色等自然色", lighting: "自然光（金色时段最佳）",
    propsStyle: "户外装备、自然元素", bgSuggestion: "草坪/山林/海滩/露营地等户外场景",
  },
  luxury_premium: {
    label: "奢华质感", description: "高端、精致、奢侈品调性",
    colorTone: "黑金、深酒红、墨绿等深色", lighting: "聚光灯/伦勃朗光，强烈明暗对比",
    propsStyle: "丝绒、大理石、金属装饰", bgSuggestion: "深色丝绒/大理石台面/暗调场景",
  },
};

// ═══════════════════════════════════════════════════════════════════
// 类型适配层提示词 — 四种视频类型的内容结构模板
// ═══════════════════════════════════════════════════════════════════

export const VIDEO_TYPE_STRUCTURE_TEMPLATES: Record<string, string> = {
  main_video: `## 主图视频（Listing Video）— "30秒卖点速览"

### 内容结构：6幕式
| 幕次 | 时间段 | 内容要求 | 景别建议 |
|------|--------|---------|---------|
| 第1幕：痛点/场景引入 | 0-3秒 | 用一个生活场景或痛点画面快速建立共鸣，让买家产生"这就是我"的感觉 | 中景/全景 |
| 第2幕：产品亮相 | 3-6秒 | 产品以干净利落的方式出场，配合品牌Logo或产品名称文字叠加 | 近景/特写 |
| 第3幕：核心卖点1 | 6-12秒 | 展示最强卖点（差异化功能），用动态画面而非静态图片 | 特写+中景切换 |
| 第4幕：核心卖点2 | 12-18秒 | 展示第二卖点（使用便利性/材质/安全性等） | 近景 |
| 第5幕：使用场景 | 18-24秒 | 真人使用产品的完整场景，传递"拥有后的美好生活" | 中景/全景 |
| 第6幕：收尾CTA | 24-30秒 | 产品全貌+品牌Logo+核心卖点文字总结（不超过3个关键词） | 近景/产品平铺 |

### 创作约束
- 总时长控制在25-30秒
- 前3秒决定生死——必须用视觉冲击力或情感共鸣留住买家，避免以品牌Logo开场
- 全程需要字幕覆盖（超过85%的亚马逊视频在静音状态下被观看）
- 每个镜头时长控制在2-4秒，保持节奏紧凑
- 色调应与产品主图风格一致，维护品牌视觉统一性`,

  ad_spv: `## SPV广告视频（Sponsored Products Video）— "功能聚焦演示"

### 核心特性
SPV允许为单个产品上传最多5段功能视频，每段聚焦一个产品功能。脚本创作逻辑从"一个视频讲完所有卖点"转变为"每个视频只讲一个功能故事"。

### 内容结构：单功能4幕式（每段视频）
| 幕次 | 时间段 | 内容要求 | 景别建议 |
|------|--------|---------|---------|
| 第1幕：功能痛点 | 0-3秒 | 用一个画面展示没有该功能时的不便或问题 | 中景 |
| 第2幕：功能演示 | 3-12秒 | 详细展示该功能的操作过程，强调"怎么用"（核心部分） | 特写+近景 |
| 第3幕：效果对比 | 12-18秒 | 展示使用该功能前后的对比效果 | 分屏/近景切换 |
| 第4幕：功能总结 | 18-25秒 | 功能名称文字叠加+产品全貌 | 近景 |

### 5段视频的内容分配策略
| 视频段 | 聚焦维度 | 内容方向 | 描述文字模板 |
|--------|---------|---------|------------|
| 视频1 | 核心差异化功能 | 展示产品最独特、竞品没有的功能 | "[功能名]—只有[品牌]才有的[功能描述]" |
| 视频2 | 使用便利性 | 展示产品的易用性、一键操作、快速上手 | "轻松[动作]—[时间]内完成[任务]" |
| 视频3 | 材质/品质/安全 | 展示材质细节、认证标志、耐用性测试 | "[材质/认证]品质—为[场景]而生" |
| 视频4 | 场景适用性 | 展示产品在不同场景下的使用 | "随时随地—[场景1]、[场景2]、[场景3]" |
| 视频5 | 配件/售后/包装 | 展示包装内容物、配件、售后保障 | "开箱即用—包含[配件列表]，[保修期]质保" |

### 创作约束
- 每段视频必须独立成篇，买家可能只看其中一段
- 每段时长15-25秒
- 描述文字是SPV的重要组成部分，需要与视频内容高度匹配
- 视频缩略图（第一帧）的吸引力至关重要
- 优先制作视频1（核心功能），根据数据表现再决定是否补充其余视频`,

  ad_sbv: `## 品牌推广视频（SBV）— "品牌故事叙事"

### 核心特性
SBV聚焦品牌认知提升，出现在搜索结果页的品牌横幅位置，是买家认识品牌的"第一印象"。内容应传递品牌价值观、产品线整体优势和情感共鸣，而非单个产品的功能细节。

### 内容结构：5幕式品牌叙事
| 幕次 | 时间段 | 内容要求 | 景别建议 |
|------|--------|---------|---------|
| 第1幕：品牌愿景/用户痛点 | 0-3秒 | 用一句话或一个画面传递品牌要解决的核心问题 | 全景/中景 |
| 第2幕：品牌解决方案 | 3-7秒 | 展示品牌的核心理念和产品线概览 | 中景/产品组合镜头 |
| 第3幕：社会证明 | 7-11秒 | 展示用户好评、销量数据、获奖信息或认证 | 近景/文字叠加 |
| 第4幕：情感场景 | 11-16秒 | 展示产品融入生活的美好画面，强调情感价值 | 全景/中景 |
| 第5幕：品牌收尾 | 16-20秒 | 品牌Logo+Slogan+产品线入口引导 | 品牌标准画面 |

### 创作约束
- 总时长15-20秒（亚马逊官方建议20秒或更短）
- 核心是"讲故事"而非"卖功能"，避免堆砌产品参数
- 品牌色调、字体和视觉风格必须与品牌旗舰店（Storefront）保持一致
- 支持竖屏（9:16）格式，移动端优先可制作竖屏版本
- 音乐选择对品牌调性影响极大——科技品牌适合电子/极简风格，家居品牌适合温暖/原声风格`,

  aplus_video: `## A+视频 — "深度产品教育"

### 核心特性
A+视频位于产品详情页A+内容区域，买家滚动到此处时通常已对产品产生初步兴趣。使命不是"吸引注意力"，而是"消除购买顾虑，提供深度产品教育"。可以更长、更详细。

### 内容结构：7幕式教育型
| 幕次 | 时间段 | 内容要求 | 景别建议 |
|------|--------|---------|---------|
| 第1幕：产品概览 | 0-5秒 | 产品全貌展示，建立产品认知 | 近景/360度旋转 |
| 第2幕：开箱/配件 | 5-15秒 | 展示包装内容物、配件清单、组装过程 | 近景/俯拍 |
| 第3幕：安装/设置 | 15-30秒 | 分步骤展示产品的安装或首次使用设置 | 特写/近景 |
| 第4幕：完整使用流程 | 30-50秒 | 展示产品从启动到完成任务的完整过程 | 中景/近景切换 |
| 第5幕：高级功能/技巧 | 50-60秒 | 展示产品的进阶用法或隐藏功能 | 特写 |
| 第6幕：维护/清洁 | 60-75秒 | 展示产品的日常维护和清洁方法 | 近景 |
| 第7幕：总结/规格 | 75-90秒 | 产品关键规格参数+品牌信息 | 产品平铺/信息图 |

### 创作约束
- 总时长45-90秒
- 是降低退货率的利器——买家购买前充分了解产品，购后落差显著减小
- 分步骤教程类内容需要清晰的步骤编号字幕
- 可以使用更专业的术语和更详细的参数说明（观看者已是高意向买家）
- Premium A+的Full Video Module支持更高分辨率展示
- 如果产品有多种使用场景，可制作多个A+视频分别放入不同A+模块`,

  social_media: `## 社媒短视频 — "快节奏种草"

### 内容结构：快节奏3-5幕式
| 幕次 | 时间段 | 内容要求 | 景别建议 |
|------|--------|---------|---------|
| 第1幕：Hook | 0-3秒 | 用强视觉冲击或悬念开场 | 特写/动态 |
| 第2幕：快速演示 | 3-10秒 | 产品核心功能快速展示 | 特写+中景 |
| 第3幕：效果/反应 | 10-20秒 | 使用效果或用户反应 | 中景 |
| 第4幕：CTA | 20-30秒 | 引导关注/购买 | 近景 |

### 创作约束
- 总时长15-30秒，节奏快
- 竖屏（9:16）为主
- 前1-2秒必须有强Hook
- 适合TikTok/Instagram Reels/YouTube Shorts风格`,
};

// ═══════════════════════════════════════════════════════════════════
// 阶段0A：竞品脚本分析提示词
// ═══════════════════════════════════════════════════════════════════

export const COMPETITOR_SCRIPT_ANALYSIS_PROMPT = `你是一位资深的亚马逊产品视频分析师，擅长拆解和分析竞品视频的脚本结构。

## 任务
分析以下竞品视频脚本/内容，输出结构化的分析结果。

## 输入
{competitor_content}

## 输出要求（严格JSON格式）
请输出以下JSON结构：
{
  "structure_analysis": {
    "sections": [
      { "name": "段落名称", "duration": 秒数, "percentage": "百分比" }
    ],
    "narrative_mode": "叙事模式总结",
    "duration_feature": "时长分配特征说明",
    "video_type_guess": "main_video|ad_spv|ad_sbv|aplus_video|social_media|unknown"
  },
  "visual_language": {
    "shot_distribution": { "特写": "百分比", "中景": "百分比", "全景": "百分比" },
    "camera_movement": "运镜特征描述",
    "color_tone": "色调风格描述",
    "transition": "转场方式描述",
    "style_preset_match": "minimal_white|warm_home|tech_modern|outdoor_nature|luxury_premium|other"
  },
  "copywriting_analysis": {
    "overlay_style": "画面文案风格描述",
    "subtitle_style": "字幕风格描述",
    "narration_style": "旁白风格描述",
    "cta_text": "CTA文案内容"
  },
  "strengths": ["优点1", "优点2", "优点3"],
  "weaknesses": ["缺点1", "缺点2", "缺点3"],
  "reusable_patterns": [
    { "pattern": "可复用模式描述", "applicable": true, "for_video_type": "适用的视频类型" }
  ]
}

## 规则
1. 分析要具体，避免泛泛而谈
2. 时长百分比要精确到小数点后一位
3. 优缺点各至少3条，每条要有具体依据
4. 可复用模式要具有可操作性
5. 尝试判断竞品视频的类型（video_type_guess）和风格预设匹配（style_preset_match）`;

export const COMPETITOR_SUMMARY_PROMPT = `你是一位资深的亚马逊视频策略分析师。

## 任务
基于以下多个竞品视频脚本的分析结果，生成汇总对比分析。

## 竞品分析数据
{competitor_analyses}

## 输出要求（严格JSON格式）
{
  "common_structure": {
    "typical_sections": ["常见段落1", "常见段落2"],
    "typical_duration_range": "典型时长范围",
    "common_narrative_mode": "共同叙事模式"
  },
  "optimal_duration_allocation": [
    { "section": "段落名", "recommended_percentage": "推荐占比", "reason": "原因" }
  ],
  "differentiable_opportunities": [
    { "opportunity": "差异化机会描述", "priority": "high/medium/low" }
  ],
  "recommended_structure": {
    "sections": [
      { "name": "推荐段落名", "duration_percentage": "推荐占比", "shooting_method": "拍摄方式" }
    ],
    "total_duration_suggestion": "建议总时长",
    "narrative_mode": "推荐叙事模式"
  },
  "style_recommendation": {
    "recommended_preset": "推荐的风格预设",
    "color_tone": "推荐色调",
    "differentiation_note": "与竞品的视觉差异化建议"
  }
}`;

// ═══════════════════════════════════════════════════════════════════
// 阶段0B：产品信息提取提示词
// ═══════════════════════════════════════════════════════════════════

export const PRODUCT_INFO_EXTRACTION_PROMPT = `你是一位亚马逊产品视频策划专家。

## 任务
基于以下产品数据，整理出视频脚本创作所需的产品信息摘要。

## 产品数据
{product_data}

## 输出要求（严格JSON格式）
{
  "basic_info": {
    "product_name": "产品名称",
    "brand": "品牌",
    "category": "类目",
    "price_range": "价格区间",
    "target_audience": "目标受众"
  },
  "selling_points_hierarchy": [
    { "level": "primary|secondary|necessary", "point": "卖点描述", "evidence": "支撑数据", "video_expression": "视频中建议的表达方式" }
  ],
  "pain_points_from_reviews": [
    { "pain_point": "痛点描述", "frequency": "出现频率", "resolution_suggestion": "视频中的化解方案", "scene_suggestion": "建议的拍摄场景" }
  ],
  "key_specs": [
    { "spec": "参数名", "value": "参数值", "visual_suggestion": "视觉化建议" }
  ],
  "keywords_for_overlay": ["关键词1", "关键词2"],
  "listing_bullet_mapping": [
    { "bullet_index": 1, "summary": "卖点概要", "video_expression": "视频表达建议" }
  ],
  "brand_info": {
    "brand_tone": "品牌调性描述",
    "brand_colors": "品牌色彩",
    "brand_slogan": "品牌口号（如有）"
  }
}`;

// ═══════════════════════════════════════════════════════════════════
// 阶段1：段落规划提示词（类型适配层）
// ═══════════════════════════════════════════════════════════════════

export const SECTION_PLANNING_PROMPT = `你是一位资深的亚马逊产品视频编导，精通四种亚马逊视频类型的创作规范。

## 任务
基于以下产品信息、竞品分析结果和视频类型规范，规划视频的段落结构。

## 产品信息
{product_info}

## 竞品分析参考
{competitor_reference}

## 知识库优秀案例参考
{knowledge_base_examples}

## 视频类型
{video_type}

## 视频类型内容结构规范
{video_type_template}

## 风格预设
{style_preset}

## 目标时长
{target_duration}秒

## SPV段号（仅SPV类型适用）
{spv_segment_index}

## 输出要求（严格JSON格式）
{
  "sections": [
    {
      "section_code": "MBP1",
      "scene_name": "幕次名称（如：痛点引入、产品亮相、核心卖点1等）",
      "section_name": "段落名称（中文描述）",
      "section_name_en": "Section Name (English)",
      "shooting_method": "model_narration|live_action|ai_generated|mixed|screen_recording",
      "duration_budget": 秒数,
      "selling_point_refs": ["关联的卖点1", "关联的卖点2"],
      "pain_point_refs": ["关联的痛点1"],
      "description": "段落内容概述",
      "shot_type_suggestion": "建议的主要景别",
      "props_suggestion": ["建议道具1", "建议道具2"]
    }
  ],
  "total_duration": 总时长,
  "narrative_mode": "整体叙事模式说明",
  "duration_allocation_rationale": "时长分配理由",
  "style_guidance": "基于风格预设的整体视觉指导"
}

## 规则
1. 段落编码使用MBP1、MBP2...格式
2. 每个段落必须关联至少一个卖点或痛点
3. 总时长不超过目标时长的110%
4. 严格遵循上方"视频类型内容结构规范"中定义的幕次结构和时间分配
5. 拍摄方式要根据段落内容和风格预设合理选择
6. 如果有知识库优秀案例参考，借鉴其成功的结构和创意手法`;

// ═══════════════════════════════════════════════════════════════════
// 阶段2：子主题展开提示词
// ═══════════════════════════════════════════════════════════════════

export const SUBTOPIC_EXPANSION_PROMPT = `你是一位亚马逊产品视频的分镜师，擅长将段落展开为具体的子主题和镜头规划。

## 任务
将以下段落规划展开为子主题，并建议每个子主题的镜头数量。

## 段落规划
{sections}

## 产品信息
{product_info}

## 视频类型
{video_type}

## 输出要求（严格JSON格式）
{
  "sections": [
    {
      "section_code": "MBP1",
      "subtopics": [
        {
          "subtopic_name": "子主题名称（中文）",
          "subtopic_name_en": "Subtopic Name (English)",
          "duration_budget": 秒数,
          "shot_count": 镜头数量,
          "selling_point_ref": "关联卖点",
          "description": "子主题内容描述"
        }
      ]
    }
  ],
  "reuse_suggestions": [
    {
      "source_section": "MBP2",
      "source_subtopic": "子主题名",
      "target_section": "MBP5",
      "target_subtopic": "子主题名",
      "reason": "复用原因"
    }
  ],
  "shot_distribution": {
    "extreme_closeup": "百分比",
    "closeup": "百分比",
    "medium": "百分比",
    "wide": "百分比"
  }
}`;

// ═══════════════════════════════════════════════════════════════════
// 阶段3：镜头明细生成提示词（镜头生成层）
// ═══════════════════════════════════════════════════════════════════

export const SHOT_DETAIL_PROMPT = `你是一位专业的亚马逊产品视频分镜师，精通完整拍摄脚本的编写。

## 任务
为以下子主题生成逐镜头明细，每个镜头包含完整的字段数据。

## 段落与子主题结构
{subtopics_structure}

## 产品信息
{product_info}

## 竞品参考
{competitor_reference}

## 视频类型
{video_type}

## 风格预设
{style_preset}

## 输出要求（严格JSON格式）
{
  "shots": [
    {
      "section_code": "MBP1",
      "subtopic_name": "子主题名",
      "shot_code": "MBP1-01",
      "duration": 秒数,
      "shot_description": "分镜概述（详细描述画面内容、动作、表情）",
      "scene_location": "拍摄场景（如：白色背景台/厨房台面/户外草坪）",
      "camera_angle": "extreme_closeup|closeup|medium_closeup|medium|medium_wide|wide|extreme_wide",
      "camera_movement": "镜头动作（如：固定/缓慢推进/环绕/俯拍下移）",
      "overlay_text_en": "画面叠加英文文案（画面中的强调文字）",
      "overlay_text_cn": "画面叠加中文文案",
      "subtitle_en": "英文字幕（底部滚动字幕）",
      "subtitle_cn": "中文字幕",
      "narration_en": "英文旁白",
      "narration_cn": "中文旁白",
      "narrator_type": "voiceover|model_narration|text_only|none",
      "generation_strategy": "real_shoot|ai_image|ai_video|stock_footage|screen_record|mixed",
      "reuse_from_shot_code": "复用镜头编码（如无则为null）",
      "color_scheme": "辅助配色说明",
      "props": ["道具1", "道具2"],
      "notes": "拍摄注意事项",
      "reference_notes": "参考说明"
    }
  ]
}

## 规则
1. 镜头编码格式：段落编码-序号（如MBP3-11表示第3段落第11个镜头）
2. 分镜概述要具体到画面元素、动作、表情
3. 画面叠加文案（overlay_text）是画面中的强调文字，要简洁有力，英文全大写
4. 字幕（subtitle）是底部滚动字幕，与旁白内容对应
5. 旁白要自然流畅，英文和中文分别提供
6. 景别分布要合理，避免连续使用同一景别
7. 每个镜头时长建议2-5秒，特殊镜头可延长
8. 道具列表要具体可操作
9. 拍摄注意事项要包含灯光、角度、动作等关键提示`;

// ═══════════════════════════════════════════════════════════════════
// 阶段4：剪辑脚本生成提示词
// ═══════════════════════════════════════════════════════════════════

export const EDIT_SCRIPT_PROMPT = `你是一位资深的亚马逊视频剪辑策划师，擅长将拍摄素材规划为多个不同用途的视频成品。

## 任务
基于以下拍摄脚本的段落结构，生成多个剪辑方案。

## 段落结构
{sections_with_shots}

## 视频类型
{video_type}

## 输出要求（严格JSON格式）
{
  "edit_scripts": [
    {
      "edit_name": "剪辑方案名称",
      "video_purpose": "spv_ad|sbv_ad|main_listing|aplus|social_media|other",
      "max_duration": 秒数上限,
      "edit_style": "剪辑风格（如：顺序剪辑/精华混剪/倒叙/平行剪辑）",
      "section_mapping": [
        {
          "section_code": "MBP1",
          "include": true,
          "trim_strategy": "裁剪策略说明"
        }
      ],
      "description": "方案说明（用途、目标受众、投放渠道）"
    }
  ]
}

## 规则
1. 至少生成3个剪辑方案，根据原始视频类型调整方案组合
2. 每个方案的段落组合要有差异化
3. 广告视频要在前3秒有强hook
4. A+视频侧重产品细节和使用场景
5. 社媒视频要节奏更快、更有冲击力`;

// ═══════════════════════════════════════════════════════════════════
// 辅助函数：根据视频类型获取对应的结构模板
// ═══════════════════════════════════════════════════════════════════

export function getVideoTypeTemplate(videoType: string): string {
  return VIDEO_TYPE_STRUCTURE_TEMPLATES[videoType] || VIDEO_TYPE_STRUCTURE_TEMPLATES["main_video"];
}

export function getVideoTypeSpec(videoType: string) {
  return VIDEO_TYPE_SPECS[videoType] || VIDEO_TYPE_SPECS["main_video"];
}

export function getStylePreset(presetKey: string) {
  return STYLE_PRESETS[presetKey] || null;
}

export function buildStylePresetPrompt(presetKey: string): string {
  const preset = STYLE_PRESETS[presetKey];
  if (!preset) return "无特定风格预设，使用默认专业风格";
  return `风格预设：${preset.label}
描述：${preset.description}
色调：${preset.colorTone}
灯光：${preset.lighting}
道具风格：${preset.propsStyle}
背景建议：${preset.bgSuggestion}`;
}
