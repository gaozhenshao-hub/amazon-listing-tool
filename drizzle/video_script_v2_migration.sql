-- V2 Schema Enhancement: Add style_preset, version, props, notes, subtitle fields

-- 1. video_scripts 主表增加字段
ALTER TABLE video_scripts
  ADD COLUMN style_preset VARCHAR(50) DEFAULT 'minimal_white' AFTER videoType,
  ADD COLUMN version INT DEFAULT 1 AFTER stageStatus,
  ADD COLUMN version_note TEXT AFTER version;

-- 2. video_script_shots 镜头表增加字段
ALTER TABLE video_script_shots
  ADD COLUMN subtitleEn TEXT AFTER narrationCn,
  ADD COLUMN subtitleCn TEXT AFTER subtitleEn,
  ADD COLUMN props JSON AFTER colorScheme,
  ADD COLUMN notes TEXT AFTER props;

-- 3. video_script_sections 段落表增加字段
ALTER TABLE video_script_sections
  ADD COLUMN description TEXT AFTER painPointRefs,
  ADD COLUMN shotTypeSuggestion VARCHAR(100) AFTER description,
  ADD COLUMN propsSuggestion JSON AFTER shotTypeSuggestion;

-- 4. 创建版本快照表
CREATE TABLE IF NOT EXISTS video_script_versions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  videoScriptId INT NOT NULL,
  version INT NOT NULL DEFAULT 1,
  versionNote TEXT,
  snapshotData JSON NOT NULL,
  createdBy INT,
  createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- 5. 创建SPV段视频表（支持SPV多段视频管理）
CREATE TABLE IF NOT EXISTS video_spv_segments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  videoScriptId INT NOT NULL,
  segmentIndex INT NOT NULL DEFAULT 1,
  segmentName VARCHAR(200) NOT NULL,
  focusDimension VARCHAR(100),
  descriptionText TEXT,
  maxDuration DECIMAL(5,1) DEFAULT 25.0,
  status VARCHAR(20) DEFAULT 'draft',
  sortOrder INT DEFAULT 0,
  createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP NOT NULL
);
