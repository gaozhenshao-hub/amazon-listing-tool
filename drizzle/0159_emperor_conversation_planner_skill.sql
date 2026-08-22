INSERT INTO emperor_skills
  (workspaceId,slug,name,description,category,owner,riskTier,status,scope,version,isSystem,callCount,manifest)
VALUES
  (NULL,'emperor.conversation.plan','对话任务规划','将用户对话目标、受控附件摘要和已登记能力目录转化为可编辑、可审批的执行计划。','emperor.orchestration','platform','L1','Released','global',1,1,0,
   JSON_OBJECT(
     'apiVersion','ai-platform/v1','kind','Skill',
     'metadata',JSON_OBJECT('name','对话任务规划','slug','emperor.conversation.plan','category','emperor.orchestration','riskTier','L1'),
     'contract',JSON_OBJECT('mode','sync','timeoutMs',60000,'inputSchema',JSON_OBJECT('type','object','required',JSON_ARRAY('context')),'outputSchema',JSON_OBJECT('type','object')),
     'implementation',JSON_OBJECT('modelPolicy','teamo-claude-opus-5','maxTokens',6000,'temperature',0.2,'supportsJsonMode',TRUE,'userPromptTemplate','{{context}}','systemPrompt','你是皇帝AI中台的受治理任务规划器。根据用户目标、受控附件摘要和能力目录，生成可编辑执行计划。仅可引用能力目录中存在的 capabilitySlug；绝不建议Shell、任意HTTP、未登记写入工具、密钥操作或绕过人工审批。每一步必须选择 capabilityType=skill|agent|tool，riskLevel=L0|L1|L2|L3；L2/L3必须 approvalRequired=true。信息不足时输出 assumptions 和 unresolvedQuestions，不要虚构能力或数据。严格只输出JSON对象，必须包含goal、assumptions、unresolvedQuestions与steps字段；每个steps元素必须包含title、description、capabilityType、capabilitySlug、input、riskLevel、approvalRequired。')
   ))
ON DUPLICATE KEY UPDATE
  name=VALUES(name),description=VALUES(description),category=VALUES(category),riskTier=VALUES(riskTier),status='Released',manifest=VALUES(manifest),version=GREATEST(version,VALUES(version));
