import { applyVideoWorkflowCandidate } from "./videoWorkflowPublication";
import { projectVideoWorkflowAgent } from "./videoWorkflowAgentProjection";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { ROLE_MODULE_ACCESS } from "../../../shared/const";
import { requireDb, type DbExecutor } from "../../repositories/dbClient";
import { assertResourceAction } from "../../services/securityGovernance";
import { VIDEO_WORKFLOW_DEFINITIONS, VideoWorkflowIdentitySchema, VideoWorkflowScopeSchema, VideoWorkflowOperationInputSchema, VideoWorkflowStartInputSchema,
  VideoWorkflowApplyInputSchema, VideoWorkflowApplyOperationInputSchema, VideoWorkflowApplyReceiptSchema, VideoWorkflowSourceSchema,
  parseVideoWorkflowCandidate, VideoWorkflowOptionsInputSchema, type VideoWorkflowOptionsInput, VideoWorkflowHashSchema, VideoWorkflowUuidSchema, VideoWorkflowIdSchema,
  videoWorkflowHash, videoWorkflowCanonical, type VideoWorkflowIdentity, type VideoWorkflowScope, type VideoWorkflowOperationInput,
  type VideoWorkflowStartInput, type VideoWorkflowApplyInput, type VideoWorkflowApplyOperationInput, type VideoWorkflowSource } from "../../../shared/videoWorkflow";
import { VideoConfiguredRuntimeSnapshotSchema, VideoConfiguredSavedConfigurationSchema, VideoConfiguredDispatchReceiptSchema,
  type VideoConfiguredRuntimeSnapshot, type VideoConfiguredSavedConfiguration } from "./videoConfiguredRuntimeContract";
import { captureVideoWorkflowSource, videoWorkflowRows as rows, videoWorkflowStatement as statement,
  videoWorkflowJson as json, videoWorkflowFail as fail, VideoWorkflowRepositoryError, type VideoWorkflowExecutor } from "./videoWorkflowSource";
import { assertVideoWorkflowSchema } from "./videoWorkflowSource";
export { VideoWorkflowRepositoryError } from "./videoWorkflowSource";
export const VIDEO_WORKFLOW_JOB_KIND = "video.workflow.configured.v1";
export const VIDEO_WORKFLOW_SOURCE_KEY = "video.workflow.source.v1";
export const VIDEO_WORKFLOW_CANDIDATE_KEY = "video.workflow.candidate.v1";
export const VIDEO_WORKFLOW_APPLY_KEY = "video.workflow.revision.v1";
export interface VideoWorkflowDatabase { transaction<T>(body: (tx: VideoWorkflowExecutor) => Promise<T>): Promise<T> }
type Action = "read" | "run" | "confirm" | "cancel" | "update";
const hash = VideoWorkflowHashSchema, uuid = VideoWorkflowUuidSchema, id = VideoWorkflowIdSchema;
const code = z.string().regex(/^[A-Z][A-Z0-9_]{0,159}$/u);
const equal = (a: unknown, b: unknown) => videoWorkflowCanonical(a) === videoWorkflowCanonical(b);
const runtimeSchema = VideoConfiguredRuntimeSnapshotSchema;
const configSchema = VideoConfiguredSavedConfigurationSchema.refine(value => value.agentKey === "video");
const inputSchema = z.object({ version: z.literal(1), identity: VideoWorkflowIdentitySchema, request: VideoWorkflowStartInputSchema,
  requestHash: hash, sourceArtifactId: z.string().min(1).max(80), sourceHash: hash,
  configuration: configSchema, runtimeSnapshot: runtimeSchema }).strict();
const dispatchSchema = z.object({ receipt: VideoConfiguredDispatchReceiptSchema, contextHash: hash, snapshotHash: hash, bindingHash: hash, providerRequestHash: hash }).strict();
const outputSchema = z.object({ version: z.literal(1), state: z.enum(["queued", "running", "dispatched", "succeeded", "failed", "canceled", "outcome_unknown"]),
  dispatch: dispatchSchema.nullable(), candidateArtifactId: z.string().min(1).max(80).nullable(), resultHash: hash.nullable(), errorCode: code.nullable() }).strict();
const startReceiptSchema = z.object({ identity: VideoWorkflowIdentitySchema, scope: VideoWorkflowOperationInputSchema,
  status: z.enum(["reserved", "cancelled"]), requestHash: hash.nullable(), runId: z.string().min(1).max(80).nullable() }).strict();
type StartReceipt = z.infer<typeof startReceiptSchema>;
export type VideoWorkflowRun = z.infer<typeof inputSchema> & z.infer<typeof outputSchema> & {
  id: number; runId: string; source: VideoWorkflowSource; candidate: Record<string, unknown> | null;
  lockedBy: string | null; leaseUntil: number | null; createdAt: string;
};
export type VideoWorkflowLease = { identity: VideoWorkflowIdentity; scope: VideoWorkflowOperationInput; runId: string; token: string };
export type VideoWorkflowPreparation = { configuration: VideoConfiguredSavedConfiguration; runtimeSnapshot: VideoConfiguredRuntimeSnapshot };
export type VideoWorkflowPrepare = (tx: VideoWorkflowExecutor, source: VideoWorkflowSource) => Promise<VideoWorkflowPreparation>;
export type VideoWorkflowCandidateInput = { stage: string; candidate: unknown; runId: string; contextHash: string; snapshotHash: string; bindingHash: string; providerRequestHash: string };
export const videoWorkflowRunId = (identity: VideoWorkflowIdentity, operationId: string) => `vidw_${videoWorkflowHash({ identity: VideoWorkflowIdentitySchema.parse(identity), operationId: uuid.parse(operationId) })}`;
export const videoWorkflowRequestHash = (identity: VideoWorkflowIdentity, input: VideoWorkflowStartInput | VideoWorkflowApplyInput) => videoWorkflowHash({ identity, request: input });
function operation(input: VideoWorkflowOperationInput): VideoWorkflowOperationInput {
  return { expectedWorkspaceId: input.expectedWorkspaceId, projectId: input.projectId, videoScriptId: input.videoScriptId, operationId: input.operationId };
}
const terminal = (state: VideoWorkflowRun["state"]) => ["succeeded", "failed", "canceled", "outcome_unknown"].includes(state);
const dbState = (state: VideoWorkflowRun["state"]) => state === "outcome_unknown" ? "failed" : state === "dispatched" ? "running" : state;
async function write(tx: VideoWorkflowExecutor, text: string, params: unknown[]) {
  const packet = await rows(tx, "SELECT @@max_allowed_packet AS maximumPacket", [], 1);
  if (packet.length !== 1 || !Number.isSafeInteger(Number(packet[0].maximumPacket)) || Number(packet[0].maximumPacket) < 4096 + Buffer.byteLength(text)
    + params.reduce<number>((sum, value) => sum + (typeof value === "string" ? Buffer.byteLength(value) : 64), 0)) fail("PACKET_LIMIT");
  const result = await tx.execute(statement(text, params));
  if (!Array.isArray(result) || !result[0] || typeof result[0] !== "object" || result[0].affectedRows !== 1 || result[0].warningStatus !== 0) fail("WRITE_UNCONFIRMED");
}
export async function authorizeVideoWorkflow(tx: VideoWorkflowExecutor, identity: VideoWorkflowIdentity, scope: { expectedWorkspaceId: number; projectId: number; videoScriptId?: number }, action: Action, permission: typeof assertResourceAction = assertResourceAction) {
  const spaces = await rows(tx, "SELECT id,status FROM workspaces WHERE id=? FOR SHARE", [identity.workspaceId], 1);
  const actors = await rows(tx, "SELECT id,role,status,defaultWorkspaceId FROM users WHERE id=? FOR SHARE", [identity.userId], 1), actor = actors[0];
  const members = await rows(tx, "SELECT id,workspaceId,userId,status FROM workspace_memberships WHERE workspaceId=? AND userId=? ORDER BY id LIMIT 2 FOR SHARE", [identity.workspaceId, identity.userId], 2);
  if (spaces.length !== 1 || spaces[0].id !== identity.workspaceId || spaces[0].status !== "active" || !actor || actor.id !== identity.userId
    || actor.status !== "active" || actor.defaultWorkspaceId !== identity.workspaceId || typeof actor.role !== "string" || !actor.role
    || members.length !== 1 || !id.safeParse(members[0].id).success || members[0].workspaceId !== identity.workspaceId || members[0].userId !== identity.userId || members[0].status !== "active") fail("ACCESS_DENIED");
  if (actor.role !== "super_admin") {
    const records = await rows(tx, "SELECT id,workspaceId,role,IF(OCTET_LENGTH(modules)<=65536,modules,NULL) AS modules,IF(detailedPermissions IS NULL OR OCTET_LENGTH(detailedPermissions)<=65536,detailedPermissions,NULL) AS detailedPermissions FROM role_permissions WHERE role=? AND (workspaceId=? OR workspaceId IS NULL) ORDER BY workspaceId IS NULL,id LIMIT 3 FOR SHARE", [actor.role, identity.workspaceId], 2);
    if (records.some(row => !id.safeParse(row.id).success || row.role !== actor.role || row.workspaceId !== null && row.workspaceId !== identity.workspaceId) || new Set(records.map(row => row.workspaceId)).size !== records.length) fail("ACCESS_DENIED");
    const selected = records.find(row => row.workspaceId === identity.workspaceId) ?? records.find(row => row.workspaceId === null);
    const modules = selected ? z.array(z.string().min(1).max(100)).max(100).parse(json(selected.modules, 65536)) : ROLE_MODULE_ACCESS[actor.role] ?? [];
    if (!modules.includes("listing") || ["run", "confirm"].includes(action) && !modules.includes("emperor")) fail("ACCESS_DENIED");
    if (selected?.detailedPermissions !== null && selected?.detailedPermissions !== undefined) {
      const operations = z.array(z.enum(["read", "edit", "delete"])).max(3);
      const details = z.array(z.object({ moduleId: z.string().min(1).max(100), operations, subModules: z.array(z.object({ subModuleId: z.string().min(1).max(100), operations }).strict()).max(100).optional() }).strict()).max(100).parse(json(selected.detailedPermissions, 65536));
      if (new Set(details.map(row => row.moduleId)).size !== details.length || details.some(row => row.subModules && new Set(row.subModules.map(sub => sub.subModuleId)).size !== row.subModules.length)) fail("ACCESS_DENIED");
      for (const [moduleId, subModuleId] of [["listing", "listing_projects"], ...(["run", "confirm"].includes(action) ? [["emperor", "emperor_agents"]] : [])]) {
        const module = details.find(row => row.moduleId === moduleId), allowed = module?.subModules?.length ? module.subModules.find(row => row.subModuleId === subModuleId)?.operations : module?.operations;
        if (!allowed?.includes("read") || action !== "read" && !allowed.includes("edit")) fail("ACCESS_DENIED");
      }
    }
  }
  const parents = await rows(tx, "SELECT id,workspaceId,userId FROM projects WHERE id=? FOR UPDATE", [scope.projectId], 1), parent = parents[0];
  const sessions = scope.videoScriptId === undefined ? [] : await rows(tx, "SELECT id,projectId,userId FROM video_scripts WHERE id=? AND projectId=? FOR UPDATE", [scope.videoScriptId, scope.projectId], 1);
  if (!parent || parent.id !== scope.projectId || parent.workspaceId !== identity.workspaceId || !id.safeParse(parent.userId).success
    || scope.videoScriptId !== undefined && (sessions.length !== 1 || sessions[0].id !== scope.videoScriptId || sessions[0].projectId !== scope.projectId || !id.safeParse(sessions[0].userId).success)) fail("ACCESS_DENIED");
  const common = { actor: { id: identity.userId, role: actor.role, defaultWorkspaceId: identity.workspaceId }, workspaceId: identity.workspaceId,
    projectId: scope.projectId, authorizationRead: { executor: tx as DbExecutor, strict: true as const, lock: true as const, lockMode: "share" as const } };
  try {
    await permission({ ...common, resource: "project", resourceId: scope.projectId, ownerUserId: Number(parent.userId), action: "read" });
    if (action !== "read") await permission({ ...common, resource: "project", resourceId: scope.projectId, ownerUserId: Number(parent.userId), action: "update" });
    if (["run", "confirm"].includes(action)) {
      await permission({ ...common, resource: "agent", resourceId: "video", action: "read" });
      await permission({ ...common, resource: "agent", resourceId: "video", action });
    }
  } catch { return fail("ACCESS_DENIED"); }
  return { role: actor.role };
}
const auditId = (identity: VideoWorkflowIdentity, operationId: string, kind: string) => `vidw_${kind}_${videoWorkflowHash({ identity, operationId })}`;
async function auditRead<T>(tx: VideoWorkflowExecutor, identity: VideoWorkflowIdentity, scope: VideoWorkflowOperationInput, kind: "start" | "cancel" | "apply", schema: z.ZodType<T>): Promise<T | null> {
  const key = auditId(identity, scope.operationId, kind), found = await rows(tx, "SELECT auditId,workspaceId,actorUserId,action,resourceType,resourceId,projectId,status,riskLevel,IF(OCTET_LENGTH(metadata)<=65536,metadata,NULL) AS metadata FROM security_audit_logs WHERE auditId=? AND BINARY auditId=BINARY ? LIMIT 2 FOR UPDATE", [key, key], 1);
  if (!found.length) return null;
  const row = found[0];
  if (row.auditId !== key || row.workspaceId !== identity.workspaceId || row.actorUserId !== identity.userId || row.projectId !== scope.projectId
    || row.action !== `video.workflow.${kind}` || row.resourceType !== "video_workflow" || row.resourceId !== scope.operationId || row.status !== "success" || row.riskLevel !== "medium") fail("JOURNAL_INVALID");
  const parsed = z.object({ version: z.literal(1), identity: VideoWorkflowIdentitySchema, scope: VideoWorkflowOperationInputSchema, receipt: schema }).strict().parse(json(row.metadata, 65536));
  if (!equal(parsed.identity, identity) || !equal(parsed.scope, operation(scope))) fail("OPERATION_SCOPE_CONFLICT");
  return parsed.receipt;
}
async function auditPut<T>(tx: VideoWorkflowExecutor, identity: VideoWorkflowIdentity, scope: VideoWorkflowOperationInput, role: string, kind: "start" | "cancel" | "apply", receipt: T, schema: z.ZodType<T>) {
  const old = await auditRead(tx, identity, scope, kind, schema);
  if (old) { if (!equal(old, receipt)) fail("OPERATION_CONTENT_CONFLICT"); return old; }
  const body = videoWorkflowCanonical({ version: 1, identity, scope: operation(scope), receipt: schema.parse(receipt) });
  if (Buffer.byteLength(body) > 65536) fail("JOURNAL_LIMIT");
  await write(tx, "INSERT INTO security_audit_logs (auditId,workspaceId,actorUserId,actorRole,action,resourceType,resourceId,projectId,status,riskLevel,beforeSnapshot,afterSnapshot,metadata) VALUES (?,?,?,?,?,'video_workflow',?,?,'success','medium',NULL,NULL,?)",
    [auditId(identity, scope.operationId, kind), identity.workspaceId, identity.userId, role, `video.workflow.${kind}`, scope.operationId, scope.projectId, body]);
  const actual = await auditRead(tx, identity, scope, kind, schema); if (!equal(actual, receipt)) fail("JOURNAL_READBACK_INVALID"); return schema.parse(actual);
}
async function artifactRead(tx: VideoWorkflowExecutor, identity: VideoWorkflowIdentity, scope: VideoWorkflowScope, artifactId: string, artifactKey: string, runId: string) {
  const found = await rows(tx, "SELECT workspaceId,userId,artifactId,domain,artifactKey,artifactType,sourceType,sourceId,sourceTable,sourceRowId,runId,agentSlug,projectId,status,version,isCurrent,IF(OCTET_LENGTH(contentJson)<=8388608,contentJson,NULL) AS contentJson,contentHash,metadata,sourceAiJobRunId FROM ai_artifacts WHERE artifactId=? AND BINARY artifactId=BINARY ? LIMIT 2 FOR SHARE", [artifactId, artifactId], 1);
  const row = found[0]; if (!row) fail("ARTIFACT_MISSING");
  const body = json(row.contentJson);
  if (row.workspaceId !== identity.workspaceId || row.userId !== identity.userId || row.artifactId !== artifactId || row.domain !== "video" || row.artifactKey !== artifactKey
    || row.artifactType !== "json" || row.sourceType !== "system" || row.sourceId !== String(scope.videoScriptId) || row.sourceTable !== "video_scripts"
    || row.sourceRowId !== String(scope.videoScriptId) || row.runId !== runId || row.agentSlug !== "video" || row.projectId !== scope.projectId || row.status !== "draft"
    || row.version !== 1 || row.isCurrent !== 0 || row.contentHash !== videoWorkflowHash(body) || row.sourceAiJobRunId !== runId
    || !equal(json(row.metadata), { version: 1, kind: VIDEO_WORKFLOW_JOB_KIND, scope })) fail("ARTIFACT_INVALID");
  return body;
}
async function artifactPut(tx: VideoWorkflowExecutor, identity: VideoWorkflowIdentity, scope: VideoWorkflowScope, artifactId: string, artifactKey: string, runId: string, content: unknown) {
  await write(tx, "INSERT INTO ai_artifacts (workspaceId,artifactId,domain,artifactKey,artifactType,sourceType,sourceId,sourceTable,sourceRowId,runId,agentSlug,projectId,userId,status,version,isCurrent,contentJson,contentHash,metadata,sourceAiJobRunId) VALUES (?,?,'video',?,'json','system',?,'video_scripts',?,?,'video',?,?,'draft',1,0,?,?,?,?)",
    [identity.workspaceId, artifactId, artifactKey, String(scope.videoScriptId), String(scope.videoScriptId), runId, scope.projectId, identity.userId,
      videoWorkflowCanonical(content), videoWorkflowHash(content), videoWorkflowCanonical({ version: 1, kind: VIDEO_WORKFLOW_JOB_KIND, scope }), runId]);
  if (!equal(await artifactRead(tx, identity, scope, artifactId, artifactKey, runId), content)) fail("ARTIFACT_READBACK_INVALID");
}
const projection = "id,workspaceId,userId,projectId,runId,kind,module,`procedure`,queueName,status,attempt,maxAttempts,lockedBy,UNIX_TIMESTAMP(leaseUntil) AS leaseUntil,DATE_FORMAT(createdAt,'%Y-%m-%dT%H:%i:%s.%fZ') AS createdAt,completedAt,IF(OCTET_LENGTH(input)<=8388608,input,NULL) AS input,IF(OCTET_LENGTH(output)<=1048576,output,NULL) AS output";
function outputOf(run: VideoWorkflowRun) { return outputSchema.parse({ version: 1, state: run.state, dispatch: run.dispatch, candidateArtifactId: run.candidateArtifactId, resultHash: run.resultHash, errorCode: run.errorCode }); }
function verifyDispatch(snapshot: VideoConfiguredRuntimeSnapshot, value: z.infer<typeof dispatchSchema>) {
  if (value.snapshotHash !== snapshot.snapshotHash || value.receipt.stage !== snapshot.stage
    || value.receipt.requestHash !== value.providerRequestHash || value.receipt.bindingHash !== value.bindingHash
    || value.receipt.modelConfigurationHash !== snapshot.model.configurationHash || value.receipt.budget.imageCount !== 0 || value.receipt.budget.imageBytes !== 0
    || value.receipt.budget.outputTokens !== snapshot.skill.maxTokens || value.receipt.budget.contextLimit !== snapshot.model.model.maxContextTokens
    || !equal(value.receipt.budget, snapshot.budgetPlan.budget)
    || value.bindingHash !== videoWorkflowHash({ schema: "video-configured-stage/v1", stage: snapshot.stage, snapshotHash: value.snapshotHash, contextHash: value.contextHash, providerRequestHash: value.providerRequestHash })) fail("DISPATCH_INVALID");
}
async function load(tx: VideoWorkflowExecutor, identity: VideoWorkflowIdentity, scope: VideoWorkflowOperationInput): Promise<VideoWorkflowRun | null> {
  const runId = videoWorkflowRunId(identity, scope.operationId), found = await rows(tx, `SELECT ${projection} FROM ai_jobs WHERE runId=? AND BINARY runId=BINARY ? LIMIT 2 FOR UPDATE`, [runId, runId], 1);
  if (!found.length) return null;
  const row = found[0], input = inputSchema.parse(json(row.input)), output = outputSchema.parse(json(row.output, 1048576));
  if (!id.safeParse(row.id).success || row.workspaceId !== identity.workspaceId || row.userId !== identity.userId || row.projectId !== scope.projectId || row.runId !== runId
    || row.kind !== VIDEO_WORKFLOW_JOB_KIND || row.module !== "video" || row.procedure !== "videoScript.workflowStart" || row.queueName !== "video_workflow"
    || row.maxAttempts !== 1 || ![0, 1].includes(Number(row.attempt)) || !equal(input.identity, identity) || !equal(operation(input.request), operation(scope))
    || row.status !== dbState(output.state) || typeof row.createdAt !== "string" || terminal(output.state) !== (row.completedAt !== null)
    || row.lockedBy !== null && (typeof row.lockedBy !== "string" || row.lockedBy.length > 128)
    || (row.lockedBy === null) !== (row.leaseUntil === null) || row.leaseUntil !== null && (!Number.isFinite(Number(row.leaseUntil)) || Number(row.leaseUntil) <= 0)
    || terminal(output.state) && row.lockedBy !== null) fail("RUN_INVALID");
  if (input.requestHash !== videoWorkflowRequestHash(identity, input.request) || input.sourceHash !== input.request.expectedSourceHash
    || input.runtimeSnapshot.operation !== input.request.operation
    || input.runtimeSnapshot.snapshotHash !== input.request.expectedRuntimeHash || input.runtimeSnapshot.operationId !== scope.operationId
    || !equal(input.runtimeSnapshot.identity, identity) || input.runtimeSnapshot.sourceHash !== input.sourceHash
    || input.runtimeSnapshot.configuration.hash !== input.configuration.hash || input.runtimeSnapshot.configuration.revision !== input.configuration.revision) fail("IMMUTABLE_CHANGED");
  const sourceScope = VideoWorkflowScopeSchema.parse({ expectedWorkspaceId: scope.expectedWorkspaceId, projectId: scope.projectId, videoScriptId: scope.videoScriptId });
  const source = VideoWorkflowSourceSchema.parse(await artifactRead(tx, identity, sourceScope, input.sourceArtifactId, VIDEO_WORKFLOW_SOURCE_KEY, runId));
  if (source.sourceHash !== input.sourceHash || !equal(source.identity, identity) || !equal(source.scope, sourceScope)) fail("SOURCE_BINDING_INVALID");
  if (output.dispatch) verifyDispatch(input.runtimeSnapshot, output.dispatch);
  if (["dispatched", "succeeded", "outcome_unknown"].includes(output.state) && !output.dispatch || (output.candidateArtifactId === null) !== (output.resultHash === null)
    || (output.state === "succeeded") !== (output.resultHash !== null)) fail("STATE_INVALID");
  let candidate: VideoWorkflowRun["candidate"] = null;
  if (output.candidateArtifactId) {
    const body = z.object({ version: z.literal(1), candidate: z.record(z.string(), z.unknown()), resultHash: hash, dispatchHash: hash }).strict().parse(
      await artifactRead(tx, identity, sourceScope, output.candidateArtifactId, VIDEO_WORKFLOW_CANDIDATE_KEY, runId));
    if (body.resultHash !== output.resultHash || body.resultHash !== videoWorkflowHash(body.candidate) || body.dispatchHash !== videoWorkflowHash(output.dispatch)) fail("CANDIDATE_INVALID");
    candidate = parseVideoWorkflowCandidate(input.request.operation, body.candidate);
  }
  return { ...input, ...output, id: Number(row.id), runId, source, candidate, lockedBy: row.lockedBy as string | null, leaseUntil: row.leaseUntil === null ? null : Number(row.leaseUntil), createdAt: row.createdAt };
}
async function update(tx: VideoWorkflowExecutor, run: VideoWorkflowRun, token: string | null = run.lockedBy, claim = false) {
  const release = terminal(run.state), body = outputOf(run);
  await write(tx, `UPDATE ai_jobs SET status=?,output=?,errorMessage=?,progress=?,lockedBy=?,leaseUntil=${release ? "NULL" : "DATE_ADD(NOW(6),INTERVAL 120 SECOND)"},lastHeartbeatAt=NOW(6),completedAt=${release ? "NOW(6)" : "NULL"},${claim ? "attempt=1,startedAt=COALESCE(startedAt,NOW(6)),claimedAt=NOW(6)," : ""}updatedAt=NOW(6) WHERE id=? AND runId=? AND workspaceId=? AND userId=? AND kind=?`,
    [dbState(run.state), videoWorkflowCanonical(body), run.errorCode, run.state === "succeeded" ? 100 : run.state === "dispatched" ? 50 : 0, release ? null : token,
      run.id, run.runId, run.identity.workspaceId, run.identity.userId, VIDEO_WORKFLOW_JOB_KIND]);
  const actual = await load(tx, run.identity, operation(run.request));
  if (!actual || !equal(outputOf(actual), body) || actual.lockedBy !== (release ? null : token)) fail("JOB_READBACK_INVALID");
  return actual;
}

/** One owner/private operation over existing InnoDB jobs, artifacts and audit.
 * No method performs network I/O or calls a provider while holding a DB lock. */
export function createVideoWorkflowRepository(deps: { getDb?: () => Promise<VideoWorkflowDatabase | null>; permission?: typeof assertResourceAction;
  capture?: typeof captureVideoWorkflowSource; schemaReady?: typeof assertVideoWorkflowSchema;
  enabled?: () => boolean; token?: () => string } = {}) {
  const getDb = deps.getDb ?? (() => requireDb("Video workflow")), permission = deps.permission ?? assertResourceAction,
    capture = deps.capture ?? captureVideoWorkflowSource, schemaReady = deps.schemaReady ?? assertVideoWorkflowSchema,
    enabled = deps.enabled ?? (() => process.env.ENABLE_VIDEO_WORKFLOW_WRITES === "true");
  const gate = () => { if (!enabled()) fail("WRITES_DISABLED"); };
  async function invoke<T>(identity: VideoWorkflowIdentity, scope: VideoWorkflowScope, action: Action, writing: boolean, body: (tx: VideoWorkflowExecutor, role: string) => Promise<T>): Promise<T> {
    VideoWorkflowIdentitySchema.parse(identity); VideoWorkflowScopeSchema.parse({ expectedWorkspaceId: scope.expectedWorkspaceId, projectId: scope.projectId, videoScriptId: scope.videoScriptId });
    if (identity.workspaceId !== scope.expectedWorkspaceId) fail("ACCESS_DENIED");
    try {
      const database = await getDb(); if (!database || typeof database.transaction !== "function") fail("TRANSACTION_REQUIRED");
      return await database.transaction(async tx => { await schemaReady(tx); const actor = await authorizeVideoWorkflow(tx, identity, scope, action, permission); return body(tx, actor.role); });
    } catch (error) {
      if (error instanceof VideoWorkflowRepositoryError) throw error;
      if (error instanceof TRPCError && ["FORBIDDEN", "UNAUTHORIZED"].includes(error.code)) return fail("ACCESS_DENIED");
      throw new VideoWorkflowRepositoryError(writing ? "OUTCOME_UNVERIFIED" : "READ_UNAVAILABLE", writing);
    }
  }
  async function source(tx: VideoWorkflowExecutor, identity: VideoWorkflowIdentity, scope: VideoWorkflowOptionsInput) {
    const value = VideoWorkflowSourceSchema.parse(await capture(tx, identity, VideoWorkflowOptionsInputSchema.parse({ expectedWorkspaceId: scope.expectedWorkspaceId, projectId: scope.projectId, videoScriptId: scope.videoScriptId, operationId: scope.operationId, operation: scope.operation, competitorScriptId: scope.competitorScriptId }), permission));
    if (!equal(value.identity, identity) || value.scope.projectId !== scope.projectId || value.scope.videoScriptId !== scope.videoScriptId) fail("SOURCE_BINDING_INVALID"); return value;
  }
  async function state(tx: VideoWorkflowExecutor, identity: VideoWorkflowIdentity, scope: VideoWorkflowOperationInput) {
    const started = await auditRead(tx, identity, scope, "start", startReceiptSchema), canceled = await auditRead(tx, identity, scope, "cancel", startReceiptSchema), run = await load(tx, identity, scope);
    if (run && (!started || started.status !== "reserved" || started.requestHash !== run.requestHash || started.runId !== run.runId)
      || started?.status === "reserved" && !run || canceled && (canceled.status !== "cancelled" || run && run.state !== "canceled")) fail("START_JOURNAL_INVALID");
    return { run, receipt: canceled ?? started };
  }
  async function prepare(tx: VideoWorkflowExecutor, current: VideoWorkflowSource, operationId: string, fn: VideoWorkflowPrepare) {
    const raw = await fn(tx, current), configuration = configSchema.parse(raw.configuration), runtimeSnapshot = runtimeSchema.parse(raw.runtimeSnapshot);
    if (configuration.workspaceId !== current.identity.workspaceId || !configuration.config.enabled || !equal(runtimeSnapshot.identity, current.identity)
      || runtimeSnapshot.operationId !== operationId || runtimeSnapshot.sourceHash !== current.sourceHash || runtimeSnapshot.configuration.hash !== configuration.hash
      || runtimeSnapshot.configuration.revision !== configuration.revision || runtimeSnapshot.operation !== current.operation) fail("RUNTIME_BINDING_INVALID");
    return { configuration, runtimeSnapshot };
  }
  async function now(tx: VideoWorkflowExecutor) { const result = await rows(tx, "SELECT UNIX_TIMESTAMP(NOW(6)) AS currentTime", [], 1); const value = Number(result[0]?.currentTime); if (result.length !== 1 || !Number.isFinite(value) || value <= 0) fail("CLOCK_UNAVAILABLE"); return value; }
  async function leased(tx: VideoWorkflowExecutor, lease: VideoWorkflowLease, freshSource: boolean) {
    const found = await state(tx, lease.identity, lease.scope), run = found.run;
    const current = freshSource && run ? await source(tx, lease.identity, run.request) : null;
    if (!run || !["running", "dispatched"].includes(run.state) || run.runId !== lease.runId || run.lockedBy !== lease.token || run.leaseUntil === null || run.leaseUntil <= await now(tx)
      || found.receipt?.status === "cancelled") fail("LEASE_LOST");
    if (current && current.sourceHash !== run.sourceHash) fail("SOURCE_CHANGED"); return { run, source: current };
  }
  return {
    readSource(identity: VideoWorkflowIdentity, input: VideoWorkflowOptionsInput) { return invoke(identity, input, "read", false, tx => source(tx, identity, input)); },
    preview(identity: VideoWorkflowIdentity, input: VideoWorkflowOptionsInput, fn: VideoWorkflowPrepare) { return invoke(identity, input, "run", false, async tx => { const current = await source(tx, identity, input); return { source: current, ...await prepare(tx, current, input.operationId, fn) }; }); },
    reserve(identity: VideoWorkflowIdentity, raw: VideoWorkflowStartInput, fn: VideoWorkflowPrepare) {
      const input = VideoWorkflowStartInputSchema.parse(raw);
      return invoke(identity, input, "run", true, async (tx, role) => {
        const old = await state(tx, identity, operation(input)), requestHash = videoWorkflowRequestHash(identity, input);
        if (old.receipt?.status === "cancelled") fail("OPERATION_CANCELED");
        if (old.run) { if (old.run.requestHash !== requestHash) fail("OPERATION_CONTENT_CONFLICT"); return old.run; }
        gate(); const current = await source(tx, identity, input); if (current.sourceHash !== input.expectedSourceHash) fail("SOURCE_CHANGED");
        const active = await rows(tx, "SELECT runId FROM ai_jobs WHERE kind=? AND workspaceId=? AND projectId=? AND JSON_EXTRACT(input,'$.request.videoScriptId')=? AND (status IN ('queued','running') OR JSON_UNQUOTE(JSON_EXTRACT(output,'$.state'))='outcome_unknown') ORDER BY id LIMIT 2 FOR UPDATE", [VIDEO_WORKFLOW_JOB_KIND, identity.workspaceId, input.projectId, input.videoScriptId], 1);
        if (active.length) fail("ACTIVE_OPERATION_EXISTS");
        const legacy = await rows(tx, "SELECT runId FROM ai_jobs WHERE kind=? AND workspaceId=? AND projectId=? AND JSON_EXTRACT(input,'$.videoScriptId')=? AND status IN ('queued','running') ORDER BY id LIMIT 2 FOR UPDATE", ["video.generation", identity.workspaceId, input.projectId, input.videoScriptId], 1);
        if (legacy.length) fail("LEGACY_OPERATION_ACTIVE");
        const prepared = await prepare(tx, current, input.operationId, fn);
        if (prepared.runtimeSnapshot.snapshotHash !== input.expectedRuntimeHash) fail("RUNTIME_CHANGED");
        if (prepared.runtimeSnapshot.budgetPlan.maxCostCentsTotal > input.maxCostCents) fail("COST_AUTHORIZATION_EXCEEDED");
        const runId = videoWorkflowRunId(identity, input.operationId), sourceArtifactId = `vidw_src_${videoWorkflowHash({ identity, operationId: input.operationId })}`;
        const value = inputSchema.parse({ version: 1, identity, request: input, requestHash, sourceArtifactId, sourceHash: current.sourceHash, ...prepared });
        const output = outputSchema.parse({ version: 1, state: "queued", dispatch: null, candidateArtifactId: null, resultHash: null, errorCode: null }); gate();
        await artifactPut(tx, identity, current.scope, sourceArtifactId, VIDEO_WORKFLOW_SOURCE_KEY, runId, current);
        await write(tx, "INSERT INTO ai_jobs (workspaceId,runId,kind,module,`procedure`,status,queueName,attempt,maxAttempts,userId,projectId,skillSlug,input,output) VALUES (?,?,?,'video','videoScript.workflowStart','queued','video_workflow',0,1,?,?,?,?,?)",
          [identity.workspaceId, runId, VIDEO_WORKFLOW_JOB_KIND, identity.userId, input.projectId, prepared.runtimeSnapshot.skill.slug, videoWorkflowCanonical(value), videoWorkflowCanonical(output)]);
        const run = await load(tx, identity, operation(input)); if (!run || run.requestHash !== requestHash || !equal(outputOf(run), output)) fail("JOB_READBACK_INVALID");
        await auditPut(tx, identity, operation(input), role, "start", { identity, scope: operation(input), status: "reserved", requestHash, runId }, startReceiptSchema); return run;
      });
    },
    check(identity: VideoWorkflowIdentity, input: VideoWorkflowOperationInput) { VideoWorkflowOperationInputSchema.parse(input); return invoke(identity, input, "read", false, tx => state(tx, identity, input)); },
    cancel(identity: VideoWorkflowIdentity, input: VideoWorkflowOperationInput) { VideoWorkflowOperationInputSchema.parse(input); return invoke(identity, input, "cancel", true, async (tx, role) => {
      const old = await state(tx, identity, input); if (old.receipt?.status === "cancelled" || old.run?.state === "succeeded") return old;
      if (old.run) { old.run.state = "canceled"; old.run.errorCode = "OPERATION_CANCELED"; await update(tx, old.run); }
      const receipt = await auditPut(tx, identity, input, role, "cancel", startReceiptSchema.parse({ identity, scope: operation(input), status: "cancelled", requestHash: old.run?.requestHash ?? null, runId: old.run?.runId ?? null }), startReceiptSchema);
      return { run: old.run ? await load(tx, identity, input) : null, receipt };
    }); },
    history(identity: VideoWorkflowIdentity, input: VideoWorkflowScope) { return invoke(identity, input, "read", false, async tx => {
      const found = await rows(tx, "SELECT runId,IF(OCTET_LENGTH(JSON_EXTRACT(input,'$.request'))<=16384,JSON_EXTRACT(input,'$.request'),NULL) AS request,JSON_UNQUOTE(JSON_EXTRACT(input,'$.requestHash')) AS requestHash,JSON_UNQUOTE(JSON_EXTRACT(input,'$.sourceHash')) AS sourceHash,status,JSON_UNQUOTE(JSON_EXTRACT(output,'$.state')) AS logicalState,DATE_FORMAT(createdAt,'%Y-%m-%dT%H:%i:%s.%fZ') AS createdAt FROM ai_jobs WHERE kind=? AND workspaceId=? AND userId=? AND projectId=? AND JSON_EXTRACT(input,'$.request.videoScriptId')=? ORDER BY id DESC LIMIT 51 FOR SHARE", [VIDEO_WORKFLOW_JOB_KIND, identity.workspaceId, identity.userId, input.projectId, input.videoScriptId], 51);
      return { complete: found.length <= 50, operations: found.slice(0, 50).map(row => {
        const request = VideoWorkflowStartInputSchema.parse(json(row.request, 16384)), logical = outputSchema.shape.state.parse(row.logicalState);
        if (request.expectedWorkspaceId !== identity.workspaceId || request.projectId !== input.projectId || request.videoScriptId !== input.videoScriptId || row.runId !== videoWorkflowRunId(identity, request.operationId)
          || row.requestHash !== videoWorkflowRequestHash(identity, request) || row.sourceHash !== request.expectedSourceHash
          || row.status !== dbState(logical) || typeof row.createdAt !== "string") fail("HISTORY_INVALID");
        return { operationId: request.operationId, operation: request.operation, competitorScriptId: request.competitorScriptId, state: logical, sourceHash: request.expectedSourceHash, createdAt: row.createdAt };
      }) };
    }); },
    claim(identity: VideoWorkflowIdentity, input: VideoWorkflowOperationInput, workerId: string): Promise<VideoWorkflowLease | null> { return invoke(identity, input, "run", true, async tx => {
      gate(); if (!/^[a-zA-Z0-9_.:-]{1,80}$/u.test(workerId)) fail("WORKER_INVALID");
      const old = await state(tx, identity, input), run = old.run;
      if (!run || terminal(run.state) || run.leaseUntil !== null && run.leaseUntil > await now(tx)) return null;
      if (run.state === "dispatched") { run.state = "outcome_unknown"; run.errorCode = "DISPATCH_OUTCOME_UNKNOWN"; await update(tx, run); return null; }
      const current = await source(tx, identity, run.request);
      if (current.sourceHash !== run.sourceHash) { run.state = "failed"; run.errorCode = "SOURCE_CHANGED"; await update(tx, run); return null; }
      const token = `${workerId}:${uuid.parse((deps.token ?? randomUUID)())}`; run.state = "running"; await update(tx, run, token, true);
      return { identity, scope: operation(input), runId: run.runId, token };
    }); },
    prepareStage<T>(lease: VideoWorkflowLease, body: (tx: VideoWorkflowExecutor, run: VideoWorkflowRun, source: VideoWorkflowSource) => Promise<T>) { return invoke(lease.identity, lease.scope, "run", false, async tx => { gate(); const value = await leased(tx, lease, true); return body(tx, value.run, value.source!); }); },
    heartbeat(lease: VideoWorkflowLease) { return invoke(lease.identity, lease.scope, "run", true, async tx => update(tx, (await leased(tx, lease, false)).run)); },
    dispatch(lease: VideoWorkflowLease, value: z.infer<typeof dispatchSchema>, verify: (tx: VideoWorkflowExecutor, run: VideoWorkflowRun, source: VideoWorkflowSource) => Promise<void>) { return invoke(lease.identity, lease.scope, "run", true, async tx => {
      gate(); const current = await leased(tx, lease, true), run = current.run; if (run.state !== "running" || run.dispatch !== null) fail("ALREADY_DISPATCHED");
      const parsed = dispatchSchema.parse(value); verifyDispatch(run.runtimeSnapshot, parsed); await verify(tx, run, current.source!); gate();
      run.state = "dispatched"; run.dispatch = parsed; return update(tx, run);
    }); },
    candidate(lease: VideoWorkflowLease, value: VideoWorkflowCandidateInput) { return invoke(lease.identity, lease.scope, "run", true, async tx => {
      // Paid result persistence is allowed after local stop/flag-off; current
      // actor authorization, cancellation fence and original lease still apply.
      const { run } = await leased(tx, lease, false), dispatch = run.dispatch;
      if (run.state !== "dispatched" || !dispatch || value.stage !== run.runtimeSnapshot.stage || value.runId !== dispatch.receipt.runId || value.contextHash !== dispatch.contextHash
        || value.snapshotHash !== dispatch.snapshotHash || value.bindingHash !== dispatch.bindingHash || value.providerRequestHash !== dispatch.providerRequestHash) fail("RESULT_RECEIPT_INVALID");
      const candidate = parseVideoWorkflowCandidate(run.request.operation, value.candidate), resultHash = videoWorkflowHash(candidate), artifactId = `vidw_can_${videoWorkflowHash({ runId: run.runId })}`;
      await artifactPut(tx, lease.identity, run.source.scope, artifactId, VIDEO_WORKFLOW_CANDIDATE_KEY, run.runId, { version: 1, candidate, resultHash, dispatchHash: videoWorkflowHash(dispatch) });
      run.state = "succeeded"; run.resultHash = resultHash; run.candidateArtifactId = artifactId; return update(tx, run);
    }); },
    failure(lease: VideoWorkflowLease, reasonCode: string) { return invoke(lease.identity, lease.scope, "run", true, async tx => {
      const { run } = await leased(tx, lease, false); run.state = run.dispatch ? "outcome_unknown" : "failed";
      run.errorCode = run.dispatch ? "DISPATCH_OUTCOME_UNKNOWN" : code.safeParse(reasonCode).success ? reasonCode : "PROCESSING_FAILED"; return update(tx, run);
    }); },
    applyCheck(identity: VideoWorkflowIdentity, input: VideoWorkflowApplyOperationInput) { VideoWorkflowApplyOperationInputSchema.parse(input); return invoke(identity, input, "read", false, async tx => {
      const saved = await auditRead(tx, identity, input, "apply", VideoWorkflowApplyReceiptSchema); if (saved && !equal(saved.scope, input)) fail("OPERATION_SCOPE_CONFLICT"); return saved;
    }); },
    applyCancel(identity: VideoWorkflowIdentity, input: VideoWorkflowApplyOperationInput) { VideoWorkflowApplyOperationInputSchema.parse(input); return invoke(identity, input, "cancel", true, async (tx, role) => {
      const old = await auditRead(tx, identity, input, "apply", VideoWorkflowApplyReceiptSchema); if (old) { if (!equal(old.scope, input)) fail("OPERATION_SCOPE_CONFLICT"); return old; }
      return auditPut(tx, identity, input, role, "apply", VideoWorkflowApplyReceiptSchema.parse({ identity, scope: input, status: "cancelled", requestHash: null, afterHash: null, version: null, resultHash: null, reasonCode: "OPERATION_CANCELED" }), VideoWorkflowApplyReceiptSchema);
    }); },
    apply(identity: VideoWorkflowIdentity, raw: VideoWorkflowApplyInput) { const input = VideoWorkflowApplyInputSchema.parse(raw); return invoke(identity, input, "confirm", true, async (tx, role) => {
      const applyScope = VideoWorkflowApplyOperationInputSchema.parse({ ...operation(input), runOperationId: input.runOperationId });
      const old = await auditRead(tx, identity, input, "apply", VideoWorkflowApplyReceiptSchema), requestHash = videoWorkflowRequestHash(identity, input);
      if (old) { if (!equal(old.scope, applyScope) || old.status !== "committed" || old.requestHash !== requestHash) fail("OPERATION_CONTENT_CONFLICT"); return old; }
      gate(); const run = await load(tx, identity, { ...operation(input), operationId: input.runOperationId });
      if (!run || run.state !== "succeeded" || !run.candidate || run.resultHash !== input.expectedResultHash) fail("RESULT_NOT_READY");
      const current = await source(tx, identity, run.request);
      if (current.sourceHash !== input.expectedSourceHash || current.sourceHash !== run.sourceHash) fail("SOURCE_CHANGED");
      const applied = await applyVideoWorkflowCandidate(tx, current, run.candidate, input.replaceConfirmed, identity.userId);
      await projectVideoWorkflowAgent(tx, identity, current.scope, applied.tables, true, VIDEO_WORKFLOW_DEFINITIONS[run.request.operation].node);
      const receipt = VideoWorkflowApplyReceiptSchema.parse({ identity, scope: applyScope, status: "committed", requestHash, afterHash: applied.afterHash, version: applied.version, resultHash: run.resultHash, reasonCode: null });
      await artifactPut(tx, identity, current.scope, `vidw_rev_${videoWorkflowHash({ identity, operationId: input.operationId })}`, VIDEO_WORKFLOW_APPLY_KEY, run.runId, { version: 1, request: input, receipt, before: current.tables, after: applied.tables, candidate: run.candidate }); gate();
      return auditPut(tx, identity, input, role, "apply", receipt, VideoWorkflowApplyReceiptSchema);
    }); },
  };
}
