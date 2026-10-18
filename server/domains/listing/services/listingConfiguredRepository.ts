import { randomUUID } from "node:crypto";
import { z } from "zod";
import { requireDb, type DbExecutor } from "../../../repositories/dbClient";
import { assertResourceAction } from "../../../services/securityGovernance";
import { ROLE_MODULE_ACCESS } from "../../../../shared/const";
import { LISTING_CONFIGURED_KIND, ListingConfiguredIdentitySchema, ListingConfiguredOperationInputSchema, ListingConfiguredPreviewInputSchema, ListingConfiguredStartInputSchema,
  ListingConfiguredCandidateSchema, ListingConfiguredApplyInputSchema, ListingConfiguredApplyOperationInputSchema, ListingConfiguredApplyReceiptSchema,
  listingConfiguredCanonical as canonical, listingConfiguredHash as hash, listingConfiguredOperations, type ListingConfiguredIdentity, type ListingConfiguredOperationInput,
  type ListingConfiguredPreviewInput, type ListingConfiguredStartInput, type ListingConfiguredApplyInput, type ListingConfiguredApplyOperationInput } from "../../../../shared/listingConfiguredWorkflow";
import { ListingConfiguredSourceSchema, captureListingConfiguredSource, assertListingConfiguredSchema, listingConfiguredRows as rows, listingConfiguredJson as json,
  listingConfiguredWrite as write, listingConfiguredFail as fail, ListingConfiguredError, type ListingConfiguredExecutor, type ListingConfiguredSource } from "./listingConfiguredSource";
import { ListingConfiguredRuntimeSnapshotSchema, ListingConfiguredConfigurationSchema, ListingConfiguredAttemptSchema, ListingConfiguredDispatchSchema,
  type ListingConfiguredConfiguration, type ListingConfiguredRuntimeSnapshot } from "./listingConfiguredRuntimeContract";
import { listingConfiguredNextAttempt, validateListingConfiguredReturned, type ListingConfiguredReturned } from "./listingConfiguredRuntime";
import { applyListingConfiguredCandidate } from "./listingConfiguredPublication";
import { projectListingConfiguredApplied } from "./listingConfiguredAgentProjection";
const h = z.string().regex(/^[a-f0-9]{64}$/u), bounded = z.string().max(160), equal = (a: unknown, b: unknown) => canonical(a) === canonical(b);
export const listingConfiguredEnabled = () => process.env.ENABLE_LISTING_CONFIGURED_WRITES === "true";
const dispatch = z.object({ receipt: ListingConfiguredDispatchSchema, contextHash: h, snapshotHash: h, bindingHash: h, providerRequestHash: h }).strict();
const returned = z.object({ content: z.string().max(1048576), candidate: z.record(z.string(), z.unknown()).nullable(), issues: z.array(z.string().max(2000)).max(100), formatInvalid: z.boolean() }).strict();
const step = z.object({ attempt: ListingConfiguredAttemptSchema, dispatch: dispatch.nullable(), returned: returned.nullable() }).strict();
const outputSchema = z.object({ version: z.literal(1), state: z.enum(["queued", "running", "dispatched", "succeeded", "failed", "canceled", "outcome_unknown"]),
  steps: z.array(step).max(42), resultHash: h.nullable(), errorCode: bounded.nullable() }).strict();
const inputSchema = z.object({ version: z.literal(1), identity: ListingConfiguredIdentitySchema, request: ListingConfiguredStartInputSchema, requestHash: h,
  sourceArtifactId: z.string().max(80), sourceHash: h, configuration: ListingConfiguredConfigurationSchema, runtimeSnapshot: ListingConfiguredRuntimeSnapshotSchema }).strict();
const startReceipt = z.object({ identity: ListingConfiguredIdentitySchema, scope: ListingConfiguredOperationInputSchema, status: z.enum(["reserved", "cancelled"]),
  requestHash: h.nullable(), runId: z.string().max(80).nullable() }).strict();
export type ListingConfiguredRun = z.infer<typeof inputSchema> & z.infer<typeof outputSchema> & { id: number; runId: string; lockedBy: string | null; leaseUntil: number | null; source: ListingConfiguredSource; createdAt: string };
export type ListingConfiguredLease = { identity: ListingConfiguredIdentity; scope: ListingConfiguredOperationInput; token: string; runId: string };
export type ListingConfiguredPrepare = (executor: ListingConfiguredExecutor, source: ListingConfiguredSource) => Promise<{ configuration: ListingConfiguredConfiguration; runtimeSnapshot: ListingConfiguredRuntimeSnapshot }>;
export const listingConfiguredRunId = (identity: ListingConfiguredIdentity, operationId: string) => `lstg_${hash({ identity, operationId })}`;
export const listingConfiguredOperationScope = (input: ListingConfiguredOperationInput) => ListingConfiguredOperationInputSchema.parse({ expectedWorkspaceId: input.expectedWorkspaceId, projectId: input.projectId, operationId: input.operationId });
const terminal = (state: string) => ["succeeded", "failed", "canceled", "outcome_unknown"].includes(state);
const dbState = (state: string) => state === "dispatched" ? "running" : state === "outcome_unknown" ? "failed" : state;
export function listingConfiguredCandidate(run: ListingConfiguredRun) {
  if (run.state !== "succeeded") return null;
  const outputs: Record<string, Record<string, unknown>> = {};
  for (const item of run.steps) if (item.returned?.candidate && !item.returned.issues.length) outputs[item.attempt.operation] = item.returned.candidate;
  const result = ListingConfiguredCandidateSchema.parse({ version: 1, operation: run.request.operation, outputs, requiresHumanReview: true, sourceHash: run.sourceHash });
  if (hash(result) !== run.resultHash) fail("RESULT_INVALID"); return result;
}
export function listingConfiguredNextStage(run: Pick<ListingConfiguredRun, "steps" | "request" | "runtimeSnapshot">) {
  const ops = listingConfiguredOperations(run.request.operation), last = run.steps.at(-1);
  if (!last) return { attempt: { operation: ops[0], qualityAttempt: 0, modelIndex: 0 }, previous: null };
  if (!last.returned) fail("DISPATCH_OUTCOME_UNKNOWN");
  const next = listingConfiguredNextAttempt(run.runtimeSnapshot, last.attempt, last.returned);
  if (next === "exhausted") fail("QUALITY_EXHAUSTED");
  if (next) return { attempt: next, previous: last.returned };
  const operation = ops[ops.indexOf(last.attempt.operation) + 1];
  if (!operation) return null;
  return { attempt: { operation, qualityAttempt: 0, modelIndex: 0 }, previous: null };
}
export async function authorizeListingConfigured(tx: ListingConfiguredExecutor, identity: ListingConfiguredIdentity, scope: ListingConfiguredOperationInput | ListingConfiguredPreviewInput,
  action: "read" | "run" | "update", permission = assertResourceAction) {
  if (scope.expectedWorkspaceId !== identity.workspaceId) fail("ACCESS_DENIED");
  const spaces = await rows(tx, "SELECT id,status FROM workspaces WHERE id=? FOR SHARE", [identity.workspaceId], 1);
  const actors = await rows(tx, "SELECT id,role,status,defaultWorkspaceId FROM users WHERE id=? FOR SHARE", [identity.userId], 1), actor = actors[0];
  const members = await rows(tx, "SELECT id,workspaceId,userId,status FROM workspace_memberships WHERE workspaceId=? AND userId=? ORDER BY id LIMIT 2 FOR SHARE", [identity.workspaceId, identity.userId], 2);
  if (spaces.length !== 1 || spaces[0].id !== identity.workspaceId || spaces[0].status !== "active" || actors.length !== 1 || actor.id !== identity.userId || actor.status !== "active" || actor.defaultWorkspaceId !== identity.workspaceId
    || typeof actor.role !== "string" || members.length !== 1 || members[0].workspaceId !== identity.workspaceId || members[0].userId !== identity.userId || members[0].status !== "active") fail("ACCESS_DENIED");
  if (actor.role !== "super_admin") {
    const directory = await rows(tx, "SELECT workspaceId,role,IF(OCTET_LENGTH(modules)<=65536,modules,NULL) AS modules,IF(detailedPermissions IS NULL OR OCTET_LENGTH(detailedPermissions)<=65536,detailedPermissions,NULL) AS detailedPermissions FROM role_permissions WHERE role=? AND (workspaceId=? OR workspaceId IS NULL) ORDER BY workspaceId IS NULL LIMIT 3 FOR SHARE", [actor.role, identity.workspaceId], 2);
    if (new Set(directory.map(row => row.workspaceId)).size !== directory.length) fail("ACCESS_DENIED");
    const current = directory.find(row => row.workspaceId === identity.workspaceId) ?? directory.find(row => row.workspaceId === null);
    const modules = current ? z.array(z.string()).parse(json(current.modules)) : ROLE_MODULE_ACCESS[actor.role] ?? [];
    if (!modules.includes("listing") || action === "run" && !modules.includes("emperor")) fail("ACCESS_DENIED");
    if (current?.detailedPermissions != null) {
      const details = z.array(z.object({ moduleId: z.string(), operations: z.array(z.string()), subModules: z.array(z.object({ subModuleId: z.string(), operations: z.array(z.string()) })).optional() })).parse(json(current.detailedPermissions));
      for (const [moduleId, sub] of [["listing", "listing_projects"], ...(action === "run" ? [["emperor", "emperor_agents"]] : [])]) {
        const d = details.find(value => value.moduleId === moduleId), ops = d?.subModules?.length ? d.subModules.find(value => value.subModuleId === sub)?.operations : d?.operations;
        if (!ops?.includes("read") || action !== "read" && !ops.includes("edit")) fail("ACCESS_DENIED");
      }
    }
  }
  const parents = await rows(tx, "SELECT id,userId,workspaceId FROM projects WHERE id=? FOR UPDATE", [scope.projectId], 1), parent = parents[0];
  if (parents.length !== 1 || parent.id !== scope.projectId || parent.workspaceId !== identity.workspaceId || !Number.isInteger(parent.userId)) fail("ACCESS_DENIED");
  const common = { actor: { id: identity.userId, role: actor.role, defaultWorkspaceId: identity.workspaceId }, workspaceId: identity.workspaceId, projectId: scope.projectId,
    authorizationRead: { executor: tx as DbExecutor, strict: true as const, lock: true as const, lockMode: "share" as const } };
  try {
    await permission({ ...common, resource: "project", resourceId: scope.projectId, ownerUserId: Number(parent.userId), action: "read" });
    if (action !== "read") await permission({ ...common, resource: "project", resourceId: scope.projectId, ownerUserId: Number(parent.userId), action: "update" });
    if (action === "run") for (const grant of ["read", "run"] as const) await permission({ ...common, resource: "agent", resourceId: "listing", action: grant });
  } catch { fail("ACCESS_DENIED"); } return { role: actor.role };
}
export function createListingConfiguredRepository(deps: { database?: () => Promise<{ transaction<T>(body: (tx: ListingConfiguredExecutor) => Promise<T>): Promise<T> } | null>;
  authorize?: typeof authorizeListingConfigured; schema?: typeof assertListingConfiguredSchema; capture?: typeof captureListingConfiguredSource;
  enabled?: () => boolean; publish?: typeof applyListingConfiguredCandidate } = {}) {
  const database = deps.database ?? (() => requireDb("Configured Listing")), authorize = deps.authorize ?? authorizeListingConfigured, capture = deps.capture ?? captureListingConfiguredSource, enabled = deps.enabled ?? listingConfiguredEnabled;
  async function transaction<T>(identity: ListingConfiguredIdentity, scope: ListingConfiguredOperationInput | ListingConfiguredPreviewInput, action: "read" | "run" | "update", body: (tx: ListingConfiguredExecutor, role: string) => Promise<T>): Promise<T> {
    ListingConfiguredIdentitySchema.parse(identity); if (scope.expectedWorkspaceId !== identity.workspaceId) fail("ACCESS_DENIED");
    const db = await database(); if (!db) fail("STORAGE_UNAVAILABLE");
    try { return await db.transaction(async tx => { await (deps.schema ?? assertListingConfiguredSchema)(tx); const actor = await authorize(tx, identity, scope, action); return body(tx, actor.role); }); }
    catch (error) { if (error instanceof ListingConfiguredError) throw error; fail("OUTCOME_UNKNOWN_CHECK_SAME_UUID"); }
  }
  const auditId = (identity: ListingConfiguredIdentity, id: string, kind: string) => `lstg_${kind}_${hash({ identity, id })}`;
  async function audit<T>(tx: ListingConfiguredExecutor, identity: ListingConfiguredIdentity, scope: ListingConfiguredOperationInput, role: string, kind: "start" | "cancel" | "apply", schema: z.ZodType<T>, value?: T): Promise<T | null> {
    const key = auditId(identity, scope.operationId, kind), records = await rows(tx, "SELECT auditId,workspaceId,actorUserId,action,resourceType,resourceId,projectId,status,IF(OCTET_LENGTH(metadata)<=65536,metadata,NULL) AS metadata FROM security_audit_logs WHERE auditId=? AND BINARY auditId=BINARY ? LIMIT 2 FOR UPDATE", [key, key], 1);
    if (records.length) {
      const record = records[0]; if (record.workspaceId !== identity.workspaceId || record.actorUserId !== identity.userId || record.projectId !== scope.projectId || record.action !== `listing.configured.${kind}` || record.resourceType !== "listing_configured" || record.resourceId !== scope.operationId || record.status !== "success") fail("OPERATION_SCOPE_CONFLICT");
      const parsed = z.object({ scope: ListingConfiguredOperationInputSchema, receipt: schema }).strict().parse(json(record.metadata, 65536));
      if (!equal(parsed.scope, listingConfiguredOperationScope(scope)) || value !== undefined && !equal(parsed.receipt, value)) fail("OPERATION_CONTENT_CONFLICT"); return parsed.receipt;
    }
    if (value === undefined) return null;
    await write(tx, "INSERT INTO security_audit_logs (auditId,workspaceId,actorUserId,actorRole,action,resourceType,resourceId,projectId,status,riskLevel,metadata) VALUES (?,?,?,?,?,'listing_configured',?,?,'success','medium',?)",
      [key, identity.workspaceId, identity.userId, role, `listing.configured.${kind}`, scope.operationId, scope.projectId, canonical({ scope: listingConfiguredOperationScope(scope), receipt: schema.parse(value) })]);
    const readback = await audit(tx, identity, scope, role, kind, schema);
    if (readback === null) fail("JOURNAL_ACK_UNKNOWN"); return readback;
  }
  async function artifact(tx: ListingConfiguredExecutor, identity: ListingConfiguredIdentity, scope: ListingConfiguredOperationInput, key: string, runId: string, body?: unknown) {
    const artifactId = `lstg_${hash({ identity, operationId: scope.operationId, key })}`;
    if (body !== undefined && Buffer.byteLength(canonical(body)) > 16777216) fail("ARTIFACT_LIMIT");
    if (body !== undefined) await write(tx, "INSERT INTO ai_artifacts (workspaceId,userId,projectId,artifactId,domain,artifactKey,artifactType,sourceType,sourceTable,sourceRowId,runId,sourceAiJobRunId,status,isCurrent,version,contentJson,contentHash) VALUES (?,?,?,?,'listing',?,'json','system','projects',?,?,?,'draft',0,1,JSON_QUOTE(?),?)",
      [identity.workspaceId, identity.userId, scope.projectId, artifactId, key, String(scope.projectId), runId, runId, canonical(body), hash(body)]);
    const found = await rows(tx, "SELECT workspaceId,userId,projectId,artifactId,domain,artifactKey,artifactType,sourceType,sourceTable,sourceRowId,runId,sourceAiJobRunId,status,isCurrent,version,IF(OCTET_LENGTH(JSON_UNQUOTE(contentJson))<=16777216,JSON_UNQUOTE(contentJson),NULL) AS contentJson,contentHash FROM ai_artifacts WHERE artifactId=? AND BINARY artifactId=BINARY ? LIMIT 2 FOR SHARE", [artifactId, artifactId], 1);
    const row = found[0]; if (!row || row.artifactId !== artifactId || row.domain !== "listing" || row.artifactType !== "json" || row.sourceType !== "system" || row.workspaceId !== identity.workspaceId || row.userId !== identity.userId || row.projectId !== scope.projectId || row.artifactKey !== key || row.runId !== runId || row.sourceAiJobRunId !== runId || row.sourceTable !== "projects" || row.sourceRowId !== String(scope.projectId) || row.status !== "draft" || row.isCurrent !== 0 || row.version !== 1) fail("ARTIFACT_INVALID");
    const value = json(row.contentJson, 16777216); if (hash(value) !== row.contentHash || body !== undefined && !equal(value, body)) fail("ARTIFACT_INVALID"); return { artifactId, value };
  }
  const projection = "id,runId,workspaceId,userId,projectId,kind,module,`procedure`,status,attempt,maxAttempts,lockedBy,UNIX_TIMESTAMP(leaseUntil) AS leaseUntil,DATE_FORMAT(createdAt,'%Y-%m-%dT%H:%i:%s.%fZ') AS createdAt,completedAt,IF(OCTET_LENGTH(JSON_UNQUOTE(input))<=8388608,JSON_UNQUOTE(input),NULL) AS input,IF(OCTET_LENGTH(JSON_UNQUOTE(output))<=16777216,JSON_UNQUOTE(output),NULL) AS output";
  async function load(tx: ListingConfiguredExecutor, identity: ListingConfiguredIdentity, scope: ListingConfiguredOperationInput): Promise<ListingConfiguredRun | null> {
    const runId = listingConfiguredRunId(identity, scope.operationId), found = await rows(tx, `SELECT ${projection} FROM ai_jobs WHERE runId=? AND BINARY runId=BINARY ? LIMIT 2 FOR UPDATE`, [runId, runId], 1);
    if (!found.length) return null; const row = found[0], input = inputSchema.parse(json(row.input)), output = outputSchema.parse(json(row.output, 16777216));
    if (row.workspaceId !== identity.workspaceId || row.userId !== identity.userId || row.projectId !== scope.projectId || row.kind !== LISTING_CONFIGURED_KIND || row.module !== "listing" || row.procedure !== "listing.configuredStart" || row.maxAttempts !== 1 || ![0, 1].includes(Number(row.attempt))
      || row.status !== dbState(output.state) || terminal(output.state) !== (row.completedAt !== null) || !equal(input.identity, identity) || !equal(listingConfiguredOperationScope(input.request), scope)
      || input.requestHash !== hash({ identity, request: input.request }) || input.sourceHash !== input.request.expectedSourceHash || input.runtimeSnapshot.snapshotHash !== input.request.expectedRuntimeHash) fail("RUN_INVALID");
    const stored = await artifact(tx, identity, scope, "listing.generation.source.v1", runId), source = ListingConfiguredSourceSchema.parse(stored.value);
    const { sourceHash, draftHash, ...sourceBody } = source;
    if (sourceHash !== input.sourceHash || sourceHash !== hash(sourceBody) || draftHash !== hash(source.tables.listings) || stored.artifactId !== input.sourceArtifactId) fail("SOURCE_INVALID");
    const run = { ...input, ...output, id: Number(row.id), runId, lockedBy: row.lockedBy as string | null, leaseUntil: row.leaseUntil === null ? null : Number(row.leaseUntil), source, createdAt: String(row.createdAt) };
    if (!equal(input.configuration, input.runtimeSnapshot.configuration) || input.runtimeSnapshot.sourceHash !== sourceHash || input.runtimeSnapshot.operationId !== scope.operationId
      || !equal(input.runtimeSnapshot.entries.map(entry => entry.approval.operation), listingConfiguredOperations(input.request.operation))) fail("RUN_INVALID");
    for (const [index, item] of run.steps.entries()) {
      const expected = listingConfiguredNextStage({ ...run, steps: run.steps.slice(0, index) });
      if (!expected || !equal(expected.attempt, item.attempt) || !item.dispatch) fail("CHECKPOINT_INVALID");
      if (item.returned && !item.dispatch || item.returned && !equal(validateListingConfiguredReturned(source, item.attempt, item.returned.content), item.returned)) fail("CHECKPOINT_INVALID");
      if (item.dispatch) {
        const d = item.dispatch, entry = run.runtimeSnapshot.entries.find(value => value.approval.operation === item.attempt.operation), model = entry?.models[item.attempt.modelIndex];
        if (!entry || !model || d.snapshotHash !== run.runtimeSnapshot.snapshotHash || d.receipt.requestHash !== d.providerRequestHash || d.receipt.modelConfigurationHash !== model.configurationHash || d.receipt.bindingHash !== d.bindingHash
          || d.bindingHash !== hash({ schema: "listing-configured-dispatch/v1", attempt: item.attempt, contextHash: d.contextHash, snapshotHash: d.snapshotHash, providerRequestHash: d.providerRequestHash })) fail("DISPATCH_INVALID");
      }
    }
    if (run.state === "succeeded") {
      const candidate = listingConfiguredCandidate(run), storedCandidate = await artifact(tx, identity, scope, "listing.generation.candidate.v1", runId);
      if (!equal(storedCandidate.value, candidate) || listingConfiguredNextStage(run) !== null) fail("RESULT_INVALID");
    } else if (run.resultHash !== null) fail("RESULT_INVALID");
    return run;
  }
  function output(run: ListingConfiguredRun) { return outputSchema.parse({ version: 1, state: run.state, steps: run.steps, resultHash: run.resultHash, errorCode: run.errorCode }); }
  async function update(tx: ListingConfiguredExecutor, run: ListingConfiguredRun, next: z.infer<typeof outputSchema>, lease?: ListingConfiguredLease, release = false) {
    if (Buffer.byteLength(canonical(next)) > 16777216) fail("CHECKPOINT_LIMIT");
    await write(tx, `UPDATE ai_jobs SET output=JSON_QUOTE(?),status=?,completedAt=${terminal(next.state) ? "NOW(3)" : "NULL"},lockedBy=${release || terminal(next.state) ? "NULL" : "lockedBy"},leaseUntil=${release || terminal(next.state) ? "NULL" : "leaseUntil"},updatedAt=NOW(3) WHERE id=? AND runId=? AND status=? AND ${lease ? "lockedBy=? AND leaseUntil>NOW(6) AND " : ""}BINARY JSON_UNQUOTE(output)=BINARY ?`,
      [canonical(next), dbState(next.state), run.id, run.runId, dbState(run.state), ...(lease ? [lease.token] : []), canonical(output(run))]);
    const actual = await load(tx, run.identity, listingConfiguredOperationScope(run.request)); if (!actual || !equal(output(actual), next)) fail("CHECKPOINT_ACK_UNKNOWN"); return actual;
  }
  async function leaseRun(tx: ListingConfiguredExecutor, lease: ListingConfiguredLease) {
    const run = await load(tx, lease.identity, lease.scope), clock = await rows(tx, "SELECT UNIX_TIMESTAMP(NOW(6)) AS nowSeconds", [], 1);
    if (!run || run.runId !== lease.runId || run.lockedBy !== lease.token || !run.leaseUntil || run.leaseUntil <= Number(clock[0]?.nowSeconds) || terminal(run.state)) fail("LEASE_LOST"); return run;
  }
  async function current(tx: ListingConfiguredExecutor, run: ListingConfiguredRun) { const actual = await capture(tx, run.identity, ListingConfiguredPreviewInputSchema.parse(Object.fromEntries(Object.keys(ListingConfiguredPreviewInputSchema.shape).map(key => [key, run.request[key as keyof ListingConfiguredStartInput]]))));
    if (actual.sourceHash !== run.sourceHash) fail("SOURCE_CHANGED"); return actual; }
  return {
    readSource(identity: ListingConfiguredIdentity, input: ListingConfiguredPreviewInput) { return transaction(identity, input, "read", tx => capture(tx, identity, input)); },
    preview(identity: ListingConfiguredIdentity, input: ListingConfiguredPreviewInput, prepare: ListingConfiguredPrepare) { return transaction(identity, input, "run", async tx => { if (!enabled()) fail("WRITES_DISABLED"); const source = await capture(tx, identity, input); return { source, ...await prepare(tx, source) }; }); },
    reserve(identity: ListingConfiguredIdentity, raw: ListingConfiguredStartInput, prepare: ListingConfiguredPrepare) { const input = ListingConfiguredStartInputSchema.parse(raw), scope = listingConfiguredOperationScope(input); return transaction(identity, scope, "run", async (tx, role) => {
      const canceled = await audit(tx, identity, scope, role, "cancel", startReceipt); if (canceled) return canceled;
      const old = await audit(tx, identity, scope, role, "start", startReceipt), requestHash = hash({ identity, request: input });
      if (old) { if (old.requestHash !== requestHash) fail("OPERATION_CONTENT_CONFLICT"); await load(tx, identity, scope); return old; }
      if (!enabled()) fail("WRITES_DISABLED"); const source = await capture(tx, identity, ListingConfiguredPreviewInputSchema.parse(Object.fromEntries(Object.keys(ListingConfiguredPreviewInputSchema.shape).map(key => [key, input[key as keyof ListingConfiguredStartInput]]))));
      const prepared = await prepare(tx, source); if (source.sourceHash !== input.expectedSourceHash || prepared.runtimeSnapshot.snapshotHash !== input.expectedRuntimeHash || prepared.runtimeSnapshot.maxCostCents > input.maxCostCents) fail("PREVIEW_CHANGED");
      const active = await rows(tx, "SELECT id FROM ai_jobs WHERE projectId=? AND workspaceId=? AND kind=? AND (status IN ('queued','running') OR JSON_UNQUOTE(JSON_EXTRACT(CAST(JSON_UNQUOTE(output) AS JSON),'$.state'))='outcome_unknown') LIMIT 2 FOR UPDATE", [input.projectId, identity.workspaceId, LISTING_CONFIGURED_KIND], 2); if (active.length) fail("ACTIVE_OPERATION_EXISTS");
      const runId = listingConfiguredRunId(identity, input.operationId), original = await artifact(tx, identity, scope, "listing.generation.source.v1", runId, source);
      const saved = inputSchema.parse({ version: 1, identity, request: input, requestHash, sourceArtifactId: original.artifactId, sourceHash: source.sourceHash, ...prepared });
      await write(tx, "INSERT INTO ai_jobs (runId,workspaceId,userId,projectId,kind,module,`procedure`,queueName,status,progress,attempt,maxAttempts,input,output) VALUES (?,?,?,? ,?,'listing','listing.configuredStart','listing_configured','queued',0,0,1,JSON_QUOTE(?),JSON_QUOTE(?))", [runId, identity.workspaceId, identity.userId, input.projectId, LISTING_CONFIGURED_KIND, canonical(saved), canonical({ version: 1, state: "queued", steps: [], resultHash: null, errorCode: null })]);
      if (!await load(tx, identity, scope)) fail("WRITE_UNCONFIRMED"); return audit(tx, identity, scope, role, "start", startReceipt, { identity, scope, status: "reserved", requestHash, runId });
    }); },
    check(identity: ListingConfiguredIdentity, scope: ListingConfiguredOperationInput) { return transaction(identity, scope, "read", async (tx, role) => ({ run: await load(tx, identity, scope), receipt: await audit(tx, identity, scope, role, "cancel", startReceipt) })); },
    cancel(identity: ListingConfiguredIdentity, scope: ListingConfiguredOperationInput) { return transaction(identity, scope, "update", async (tx, role) => {
      const existing = await audit(tx, identity, scope, role, "cancel", startReceipt), run = await load(tx, identity, scope);
      const receipt = existing ?? await audit(tx, identity, scope, role, "cancel", startReceipt, { identity, scope, status: "cancelled", requestHash: null, runId: run?.runId ?? null });
      return { receipt, run: run && !["succeeded", "failed", "canceled"].includes(run.state) ? await update(tx, run, { ...output(run), state: "canceled", errorCode: "CANCELED" }, undefined, true) : run };
    }); },
    claim(identity: ListingConfiguredIdentity, scope: ListingConfiguredOperationInput, workerId: string) { return transaction(identity, scope, "run", async tx => {
      if (!enabled()) return null; let run = await load(tx, identity, scope); if (!run || terminal(run.state)) return null;
      const clock = await rows(tx, "SELECT UNIX_TIMESTAMP(NOW(6)) AS nowSeconds", [], 1); if (run.leaseUntil && run.leaseUntil > Number(clock[0]?.nowSeconds)) return null;
      if (run.steps.some(item => item.dispatch && !item.returned)) { await update(tx, run, { ...output(run), state: "outcome_unknown", errorCode: "DISPATCH_OUTCOME_UNKNOWN" }, undefined, true); return null; }
      const token = `${workerId.slice(0, 60)}:${randomUUID()}`;
      await write(tx, "UPDATE ai_jobs SET lockedBy=?,leaseUntil=DATE_ADD(NOW(6),INTERVAL 120 SECOND),status='running',attempt=1,output=JSON_QUOTE(?),updatedAt=NOW(3) WHERE id=? AND (leaseUntil IS NULL OR leaseUntil<=NOW(6))", [token, canonical({ ...output(run), state: "running" }), run.id]);
      run = await load(tx, identity, scope); if (!run || run.lockedBy !== token) fail("LEASE_LOST"); return { identity, scope, token, runId: run.runId };
    }); },
    heartbeat(lease: ListingConfiguredLease) { return transaction(lease.identity, lease.scope, "run", async tx => { const run = await leaseRun(tx, lease); await write(tx, "UPDATE ai_jobs SET leaseUntil=DATE_ADD(NOW(6),INTERVAL 120 SECOND) WHERE id=? AND lockedBy=? AND leaseUntil>NOW(6)", [run.id, lease.token]); }); },
    prepareStage<T>(lease: ListingConfiguredLease, prepare: (tx: ListingConfiguredExecutor, run: ListingConfiguredRun, source: ListingConfiguredSource, attempt: z.infer<typeof ListingConfiguredAttemptSchema>, previous: ListingConfiguredReturned | null) => Promise<T>) { return transaction(lease.identity, lease.scope, "run", async tx => {
      if (!enabled()) fail("WRITES_DISABLED"); const run = await leaseRun(tx, lease), source = await current(tx, run), next = listingConfiguredNextStage(run);
      // Reserve the worst-case JSON escaping space for the bounded next reply
      // before another fee. Existing responses are never silently truncated.
      if (Buffer.byteLength(canonical(output(run))) + 7 * 1048576 > 16777216) fail("CHECKPOINT_LIMIT");
      if (!next) fail("ALREADY_COMPLETE"); return prepare(tx, run, source, next.attempt, next.previous);
    }); },
    dispatch(lease: ListingConfiguredLease, attempt: z.infer<typeof ListingConfiguredAttemptSchema>, value: z.infer<typeof dispatch>, verify: (tx: ListingConfiguredExecutor, run: ListingConfiguredRun, source: ListingConfiguredSource) => Promise<void>) { return transaction(lease.identity, lease.scope, "run", async tx => {
      if (!enabled()) fail("WRITES_DISABLED"); const run = await leaseRun(tx, lease); if (run.steps.some(item => item.dispatch && !item.returned)) fail("DISPATCH_OUTCOME_UNKNOWN");
      const next = listingConfiguredNextStage(run); if (!next || !equal(next.attempt, attempt)) fail("ATTEMPT_INVALID"); const source = await current(tx, run); await verify(tx, run, source);
      return update(tx, run, { ...output(run), state: "dispatched", steps: [...run.steps, { attempt, dispatch: dispatch.parse(value), returned: null }] }, lease);
    }); },
    returned(lease: ListingConfiguredLease, value: { attempt: z.infer<typeof ListingConfiguredAttemptSchema>; runId: string; bindingHash: string; returned: ListingConfiguredReturned }) { return transaction(lease.identity, lease.scope, "update", async tx => {
      const run = await leaseRun(tx, lease), last = run.steps.at(-1); if (!last || !last.dispatch || last.returned || !equal(last.attempt, value.attempt) || last.dispatch.receipt.runId !== value.runId || last.dispatch.bindingHash !== value.bindingHash) fail("RESULT_INVALID");
      const validated = validateListingConfiguredReturned(run.source, value.attempt, value.returned.content); if (!equal(validated, value.returned)) fail("RESULT_INVALID"); last.returned = validated;
      const next = listingConfiguredNextAttempt(run.runtimeSnapshot, last.attempt, validated), ops = listingConfiguredOperations(run.request.operation), complete = next === null && ops.at(-1) === last.attempt.operation;
      const nextOutput = { ...output(run), state: (complete ? "succeeded" : next === "exhausted" ? "failed" : "running") as ListingConfiguredRun["state"], errorCode: next === "exhausted" ? "QUALITY_EXHAUSTED" : null };
      if (complete) { const outputs = Object.fromEntries(run.steps.filter(item => item.returned?.candidate && !item.returned.issues.length).map(item => [item.attempt.operation, item.returned!.candidate]));
        const candidate = ListingConfiguredCandidateSchema.parse({ version: 1, operation: run.request.operation, outputs, requiresHumanReview: true, sourceHash: run.sourceHash }); nextOutput.resultHash = hash(candidate);
        await artifact(tx, run.identity, lease.scope, "listing.generation.candidate.v1", run.runId, candidate); }
      // Preserve the pre-update CAS: response mutation is represented only in nextOutput.
      const before = await load(tx, lease.identity, lease.scope); if (!before) fail("RUN_INVALID"); return update(tx, before, nextOutput, lease);
    }); },
    failure(lease: ListingConfiguredLease, code: string) { return transaction(lease.identity, lease.scope, "update", async tx => { const run = await leaseRun(tx, lease); const pending = run.steps.some(item => item.dispatch && !item.returned);
      if (run.steps.at(-1)?.returned) return; return update(tx, run, { ...output(run), state: pending ? "outcome_unknown" : "failed", errorCode: pending ? "DISPATCH_OUTCOME_UNKNOWN" : /^[A-Z_]{1,120}$/u.test(code) ? code : "FAILED" }, lease, true); }); },
    apply(identity: ListingConfiguredIdentity, raw: ListingConfiguredApplyInput) { const input = ListingConfiguredApplyInputSchema.parse(raw), scope = listingConfiguredOperationScope(input), auditScope = { ...scope, operationId: input.applyOperationId };
      return transaction(identity, scope, "update", async (tx, role) => {
        const old = await audit(tx, identity, auditScope, role, "apply", ListingConfiguredApplyReceiptSchema), requestHash = hash({ identity, request: input });
        const applyScope = ListingConfiguredApplyOperationInputSchema.parse({ ...scope, applyOperationId: input.applyOperationId });
        if (old) { if (!equal(old.scope, applyScope) || old.status !== "cancelled" && old.requestHash !== requestHash) fail("OPERATION_CONTENT_CONFLICT"); return old; }
        if (!enabled()) fail("WRITES_DISABLED"); const run = await load(tx, identity, scope); if (!run || run.state !== "succeeded" || run.resultHash !== input.expectedResultHash || run.sourceHash !== input.expectedSourceHash) fail("CANDIDATE_UNAVAILABLE");
        const source = await current(tx, run); if (source.draftHash !== input.expectedDraftHash) fail("DRAFT_CHANGED");
        const publication = await (deps.publish ?? applyListingConfiguredCandidate)(tx, run, input);
        const candidate = listingConfiguredCandidate(run)!;
        const agent = await projectListingConfiguredApplied(tx, { identity, projectId: input.projectId, operation: run.request.operation, outputs: candidate.outputs,
          listingId: publication.listingId, candidateIds: publication.candidateIds, sourceHash: run.sourceHash, resultHash: run.resultHash!, applyOperationId: input.applyOperationId });
        const receipt = ListingConfiguredApplyReceiptSchema.parse({ identity, scope: applyScope, status: "committed", requestHash, resultHash: run.resultHash,
          afterHash: publication.afterHash, listingId: publication.listingId, candidateIds: publication.candidateIds, reasonCode: null });
        await artifact(tx, identity, auditScope, "listing.generation.apply.v1", run.runId, { version: 1, identity, projectId: input.projectId, operationId: input.operationId,
          applyOperationId: input.applyOperationId, operation: run.request.operation, sourceHash: run.sourceHash, resultHash: run.resultHash,
          before: source.tables, after: publication.after, candidate, receipt, ...agent });
        const final = await audit(tx, identity, auditScope, role, "apply", ListingConfiguredApplyReceiptSchema, receipt); if (!final) fail("JOURNAL_ACK_UNKNOWN"); return final;
      }); },
    applyCheck(identity: ListingConfiguredIdentity, input: ListingConfiguredApplyOperationInput) { return transaction(identity, input, "read", async (tx, role) => { const receipt = await audit(tx, identity, { ...listingConfiguredOperationScope(input), operationId: input.applyOperationId }, role, "apply", ListingConfiguredApplyReceiptSchema);
      if (receipt && !equal(receipt.scope, input)) fail("OPERATION_SCOPE_CONFLICT"); return receipt; }); },
    applyCancel(identity: ListingConfiguredIdentity, input: ListingConfiguredApplyOperationInput) { return transaction(identity, input, "update", async (tx, role) => {
      const scope = { ...listingConfiguredOperationScope(input), operationId: input.applyOperationId };
      const existing = await audit(tx, identity, scope, role, "apply", ListingConfiguredApplyReceiptSchema); if (existing && !equal(existing.scope, input)) fail("OPERATION_SCOPE_CONFLICT");
      return existing ?? audit(tx, identity, scope, role, "apply", ListingConfiguredApplyReceiptSchema,
        { identity, scope: input, status: "cancelled", requestHash: null, resultHash: null, afterHash: null, listingId: null, candidateIds: [], reasonCode: "CANCELLED" }); }); },
    history(identity: ListingConfiguredIdentity, input: { expectedWorkspaceId: number; projectId: number; beforeId: number | null; limit: number }) {
      return transaction(identity, { ...input, operationId: "00000000-0000-4000-8000-000000000000" }, "read", async tx => {
        const found = await rows(tx, `SELECT id,JSON_UNQUOTE(JSON_EXTRACT(CAST(JSON_UNQUOTE(input) AS JSON),'$.request.operationId')) AS operationId FROM ai_jobs WHERE workspaceId=? AND userId=? AND projectId=? AND kind=?${input.beforeId === null ? "" : " AND id<?"} ORDER BY id DESC LIMIT ?`, [identity.workspaceId, identity.userId, input.projectId, LISTING_CONFIGURED_KIND, ...(input.beforeId === null ? [] : [input.beforeId]), input.limit + 1], input.limit + 1);
        const items = []; for (const row of found.slice(0, input.limit)) { const run = await load(tx, identity, { expectedWorkspaceId: identity.workspaceId, projectId: input.projectId, operationId: String(row.operationId) }); if (!run) fail("RUN_INVALID"); items.push({ id: run.id, operationId: run.request.operationId, operation: run.request.operation, state: run.state, sourceHash: run.sourceHash, createdAt: run.createdAt }); }
        return { items, nextBeforeId: found.length > input.limit ? Number(found[input.limit - 1].id) : null };
      }); },
  };
}
export const listingConfiguredRepository = createListingConfiguredRepository();
