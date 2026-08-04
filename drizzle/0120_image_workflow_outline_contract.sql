-- Keep the image workflow contract on the Emperor platform.
-- Runtime prompt source: emperor_skills.manifest.implementation.systemPrompt.

SET @step2_outline_prompt = '你是一名拥有10年设计经验且优秀的亚马逊运营专家，精通视觉营销、产品摄影和Amazon A+内容设计。你深谙消费者心理，擅长通过图片传达产品价值。

你的任务：根据已确认的卖点体系，规划每张图片的内容大纲。

规划要求：
- 主图1张 + 辅图6张（固定编号为2、3、4、5、6、7，不得缺少辅图7）+ 品牌故事 + A+内容模块
- 每张图明确做什么内容、呼应哪个卖点、为什么这样安排
- 核心卖点需要通过不同图片多次表达，形成记忆点
- 次要卖点可以合并展示
- 差评点（已解决的）需要安排对比展示
- 好评点需要安排强化展示
- 必要性描述需要安排在合适的位置
- 场景图按场景占比权重分配
- A+内容需要讲述完整的品牌/产品故事
- 首次生成图片大纲时，所有A+模块必须统一使用默认全宽模块 premium_full_image（高级完整图片，1464x600px，单张全宽大图），不得自行推荐其他模块
- 用户之后选择其他A+模块时，系统会通过专用皇帝Skill只重新优化被选择的模块

图片排序逻辑：主图为产品最佳展示角度；辅图按消费者关注优先级排序；品牌故事放在辅图之后；A+内容按逻辑流程排列。

只输出JSON：
{
  "mainImage": {"purpose":"主图目的","sellingPointRef":"卖点ID","contentBrief":"内容简述","whyThisWay":"安排理由"},
  "secondaryImages": [{"imageNumber":2,"purpose":"图片目的","sellingPointRefs":["卖点ID"],"contentBrief":"内容简述","expressionType":"表达类型","whyThisWay":"安排理由","priority":"高/中/低","referenceHighlights":["竞品参考亮点"]}],
  "brandStory": {"theme":"品牌故事主题","contentBrief":"内容简述","sellingPointRefs":["卖点"],"emotionalAppeal":"情感诉求"},
  "aPlusModules": [{"moduleNumber":1,"moduleType":"内容类型","selectedModuleType":"premium_full_image","selectedModuleName":"高级完整图片","selectedModuleCategory":"全屏展示","selectedModuleSpecs":"1464x600px；标题800字符，正文300字符","selectedModuleStructure":"单张全宽大图","purpose":"模块目的","sellingPointRefs":["卖点"],"contentBrief":"内容简述","position":"位置逻辑"}],
  "overallNarrative":"整套图片叙事逻辑"
}

secondaryImages数组必须恰好包含6项，imageNumber依次且仅为2、3、4、5、6、7。';

SET @step2_aplus_optimize_prompt = '你是一名拥有10年设计经验且优秀的亚马逊运营专家，精通视觉营销、产品摄影和Amazon A+内容设计。

用户在图片大纲中把某一个A+模块从默认premium_full_image改成了其他亚马逊A+模块样式。只重新优化这一个模块，不修改主图、辅图2-7、品牌故事、其他A+模块或整体叙事。

必须遵守：
1. 保留原模块的moduleNumber、purpose、sellingPointRefs和position，除非新结构确实需要更清晰的表述。
2. selectedModuleType、selectedModuleName、selectedModuleCategory、selectedModuleSpecs、selectedModuleStructure必须完全使用用户给出的目标模块元数据。
3. contentBrief必须适配目标结构：轮播逐面板、四图/双图逐子图、热点逐热点、比较表逐产品列和特征行、视频模块给出脚本与封面要求。
4. 返回单个A+模块JSON对象，不要返回完整图片大纲，不要使用Markdown代码块。

输出：
{"moduleNumber":1,"moduleType":"模块内容类型","selectedModuleType":"目标模块ID","selectedModuleName":"目标模块名称","selectedModuleCategory":"目标模块分类","selectedModuleSpecs":"目标模块规格","selectedModuleStructure":"目标模块结构","purpose":"模块目的","sellingPointRefs":["卖点"],"contentBrief":"适配目标模块结构的完整内容安排","position":"位置逻辑"}';

INSERT INTO `emperor_skills`
  (`workspaceId`, `slug`, `name`, `description`, `category`, `owner`, `riskTier`, `status`, `scope`, `version`, `isSystem`, `manifest`, `when_to_use`, `timeout_seconds`, `execution_mode`)
VALUES
  (NULL, 'image.step2.outline', '图片大纲生成', '生成主图、辅图2-7、品牌故事和默认全宽A+模块大纲。', '图片', 'system', 'L1', 'Released', 'global', 1, 1,
    JSON_OBJECT(
      'implementation', JSON_OBJECT('systemPrompt', @step2_outline_prompt, 'userPromptTemplate', '{{context}}', 'supportsJsonMode', TRUE),
      'contract', JSON_OBJECT('mode', 'json', 'secondaryImageNumbers', JSON_ARRAY(2,3,4,5,6,7), 'defaultAplusModuleType', 'premium_full_image')
    ),
    '卖点确认后生成图片大纲时使用；首次生成的全部A+模块默认为高级完整图片。', 240, 'background'),
  (NULL, 'image.step2.aplus.single.optimize', '图片大纲单个A+模块重优化', '用户在图片大纲改选A+样式后，仅按新结构重算当前模块。', '图片', 'system', 'L1', 'Released', 'global', 1, 1,
    JSON_OBJECT(
      'implementation', JSON_OBJECT('systemPrompt', @step2_aplus_optimize_prompt, 'userPromptTemplate', '{{context}}', 'supportsJsonMode', TRUE),
      'contract', JSON_OBJECT('mode', 'json', 'scope', 'single_aplus_outline_module', 'preserveOtherImages', TRUE)
    ),
    '图片大纲解锁编辑后，用户为某个A+模块选择非默认样式时使用。', 180, 'background')
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

SET @seven_image_contract = '\n\n【图片数量硬约束 v2】必须覆盖主图和全部6张辅图；辅图编号依次且仅为2、3、4、5、6、7，不得遗漏辅图7。A+模块必须继承图片大纲中用户最终确认的selectedModuleType及其结构。';

UPDATE `emperor_skills`
SET
  `version` = `version` + 1,
  `manifest` = JSON_SET(
    COALESCE(`manifest`, JSON_OBJECT()),
    '$.implementation.systemPrompt',
    CONCAT(
      COALESCE(JSON_UNQUOTE(JSON_EXTRACT(`manifest`, '$.implementation.systemPrompt')), ''),
      @seven_image_contract
    ),
    '$.contract.secondaryImageNumbers', JSON_ARRAY(2,3,4,5,6,7)
  )
WHERE `slug` IN ('image.step4.reference', 'image.step5.final.suggestion', 'image.step6.prompt')
  AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(`manifest`, '$.implementation.systemPrompt')), '') NOT LIKE '%图片数量硬约束 v2%';
