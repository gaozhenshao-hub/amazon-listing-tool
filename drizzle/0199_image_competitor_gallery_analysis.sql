CREATE TABLE IF NOT EXISTS `image_competitor_research_subjects` (
  `id` int AUTO_INCREMENT NOT NULL,
  `workspaceId` int NOT NULL,
  `projectId` int NOT NULL,
  `userId` int NOT NULL,
  `confirmedSnapshotId` int NOT NULL,
  `marketplace` varchar(16) NOT NULL DEFAULT 'US',
  `asin` varchar(20) NOT NULL,
  `displayName` varchar(255) NOT NULL DEFAULT '',
  `role` enum('primary','benchmark','supplemental') NOT NULL DEFAULT 'benchmark',
  `status` enum('draft','ready','analyzing','review_required','confirmed','archived') NOT NULL DEFAULT 'draft',
  `currentAnalysisVersion` int NOT NULL DEFAULT 0,
  `sortOrder` int NOT NULL DEFAULT 0,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `image_competitor_research_subjects_id` PRIMARY KEY(`id`),
  UNIQUE KEY `uk_image_comp_subject_snapshot` (`workspaceId`,`projectId`,`confirmedSnapshotId`),
  KEY `idx_image_comp_subject_project_role` (`workspaceId`,`projectId`,`role`,`status`)
);

CREATE TABLE IF NOT EXISTS `image_competitor_asset_facts` (
  `id` int AUTO_INCREMENT NOT NULL,
  `workspaceId` int NOT NULL,
  `projectId` int NOT NULL,
  `subjectId` int NOT NULL,
  `acquisitionAssetId` int NOT NULL,
  `assetRole` varchar(32) NOT NULL,
  `positionIndex` int NOT NULL,
  `inputContentHash` varchar(64) NOT NULL,
  `status` enum('pending','analyzed','review_required','confirmed','excluded','failed') NOT NULL DEFAULT 'pending',
  `aiFacts` json,
  `userEdit` json,
  `confidence` decimal(5,4),
  `analyzedByJobRunId` varchar(80),
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `image_competitor_asset_facts_id` PRIMARY KEY(`id`),
  UNIQUE KEY `uk_image_comp_fact_subject_asset` (`subjectId`,`acquisitionAssetId`),
  KEY `idx_image_comp_fact_subject_status` (`workspaceId`,`subjectId`,`status`)
);

CREATE TABLE IF NOT EXISTS `image_competitor_gallery_analysis_versions` (
  `id` int AUTO_INCREMENT NOT NULL,
  `workspaceId` int NOT NULL,
  `projectId` int NOT NULL,
  `subjectId` int NOT NULL,
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
  CONSTRAINT `image_competitor_gallery_analysis_versions_id` PRIMARY KEY(`id`),
  UNIQUE KEY `uk_image_comp_gallery_subject_ver` (`subjectId`,`version`),
  KEY `idx_image_comp_gallery_project_status` (`workspaceId`,`projectId`,`status`)
);

CREATE TABLE IF NOT EXISTS `image_workflow_step0_artifacts` (
  `id` int AUTO_INCREMENT NOT NULL,
  `workspaceId` int NOT NULL,
  `projectId` int NOT NULL,
  `sessionId` int NOT NULL,
  `artifactType` enum('competitor_gallery','expression_summary','composite') NOT NULL,
  `version` int NOT NULL,
  `status` enum('draft','review_required','confirmed','superseded') NOT NULL DEFAULT 'draft',
  `content` json NOT NULL,
  `evidenceRefs` json NOT NULL,
  `createdBy` int NOT NULL,
  `confirmedBy` int,
  `confirmedAt` timestamp NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `image_workflow_step0_artifacts_id` PRIMARY KEY(`id`),
  UNIQUE KEY `uk_image_step0_artifact_ver` (`sessionId`,`artifactType`,`version`),
  KEY `idx_image_step0_artifact_current` (`workspaceId`,`projectId`,`artifactType`,`status`)
);

INSERT INTO emperor_skills
  (workspaceId,slug,name,description,category,owner,riskTier,status,scope,version,isSystem,callCount,manifest)
VALUES
  (NULL,'image.step0.competitor.gallery.image-facts','竞品图库逐图事实提取','对已确认竞品图库中的单张图片提取结构化视觉事实，并保留图片证据引用。','image','platform','L1','Released','global',1,1,0,
   JSON_OBJECT(
     'apiVersion','ai-platform/v1','kind','Skill',
     'metadata',JSON_OBJECT('name','竞品图库逐图事实提取','slug','image.step0.competitor.gallery.image-facts','category','image','riskTier','L1'),
     'contract',JSON_OBJECT('mode','async','timeoutMs',120000,'inputSchema',JSON_OBJECT('type','object','required',JSON_ARRAY('context')),'outputSchema',JSON_OBJECT('type','object','required',JSON_ARRAY('imagePurpose','imageType','sellingPoints','expressionMethod','summary','confidence'))),
     'implementation',JSON_OBJECT(
       'modelPolicy','manus-default','maxTokens',2600,'temperature',0.15,'supportsJsonMode',TRUE,'userPromptTemplate','{{context}}',
       'systemPrompt','你是亚马逊竞品图片证据分析Skill。只分析本次提供的一张已确认竞品图片及其图位信息；不得把图片当作我方素材，不得推断图片外的销量、认证、评论或商业事实。输出严格JSON对象：imagePurpose、imageType、sellingPoints、expressionMethod、composition、visualStyle、copyStrategy、proofType、targetAudience、emotionalTone、strengths、risks、summary、confidence。所有结论必须能由图片直接观察支持；不确定时降低confidence并使用中性描述。'
     )
   )),
  (NULL,'image.step0.competitor.gallery.summary','主要竞品整套图片总结','基于同一竞品全部已确认图片的逐图事实，分析图库叙事、视觉系统、卖点架构与差异化机会。','image','platform','L1','Released','global',1,1,0,
   JSON_OBJECT(
     'apiVersion','ai-platform/v1','kind','Skill',
     'metadata',JSON_OBJECT('name','主要竞品整套图片总结','slug','image.step0.competitor.gallery.summary','category','image','riskTier','L1'),
     'contract',JSON_OBJECT('mode','async','timeoutMs',120000,'inputSchema',JSON_OBJECT('type','object','required',JSON_ARRAY('context')),'outputSchema',JSON_OBJECT('type','object','required',JSON_ARRAY('positioning','targetAudience','narrativeStrategy','sequenceLogic','visualSystem','sellingPointArchitecture','overallConclusion'))),
     'implementation',JSON_OBJECT(
       'modelPolicy','manus-default','maxTokens',5200,'temperature',0.2,'supportsJsonMode',TRUE,'userPromptTemplate','{{context}}',
       'systemPrompt','你是亚马逊主要竞品整套图库分析Skill。输入只包含同一竞品逐图事实和明确的assetId。请分析整套主图与可获取A+/品牌故事的叙事顺序、视觉系统、卖点覆盖、证明方式、优势、薄弱点、风险、可借鉴原则、不可照搬模式与差异化机会。每一条策略结论都必须引用输入中的evidenceAssetIds；不得虚构未返回模块，不得把竞品图片建议为我方直接复用素材。严格只输出约定JSON对象。'
     )
   ))
ON DUPLICATE KEY UPDATE
  name=VALUES(name),description=VALUES(description),category=VALUES(category),riskTier=VALUES(riskTier),status='Released',manifest=VALUES(manifest),version=GREATEST(version,VALUES(version));
