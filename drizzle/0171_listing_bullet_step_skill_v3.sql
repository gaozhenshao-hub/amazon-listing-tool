INSERT INTO emperor_skills
  (workspaceId,slug,name,description,category,owner,riskTier,status,scope,version,isSystem,callCount,manifest)
VALUES
  (NULL,'listing.bullet.step.generate','逐条卖点精雕','为用户当前选中的单条卖点生成可人工审核的、基于事实的美国站英文Bullet。','listing','platform','L1','Released','global',3,1,0,
   JSON_OBJECT(
     'apiVersion','ai-platform/v1',
     'kind','Skill',
     'metadata',JSON_OBJECT('name','逐条卖点精雕','slug','listing.bullet.step.generate','category','listing','riskTier','L1'),
     'contract',JSON_OBJECT('mode','async','timeoutMs',90000,'inputSchema',JSON_OBJECT('type','object','required',JSON_ARRAY('context')),'outputSchema',JSON_OBJECT('type','object','required',JSON_ARRAY('subtitle','fullText'))),
     'implementation',JSON_OBJECT(
       'modelPolicy','teamo-claude-opus-5',
       'maxTokens',3200,
       'temperature',0.25,
       'supportsJsonMode',TRUE,
       'userPromptTemplate','{{context}}',
       'systemPrompt','你是一名以英语为母语、精通中文、完全熟悉美国国情与亚马逊美国站消费语境的营销与广告文案专家。请以拥有10年以上奥美广告文案经验的专业标准工作：先从真实消费者购买理由出发，再用精确、自然、可信的美式英语表达利益，不写空洞宣传。\n\n当前任务是“五点逐步精雕”的单条任务。输入会提供用户当前选中的卖点核心及其序号；你只能写这一条对应的英文Bullet，无论它是第一、第二、第三、第四或第五条。绝不生成其余卖点、整套五点、编号列表、多段文本、分析说明或中文文案。subtitle与fullText共同构成一条连续的英文Bullet：subtitle为短引导语，fullText为同一段的正文，二者均不得含换行。\n\n事实边界：只能使用输入中明确提供的产品属性、参数、卖点核心FABE证据、已确认关键词、竞品/评论痛点和买家问题。输入没有依据时，绝不虚构认证、保修年限、百分比、排名、评论数量、竞品比较、社会认同或绝对化承诺。\n\n写作要求：1. 只围绕当前选中卖点核心的一个购买理由，清晰说明Feature→Advantage→Benefit；证据不足时宁可使用可验证事实，不要补造证据。2. 仅使用当前卖点核心targetKeywords中的相关词，且自然融入，不堆砌。3. 与已确认卖点在主题、开头句、核心利益、场景和关键词上明显不同，不复用完整句子。4. 总长度必须为200–280字符。若输入中有真实使用场景，应自然融入对应场景；若输入中有可验证的数值、规格或比较依据，可准确呈现数据比较；若输入中有真实认证、材料、保修或质量依据，可作为信任元素。若没有明确事实依据，必须省略这些元素，绝不编造。5. 输出前自行核对事实依据、差异化、关键词自然度和单段约束。\n\n严格只输出JSON对象，且只包含：subtitle、fullText、evidenceUsed、keywordsUsed、distinctFromPrevious、qualityAudit。evidenceUsed必须是输入中的短事实或空数组；keywordsUsed必须来自targetKeywords；qualityAudit必须包含factsGrounded、lengthInRange、noKeywordStuffing、oneClearBenefit四个布尔字段。'
     )
   ))
ON DUPLICATE KEY UPDATE
  name=VALUES(name),
  description=VALUES(description),
  category=VALUES(category),
  riskTier=VALUES(riskTier),
  status='Released',
  manifest=VALUES(manifest),
  version=GREATEST(version,VALUES(version));
