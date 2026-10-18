import { randomUUID } from "node:crypto";
import { videoWorkflowCanonical as canonical, videoWorkflowHash as hash, type VideoWorkflowIdentity, type VideoWorkflowScope } from "../../../shared/videoWorkflow";
import { VIDEO_AGENT_SLUG, VIDEO_STAGE_NODE_MAP, getVideoAgentDag } from "./videoWorkflowDag";
import { videoWorkflowRows as rows, videoWorkflowStatement as statement, videoWorkflowFail as fail, videoWorkflowJson as json, type VideoWorkflowExecutor } from "./videoWorkflowSource";

type Row = Record<string, unknown>;
const tableNames = ["emperor_agents", "emperor_agent_runs", "emperor_agent_checkpoints", "emperor_agent_events", "emperor_agent_artifacts"] as const;
async function write(tx: VideoWorkflowExecutor, query: string, params: unknown[], count = 1) {
  const result = await tx.execute(statement(query, params));
  if (!Array.isArray(result) || result[0]?.affectedRows !== count || result[0]?.warningStatus !== 0) fail("AGENT_PROJECTION_UNCONFIRMED");
  return result[0] as { insertId: number };
}
async function insert(tx: VideoWorkflowExecutor, table: string, value: Row) {
  const keys = Object.keys(value);
  return write(tx, `INSERT INTO ${table} (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`, keys.map(key => value[key]));
}
async function update(tx: VideoWorkflowExecutor, table: string, id: number, value: Row) {
  const keys = Object.keys(value);
  return write(tx, `UPDATE ${table} SET ${keys.map(key => `${key}=?`).join(",")} WHERE id=?`, [...keys.map(key => value[key]), id]);
}
function stageOutput(tables: Record<string, Row[]>, stage: string): unknown {
  if (stage === "stage_0a") return { competitors: tables.video_competitor_scripts, summary: tables.video_competitor_summary[0] ?? null };
  const table = { stage_0b: "video_product_snapshots", stage_1: "video_script_sections", stage_2: "video_script_subtopics", stage_3: "video_script_shots", stage_4: "video_edit_scripts" }[stage];
  if (!table) fail("AGENT_PROJECTION_INVALID");
  return stage === "stage_0b" ? tables[table][0] ?? null : tables[table];
}
export function videoWorkflowArtifactContent(tables: Record<string, Row[]>) {
  return { script: tables.video_scripts[0], competitors: tables.video_competitor_scripts, summary: tables.video_competitor_summary[0] ?? null,
    snapshot: tables.video_product_snapshots[0] ?? null, sections: tables.video_script_sections, subtopics: tables.video_script_subtopics,
    shots: tables.video_script_shots, editScripts: tables.video_edit_scripts, spvSegments: tables.video_spv_segments };
}
/** Formal overlays never supersede a newer business version. Old artifacts
 * without a reliable script version remain history, not current source. */
export function videoWorkflowArtifactMatchesScript(artifact: { content: unknown; metadata?: unknown }, script: { id: number; projectId: number; version: number | null; userId: number }): boolean {
  const content = artifact.content as { script?: Row } | null, selected = content?.script;
  return Number.isSafeInteger(script.version) && Number(script.version) > 0 && !!selected && selected.id === script.id && selected.projectId === script.projectId
    && selected.userId === script.userId && selected.version === script.version;
}

/** Caller holds the fresh project→script locks and has already written the
 * exact business version. No global runner/registry call or nested transaction.
 * Run, human gates, invalidations, immutable stage history and formal business
 * artifact either all commit with that version or all roll back. */
export async function projectVideoWorkflowAgent(tx: VideoWorkflowExecutor, identity: VideoWorkflowIdentity, scope: VideoWorkflowScope,
  tables: Record<string, Row[]>, confirmedPublication: boolean, explicitlyConfirmedStage?: keyof typeof VIDEO_STAGE_NODE_MAP) {
  const script = tables.video_scripts?.[0], dag = getVideoAgentDag();
  if (!script || script.id !== scope.videoScriptId || script.projectId !== scope.projectId || !Number.isSafeInteger(script.version)) fail("AGENT_PROJECTION_INVALID");
  const engines = await rows(tx, `SELECT TABLE_NAME AS name,ENGINE AS engine FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (${tableNames.map(() => "?").join(",")})`, [...tableNames], tableNames.length);
  if (engines.length !== tableNames.length || engines.some(row => row.engine !== "InnoDB" || !tableNames.includes(row.name as typeof tableNames[number])) || new Set(engines.map(row => row.name)).size !== tableNames.length) fail("AGENT_PROJECTION_UNAVAILABLE");
  const businessHash = hash(tables), binding = { version: 1, videoScriptId: scope.videoScriptId, scriptVersion: script.version, businessHash };
  const agents = await rows(tx, "SELECT id,slug,dagDefinition FROM emperor_agents WHERE slug=? FOR UPDATE", [VIDEO_AGENT_SLUG], 1);
  if (!agents.length) await insert(tx, "emperor_agents", { workspaceId: null, slug: VIDEO_AGENT_SLUG, name: "视频脚本 · 六阶段工作流",
    status: "active", scope: "project", triggerType: "manual", maxExecutionSeconds: 1800, dagDefinition: canonical(dag) });
  // Existing registry templates are not overwritten. The run's immutable DAG
  // snapshot is authoritative for the six business-managed nodes.
  const runs = await rows(tx, `SELECT id,runId,stateVersion,inputs FROM emperor_agent_runs WHERE agentSlug=? AND workspaceId=? AND projectId=? AND userId=?
    AND COALESCE(JSON_EXTRACT(inputs,'$.payload.videoScriptId'),JSON_EXTRACT(inputs,'$.inputs.videoScriptId'),JSON_EXTRACT(inputs,'$.videoScriptId'))=?
    ORDER BY id DESC LIMIT 1 FOR UPDATE`, [VIDEO_AGENT_SLUG, identity.workspaceId, scope.projectId, identity.userId, scope.videoScriptId], 1);
  let run = runs[0];
  if (!run) {
    const runId = `video_${randomUUID()}`, inputs = { __agentRun: { agentSlug: VIDEO_AGENT_SLUG, agentName: "视频脚本 · 六阶段工作流",
      templateVersionId: null, templateVersion: null, dagSnapshot: dag, dagHash: hash(dag), preparedAt: new Date().toISOString() },
      payload: { projectId: scope.projectId, videoScriptId: scope.videoScriptId, workflow: "video.script", executionOwner: "video_script.workbench" } };
    const saved = await insert(tx, "emperor_agent_runs", { workspaceId: identity.workspaceId, runId, agentSlug: VIDEO_AGENT_SLUG,
      agentName: "视频脚本 · 六阶段工作流", dagHash: hash(dag), userId: identity.userId, projectId: scope.projectId,
      status: "waiting_human", progress: 0, stateVersion: 0, inputs: canonical(inputs) });
    run = { id: saved.insertId, runId, stateVersion: 0, inputs };
  }
  const checkpoints = await rows(tx, "SELECT id,nodeId,status,metadata,reviewerUserId,confirmedAt FROM emperor_agent_checkpoints WHERE runId=? ORDER BY id FOR UPDATE", [run.runId], 6);
  if (new Set(checkpoints.map(row => row.nodeId)).size !== checkpoints.length || checkpoints.some(row => !dag.nodes.some(node => node.id === row.nodeId))) fail("AGENT_PROJECTION_INVALID");
  const previousArtifacts = await rows(tx, "SELECT id,nodeId,artifactKey,version,isCurrent FROM emperor_agent_artifacts WHERE runId=? AND isCurrent=1 FOR UPDATE", [run.runId], 6);
  for (const artifact of previousArtifacts) await update(tx, "emperor_agent_artifacts", Number(artifact.id), { status: "superseded", isCurrent: 0 });
  const statuses = script.stageStatus as Row, outputs: Row = {}, stageStates: Row = {};
  let confirmed = 0;
  for (const [stage, nodeId] of Object.entries(VIDEO_STAGE_NODE_MAP)) {
    const node = dag.nodes.find(value => value.id === nodeId)!, output = stageOutput(tables, stage), isConfirmed = statuses?.[stage] === "confirmed";
    const state = isConfirmed ? "confirmed" : ["generated", "stale"].includes(String(statuses?.[stage])) ? "waiting_human"
      : ["failed", "canceled"].includes(String(statuses?.[stage])) ? String(statuses[stage]) : "pending";
    if (isConfirmed) { confirmed++; outputs[nodeId] = output; }
    stageStates[nodeId] = state;
    const old = checkpoints.find(value => value.nodeId === nodeId);
    const explicit = isConfirmed && explicitlyConfirmedStage === stage;
    const reviewer = explicit ? identity.userId : isConfirmed && old?.status === "confirmed" ? old.reviewerUserId ?? null : null;
    const reviewedAt = explicit ? new Date() : isConfirmed && old?.status === "confirmed" ? old.confirmedAt ?? null : null;
    const oldMetadata = old?.metadata == null ? {} : json(old.metadata) as Row;
    const value = { status: state, output: canonical(output), userEdit: isConfirmed ? canonical(output) : null,
      metadata: canonical({ ...oldMetadata, businessProjection: binding, businessJobStatus: state }),
      reviewerUserId: reviewer, confirmedAt: reviewedAt,
      lockToken: null, lockedAt: null, timeoutAt: null, retryScheduledAt: null, errorMessage: null };
    if (old) await update(tx, "emperor_agent_checkpoints", Number(old.id), value);
    else await insert(tx, "emperor_agent_checkpoints", { workspaceId: identity.workspaceId, runId: run.runId, agentSlug: VIDEO_AGENT_SLUG,
      nodeId, nodeLabel: node.label ?? nodeId, nodeType: "skill_node", attempt: 0, maxAttempts: 1, ...value });
    await insert(tx, "emperor_agent_artifacts", { workspaceId: identity.workspaceId, runId: run.runId, agentSlug: VIDEO_AGENT_SLUG,
      nodeId, artifactKey: nodeId, artifactType: "json", status: isConfirmed ? "final" : "draft", version: script.version,
      isCurrent: isConfirmed ? 1 : 0, selectedBy: reviewer, userId: identity.userId, projectId: scope.projectId,
      content: canonical(output), contentHash: hash(output), metadata: canonical({ businessProjection: binding }), mimeType: "application/json",
      fileSizeBytes: Buffer.byteLength(canonical(output)) });
  }
  const complete = dag.nodes.filter(node => node.required).every(node => stageStates[node.id] === "confirmed");
  await write(tx, "UPDATE emperor_agent_runs SET status=?,progress=?,currentNodeId=?,outputs=?,stateVersion=stateVersion+1,errorMessage=NULL WHERE id=? AND stateVersion=?",
    [complete ? "completed" : "waiting_human", Math.round(confirmed / 6 * 100), dag.nodes.find(node => stageStates[node.id] !== "confirmed")?.id ?? null,
      canonical({ ...outputs, __videoWorkflow: binding }), run.id, run.stateVersion]);
  await insert(tx, "emperor_agent_events", { workspaceId: identity.workspaceId, runId: run.runId, agentSlug: VIDEO_AGENT_SLUG,
    eventType: "business_version_projected", message: "视频业务版本与人工审核节点同事务同步", payload: canonical({ ...binding, stageStates }) });
  const oldCurrent = await rows(tx, "SELECT id FROM ai_artifacts WHERE workspaceId=? AND projectId=? AND domain='video' AND artifactKey='video.script' AND sourceTable='video_scripts' AND sourceRowId=? AND isCurrent=1 FOR UPDATE", [identity.workspaceId, scope.projectId, String(scope.videoScriptId)], 100);
  for (const artifact of oldCurrent) await update(tx, "ai_artifacts", Number(artifact.id), { isCurrent: 0, status: "superseded" });
  const content = videoWorkflowArtifactContent(tables), artifactId = `video_form_${hash({ identity, scope, binding })}`;
  await insert(tx, "ai_artifacts", { workspaceId: identity.workspaceId, artifactId, domain: "video", artifactKey: "video.script", artifactType: "json",
    sourceType: "user_edit", sourceId: String(scope.videoScriptId), sourceTable: "video_scripts", sourceRowId: String(scope.videoScriptId),
    runId: run.runId, agentSlug: VIDEO_AGENT_SLUG, projectId: scope.projectId, userId: identity.userId,
    status: confirmedPublication ? "final" : "draft", version: script.version, isCurrent: confirmedPublication ? 1 : 0,
    selectedBy: confirmedPublication ? identity.userId : null, contentJson: canonical(content), contentHash: hash(content),
    metadata: canonical({ videoWorkflowProjection: binding, currentStage: script.currentStage, scriptVersion: script.version }),
    mimeType: "application/json", fileSizeBytes: Buffer.byteLength(canonical(content)) });
  const readback = await rows(tx, "SELECT artifactId,contentJson,contentHash,metadata,status,isCurrent,version FROM ai_artifacts WHERE artifactId=?", [artifactId], 1);
  const checkpointReadback = await rows(tx, "SELECT id,nodeId,status,metadata FROM emperor_agent_checkpoints WHERE runId=? ORDER BY id FOR UPDATE", [run.runId], 6);
  const runReadback = await rows(tx, "SELECT id,runId,stateVersion,outputs,status FROM emperor_agent_runs WHERE runId=?", [run.runId], 1);
  if (readback.length !== 1 || hash(json(readback[0].contentJson)) !== hash(content) || readback[0].contentHash !== hash(content)
    || readback[0].isCurrent !== (confirmedPublication ? 1 : 0) || readback[0].version !== script.version
    || checkpointReadback.length !== 6 || checkpointReadback.some(row => row.status !== stageStates[String(row.nodeId)]
      || hash((json(row.metadata) as Row).businessProjection) !== hash(binding))
    || runReadback.length !== 1 || runReadback[0].stateVersion !== Number(run.stateVersion) + 1
    || hash(json(runReadback[0].outputs)) !== hash({ ...outputs, __videoWorkflow: binding })) fail("AGENT_PROJECTION_READBACK_INVALID");
  return { agentRunId: String(run.runId), artifactId, businessHash, scriptVersion: Number(script.version) };
}
