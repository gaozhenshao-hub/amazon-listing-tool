INSERT IGNORE INTO `emperor_skills`
  (`workspaceId`,`slug`,`name`,`description`,`category`,`owner`,`riskTier`,`status`,`scope`,`version`,`isSystem`,`callCount`,`manifest`,`when_to_use`,`timeout_seconds`,`execution_mode`)
VALUES
  (NULL,'system.knowledge.distillation.manual','知识蒸馏结构化执行器','仅在超级管理员从已批准Evidence Card手动发起时，将证据整理为可编辑Skill草案。不得扫描知识库、不得自动发布、不得把未经证实的内容写成事实。','系统治理','knowledge_governance','L2','Released','global',1,1,0,
   JSON_OBJECT(
     'implementation', JSON_OBJECT(
       'systemPrompt','你是受治理的知识蒸馏执行器。仅基于输入中已批准的Evidence Card生成可编辑Skill草案。输出严格JSON；每条规则须列明证据键；不编造事实，不读取外部知识，不发布Skill，不修改用户内容。',
       'userPromptTemplate','{{context}}',
       'modelPolicy','default',
       'tools',JSON_ARRAY(),
       'knowledge',JSON_OBJECT('source','approved_evidence_only')
     ),
     'contract', JSON_OBJECT('mode','review_required','timeoutMs',120000)
   ),
   '仅在超级管理员选择已批准Evidence Card并手动点击“生成蒸馏草案”时使用。',120,'inline');
