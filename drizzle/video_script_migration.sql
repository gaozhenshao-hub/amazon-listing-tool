-- Video Script Generation Module Migration
-- Module 2 Extension: 视频脚本生成

-- 1. 视频脚本主表
CREATE TABLE IF NOT EXISTS `video_scripts` (
  `id` int AUTO_INCREMENT PRIMARY KEY,
  `projectId` int NOT NULL,
  `userId` int NOT NULL,
  `scriptName` varchar(255) NOT NULL,
  `productName` varchar(255),
  `videoType` enum('main_video','ad_spv','ad_sbv','aplus_video','social_media','other') DEFAULT 'main_video',
  `targetDuration` decimal(5,1),
  `currentStage` enum('stage_0a','stage_0b','stage_1','stage_2','stage_3','stage_4','completed') NOT NULL DEFAULT 'stage_0a',
  `stageStatus` json,
  `status` enum('draft','in_progress','completed','archived') NOT NULL DEFAULT 'draft',
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- 2. 竞品脚本分析表
CREATE TABLE IF NOT EXISTS `video_competitor_scripts` (
  `id` int AUTO_INCREMENT PRIMARY KEY,
  `videoScriptId` int NOT NULL,
  `competitorName` varchar(200),
  `competitorAsin` varchar(20),
  `inputType` enum('excel_upload','video_url','knowledge_base','listing_extract') NOT NULL,
  `sourceUrl` text,
  `sourceFileKey` text,
  `sourceKbVideoId` int,
  `videoType` varchar(50),
  `totalDuration` decimal(5,1),
  `rawContent` text,
  `structureAnalysis` json,
  `visualLanguage` json,
  `copywritingAnalysis` json,
  `strengths` json,
  `weaknesses` json,
  `reusablePatterns` json,
  `userConfirmed` int DEFAULT 0,
  `userEdits` json,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- 3. 多竞品汇总分析表
CREATE TABLE IF NOT EXISTS `video_competitor_summary` (
  `id` int AUTO_INCREMENT PRIMARY KEY,
  `videoScriptId` int NOT NULL,
  `competitorScriptIds` json,
  `commonStructure` json,
  `optimalDurationAllocation` json,
  `differentiableOpportunities` json,
  `recommendedStructure` json,
  `userConfirmed` int DEFAULT 0,
  `userEdits` json,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- 4. 产品信息快照表
CREATE TABLE IF NOT EXISTS `video_product_snapshots` (
  `id` int AUTO_INCREMENT PRIMARY KEY,
  `videoScriptId` int NOT NULL,
  `basicInfo` json,
  `sellingPointsHierarchy` json,
  `painPoints` json,
  `keywords` json,
  `productSpecs` json,
  `productImageUrls` json,
  `dataSources` json,
  `userConfirmed` int DEFAULT 0,
  `userEdits` json,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- 5. 视频脚本段落表
CREATE TABLE IF NOT EXISTS `video_script_sections` (
  `id` int AUTO_INCREMENT PRIMARY KEY,
  `videoScriptId` int NOT NULL,
  `sectionCode` varchar(20),
  `sectionName` varchar(200) NOT NULL,
  `sectionNameEn` varchar(200),
  `shootingMethod` enum('model_narration','live_action','ai_generated','mixed','screen_recording') DEFAULT 'live_action',
  `durationBudget` decimal(5,1),
  `sellingPointRefs` json,
  `painPointRefs` json,
  `sortOrder` int DEFAULT 0,
  `userConfirmed` int DEFAULT 0,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- 6. 视频脚本子主题表
CREATE TABLE IF NOT EXISTS `video_script_subtopics` (
  `id` int AUTO_INCREMENT PRIMARY KEY,
  `sectionId` int NOT NULL,
  `subtopicName` varchar(200) NOT NULL,
  `subtopicNameEn` varchar(200),
  `durationBudget` decimal(5,1),
  `shotCount` int DEFAULT 1,
  `sellingPointRef` text,
  `sortOrder` int DEFAULT 0,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- 7. 视频脚本镜头表（14字段完整版）
CREATE TABLE IF NOT EXISTS `video_script_shots` (
  `id` int AUTO_INCREMENT PRIMARY KEY,
  `subtopicId` int NOT NULL,
  `sectionId` int NOT NULL,
  `shotCode` varchar(20),
  `duration` decimal(4,1),
  `shotDescription` text,
  `sceneLocation` varchar(100),
  `cameraAngle` enum('extreme_closeup','closeup','medium_closeup','medium','medium_wide','wide','extreme_wide'),
  `cameraMovement` varchar(100),
  `overlayTextEn` text,
  `overlayTextCn` text,
  `narrationEn` text,
  `narrationCn` text,
  `narratorType` enum('voiceover','model_narration','text_only','none') DEFAULT 'voiceover',
  `generationStrategy` enum('real_shoot','ai_image','ai_video','stock_footage','screen_record','mixed') DEFAULT 'real_shoot',
  `reuseFromShotCode` varchar(20),
  `designatedAssets` json,
  `colorScheme` varchar(200),
  `referenceImageUrl` text,
  `sortOrder` int DEFAULT 0,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- 8. 剪辑脚本表
CREATE TABLE IF NOT EXISTS `video_edit_scripts` (
  `id` int AUTO_INCREMENT PRIMARY KEY,
  `videoScriptId` int NOT NULL,
  `editName` varchar(200) NOT NULL,
  `videoPurpose` enum('spv_ad','sbv_ad','main_listing','aplus','social_media','other') DEFAULT 'main_listing',
  `maxDuration` decimal(5,1),
  `editStyle` varchar(100),
  `sectionMapping` json,
  `description` text,
  `sortOrder` int DEFAULT 0,
  `userConfirmed` int DEFAULT 0,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Add indexes for performance
CREATE INDEX idx_video_scripts_project ON video_scripts(projectId);
CREATE INDEX idx_video_scripts_user ON video_scripts(userId);
CREATE INDEX idx_video_competitor_scripts_script ON video_competitor_scripts(videoScriptId);
CREATE INDEX idx_video_product_snapshots_script ON video_product_snapshots(videoScriptId);
CREATE INDEX idx_video_script_sections_script ON video_script_sections(videoScriptId);
CREATE INDEX idx_video_script_subtopics_section ON video_script_subtopics(sectionId);
CREATE INDEX idx_video_script_shots_subtopic ON video_script_shots(subtopicId);
CREATE INDEX idx_video_script_shots_section ON video_script_shots(sectionId);
CREATE INDEX idx_video_edit_scripts_script ON video_edit_scripts(videoScriptId);
