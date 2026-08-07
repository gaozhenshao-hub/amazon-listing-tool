import { createConnection } from 'mysql2/promise';

const url = process.env.DATABASE_URL;
const conn = await createConnection(url);

// Update image.step4.reoptimize skill
const reoptimizePrompt = `你是一位拥有10年经验的亚马逊产品图片设计专家。

你的任务：用户已经为某张图上传了构图参考图和/或效果参考图。请根据参考图的视觉特征，重新优化该图的构图参考和效果参考方案。

**分析要求：**
1. 如果提供了构图参考图，分析其构图方式、元素布局、视觉焦点、留白比例
2. 如果提供了效果参考图，分析其色彩运用、光影效果、材质质感、整体氛围
3. 结合已确认的风格方案和图片大纲，输出优化后的构图参考和效果参考

**重要：只返回以下字段，不要包含 compositionRefImageUrl、effectRefImageUrl、kbReferenceImages、imageNumber、imageType、purpose 等字段（这些由系统管理）。**

请以JSON格式输出：
{
  "compositionReference": {
    "compositionType": "构图方式（基于参考图分析）",
    "layout": "具体布局描述",
    "focalPoint": "视觉焦点位置",
    "visualFlow": "视线引导路径",
    "proportions": "各元素占比",
    "referenceAnalysis": "对构图参考图的分析总结"
  },
  "effectReference": {
    "colorApplication": "配色应用（基于参考图分析）",
    "typographyApplication": "字体应用",
    "iconApplication": "图标应用",
    "atmosphere": "整体视觉氛围",
    "lightingStyle": "光影风格",
    "textureStyle": "材质/纹理风格",
    "referenceAnalysis": "对效果参考图的分析总结"
  },
  "designNotes": "设计师注意事项",
  "improvementSummary": "相比原方案的改进点总结"
}`;

// Update knowledge entry
const knowledgeContent = `## 规则\n\n**凡是涉及 AI 能力的 Bug 修复或功能优化，必须同时完成以下两步：**\n\n### 1. 代码层修复\n- 修复前端（React 组件）的数据处理逻辑\n- 修复后端（tRPC router）的数据合并/保存逻辑\n- 确保 AI 返回结果与前端期望的字段名一致\n\n### 2. 皇帝平台 Skill 同步修复\n- 在 emperor_skills 表中找到对应的 Skill（通过 slug 定位）\n- 更新 system_prompt 字段，确保字段名与代码一致\n- 不覆盖前端管理的字段（compositionRefImageUrl、effectRefImageUrl、kbReferenceImages）\n\n### 常见 Skill slug 对照\n| 功能 | Skill slug |\n|------|------------|\n| Step4 参考图生成 | image.step4.reference |\n| Step4 单图重优化 | image.step4.reoptimize |\n| Step1 卖点生成 | image.step1.sellingpoints |\n| Step2 图片大纲 | image.step2.outline |\n| Step3 风格确认 | image.step3.style |\n| Step5 最终建议 | image.step5.final |`;

try {
  // systemPrompt is stored inside manifest.implementation.systemPrompt (JSON column)
  const [r1] = await conn.execute(
    `UPDATE emperor_skills
     SET manifest = JSON_SET(manifest, '$.implementation.systemPrompt', ?),
         updatedAt = NOW()
     WHERE slug = ?`,
    [reoptimizePrompt, 'image.step4.reoptimize']
  );
  console.log('image.step4.reoptimize updated, rows:', r1.affectedRows);

  // Upsert knowledge entry
  const [existing] = await conn.execute(
    "SELECT id FROM emperor_knowledge WHERE title='AI修复规范：代码修复必须同步皇帝平台 Skill' LIMIT 1"
  );
  if (existing.length > 0) {
    await conn.execute(
      'UPDATE emperor_knowledge SET content=?, updated_at=? WHERE id=?',
      [knowledgeContent, Date.now(), existing[0].id]
    );
    console.log('Knowledge entry updated');
  } else {
    await conn.execute(
      'INSERT INTO emperor_knowledge (user_id, title, content, memory_type, tags, created_at, updated_at) VALUES (?,?,?,?,?,?,?)',
      [1, 'AI修复规范：代码修复必须同步皇帝平台 Skill', knowledgeContent, 'fact', '["ai修复","皇帝平台","skill同步","开发规范"]', Date.now(), Date.now()]
    );

    console.log('Knowledge entry inserted');
  }
} finally {
  await conn.end();
}
