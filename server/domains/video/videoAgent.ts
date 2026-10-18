import * as vsDb from "../../videoScriptDb";
import {
  markBusinessManagedNodeConfirmed,
  markBusinessManagedNodeDraft,
} from "../ai_os/services/businessManagedAgent";
import {
  getAgentRun,
  recordAgentTemplateVersion,
  startAgentRun,
} from "../ai_os/services/agentRunner";
import { parseJson, rawExecute } from "../ai_os/services/agentRunner/runtimeCore";

import { VIDEO_AGENT_SLUG, VIDEO_STAGE_NODE_MAP, getVideoAgentDag, type VideoStage } from "./videoWorkflowDag";
export { VIDEO_AGENT_SLUG, VIDEO_STAGE_NODE_MAP, VIDEO_OPERATION_NODE_MAP, getVideoAgentDag, type VideoStage, type VideoAgentNodeId } from "./videoWorkflowDag";

export async function ensureVideoAgentTemplate() {
  const dag = getVideoAgentDag();
  const existing = await rawExecute("SELECT id FROM emperor_agents WHERE slug=? LIMIT 1", [VIDEO_AGENT_SLUG]);
  if (existing[0]) {
    await rawExecute(
      "UPDATE emperor_agents SET name=?,description=?,category=?,status='active',scope='project',triggerType='manual',maxExecutionSeconds=1800,dagDefinition=?,updatedAt=NOW() WHERE slug=?",
      ["视频脚本 · 六阶段工作流", "视频竞品、章节、子主题、分镜与剪辑脚本的人机协同流程。", "视频", JSON.stringify(dag), VIDEO_AGENT_SLUG],
    );
  } else {
    await rawExecute(
      `INSERT INTO emperor_agents
       (workspaceId,slug,name,description,category,status,scope,triggerType,maxExecutionSeconds,dagDefinition)
       VALUES (NULL,?,?,?,?, 'active','project','manual',1800,?)`,
      [VIDEO_AGENT_SLUG, "视频脚本 · 六阶段工作流", "视频竞品、章节、子主题、分镜与剪辑脚本的人机协同流程。", "视频", JSON.stringify(dag)],
    );
  }
  await recordAgentTemplateVersion({
    workspaceId: null,
    agentSlug: VIDEO_AGENT_SLUG,
    agentName: "视频脚本 · 六阶段工作流",
    dag,
    status: "released",
    releaseNotes: "视频工作流 v1：AI Job、Checkpoint 与 Artifact 状态闭环",
    isDefault: true,
    rolloutPercent: 100,
  });
  return dag;
}

function storedVideoScriptId(value: unknown) {
  const parsed = parseJson(value, {}) as any;
  return Number(parsed?.payload?.videoScriptId ?? parsed?.inputs?.videoScriptId ?? parsed?.videoScriptId ?? 0);
}

export async function ensureVideoAgentRun(input: {
  videoScriptId: number;
  projectId: number;
  userId: number;
  workspaceId?: number | null;
}) {
  const dag = await ensureVideoAgentTemplate();
  const rows = await rawExecute(
    `SELECT * FROM emperor_agent_runs
     WHERE agentSlug=? AND projectId=? AND userId=?
       AND status NOT IN ('completed','canceled')
     ORDER BY createdAt DESC,id DESC LIMIT 20`,
    [VIDEO_AGENT_SLUG, input.projectId, input.userId],
  );
  const existing = rows.find((row) => storedVideoScriptId(row.inputs) === input.videoScriptId);
  if (existing) {
    return { runId: String(existing.runId), dag, detail: await getAgentRun(String(existing.runId), input.userId, true), created: false };
  }
  const detail = await startAgentRun({
    slug: VIDEO_AGENT_SLUG,
    inputs: {
      projectId: input.projectId,
      videoScriptId: input.videoScriptId,
      workflow: "video.script",
      schemaVersion: "1.0",
      executionOwner: "video_script.workbench",
    },
    userId: input.userId,
    workspaceId: input.workspaceId ?? null,
    projectId: input.projectId,
  });
  return { runId: String((detail as any).run.runId), dag, detail, created: true };
}

export async function getVideoStageOutput(videoScriptId: number, stage: VideoStage) {
  if (stage === "stage_0a") {
    return {
      competitors: await vsDb.getCompetitorScriptsByVideoScript(videoScriptId),
      summary: await vsDb.getCompetitorSummary(videoScriptId),
    };
  }
  if (stage === "stage_0b") return vsDb.getProductSnapshot(videoScriptId);
  if (stage === "stage_1") return vsDb.getSections(videoScriptId);
  if (stage === "stage_2") return vsDb.getSubtopicsByVideoScript(videoScriptId);
  if (stage === "stage_3") return vsDb.getAllShotsByVideoScript(videoScriptId);
  return vsDb.getEditScripts(videoScriptId);
}

export async function confirmVideoStage(input: {
  videoScriptId: number;
  projectId: number;
  stage: VideoStage;
  userId: number;
  workspaceId?: number | null;
}) {
  const agent = await ensureVideoAgentRun(input);
  const output = await getVideoStageOutput(input.videoScriptId, input.stage);
  await markBusinessManagedNodeConfirmed({
    runId: agent.runId,
    dag: agent.dag,
    nodeId: VIDEO_STAGE_NODE_MAP[input.stage],
    output,
    userEdit: output,
    userId: input.userId,
    metadata: { businessJobStatus: "confirmed", videoScriptId: input.videoScriptId, stage: input.stage },
  });
  return { agentRunId: agent.runId, output };
}

export async function saveVideoStageDraft(input: {
  videoScriptId: number;
  projectId: number;
  stage: VideoStage;
  userId: number;
  workspaceId?: number | null;
}) {
  const agent = await ensureVideoAgentRun(input);
  const output = await getVideoStageOutput(input.videoScriptId, input.stage);
  await markBusinessManagedNodeDraft({
    runId: agent.runId,
    dag: agent.dag,
    nodeId: VIDEO_STAGE_NODE_MAP[input.stage],
    output,
    userEdit: output,
    userId: input.userId,
  });
  return { agentRunId: agent.runId };
}
