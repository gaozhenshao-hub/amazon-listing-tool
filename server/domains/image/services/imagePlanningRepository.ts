import { randomUUID } from "node:crypto";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { ROLE_MODULE_ACCESS } from "../../../../shared/const";
import { requireDb, type DbExecutor } from "../../../repositories/dbClient";
import { assertResourceAction } from "../../../services/securityGovernance";
import { ImagePlanningIdentitySchema, ImagePlanningScopeSchema, ImagePlanningOperationInputSchema, ImagePlanningStartInputSchema,
  ImagePlanningApplyInputSchema, ImagePlanningApplyOperationInputSchema, ImagePlanningApplyReceiptSchema, ImagePlanningSourceSchema,
  ImagePlanningOutlineSchema, ImagePlanningHashSchema, ImagePlanningUuidSchema, ImagePlanningIdSchema,
  imagePlanningHash, imagePlanningCanonical, type ImagePlanningIdentity, type ImagePlanningScope, type ImagePlanningOperationInput,
  type ImagePlanningStartInput, type ImagePlanningApplyInput, type ImagePlanningApplyOperationInput, type ImagePlanningSource } from "../../../../shared/imagePlanning";
import { ConfiguredBusinessRuntimeSnapshotSchema, ConfiguredBusinessSavedConfigurationSchema, ConfiguredBusinessDispatchReceiptSchema,
  type ConfiguredBusinessRuntimeSnapshot, type ConfiguredBusinessSavedConfiguration } from "../../ai_os/services/configuredBusinessRuntimeContract";
import { captureImagePlanningSource, assertImagePlanningSourceSchema, imagePlanningRows as rows, imagePlanningStatement as statement,
  imagePlanningJson as json, imagePlanningFail as fail, ImagePlanningRepositoryError, type ImagePlanningExecutor } from "./imagePlanningSource";
import { assertImagePlanningSchema } from "./imagePlanningSchemaAdmission";
export { ImagePlanningRepositoryError } from "./imagePlanningSource";
export const IMAGE_PLANNING_JOB_KIND = "image.workflow.outline.v1";
export const IMAGE_PLANNING_SOURCE_KEY = "image.workflow.outline.source.v1";
export const IMAGE_PLANNING_CANDIDATE_KEY = "image.workflow.outline.candidate.v1";
export const IMAGE_PLANNING_APPLY_KEY = "image.workflow.outline.apply.v1";
export interface ImagePlanningDatabase { transaction<T>(body: (tx: ImagePlanningExecutor) => Promise<T>): Promise<T> }
type Action = "read" | "run" | "confirm" | "cancel";
const hash = ImagePlanningHashSchema, uuid = ImagePlanningUuidSchema, id = ImagePlanningIdSchema;
const code = z.string().regex(/^[A-Z][A-Z0-9_]{0,159}$/u);
const equal = (a: unknown, b: unknown) => imagePlanningCanonical(a) === imagePlanningCanonical(b);
const runtimeSchema = ConfiguredBusinessRuntimeSnapshotSchema.refine(value => value.stage === "image_outline" && value.configuration.agentKey === "images");
const configSchema = ConfiguredBusinessSavedConfigurationSchema.refine(value => value.agentKey === "images");
const inputSchema = z.object({ version: z.literal(1), identity: ImagePlanningIdentitySchema, request: ImagePlanningStartInputSchema,
  requestHash: hash, sourceArtifactId: z.string().min(1).max(80), sourceHash: hash,
  configuration: configSchema, runtimeSnapshot: runtimeSchema }).strict();
const dispatchSchema = z.object({ receipt: ConfiguredBusinessDispatchReceiptSchema, contextHash: hash, snapshotHash: hash, bindingHash: hash, providerRequestHash: hash }).strict();
const outputSchema = z.object({ version: z.literal(1), state: z.enum(["queued", "running", "dispatched", "succeeded", "failed", "canceled", "outcome_unknown"]),
  dispatch: dispatchSchema.nullable(), candidateArtifactId: z.string().min(1).max(80).nullable(), resultHash: hash.nullable(), errorCode: code.nullable() }).strict();
const startReceiptSchema = z.object({ identity: ImagePlanningIdentitySchema, scope: ImagePlanningOperationInputSchema,
  status: z.enum(["reserved", "cancelled"]), requestHash: hash.nullable(), runId: z.string().min(1).max(80).nullable() }).strict();
type StartReceipt = z.infer<typeof startReceiptSchema>;
export type ImagePlanningRun = z.infer<typeof inputSchema> & z.infer<typeof outputSchema> & {
  id: number; runId: string; source: ImagePlanningSource; candidate: z.infer<typeof ImagePlanningOutlineSchema> | null;
  lockedBy: string | null; leaseUntil: number | null; createdAt: string;
};
export type ImagePlanningLease = { identity: ImagePlanningIdentity; scope: ImagePlanningOperationInput; runId: string; token: string };
export type ImagePlanningPreparation = { configuration: ConfiguredBusinessSavedConfiguration; runtimeSnapshot: ConfiguredBusinessRuntimeSnapshot };
export type ImagePlanningPrepare = (tx: ImagePlanningExecutor, source: ImagePlanningSource) => Promise<ImagePlanningPreparation>;
export type ImagePlanningCandidateInput = { stage: string; candidate: unknown; runId: string; contextHash: string; snapshotHash: string; bindingHash: string; providerRequestHash: string };
export const imagePlanningRunId = (identity: ImagePlanningIdentity, operationId: string) => `impl_${imagePlanningHash({ identity: ImagePlanningIdentitySchema.parse(identity), operationId: uuid.parse(operationId) })}`;
export const imagePlanningRequestHash = (identity: ImagePlanningIdentity, input: ImagePlanningStartInput | ImagePlanningApplyInput) => imagePlanningHash({ identity, request: input });
function operation(input: ImagePlanningOperationInput): ImagePlanningOperationInput {
  return { expectedWorkspaceId: input.expectedWorkspaceId, projectId: input.projectId, sessionId: input.sessionId, operationId: input.operationId };
}
const terminal = (state: ImagePlanningRun["state"]) => ["succeeded", "failed", "canceled", "outcome_unknown"].includes(state);
const dbState = (state: ImagePlanningRun["state"]) => state === "outcome_unknown" ? "failed" : state === "dispatched" ? "running" : state;
async function write(tx: ImagePlanningExecutor, text: string, params: unknown[]) {
  const packet = await rows(tx, "SELECT @@max_allowed_packet AS maximumPacket", [], 1);
  if (packet.length !== 1 || !Number.isSafeInteger(Number(packet[0].maximumPacket)) || Number(packet[0].maximumPacket) < 4096 + Buffer.byteLength(text)
    + params.reduce<number>((sum, value) => sum + (typeof value === "string" ? Buffer.byteLength(value) : 64), 0)) fail("PACKET_LIMIT");
  const result = await tx.execute(statement(text, params));
  if (!Array.isArray(result) || !result[0] || typeof result[0] !== "object" || result[0].affectedRows !== 1 || result[0].warningStatus !== 0) fail("WRITE_UNCONFIRMED");
}
async function authorize(tx: ImagePlanningExecutor, identity: ImagePlanningIdentity, scope: ImagePlanningScope, action: Action, permission: typeof assertResourceAction) {
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
      for (const [moduleId, subModuleId] of [["listing", "listing_image_workflow"], ...(["run", "confirm"].includes(action) ? [["emperor", "emperor_agents"]] : [])]) {
        const module = details.find(row => row.moduleId === moduleId), allowed = module?.subModules?.length ? module.subModules.find(row => row.subModuleId === subModuleId)?.operations : module?.operations;
        if (!allowed?.includes("read") || action !== "read" && !allowed.includes("edit")) fail("ACCESS_DENIED");
      }
    }
  }
  const parents = await rows(tx, "SELECT id,workspaceId,userId FROM projects WHERE id=? FOR UPDATE", [scope.projectId], 1), parent = parents[0];
  const sessions = await rows(tx, "SELECT id,projectId,userId FROM image_workflow_sessions WHERE id=? AND projectId=? FOR UPDATE", [scope.sessionId, scope.projectId], 1);
  if (!parent || parent.id !== scope.projectId || parent.workspaceId !== identity.workspaceId || !id.safeParse(parent.userId).success
    || sessions.length !== 1 || sessions[0].id !== scope.sessionId || sessions[0].projectId !== scope.projectId || sessions[0].userId !== identity.userId) fail("ACCESS_DENIED");
  const common = { actor: { id: identity.userId, role: actor.role, defaultWorkspaceId: identity.workspaceId }, workspaceId: identity.workspaceId,
    projectId: scope.projectId, authorizationRead: { executor: tx as DbExecutor, strict: true as const, lock: true as const, lockMode: "share" as const } };
  try {
    await permission({ ...common, resource: "project", resourceId: scope.projectId, ownerUserId: Number(parent.userId), action: "read" });
    await permission({ ...common, resource: "image_workflow", resourceId: scope.sessionId, ownerUserId: identity.userId, action: "read" });
    if (action !== "read") {
      await permission({ ...common, resource: "image_workflow", resourceId: scope.sessionId, ownerUserId: identity.userId, action: "update" });
      await permission({ ...common, resource: "image_workflow", resourceId: scope.sessionId, ownerUserId: identity.userId, action });
    }
    if (["run", "confirm"].includes(action)) {
      await permission({ ...common, resource: "agent", resourceId: "images", action: "read" });
      await permission({ ...common, resource: "agent", resourceId: "images", action });
    }
  } catch { return fail("ACCESS_DENIED"); }
  return { role: actor.role };
}
const auditId = (identity: ImagePlanningIdentity, operationId: string, kind: string) => `impl_${kind}_${imagePlanningHash({ identity, operationId })}`;
async function auditRead<T>(tx: ImagePlanningExecutor, identity: ImagePlanningIdentity, scope: ImagePlanningOperationInput, kind: "start" | "cancel" | "apply", schema: z.ZodType<T>): Promise<T | null> {
  const key = auditId(identity, scope.operationId, kind), found = await rows(tx, "SELECT auditId,workspaceId,actorUserId,action,resourceType,resourceId,projectId,status,riskLevel,IF(OCTET_LENGTH(metadata)<=65536,metadata,NULL) AS metadata FROM security_audit_logs WHERE auditId=? AND BINARY auditId=BINARY ? LIMIT 2 FOR UPDATE", [key, key], 1);
  if (!found.length) return null;
  const row = found[0];
  if (row.auditId !== key || row.workspaceId !== identity.workspaceId || row.actorUserId !== identity.userId || row.projectId !== scope.projectId
    || row.action !== `image.planning.${kind}` || row.resourceType !== "image_planning" || row.resourceId !== scope.operationId || row.status !== "success" || row.riskLevel !== "medium") fail("JOURNAL_INVALID");
  const parsed = z.object({ version: z.literal(1), identity: ImagePlanningIdentitySchema, scope: ImagePlanningOperationInputSchema, receipt: schema }).strict().parse(json(row.metadata, 65536));
  if (!equal(parsed.identity, identity) || !equal(parsed.scope, operation(scope))) fail("OPERATION_SCOPE_CONFLICT");
  return parsed.receipt;
}
async function auditPut<T>(tx: ImagePlanningExecutor, identity: ImagePlanningIdentity, scope: ImagePlanningOperationInput, role: string, kind: "start" | "cancel" | "apply", receipt: T, schema: z.ZodType<T>) {
  const old = await auditRead(tx, identity, scope, kind, schema);
  if (old) { if (!equal(old, receipt)) fail("OPERATION_CONTENT_CONFLICT"); return old; }
  const body = imagePlanningCanonical({ version: 1, identity, scope: operation(scope), receipt: schema.parse(receipt) });
  if (Buffer.byteLength(body) > 65536) fail("JOURNAL_LIMIT");
  await write(tx, "INSERT INTO security_audit_logs (auditId,workspaceId,actorUserId,actorRole,action,resourceType,resourceId,projectId,status,riskLevel,beforeSnapshot,afterSnapshot,metadata) VALUES (?,?,?,?,?,'image_planning',?,?,'success','medium',NULL,NULL,?)",
    [auditId(identity, scope.operationId, kind), identity.workspaceId, identity.userId, role, `image.planning.${kind}`, scope.operationId, scope.projectId, body]);
  const actual = await auditRead(tx, identity, scope, kind, schema); if (!equal(actual, receipt)) fail("JOURNAL_READBACK_INVALID"); return schema.parse(actual);
}
async function artifactRead(tx: ImagePlanningExecutor, identity: ImagePlanningIdentity, scope: ImagePlanningScope, artifactId: string, artifactKey: string, runId: string) {
  const found = await rows(tx, "SELECT workspaceId,userId,artifactId,domain,artifactKey,artifactType,sourceType,sourceId,sourceTable,sourceRowId,runId,agentSlug,projectId,status,version,isCurrent,IF(OCTET_LENGTH(contentJson)<=2097152,contentJson,NULL) AS contentJson,contentHash,metadata,sourceAiJobRunId FROM ai_artifacts WHERE artifactId=? AND BINARY artifactId=BINARY ? LIMIT 2 FOR SHARE", [artifactId, artifactId], 1);
  const row = found[0]; if (!row) fail("ARTIFACT_MISSING");
  const body = json(row.contentJson);
  if (row.workspaceId !== identity.workspaceId || row.userId !== identity.userId || row.artifactId !== artifactId || row.domain !== "image" || row.artifactKey !== artifactKey
    || row.artifactType !== "json" || row.sourceType !== "system" || row.sourceId !== String(scope.sessionId) || row.sourceTable !== "image_workflow_sessions"
    || row.sourceRowId !== String(scope.sessionId) || row.runId !== runId || row.agentSlug !== "images" || row.projectId !== scope.projectId || row.status !== "draft"
    || row.version !== 1 || row.isCurrent !== 0 || row.contentHash !== imagePlanningHash(body) || row.sourceAiJobRunId !== runId
    || !equal(json(row.metadata), { version: 1, kind: IMAGE_PLANNING_JOB_KIND, scope })) fail("ARTIFACT_INVALID");
  return body;
}
async function artifactPut(tx: ImagePlanningExecutor, identity: ImagePlanningIdentity, scope: ImagePlanningScope, artifactId: string, artifactKey: string, runId: string, content: unknown) {
  await write(tx, "INSERT INTO ai_artifacts (workspaceId,artifactId,domain,artifactKey,artifactType,sourceType,sourceId,sourceTable,sourceRowId,runId,agentSlug,projectId,userId,status,version,isCurrent,contentJson,contentHash,metadata,sourceAiJobRunId) VALUES (?,?,'image',?,'json','system',?,'image_workflow_sessions',?,?,'images',?,?,'draft',1,0,?,?,?,?)",
    [identity.workspaceId, artifactId, artifactKey, String(scope.sessionId), String(scope.sessionId), runId, scope.projectId, identity.userId,
      imagePlanningCanonical(content), imagePlanningHash(content), imagePlanningCanonical({ version: 1, kind: IMAGE_PLANNING_JOB_KIND, scope }), runId]);
  if (!equal(await artifactRead(tx, identity, scope, artifactId, artifactKey, runId), content)) fail("ARTIFACT_READBACK_INVALID");
}
const projection = "id,workspaceId,userId,projectId,runId,kind,module,`procedure`,queueName,status,attempt,maxAttempts,lockedBy,UNIX_TIMESTAMP(leaseUntil) AS leaseUntil,DATE_FORMAT(createdAt,'%Y-%m-%dT%H:%i:%s.%fZ') AS createdAt,completedAt,IF(OCTET_LENGTH(input)<=2097152,input,NULL) AS input,IF(OCTET_LENGTH(output)<=65536,output,NULL) AS output";
function outputOf(run: ImagePlanningRun) { return outputSchema.parse({ version: 1, state: run.state, dispatch: run.dispatch, candidateArtifactId: run.candidateArtifactId, resultHash: run.resultHash, errorCode: run.errorCode }); }
function verifyDispatch(snapshot: ConfiguredBusinessRuntimeSnapshot, value: z.infer<typeof dispatchSchema>) {
  if (value.snapshotHash !== snapshot.snapshotHash || value.receipt.stage !== "image_outline"
    || value.receipt.requestHash !== value.providerRequestHash || value.receipt.bindingHash !== value.bindingHash
    || value.receipt.modelConfigurationHash !== snapshot.model.configurationHash || value.receipt.budget.imageCount !== 0 || value.receipt.budget.imageBytes !== 0
    || value.receipt.budget.outputTokens !== snapshot.skill.maxTokens || value.receipt.budget.contextLimit !== snapshot.model.model.maxContextTokens
    || !equal(value.receipt.budget, snapshot.budgetPlan.budget)
    || value.bindingHash !== imagePlanningHash({ schema: "configured-business-stage/v1", stage: "image_outline", snapshotHash: value.snapshotHash, contextHash: value.contextHash, providerRequestHash: value.providerRequestHash })) fail("DISPATCH_INVALID");
}
async function load(tx: ImagePlanningExecutor, identity: ImagePlanningIdentity, scope: ImagePlanningOperationInput): Promise<ImagePlanningRun | null> {
  const runId = imagePlanningRunId(identity, scope.operationId), found = await rows(tx, `SELECT ${projection} FROM ai_jobs WHERE runId=? AND BINARY runId=BINARY ? LIMIT 2 FOR UPDATE`, [runId, runId], 1);
  if (!found.length) return null;
  const row = found[0], input = inputSchema.parse(json(row.input)), output = outputSchema.parse(json(row.output, 65536));
  if (!id.safeParse(row.id).success || row.workspaceId !== identity.workspaceId || row.userId !== identity.userId || row.projectId !== scope.projectId || row.runId !== runId
    || row.kind !== IMAGE_PLANNING_JOB_KIND || row.module !== "image" || row.procedure !== "imageWorkflow.planningStart" || row.queueName !== "image_planning"
    || row.maxAttempts !== 1 || ![0, 1].includes(Number(row.attempt)) || !equal(input.identity, identity) || !equal(operation(input.request), operation(scope))
    || row.status !== dbState(output.state) || typeof row.createdAt !== "string" || terminal(output.state) !== (row.completedAt !== null)
    || row.lockedBy !== null && (typeof row.lockedBy !== "string" || row.lockedBy.length > 128)
    || (row.lockedBy === null) !== (row.leaseUntil === null) || row.leaseUntil !== null && (!Number.isFinite(Number(row.leaseUntil)) || Number(row.leaseUntil) <= 0)
    || terminal(output.state) && row.lockedBy !== null) fail("RUN_INVALID");
  if (input.requestHash !== imagePlanningRequestHash(identity, input.request) || input.sourceHash !== input.request.expectedSourceHash
    || input.runtimeSnapshot.snapshotHash !== input.request.expectedRuntimeHash || input.runtimeSnapshot.operationId !== scope.operationId
    || !equal(input.runtimeSnapshot.identity, identity) || input.runtimeSnapshot.sourceHash !== input.sourceHash
    || input.runtimeSnapshot.configuration.hash !== input.configuration.hash || input.runtimeSnapshot.configuration.revision !== input.configuration.revision) fail("IMMUTABLE_CHANGED");
  const sourceScope = ImagePlanningScopeSchema.parse({ expectedWorkspaceId: scope.expectedWorkspaceId, projectId: scope.projectId, sessionId: scope.sessionId });
  const source = ImagePlanningSourceSchema.parse(await artifactRead(tx, identity, sourceScope, input.sourceArtifactId, IMAGE_PLANNING_SOURCE_KEY, runId));
  if (source.sourceHash !== input.sourceHash || !equal(source.identity, identity) || !equal(source.scope, sourceScope)) fail("SOURCE_BINDING_INVALID");
  if (output.dispatch) verifyDispatch(input.runtimeSnapshot, output.dispatch);
  if (["dispatched", "succeeded", "outcome_unknown"].includes(output.state) && !output.dispatch || (output.candidateArtifactId === null) !== (output.resultHash === null)
    || (output.state === "succeeded") !== (output.resultHash !== null)) fail("STATE_INVALID");
  let candidate: ImagePlanningRun["candidate"] = null;
  if (output.candidateArtifactId) {
    const body = z.object({ version: z.literal(1), candidate: ImagePlanningOutlineSchema, resultHash: hash, dispatchHash: hash }).strict().parse(
      await artifactRead(tx, identity, sourceScope, output.candidateArtifactId, IMAGE_PLANNING_CANDIDATE_KEY, runId));
    if (body.resultHash !== output.resultHash || body.resultHash !== imagePlanningHash(body.candidate) || body.dispatchHash !== imagePlanningHash(output.dispatch)) fail("CANDIDATE_INVALID");
    candidate = body.candidate;
  }
  return { ...input, ...output, id: Number(row.id), runId, source, candidate, lockedBy: row.lockedBy as string | null, leaseUntil: row.leaseUntil === null ? null : Number(row.leaseUntil), createdAt: row.createdAt };
}
async function update(tx: ImagePlanningExecutor, run: ImagePlanningRun, token: string | null = run.lockedBy, claim = false) {
  const release = terminal(run.state), body = outputOf(run);
  await write(tx, `UPDATE ai_jobs SET status=?,output=?,errorMessage=?,progress=?,lockedBy=?,leaseUntil=${release ? "NULL" : "DATE_ADD(NOW(6),INTERVAL 120 SECOND)"},lastHeartbeatAt=NOW(6),completedAt=${release ? "NOW(6)" : "NULL"},${claim ? "attempt=1,startedAt=COALESCE(startedAt,NOW(6)),claimedAt=NOW(6)," : ""}updatedAt=NOW(6) WHERE id=? AND runId=? AND workspaceId=? AND userId=? AND kind=?`,
    [dbState(run.state), imagePlanningCanonical(body), run.errorCode, run.state === "succeeded" ? 100 : run.state === "dispatched" ? 50 : 0, release ? null : token,
      run.id, run.runId, run.identity.workspaceId, run.identity.userId, IMAGE_PLANNING_JOB_KIND]);
  const actual = await load(tx, run.identity, operation(run.request));
  if (!actual || !equal(outputOf(actual), body) || actual.lockedBy !== (release ? null : token)) fail("JOB_READBACK_INVALID");
  return actual;
}

/** One owner/private operation over existing InnoDB jobs, artifacts and audit.
 * No method performs network I/O or calls a provider while holding a DB lock. */
export function createImagePlanningRepository(deps: { getDb?: () => Promise<ImagePlanningDatabase | null>; permission?: typeof assertResourceAction;
  capture?: typeof captureImagePlanningSource; schemaReady?: typeof assertImagePlanningSchema; sourceSchemaReady?: typeof assertImagePlanningSourceSchema;
  enabled?: () => boolean; token?: () => string } = {}) {
  const getDb = deps.getDb ?? (() => requireDb("Image planning")), permission = deps.permission ?? assertResourceAction,
    capture = deps.capture ?? captureImagePlanningSource, schemaReady = deps.schemaReady ?? assertImagePlanningSchema,
    sourceSchema = deps.sourceSchemaReady ?? assertImagePlanningSourceSchema, enabled = deps.enabled ?? (() => process.env.ENABLE_IMAGE_PLANNING_WRITES === "true");
  const gate = () => { if (!enabled()) fail("WRITES_DISABLED"); };
  async function invoke<T>(identity: ImagePlanningIdentity, scope: ImagePlanningScope, action: Action, writing: boolean, body: (tx: ImagePlanningExecutor, role: string) => Promise<T>): Promise<T> {
    ImagePlanningIdentitySchema.parse(identity); ImagePlanningScopeSchema.parse({ expectedWorkspaceId: scope.expectedWorkspaceId, projectId: scope.projectId, sessionId: scope.sessionId });
    if (identity.workspaceId !== scope.expectedWorkspaceId) fail("ACCESS_DENIED");
    try {
      const database = await getDb(); if (!database || typeof database.transaction !== "function") fail("TRANSACTION_REQUIRED");
      return await database.transaction(async tx => { await schemaReady(tx); const actor = await authorize(tx, identity, scope, action, permission); return body(tx, actor.role); });
    } catch (error) {
      if (error instanceof ImagePlanningRepositoryError) throw error;
      if (error instanceof TRPCError && ["FORBIDDEN", "UNAUTHORIZED"].includes(error.code)) return fail("ACCESS_DENIED");
      throw new ImagePlanningRepositoryError(writing ? "OUTCOME_UNVERIFIED" : "READ_UNAVAILABLE", writing);
    }
  }
  async function source(tx: ImagePlanningExecutor, identity: ImagePlanningIdentity, scope: ImagePlanningScope) {
    await sourceSchema(tx); const value = ImagePlanningSourceSchema.parse(await capture(tx, identity, ImagePlanningScopeSchema.parse({ expectedWorkspaceId: scope.expectedWorkspaceId, projectId: scope.projectId, sessionId: scope.sessionId })));
    if (!equal(value.identity, identity) || value.scope.projectId !== scope.projectId || value.scope.sessionId !== scope.sessionId) fail("SOURCE_BINDING_INVALID"); return value;
  }
  async function state(tx: ImagePlanningExecutor, identity: ImagePlanningIdentity, scope: ImagePlanningOperationInput) {
    const started = await auditRead(tx, identity, scope, "start", startReceiptSchema), canceled = await auditRead(tx, identity, scope, "cancel", startReceiptSchema), run = await load(tx, identity, scope);
    if (run && (!started || started.status !== "reserved" || started.requestHash !== run.requestHash || started.runId !== run.runId)
      || started?.status === "reserved" && !run || canceled && (canceled.status !== "cancelled" || run && run.state !== "canceled")) fail("START_JOURNAL_INVALID");
    return { run, receipt: canceled ?? started };
  }
  async function prepare(tx: ImagePlanningExecutor, current: ImagePlanningSource, operationId: string, fn: ImagePlanningPrepare) {
    const raw = await fn(tx, current), configuration = configSchema.parse(raw.configuration), runtimeSnapshot = runtimeSchema.parse(raw.runtimeSnapshot);
    if (configuration.workspaceId !== current.identity.workspaceId || !configuration.config.enabled || !equal(runtimeSnapshot.identity, current.identity)
      || runtimeSnapshot.operationId !== operationId || runtimeSnapshot.sourceHash !== current.sourceHash || runtimeSnapshot.configuration.hash !== configuration.hash
      || runtimeSnapshot.configuration.revision !== configuration.revision) fail("RUNTIME_BINDING_INVALID");
    return { configuration, runtimeSnapshot };
  }
  async function now(tx: ImagePlanningExecutor) { const result = await rows(tx, "SELECT UNIX_TIMESTAMP(NOW(6)) AS currentTime", [], 1); const value = Number(result[0]?.currentTime); if (result.length !== 1 || !Number.isFinite(value) || value <= 0) fail("CLOCK_UNAVAILABLE"); return value; }
  async function leased(tx: ImagePlanningExecutor, lease: ImagePlanningLease, freshSource: boolean) {
    const current = freshSource ? await source(tx, lease.identity, lease.scope) : null, found = await state(tx, lease.identity, lease.scope), run = found.run;
    if (!run || !["running", "dispatched"].includes(run.state) || run.runId !== lease.runId || run.lockedBy !== lease.token || run.leaseUntil === null || run.leaseUntil <= await now(tx)
      || found.receipt?.status === "cancelled") fail("LEASE_LOST");
    if (current && current.sourceHash !== run.sourceHash) fail("SOURCE_CHANGED"); return { run, source: current };
  }
  return {
    readSource(identity: ImagePlanningIdentity, input: ImagePlanningScope) { return invoke(identity, input, "read", false, tx => source(tx, identity, input)); },
    preview(identity: ImagePlanningIdentity, input: ImagePlanningOperationInput, fn: ImagePlanningPrepare) { return invoke(identity, input, "run", false, async tx => { const current = await source(tx, identity, input); return { source: current, ...await prepare(tx, current, input.operationId, fn) }; }); },
    reserve(identity: ImagePlanningIdentity, raw: ImagePlanningStartInput, fn: ImagePlanningPrepare) {
      const input = ImagePlanningStartInputSchema.parse(raw);
      return invoke(identity, input, "run", true, async (tx, role) => {
        const current = await source(tx, identity, input), old = await state(tx, identity, operation(input)), requestHash = imagePlanningRequestHash(identity, input);
        if (old.receipt?.status === "cancelled") fail("OPERATION_CANCELED");
        if (old.run) { if (old.run.requestHash !== requestHash) fail("OPERATION_CONTENT_CONFLICT"); return old.run; }
        gate(); if (current.sourceHash !== input.expectedSourceHash) fail("SOURCE_CHANGED");
        const active = await rows(tx, "SELECT runId FROM ai_jobs WHERE kind=? AND workspaceId=? AND projectId=? AND JSON_EXTRACT(input,'$.request.sessionId')=? AND (status IN ('queued','running') OR JSON_UNQUOTE(JSON_EXTRACT(output,'$.state'))='outcome_unknown') ORDER BY id LIMIT 2 FOR UPDATE", [IMAGE_PLANNING_JOB_KIND, identity.workspaceId, input.projectId, input.sessionId], 1);
        if (active.length) fail("ACTIVE_OPERATION_EXISTS");
        const prepared = await prepare(tx, current, input.operationId, fn);
        if (prepared.runtimeSnapshot.snapshotHash !== input.expectedRuntimeHash) fail("RUNTIME_CHANGED");
        if (prepared.runtimeSnapshot.budgetPlan.maxCostCentsTotal > input.maxCostCents) fail("COST_AUTHORIZATION_EXCEEDED");
        const runId = imagePlanningRunId(identity, input.operationId), sourceArtifactId = `impl_src_${imagePlanningHash({ identity, operationId: input.operationId })}`;
        const value = inputSchema.parse({ version: 1, identity, request: input, requestHash, sourceArtifactId, sourceHash: current.sourceHash, ...prepared });
        const output = outputSchema.parse({ version: 1, state: "queued", dispatch: null, candidateArtifactId: null, resultHash: null, errorCode: null }); gate();
        await artifactPut(tx, identity, current.scope, sourceArtifactId, IMAGE_PLANNING_SOURCE_KEY, runId, current);
        await write(tx, "INSERT INTO ai_jobs (workspaceId,runId,kind,module,`procedure`,status,queueName,attempt,maxAttempts,userId,projectId,skillSlug,input,output) VALUES (?,?,?,'image','imageWorkflow.planningStart','queued','image_planning',0,1,?,?,?,?,?)",
          [identity.workspaceId, runId, IMAGE_PLANNING_JOB_KIND, identity.userId, input.projectId, prepared.runtimeSnapshot.skill.slug, imagePlanningCanonical(value), imagePlanningCanonical(output)]);
        const run = await load(tx, identity, operation(input)); if (!run || run.requestHash !== requestHash || !equal(outputOf(run), output)) fail("JOB_READBACK_INVALID");
        await auditPut(tx, identity, operation(input), role, "start", { identity, scope: operation(input), status: "reserved", requestHash, runId }, startReceiptSchema); return run;
      });
    },
    check(identity: ImagePlanningIdentity, input: ImagePlanningOperationInput) { ImagePlanningOperationInputSchema.parse(input); return invoke(identity, input, "read", false, tx => state(tx, identity, input)); },
    cancel(identity: ImagePlanningIdentity, input: ImagePlanningOperationInput) { ImagePlanningOperationInputSchema.parse(input); return invoke(identity, input, "cancel", true, async (tx, role) => {
      const old = await state(tx, identity, input); if (old.receipt?.status === "cancelled" || old.run?.state === "succeeded") return old;
      if (old.run) { old.run.state = "canceled"; old.run.errorCode = "OPERATION_CANCELED"; await update(tx, old.run); }
      const receipt = await auditPut(tx, identity, input, role, "cancel", startReceiptSchema.parse({ identity, scope: operation(input), status: "cancelled", requestHash: old.run?.requestHash ?? null, runId: old.run?.runId ?? null }), startReceiptSchema);
      return { run: old.run ? await load(tx, identity, input) : null, receipt };
    }); },
    history(identity: ImagePlanningIdentity, input: ImagePlanningScope) { return invoke(identity, input, "read", false, async tx => {
      const found = await rows(tx, "SELECT runId,IF(OCTET_LENGTH(input)<=2097152,input,NULL) AS input,status,JSON_UNQUOTE(JSON_EXTRACT(output,'$.state')) AS logicalState,DATE_FORMAT(createdAt,'%Y-%m-%dT%H:%i:%s.%fZ') AS createdAt FROM ai_jobs WHERE kind=? AND workspaceId=? AND userId=? AND projectId=? AND JSON_EXTRACT(input,'$.request.sessionId')=? ORDER BY id DESC LIMIT 51 FOR SHARE", [IMAGE_PLANNING_JOB_KIND, identity.workspaceId, identity.userId, input.projectId, input.sessionId], 51);
      return { complete: found.length <= 50, operations: found.slice(0, 50).map(row => {
        const saved = inputSchema.parse(json(row.input)), logical = outputSchema.shape.state.parse(row.logicalState);
        if (!equal(saved.identity, identity) || saved.request.projectId !== input.projectId || saved.request.sessionId !== input.sessionId || row.runId !== imagePlanningRunId(identity, saved.request.operationId)
          || row.status !== dbState(logical) || typeof row.createdAt !== "string") fail("HISTORY_INVALID");
        return { operationId: saved.request.operationId, state: logical, sourceHash: saved.sourceHash, createdAt: row.createdAt };
      }) };
    }); },
    claim(identity: ImagePlanningIdentity, input: ImagePlanningOperationInput, workerId: string): Promise<ImagePlanningLease | null> { return invoke(identity, input, "run", true, async tx => {
      gate(); if (!/^[a-zA-Z0-9_.:-]{1,80}$/u.test(workerId)) fail("WORKER_INVALID");
      const old = await state(tx, identity, input), run = old.run;
      if (!run || terminal(run.state) || run.leaseUntil !== null && run.leaseUntil > await now(tx)) return null;
      if (run.state === "dispatched") { run.state = "outcome_unknown"; run.errorCode = "DISPATCH_OUTCOME_UNKNOWN"; await update(tx, run); return null; }
      const current = await source(tx, identity, input);
      if (current.sourceHash !== run.sourceHash) { run.state = "failed"; run.errorCode = "SOURCE_CHANGED"; await update(tx, run); return null; }
      const token = `${workerId}:${uuid.parse((deps.token ?? randomUUID)())}`; run.state = "running"; await update(tx, run, token, true);
      return { identity, scope: operation(input), runId: run.runId, token };
    }); },
    prepareStage<T>(lease: ImagePlanningLease, body: (tx: ImagePlanningExecutor, run: ImagePlanningRun, source: ImagePlanningSource) => Promise<T>) { return invoke(lease.identity, lease.scope, "run", false, async tx => { gate(); const value = await leased(tx, lease, true); return body(tx, value.run, value.source!); }); },
    heartbeat(lease: ImagePlanningLease) { return invoke(lease.identity, lease.scope, "run", true, async tx => update(tx, (await leased(tx, lease, false)).run)); },
    dispatch(lease: ImagePlanningLease, value: z.infer<typeof dispatchSchema>, verify: (tx: ImagePlanningExecutor, run: ImagePlanningRun, source: ImagePlanningSource) => Promise<void>) { return invoke(lease.identity, lease.scope, "run", true, async tx => {
      gate(); const current = await leased(tx, lease, true), run = current.run; if (run.state !== "running" || run.dispatch !== null) fail("ALREADY_DISPATCHED");
      const parsed = dispatchSchema.parse(value); verifyDispatch(run.runtimeSnapshot, parsed); await verify(tx, run, current.source!); gate();
      run.state = "dispatched"; run.dispatch = parsed; return update(tx, run);
    }); },
    candidate(lease: ImagePlanningLease, value: ImagePlanningCandidateInput) { return invoke(lease.identity, lease.scope, "run", true, async tx => {
      // Paid result persistence is allowed after local stop/flag-off; current
      // actor authorization, cancellation fence and original lease still apply.
      const { run } = await leased(tx, lease, false), dispatch = run.dispatch;
      if (run.state !== "dispatched" || !dispatch || value.stage !== "image_outline" || value.runId !== dispatch.receipt.runId || value.contextHash !== dispatch.contextHash
        || value.snapshotHash !== dispatch.snapshotHash || value.bindingHash !== dispatch.bindingHash || value.providerRequestHash !== dispatch.providerRequestHash) fail("RESULT_RECEIPT_INVALID");
      const candidate = ImagePlanningOutlineSchema.parse(value.candidate), resultHash = imagePlanningHash(candidate), artifactId = `impl_can_${imagePlanningHash({ runId: run.runId })}`;
      await artifactPut(tx, lease.identity, run.source.scope, artifactId, IMAGE_PLANNING_CANDIDATE_KEY, run.runId, { version: 1, candidate, resultHash, dispatchHash: imagePlanningHash(dispatch) });
      run.state = "succeeded"; run.resultHash = resultHash; run.candidateArtifactId = artifactId; return update(tx, run);
    }); },
    failure(lease: ImagePlanningLease, reasonCode: string) { return invoke(lease.identity, lease.scope, "run", true, async tx => {
      const { run } = await leased(tx, lease, false); run.state = run.dispatch ? "outcome_unknown" : "failed";
      run.errorCode = run.dispatch ? "DISPATCH_OUTCOME_UNKNOWN" : code.safeParse(reasonCode).success ? reasonCode : "PROCESSING_FAILED"; return update(tx, run);
    }); },
    applyCheck(identity: ImagePlanningIdentity, input: ImagePlanningApplyOperationInput) { ImagePlanningApplyOperationInputSchema.parse(input); return invoke(identity, input, "read", false, async tx => {
      const saved = await auditRead(tx, identity, input, "apply", ImagePlanningApplyReceiptSchema); if (saved && !equal(saved.scope, input)) fail("OPERATION_SCOPE_CONFLICT"); return saved;
    }); },
    applyCancel(identity: ImagePlanningIdentity, input: ImagePlanningApplyOperationInput) { ImagePlanningApplyOperationInputSchema.parse(input); return invoke(identity, input, "cancel", true, async (tx, role) => {
      const old = await auditRead(tx, identity, input, "apply", ImagePlanningApplyReceiptSchema); if (old) { if (!equal(old.scope, input)) fail("OPERATION_SCOPE_CONFLICT"); return old; }
      return auditPut(tx, identity, input, role, "apply", ImagePlanningApplyReceiptSchema.parse({ identity, scope: input, status: "cancelled", requestHash: null, afterSourceHash: null, resultHash: null, reasonCode: "OPERATION_CANCELED" }), ImagePlanningApplyReceiptSchema);
    }); },
    apply(identity: ImagePlanningIdentity, raw: ImagePlanningApplyInput) { const input = ImagePlanningApplyInputSchema.parse(raw); return invoke(identity, input, "confirm", true, async (tx, role) => {
      const applyScope = ImagePlanningApplyOperationInputSchema.parse({ ...operation(input), runOperationId: input.runOperationId });
      const old = await auditRead(tx, identity, input, "apply", ImagePlanningApplyReceiptSchema), requestHash = imagePlanningRequestHash(identity, input);
      if (old) { if (!equal(old.scope, applyScope) || old.status !== "committed" || old.requestHash !== requestHash) fail("OPERATION_CONTENT_CONFLICT"); return old; }
      gate(); const current = await source(tx, identity, input), run = await load(tx, identity, { ...operation(input), operationId: input.runOperationId });
      if (!run || run.state !== "succeeded" || !run.candidate || run.resultHash !== input.expectedResultHash) fail("RESULT_NOT_READY");
      if (current.sourceHash !== input.expectedSourceHash || current.sourceHash !== run.sourceHash) fail("SOURCE_CHANGED");
      if ([3, 4, 5, 6].some(step => current.session[`step${step}Confirmed`] === 1)) fail("DOWNSTREAM_CONFIRMATION_EXISTS");
      const candidateText = JSON.stringify(run.candidate); if (Buffer.byteLength(candidateText) > 65535) fail("RESULT_LIMIT");
      // Parent/session and full upstream source remain locked until the draft,
      // immutable apply receipt and readback all commit together. Never confirm.
      await write(tx, "UPDATE image_workflow_sessions SET step2AiResult=?,step2UserEdit=?,updatedAt=NOW(6) WHERE id=? AND projectId=? AND userId=? AND step1Confirmed=1 AND step2Confirmed=0 AND step2AiResult<=>? AND step2UserEdit<=>?",
        [candidateText, candidateText, input.sessionId, input.projectId, identity.userId, current.session.step2AiResult, current.session.step2UserEdit]);
      await write(tx, "UPDATE image_workflow_version_scopes SET revision=revision+1,updatedAt=NOW(6) WHERE workspaceId=? AND projectId=? AND sessionId=? AND revision=?",
        [identity.workspaceId, input.projectId, input.sessionId, current.scopeRevision]);
      const after = await source(tx, identity, input);
      if (after.scopeRevision !== current.scopeRevision + 1 || after.session.step2Confirmed !== 0 || after.session.step2AiResult !== candidateText || after.session.step2UserEdit !== candidateText) fail("APPLY_READBACK_INVALID");
      const receipt = ImagePlanningApplyReceiptSchema.parse({ identity, scope: applyScope, status: "committed", requestHash, afterSourceHash: after.sourceHash, resultHash: run.resultHash, reasonCode: null });
      await artifactPut(tx, identity, current.scope, `impl_app_${imagePlanningHash({ identity, operationId: input.operationId })}`, IMAGE_PLANNING_APPLY_KEY, run.runId, { version: 1, request: input, receipt }); gate();
      return auditPut(tx, identity, input, role, "apply", receipt, ImagePlanningApplyReceiptSchema);
    }); },
  };
}
