import type { EmperorAgentDag, EmperorAgentNode } from "../ai_os/services/agentRunner/runtimeCore";

export const VIDEO_AGENT_SLUG = "video.script.workflow";

export const VIDEO_STAGE_NODE_MAP = {
  stage_0a: "competitor_analysis",
  stage_0b: "product_information",
  stage_1: "section_planning",
  stage_2: "subtopic_expansion",
  stage_3: "shot_storyboard",
  stage_4: "edit_script",
} as const;

export type VideoStage = keyof typeof VIDEO_STAGE_NODE_MAP;
export type VideoAgentNodeId = typeof VIDEO_STAGE_NODE_MAP[VideoStage];

export const VIDEO_OPERATION_NODE_MAP = {
  competitor_analysis: VIDEO_STAGE_NODE_MAP.stage_0a,
  competitor_summary: VIDEO_STAGE_NODE_MAP.stage_0a,
  product_info: VIDEO_STAGE_NODE_MAP.stage_0b,
  sections: VIDEO_STAGE_NODE_MAP.stage_1,
  subtopics: VIDEO_STAGE_NODE_MAP.stage_2,
  shots: VIDEO_STAGE_NODE_MAP.stage_3,
  edit_scripts: VIDEO_STAGE_NODE_MAP.stage_4,
} as const;

const nodeDefinitions: Array<{
  id: VideoAgentNodeId;
  label: string;
  skillSlug: string;
  stage: VideoStage;
  required: boolean;
}> = [
  { id: "competitor_analysis", label: "0A · 竞品脚本分析", skillSlug: "video.competitor.analysis", stage: "stage_0a", required: false },
  { id: "product_information", label: "0B · 产品信息提取", skillSlug: "video.section.plan", stage: "stage_0b", required: true },
  { id: "section_planning", label: "01 · 章节生成", skillSlug: "video.section.plan", stage: "stage_1", required: true },
  { id: "subtopic_expansion", label: "02 · 子主题展开", skillSlug: "video.section.plan", stage: "stage_2", required: true },
  { id: "shot_storyboard", label: "03 · 分镜生成", skillSlug: "video.shot.detail", stage: "stage_3", required: true },
  { id: "edit_script", label: "04 · 剪辑脚本", skillSlug: "video.edit.script", stage: "stage_4", required: true },
];

export function getVideoAgentDag(): EmperorAgentDag {
  const nodes: EmperorAgentNode[] = nodeDefinitions.map((definition, index) => ({
    id: definition.id,
    nodeType: "skill_node",
    label: definition.label,
    subtitle: "由视频脚本页面运行、编辑与确认",
    skillSlug: definition.skillSlug,
    skillVersionPolicy: "snapshot",
    outputKey: definition.id,
    humanGate: true,
    required: definition.required,
    scheduler: "manual",
    executionOwner: "video_script.workbench",
    businessRoute: `/listing/video-script?stage=${definition.stage}`,
    x: 60 + (index % 3) * 300,
    y: 60 + Math.floor(index / 3) * 240,
  }));
  const edge = (source: VideoAgentNodeId, target: VideoAgentNodeId, required = true) => ({
    id: `${source}-${target}`,
    source,
    target,
    from: source,
    to: target,
    label: required ? "已确认产物" : "竞品参考",
    kind: required ? "required" as const : "suggested" as const,
    required,
  });
  return {
    version: "1.0.0",
    workflowType: "human_in_loop_dag",
    description: "视频脚本六阶段主链路。Skill 提供 AI 能力，Job 执行长任务，业务页面负责人工确认。",
    executionOwner: "video_script.workbench",
    businessRoute: "/listing/video-script",
    nodes,
    edges: [
      edge("competitor_analysis", "section_planning", false),
      edge("product_information", "section_planning"),
      edge("section_planning", "subtopic_expansion"),
      edge("subtopic_expansion", "shot_storyboard"),
      edge("shot_storyboard", "edit_script"),
    ],
  };
}
