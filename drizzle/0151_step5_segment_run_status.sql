ALTER TABLE image_workflow_sessions
  ADD COLUMN step5RunSegments LONGTEXT NULL COMMENT 'Step5分段与A+子任务实时状态JSON',
  ADD COLUMN step5RunFailedGroup VARCHAR(64) NULL COMMENT 'Step5失败分段：main、secondary、aplus、brand_story或fallback',
  ADD COLUMN step5RunFailedModule VARCHAR(128) NULL COMMENT 'Step5失败A+模块标识或品牌故事标识';
