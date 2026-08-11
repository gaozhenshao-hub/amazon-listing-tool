-- Round 5: unified business Job/Checkpoint binding and video Agent workflow.

ALTER TABLE `emperor_agent_checkpoints`
  MODIFY COLUMN `status` ENUM(
    'pending','ready','running','waiting_human','confirmed','skipped','failed','canceled'
  ) NOT NULL DEFAULT 'pending';

SET @video_agent_slug = 'video.script.workflow';
SET @video_agent_dag = CAST('{
  "version":"1.0.0",
  "workflowType":"human_in_loop_dag",
  "description":"视频脚本六阶段主链路。Skill 提供 AI 能力，Job 执行长任务，业务页面负责人工确认。",
  "executionOwner":"video_script.workbench",
  "businessRoute":"/listing/video-script",
  "nodes":[
    {"id":"competitor_analysis","nodeType":"skill_node","label":"0A · 竞品脚本分析","skillSlug":"video.competitor.analysis","skillVersionPolicy":"snapshot","outputKey":"competitor_analysis","humanGate":true,"required":false,"scheduler":"manual","executionOwner":"video_script.workbench","businessRoute":"/listing/video-script?stage=stage_0a","x":60,"y":60},
    {"id":"product_information","nodeType":"skill_node","label":"0B · 产品信息提取","skillSlug":"video.section.plan","skillVersionPolicy":"snapshot","outputKey":"product_information","humanGate":true,"required":true,"scheduler":"manual","executionOwner":"video_script.workbench","businessRoute":"/listing/video-script?stage=stage_0b","x":360,"y":60},
    {"id":"section_planning","nodeType":"skill_node","label":"01 · 章节生成","skillSlug":"video.section.plan","skillVersionPolicy":"snapshot","outputKey":"section_planning","humanGate":true,"required":true,"scheduler":"manual","executionOwner":"video_script.workbench","businessRoute":"/listing/video-script?stage=stage_1","x":660,"y":60},
    {"id":"subtopic_expansion","nodeType":"skill_node","label":"02 · 子主题展开","skillSlug":"video.section.plan","skillVersionPolicy":"snapshot","outputKey":"subtopic_expansion","humanGate":true,"required":true,"scheduler":"manual","executionOwner":"video_script.workbench","businessRoute":"/listing/video-script?stage=stage_2","x":60,"y":300},
    {"id":"shot_storyboard","nodeType":"skill_node","label":"03 · 分镜生成","skillSlug":"video.shot.detail","skillVersionPolicy":"snapshot","outputKey":"shot_storyboard","humanGate":true,"required":true,"scheduler":"manual","executionOwner":"video_script.workbench","businessRoute":"/listing/video-script?stage=stage_3","x":360,"y":300},
    {"id":"edit_script","nodeType":"skill_node","label":"04 · 剪辑脚本","skillSlug":"video.edit.script","skillVersionPolicy":"snapshot","outputKey":"edit_script","humanGate":true,"required":true,"scheduler":"manual","executionOwner":"video_script.workbench","businessRoute":"/listing/video-script?stage=stage_4","x":660,"y":300}
  ],
  "edges":[
    {"id":"competitor_analysis-section_planning","source":"competitor_analysis","target":"section_planning","from":"competitor_analysis","to":"section_planning","label":"竞品参考","kind":"suggested","required":false},
    {"id":"product_information-section_planning","source":"product_information","target":"section_planning","from":"product_information","to":"section_planning","label":"已确认产物","kind":"required","required":true},
    {"id":"section_planning-subtopic_expansion","source":"section_planning","target":"subtopic_expansion","from":"section_planning","to":"subtopic_expansion","label":"已确认产物","kind":"required","required":true},
    {"id":"subtopic_expansion-shot_storyboard","source":"subtopic_expansion","target":"shot_storyboard","from":"subtopic_expansion","to":"shot_storyboard","label":"已确认产物","kind":"required","required":true},
    {"id":"shot_storyboard-edit_script","source":"shot_storyboard","target":"edit_script","from":"shot_storyboard","to":"edit_script","label":"已确认产物","kind":"required","required":true}
  ]
}' AS JSON);
SET @video_agent_dag_hash = SHA2(CAST(@video_agent_dag AS CHAR), 256);

UPDATE `emperor_agents`
SET `name`='视频脚本 · 六阶段工作流',
    `description`='视频竞品、章节、子主题、分镜与剪辑脚本的人机协同流程。',
    `category`='视频',`status`='active',`scope`='project',`triggerType`='manual',
    `maxExecutionSeconds`=1800,`dagDefinition`=@video_agent_dag,`updatedAt`=NOW()
WHERE BINARY `slug`=BINARY @video_agent_slug;

INSERT INTO `emperor_agents`
  (`workspaceId`,`slug`,`name`,`description`,`category`,`status`,`scope`,`triggerType`,`maxExecutionSeconds`,`dagDefinition`)
SELECT NULL,@video_agent_slug,'视频脚本 · 六阶段工作流','视频竞品、章节、子主题、分镜与剪辑脚本的人机协同流程。','视频','active','project','manual',1800,@video_agent_dag
WHERE NOT EXISTS (SELECT 1 FROM `emperor_agents` WHERE BINARY `slug`=BINARY @video_agent_slug);

SET @video_agent_version = (
  SELECT COALESCE(MAX(`versionNumber`),0)+1 FROM `emperor_agent_template_versions`
  WHERE BINARY `agentSlug`=BINARY @video_agent_slug AND `workspaceId` IS NULL
);

INSERT INTO `emperor_agent_template_versions`
  (`workspaceId`,`agentSlug`,`agentName`,`versionNumber`,`version`,`dagHash`,`status`,`isDefault`,`rolloutPercent`,`dagDefinition`,`releaseNotes`,`releasedAt`,`activatedAt`)
SELECT NULL,@video_agent_slug,'视频脚本 · 六阶段工作流',@video_agent_version,'1.0.0',@video_agent_dag_hash,
       'released',1,100,@video_agent_dag,'视频工作流 v1：AI Job、Checkpoint 与 Artifact 状态闭环',NOW(),NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM `emperor_agent_template_versions`
  WHERE BINARY `agentSlug`=BINARY @video_agent_slug AND `workspaceId` IS NULL
    AND BINARY `dagHash`=BINARY @video_agent_dag_hash
);

UPDATE `emperor_agent_template_versions`
SET `isDefault`=IF(BINARY `dagHash`=BINARY @video_agent_dag_hash,1,0),
    `status`=IF(BINARY `dagHash`=BINARY @video_agent_dag_hash,'released',`status`),
    `rolloutPercent`=IF(BINARY `dagHash`=BINARY @video_agent_dag_hash,100,`rolloutPercent`),
    `activatedAt`=IF(BINARY `dagHash`=BINARY @video_agent_dag_hash,COALESCE(`activatedAt`,NOW()),`activatedAt`),
    `updatedAt`=NOW()
WHERE BINARY `agentSlug`=BINARY @video_agent_slug AND `workspaceId` IS NULL;
