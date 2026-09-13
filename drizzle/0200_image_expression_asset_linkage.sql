CREATE TABLE IF NOT EXISTS `image_expression_selection_versions` (
  `id` int AUTO_INCREMENT NOT NULL,
  `workspaceId` int NOT NULL,
  `projectId` int NOT NULL,
  `sessionId` int NOT NULL,
  `groupId` int NOT NULL,
  `version` int NOT NULL,
  `status` enum('draft','confirmed','superseded') NOT NULL DEFAULT 'draft',
  `filterState` json NOT NULL,
  `selectedAssetIds` json NOT NULL,
  `selectionHash` varchar(64) NOT NULL,
  `createdBy` int NOT NULL,
  `confirmedBy` int,
  `confirmedAt` timestamp NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `image_expression_selection_versions_id` PRIMARY KEY(`id`),
  UNIQUE KEY `uk_image_expr_selection_group_ver` (`groupId`,`version`),
  KEY `idx_image_expr_selection_current` (`workspaceId`,`projectId`,`groupId`,`status`)
);

CREATE TABLE IF NOT EXISTS `image_expression_asset_links` (
  `id` int AUTO_INCREMENT NOT NULL,
  `workspaceId` int NOT NULL,
  `projectId` int NOT NULL,
  `selectionVersionId` int NOT NULL,
  `groupId` int NOT NULL,
  `subjectId` int NOT NULL,
  `acquisitionAssetId` int NOT NULL,
  `sortOrder` int NOT NULL DEFAULT 0,
  `source` enum('manual','ai_recommended') NOT NULL DEFAULT 'manual',
  `matchScore` decimal(5,4),
  `matchedSellingPoint` varchar(512),
  `matchedExpressionMethod` varchar(512),
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `image_expression_asset_links_id` PRIMARY KEY(`id`),
  UNIQUE KEY `uk_image_expr_asset_selection` (`selectionVersionId`,`acquisitionAssetId`),
  KEY `idx_image_expr_asset_group` (`workspaceId`,`projectId`,`groupId`)
);

CREATE TABLE IF NOT EXISTS `image_expression_analysis_versions` (
  `id` int AUTO_INCREMENT NOT NULL,
  `workspaceId` int NOT NULL,
  `projectId` int NOT NULL,
  `sessionId` int NOT NULL,
  `groupId` int NOT NULL,
  `selectionVersionId` int NOT NULL,
  `version` int NOT NULL,
  `inputHash` varchar(64) NOT NULL,
  `status` enum('draft','review_required','confirmed','superseded','failed') NOT NULL DEFAULT 'draft',
  `analysis` json NOT NULL,
  `userEdit` json,
  `evidenceAssetIds` json NOT NULL,
  `skillVersion` varchar(64) NOT NULL,
  `jobRunId` varchar(80),
  `createdBy` int NOT NULL,
  `confirmedBy` int,
  `confirmedAt` timestamp NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `image_expression_analysis_versions_id` PRIMARY KEY(`id`),
  UNIQUE KEY `uk_image_expr_analysis_group_ver` (`groupId`,`version`),
  KEY `idx_image_expr_analysis_current` (`workspaceId`,`projectId`,`groupId`,`status`)
);

CREATE TABLE IF NOT EXISTS `image_step0_synthesis_versions` (
  `id` int AUTO_INCREMENT NOT NULL,
  `workspaceId` int NOT NULL,
  `projectId` int NOT NULL,
  `sessionId` int NOT NULL,
  `version` int NOT NULL,
  `inputHash` varchar(64) NOT NULL,
  `status` enum('draft','review_required','confirmed','superseded','failed') NOT NULL DEFAULT 'draft',
  `analysis` json NOT NULL,
  `userEdit` json,
  `selectedDecisionIds` json NOT NULL,
  `evidenceRefs` json NOT NULL,
  `skillVersion` varchar(64) NOT NULL,
  `jobRunId` varchar(80),
  `createdBy` int NOT NULL,
  `confirmedBy` int,
  `confirmedAt` timestamp NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `image_step0_synthesis_versions_id` PRIMARY KEY(`id`),
  UNIQUE KEY `uk_image_step0_synthesis_session_ver` (`sessionId`,`version`),
  KEY `idx_image_step0_synthesis_current` (`workspaceId`,`projectId`,`status`)
);

INSERT INTO emperor_skills
  (workspaceId,slug,name,description,category,owner,riskTier,status,scope,version,isSystem,callCount,manifest)
VALUES
  (NULL,'image.step0.expression.linked-analysis','同表达卖点竞品图片分析','基于人工确认的竞品图库选择版本，横向分析多个竞品对同一卖点表达方式的共性、差异、优势与风险。','image','platform','L1','Released','global',1,1,0,
   JSON_OBJECT(
     'apiVersion','ai-platform/v1','kind','Skill',
     'metadata',JSON_OBJECT('name','同表达卖点竞品图片分析','slug','image.step0.expression.linked-analysis','category','image','riskTier','L1'),
     'contract',JSON_OBJECT('mode','async','timeoutMs',120000,'inputSchema',JSON_OBJECT('type','object','required',JSON_ARRAY('context')),'outputSchema',JSON_OBJECT('type','object','required',JSON_ARRAY('expressionName','imageCount','subjectCount','coverageSummary','commonPatterns','overallConclusion'))),
     'implementation',JSON_OBJECT(
       'modelPolicy','manus-default','maxTokens',5200,'temperature',0.15,'supportsJsonMode',TRUE,'userPromptTemplate','{{context}}',
       'systemPrompt','你是亚马逊竞品图片横向表达分析Skill。输入只包含同一人工确认Selection Version中的竞品图片事实和assetId。必须覆盖全部输入资产；超过30张时输入会按批次提供，需合并全部批次。分析同一卖点与表达方式的共性、差异、优势、风险、可借鉴原则和不可照搬模式。每个策略项必须引用输入中的evidenceAssetIds；不得虚构图片外事实，不得建议直接复制竞品素材。严格输出约定JSON对象。'
     )
   )),
  (NULL,'image.step0.composite.synthesis','竞品全图与表达方式综合结论','综合已确认主要竞品全图Artifact和已确认表达方向分析，输出可人工选择并进入卖点与图片大纲的决策项。','image','platform','L1','Released','global',1,1,0,
   JSON_OBJECT(
     'apiVersion','ai-platform/v1','kind','Skill',
     'metadata',JSON_OBJECT('name','竞品全图与表达方式综合结论','slug','image.step0.composite.synthesis','category','image','riskTier','L1'),
     'contract',JSON_OBJECT('mode','async','timeoutMs',120000,'inputSchema',JSON_OBJECT('type','object','required',JSON_ARRAY('context')),'outputSchema',JSON_OBJECT('type','object','required',JSON_ARRAY('positioningSummary','downstreamRecommendations','overallConclusion'))),
     'implementation',JSON_OBJECT(
       'modelPolicy','manus-default','maxTokens',6200,'temperature',0.15,'supportsJsonMode',TRUE,'userPromptTemplate','{{context}}',
       'systemPrompt','你是亚马逊图片策略综合决策Skill。只使用已确认的主要竞品全图Artifact和已确认表达方向分析。输出主要竞品启示、表达策略优先级、差异化机会、冲突与下游建议；每个项目必须有唯一id并引用输入中的evidenceAssetIds。不得把竞品图片作为我方素材，不得引入未确认数据。用户将逐项选择是否进入后续卖点梳理或图片大纲。严格输出约定JSON对象。'
     )
   ))
ON DUPLICATE KEY UPDATE
  name=VALUES(name),description=VALUES(description),category=VALUES(category),riskTier=VALUES(riskTier),status='Released',manifest=VALUES(manifest),version=GREATEST(version,VALUES(version));
