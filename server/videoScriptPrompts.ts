// ─── Video Script Generation LLM Prompts ────────────────────────

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
    "duration_feature": "时长分配特征说明"
  },
  "visual_language": {
    "shot_distribution": { "特写": "百分比", "中景": "百分比", "全景": "百分比" },
    "camera_movement": "运镜特征描述",
    "color_tone": "色调风格描述",
    "transition": "转场方式描述"
  },
  "copywriting_analysis": {
    "overlay_style": "画面文案风格描述",
    "narration_style": "旁白风格描述",
    "cta_text": "CTA文案内容"
  },
  "strengths": ["优点1", "优点2", "优点3"],
  "weaknesses": ["缺点1", "缺点2", "缺点3"],
  "reusable_patterns": [
    { "pattern": "可复用模式描述", "applicable": true }
  ]
}

## 规则
1. 分析要具体，避免泛泛而谈
2. 时长百分比要精确到小数点后一位
3. 优缺点各至少3条，每条要有具体依据
4. 可复用模式要具有可操作性`;

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
  }
}`;

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
    { "level": "primary/secondary/necessary", "point": "卖点描述", "evidence": "支撑数据" }
  ],
  "pain_points_from_reviews": [
    { "pain_point": "痛点描述", "frequency": "出现频率", "resolution_suggestion": "视频中的化解方案" }
  ],
  "key_specs": [
    { "spec": "参数名", "value": "参数值", "visual_suggestion": "视觉化建议" }
  ],
  "keywords_for_overlay": ["关键词1", "关键词2"],
  "listing_bullet_mapping": [
    { "bullet_index": 1, "summary": "卖点概要", "video_expression": "视频表达建议" }
  ]
}`;

export const SECTION_PLANNING_PROMPT = `你是一位资深的亚马逊产品视频编导，擅长将产品卖点转化为视频段落结构。

## 任务
基于以下产品信息和竞品分析结果，规划视频的段落结构。

## 产品信息
{product_info}

## 竞品分析参考
{competitor_reference}

## 视频类型
{video_type}

## 目标时长
{target_duration}秒

## 输出要求（严格JSON格式）
{
  "sections": [
    {
      "section_code": "MBP1",
      "section_name": "段落名称（中文）",
      "section_name_en": "Section Name (English)",
      "shooting_method": "model_narration|live_action|ai_generated|mixed|screen_recording",
      "duration_budget": 秒数,
      "selling_point_refs": ["关联的卖点1", "关联的卖点2"],
      "pain_point_refs": ["关联的痛点1"],
      "description": "段落内容概述"
    }
  ],
  "total_duration": 总时长,
  "narrative_mode": "整体叙事模式说明",
  "duration_allocation_rationale": "时长分配理由"
}

## 规则
1. 段落编码使用MBP1、MBP2...格式
2. 每个段落必须关联至少一个卖点或痛点
3. 总时长不超过目标时长的110%
4. 前5秒必须有吸引力（hook），最后段落必须有CTA
5. 拍摄方式要根据段落内容合理选择`;

export const SUBTOPIC_EXPANSION_PROMPT = `你是一位亚马逊产品视频的分镜师，擅长将段落展开为具体的子主题和镜头规划。

## 任务
将以下段落规划展开为子主题，并建议每个子主题的镜头数量。

## 段落规划
{sections}

## 产品信息
{product_info}

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

export const SHOT_DETAIL_PROMPT = `你是一位专业的亚马逊产品视频分镜师，精通14字段完整拍摄脚本的编写。

## 任务
为以下子主题生成逐镜头明细，每个镜头包含完整的14字段数据。

## 段落与子主题结构
{subtopics_structure}

## 产品信息
{product_info}

## 竞品参考
{competitor_reference}

## 输出要求（严格JSON格式）
{
  "shots": [
    {
      "section_code": "MBP1",
      "subtopic_name": "子主题名",
      "shot_code": "MBP1-01",
      "duration": 秒数,
      "shot_description": "分镜概述（详细描述画面内容）",
      "scene_location": "拍摄场景（如：白色背景台/厨房台面/户外草坪）",
      "camera_angle": "extreme_closeup|closeup|medium_closeup|medium|medium_wide|wide|extreme_wide",
      "camera_movement": "镜头动作（如：固定/缓慢推进/环绕/俯拍下移）",
      "overlay_text_en": "画面叠加英文文案",
      "overlay_text_cn": "画面叠加中文文案",
      "narration_en": "英文旁白/字幕",
      "narration_cn": "中文旁白/字幕",
      "narrator_type": "voiceover|model_narration|text_only|none",
      "generation_strategy": "real_shoot|ai_image|ai_video|stock_footage|screen_record|mixed",
      "reuse_from_shot_code": "复用镜头编码（如无则为null）",
      "color_scheme": "辅助配色说明",
      "reference_notes": "参考说明"
    }
  ]
}

## 规则
1. 镜头编码格式：段落编码-序号（如MBP3-11表示第3段落第11个镜头）
2. 分镜概述要具体到画面元素、动作、表情
3. 画面文案要简洁有力，英文全大写，中文不超过15字
4. 旁白要自然流畅，英文和中文分别提供
5. 景别分布要合理，避免连续使用同一景别
6. 每个镜头时长建议2-5秒，特殊镜头可延长`;

export const EDIT_SCRIPT_PROMPT = `你是一位资深的亚马逊视频剪辑策划师，擅长将拍摄素材规划为多个不同用途的视频成品。

## 任务
基于以下拍摄脚本的段落结构，生成多个剪辑方案。

## 段落结构
{sections_with_shots}

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
          "trim_strategy": "裁剪策略说明（如：完整保留/精选前3个镜头/只保留特写镜头）"
        }
      ],
      "description": "方案说明（用途、目标受众、投放渠道）"
    }
  ]
}

## 规则
1. 至少生成4个剪辑方案：主图视频(60-90s)、SPV广告(30-45s)、A+视频(20-35s)、社媒短视频(15-30s)
2. 每个方案的段落组合要有差异化
3. 广告视频要在前3秒有强hook
4. A+视频侧重产品细节和使用场景
5. 社媒视频要节奏更快、更有冲击力`;
