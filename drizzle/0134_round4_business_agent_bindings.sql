-- Round 4: bind major-competitor analysis into the product-development Agent.
-- Keyword, ads and operations Agents are user/workspace scoped and are installed
-- lazily by their runtime services because their ownership is not global.

SET @product_analysis_agent_slug = 'product-development.analysis.workflow';
SET @product_analysis_dag = CAST('{
  "version":"1.1.0",
  "workflowType":"human_in_loop_dag",
  "description":"产品开发七阶段分析主链路。主要竞争对手作为可选证据节点，Skill 提供 AI 能力，业务页面负责运行与人工确认。",
  "executionOwner":"product_development.analysis_page",
  "businessRoute":"/dev/project/{{projectId}}/analysis",
  "nodes":[
    {"id":"market_overview","nodeType":"skill_node","label":"01 · 市场大盘","subtitle":"由产品开发业务页面运行、编辑与确认","skillSlug":"dev.analysis.market_overview","skillVersionPolicy":"snapshot","outputKey":"market_overview","humanGate":true,"required":true,"scheduler":"manual","executionOwner":"product_development.analysis_page","businessRoute":"/dev/project/{{projectId}}/analysis?stage=market_overview","x":40,"y":40},
    {"id":"attribute_cross","nodeType":"skill_node","label":"02 · 属性交叉","subtitle":"由产品开发业务页面运行、编辑与确认","skillSlug":"dev.analysis.attribute_cross","skillVersionPolicy":"snapshot","outputKey":"attribute_cross","humanGate":true,"required":true,"scheduler":"manual","executionOwner":"product_development.analysis_page","businessRoute":"/dev/project/{{projectId}}/analysis?stage=attribute_cross","x":300,"y":40},
    {"id":"review_kano","nodeType":"skill_node","label":"05 · 评论深度","subtitle":"由产品开发业务页面运行、编辑与确认","skillSlug":"dev.analysis.review_kano","skillVersionPolicy":"snapshot","outputKey":"review_kano","humanGate":true,"required":false,"scheduler":"manual","executionOwner":"product_development.analysis_page","businessRoute":"/dev/project/{{projectId}}/analysis?stage=review_kano","x":560,"y":40},
    {"id":"price_analysis","nodeType":"skill_node","label":"03 · 价格段分析","subtitle":"由产品开发业务页面运行、编辑与确认","skillSlug":"dev.analysis.price_analysis","skillVersionPolicy":"snapshot","outputKey":"price_analysis","humanGate":true,"required":true,"scheduler":"manual","executionOwner":"product_development.analysis_page","businessRoute":"/dev/project/{{projectId}}/analysis?stage=price_analysis","x":40,"y":260},
    {"id":"brand_competition","nodeType":"skill_node","label":"04 · 品牌竞争","subtitle":"由产品开发业务页面运行、编辑与确认","skillSlug":"dev.analysis.brand_competition","skillVersionPolicy":"snapshot","outputKey":"brand_competition","humanGate":true,"required":true,"scheduler":"manual","executionOwner":"product_development.analysis_page","businessRoute":"/dev/project/{{projectId}}/analysis?stage=brand_competition","x":300,"y":260},
    {"id":"information_summary","nodeType":"skill_node","label":"06 · 信息汇总","subtitle":"由产品开发业务页面运行、编辑与确认","skillSlug":"dev.analysis.information_summary","skillVersionPolicy":"snapshot","outputKey":"information_summary","humanGate":true,"required":true,"scheduler":"manual","executionOwner":"product_development.analysis_page","businessRoute":"/dev/project/{{projectId}}/analysis?stage=information_summary","x":300,"y":500},
    {"id":"decision_dashboard","nodeType":"skill_node","label":"07 · 综合决策","subtitle":"由产品开发业务页面运行、编辑与确认","skillSlug":"dev.analysis.decision_dashboard","skillVersionPolicy":"snapshot","outputKey":"decision_dashboard","humanGate":true,"required":true,"scheduler":"manual","executionOwner":"product_development.analysis_page","businessRoute":"/dev/project/{{projectId}}/analysis?stage=decision_dashboard","x":300,"y":740},
    {"id":"major_competitors","nodeType":"skill_node","label":"主要竞争对手分析","subtitle":"由产品开发业务页面运行、编辑与确认","skillSlug":"dev.panorama.market_insights","skillVersionPolicy":"snapshot","outputKey":"major_competitors","humanGate":true,"required":false,"scheduler":"manual","executionOwner":"product_development.analysis_page","businessRoute":"/dev/project/{{projectId}}?tab=panorama","x":820,"y":260}
  ],
  "edges":[
    {"id":"market_overview-price_analysis","source":"market_overview","target":"price_analysis","from":"market_overview","to":"price_analysis","label":"市场证据","kind":"required","required":true},
    {"id":"market_overview-brand_competition","source":"market_overview","target":"brand_competition","from":"market_overview","to":"brand_competition","label":"市场证据","kind":"required","required":true},
    {"id":"market_overview-information_summary","source":"market_overview","target":"information_summary","from":"market_overview","to":"information_summary","label":"已确认大盘","kind":"required","required":true},
    {"id":"market_overview-major_competitors","source":"market_overview","target":"major_competitors","from":"market_overview","to":"major_competitors","label":"全景竞品","kind":"suggested","required":false},
    {"id":"major_competitors-information_summary","source":"major_competitors","target":"information_summary","from":"major_competitors","to":"information_summary","label":"竞品证据","kind":"suggested","required":false},
    {"id":"attribute_cross-information_summary","source":"attribute_cross","target":"information_summary","from":"attribute_cross","to":"information_summary","label":"已确认属性","kind":"required","required":true},
    {"id":"price_analysis-information_summary","source":"price_analysis","target":"information_summary","from":"price_analysis","to":"information_summary","label":"已确认价格","kind":"required","required":true},
    {"id":"brand_competition-information_summary","source":"brand_competition","target":"information_summary","from":"brand_competition","to":"information_summary","label":"已确认品牌","kind":"required","required":true},
    {"id":"review_kano-information_summary","source":"review_kano","target":"information_summary","from":"review_kano","to":"information_summary","label":"评论证据或无评论跳过","kind":"required","required":true},
    {"id":"information_summary-decision_dashboard","source":"information_summary","target":"decision_dashboard","from":"information_summary","to":"decision_dashboard","label":"已确认汇总 Artifact","kind":"required","required":true}
  ]
}' AS JSON);
SET @product_analysis_dag_hash = SHA2(CAST(@product_analysis_dag AS CHAR), 256);

UPDATE `emperor_agents`
SET `name`='产品开发 · 七阶段分析',
    `description`='产品开发市场分析主链路，主要竞争对手作为可选证据节点。',
    `category`='产品开发',
    `status`='active',
    `scope`='project',
    `triggerType`='manual',
    `maxExecutionSeconds`=1800,
    `dagDefinition`=@product_analysis_dag,
    `updatedAt`=NOW()
WHERE BINARY `slug`=BINARY @product_analysis_agent_slug;

INSERT INTO `emperor_agents`
  (`workspaceId`,`slug`,`name`,`description`,`category`,`status`,`scope`,`triggerType`,`maxExecutionSeconds`,`dagDefinition`)
SELECT
  NULL,@product_analysis_agent_slug,'产品开发 · 七阶段分析','产品开发市场分析主链路，主要竞争对手作为可选证据节点。','产品开发','active','project','manual',1800,@product_analysis_dag
WHERE NOT EXISTS (
  SELECT 1 FROM `emperor_agents` WHERE BINARY `slug`=BINARY @product_analysis_agent_slug
);

SET @product_analysis_version_number = (
  SELECT COALESCE(MAX(`versionNumber`),0) + 1
  FROM `emperor_agent_template_versions`
  WHERE BINARY `agentSlug`=BINARY @product_analysis_agent_slug AND `workspaceId` IS NULL
);

INSERT INTO `emperor_agent_template_versions`
  (`workspaceId`,`agentSlug`,`agentName`,`versionNumber`,`version`,`dagHash`,`status`,`isDefault`,`rolloutPercent`,`dagDefinition`,`releaseNotes`,`releasedAt`,`activatedAt`)
SELECT
  NULL,@product_analysis_agent_slug,'产品开发 · 七阶段分析',@product_analysis_version_number,
  '1.1.0',@product_analysis_dag_hash,'released',1,100,@product_analysis_dag,
  '产品开发 Agent v1.1：主要竞争对手分析接入 Job、Checkpoint 与 Artifact',NOW(),NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM `emperor_agent_template_versions`
  WHERE BINARY `agentSlug`=BINARY @product_analysis_agent_slug
    AND `workspaceId` IS NULL
    AND BINARY `dagHash`=BINARY @product_analysis_dag_hash
);

UPDATE `emperor_agent_template_versions`
SET `isDefault`=IF(BINARY `dagHash`=BINARY @product_analysis_dag_hash,1,0),
    `status`=IF(BINARY `dagHash`=BINARY @product_analysis_dag_hash,'released',`status`),
    `rolloutPercent`=IF(BINARY `dagHash`=BINARY @product_analysis_dag_hash,100,`rolloutPercent`),
    `activatedAt`=IF(BINARY `dagHash`=BINARY @product_analysis_dag_hash,COALESCE(`activatedAt`,NOW()),`activatedAt`),
    `updatedAt`=NOW()
WHERE BINARY `agentSlug`=BINARY @product_analysis_agent_slug AND `workspaceId` IS NULL;
