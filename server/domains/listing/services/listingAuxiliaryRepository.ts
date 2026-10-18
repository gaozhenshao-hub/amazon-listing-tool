import { randomUUID } from "node:crypto";
import { z } from "zod";
import { requireDb } from "../../../repositories/dbClient";
import { LISTING_AUXILIARY_KIND, ListingAuxiliaryIdentitySchema, ListingAuxiliaryOperationInputSchema, ListingAuxiliaryStartInputSchema,
  ListingAuxiliaryCandidateSchema, ListingAuxiliaryApplyInputSchema, ListingAuxiliaryApplyOperationInputSchema, ListingAuxiliaryApplyReceiptSchema,
  listingAuxiliaryCanonical as canonical, listingAuxiliaryHash as hash, listingAuxiliaryTargets, listingAuxiliaryPreviewRequest, LISTING_AUXILIARY_DEFINITIONS, type ListingAuxiliaryIdentity, type ListingAuxiliaryOperationInput,
  type ListingAuxiliaryPreviewInput, type ListingAuxiliaryStartInput, type ListingAuxiliaryApplyInput, type ListingAuxiliaryApplyOperationInput } from "../../../../shared/listingAuxiliaryWorkflow";
import { ListingAuxiliarySourceSchema, captureListingAuxiliarySource, assertListingAuxiliarySchema, listingAuxiliaryRows as rows, listingAuxiliaryJson as json,
  listingAuxiliaryWrite as write, listingAuxiliaryFail as fail, ListingAuxiliaryError, type ListingAuxiliaryExecutor, type ListingAuxiliarySource } from "./listingAuxiliarySource";
import { ListingAuxiliaryRuntimeSnapshotSchema, ListingAuxiliaryConfigurationSchema, ListingAuxiliaryAttemptSchema, ListingAuxiliaryDispatchSchema,
  type ListingAuxiliaryConfiguration, type ListingAuxiliaryRuntimeSnapshot } from "./listingAuxiliaryRuntimeContract";
import { listingAuxiliaryNextAttempt, validateListingAuxiliaryReturned, type ListingAuxiliaryReturned } from "./listingAuxiliaryRuntime";
import { applyListingAuxiliaryCandidate } from "./listingAuxiliaryPublication";
import { projectListingConfiguredApplied } from "./listingConfiguredAgentProjection";
import { authorizeListingConfigured } from "./listingConfiguredRepository";
const authorizeListingAuxiliary = authorizeListingConfigured;
const h = z.string().regex(/^[a-f0-9]{64}$/u), bounded = z.string().max(160), equal = (a: unknown, b: unknown) => canonical(a) === canonical(b);
export const listingAuxiliaryEnabled = () => process.env.ENABLE_LISTING_AUXILIARY_WRITES === "true";
const dispatch = z.object({ receipt: ListingAuxiliaryDispatchSchema, contextHash: h, snapshotHash: h, bindingHash: h, providerRequestHash: h }).strict();
const returned = z.object({ content: z.string().max(1048576), candidate: z.record(z.string(), z.unknown()).nullable(), issues: z.array(z.string().max(2000)).max(100), formatInvalid: z.boolean() }).strict();
const step = z.object({ attempt: ListingAuxiliaryAttemptSchema, dispatch: dispatch.nullable(), returned: returned.nullable() }).strict();
const outputSchema = z.object({ version: z.literal(1), state: z.enum(["queued", "running", "dispatched", "succeeded", "failed", "canceled", "outcome_unknown"]),
  steps: z.array(step).max(54), resultHash: h.nullable(), errorCode: bounded.nullable() }).strict();
const inputSchema = z.object({ version: z.literal(1), identity: ListingAuxiliaryIdentitySchema, request: ListingAuxiliaryStartInputSchema, requestHash: h,
  sourceArtifactId: z.string().max(80), sourceHash: h, configuration: ListingAuxiliaryConfigurationSchema, runtimeSnapshot: ListingAuxiliaryRuntimeSnapshotSchema }).strict();
const startReceipt = z.object({ identity: ListingAuxiliaryIdentitySchema, scope: ListingAuxiliaryOperationInputSchema, status: z.enum(["reserved", "cancelled"]),
  requestHash: h.nullable(), runId: z.string().max(80).nullable() }).strict();
export type ListingAuxiliaryRun = z.infer<typeof inputSchema> & z.infer<typeof outputSchema> & { id: number; runId: string; lockedBy: string | null; leaseUntil: number | null; source: ListingAuxiliarySource; createdAt: string };
export type ListingAuxiliaryLease = { identity: ListingAuxiliaryIdentity; scope: ListingAuxiliaryOperationInput; token: string; runId: string };
export type ListingAuxiliaryPrepare = (executor: ListingAuxiliaryExecutor, source: ListingAuxiliarySource) => Promise<{ configuration: ListingAuxiliaryConfiguration; runtimeSnapshot: ListingAuxiliaryRuntimeSnapshot }>;
export const listingAuxiliaryRunId = (identity: ListingAuxiliaryIdentity, operationId: string) => `laux_${hash({ identity, operationId })}`;
export const listingAuxiliaryOperationScope = (input: ListingAuxiliaryOperationInput) => ListingAuxiliaryOperationInputSchema.parse({ expectedWorkspaceId: input.expectedWorkspaceId, projectId: input.projectId, operationId: input.operationId });
const terminal = (state: string) => ["succeeded", "failed", "canceled", "outcome_unknown"].includes(state);
const dbState = (state: string) => state === "dispatched" ? "running" : state === "outcome_unknown" ? "failed" : state;
export function listingAuxiliaryCandidate(run: ListingAuxiliaryRun) {
  if (run.state !== "succeeded") return null;
  const result = buildCandidate(run);
  if (hash(result) !== run.resultHash) fail("RESULT_INVALID"); return result;
}
function buildCandidate(run: Pick<ListingAuxiliaryRun,"steps"|"request"|"sourceHash"|"source">) {
  const targets = listingAuxiliaryTargets(run.source.request).map(target => {
    const successful = run.steps.filter(item => item.attempt.targetIndex === target.targetIndex && item.returned?.candidate && !item.returned.issues.length);
    if (successful.length !== 1) fail("RESULT_INVALID");
    return { targetIndex: target.targetIndex, targetHash: target.targetHash, result: successful[0].returned!.candidate };
  });
  return ListingAuxiliaryCandidateSchema.parse({ version: 1, operation: run.request.operation, targets, requiresHumanReview: true, sourceHash: run.sourceHash, draftHash: run.source.draftHash });
}
export function listingAuxiliaryNextStage(run: Pick<ListingAuxiliaryRun, "steps" | "request" | "runtimeSnapshot">) {
  const last = run.steps.at(-1);
  if (!last) return { attempt: { operation: run.request.operation, targetIndex: 0, qualityAttempt: 0, modelIndex: 0 }, previous: null };
  if (!last.returned) fail("DISPATCH_OUTCOME_UNKNOWN");
  const next = listingAuxiliaryNextAttempt(run.runtimeSnapshot, last.attempt, last.returned);
  if (next === "exhausted") fail("QUALITY_EXHAUSTED");
  if (next) return { attempt: next, previous: last.returned };
  const targetIndex = last.attempt.targetIndex + 1;
  if (targetIndex >= run.runtimeSnapshot.targetCount) return null;
  return { attempt: { operation: run.request.operation, targetIndex, qualityAttempt: 0, modelIndex: 0 }, previous: null };
}
export function createListingAuxiliaryRepository(deps: { database?: () => Promise<{ transaction<T>(body: (tx: ListingAuxiliaryExecutor) => Promise<T>): Promise<T> } | null>;
  authorize?: typeof authorizeListingAuxiliary; schema?: typeof assertListingAuxiliarySchema; capture?: typeof captureListingAuxiliarySource;
  enabled?: () => boolean; publish?: typeof applyListingAuxiliaryCandidate } = {}) {
  const database = deps.database ?? (() => requireDb("Configured Listing")), authorize = deps.authorize ?? authorizeListingAuxiliary, capture = deps.capture ?? captureListingAuxiliarySource, enabled = deps.enabled ?? listingAuxiliaryEnabled;
  async function transaction<T>(identity: ListingAuxiliaryIdentity, scope: ListingAuxiliaryOperationInput | ListingAuxiliaryPreviewInput, action: "read" | "run" | "update", body: (tx: ListingAuxiliaryExecutor, role: string) => Promise<T>): Promise<T> {
    ListingAuxiliaryIdentitySchema.parse(identity); if (scope.expectedWorkspaceId !== identity.workspaceId) fail("ACCESS_DENIED");
    const db = await database(); if (!db) fail("STORAGE_UNAVAILABLE");
    try { return await db.transaction(async tx => { await (deps.schema ?? assertListingAuxiliarySchema)(tx); const actor = await authorize(tx, identity, scope, action); return body(tx, actor.role); }); }
    catch (error) { if (error instanceof ListingAuxiliaryError) throw error; fail("OUTCOME_UNKNOWN_CHECK_SAME_UUID"); }
  }
  const auditId = (identity: ListingAuxiliaryIdentity, id: string, kind: string) => `laux_${kind}_${hash({ identity, id })}`;
  async function audit<T>(tx: ListingAuxiliaryExecutor, identity: ListingAuxiliaryIdentity, scope: ListingAuxiliaryOperationInput, role: string, kind: "start" | "cancel" | "apply", schema: z.ZodType<T>, value?: T): Promise<T | null> {
    const key = auditId(identity, scope.operationId, kind), records = await rows(tx, "SELECT auditId,workspaceId,actorUserId,action,resourceType,resourceId,projectId,status,IF(OCTET_LENGTH(metadata)<=65536,metadata,NULL) AS metadata FROM security_audit_logs WHERE auditId=? AND BINARY auditId=BINARY ? LIMIT 2 FOR UPDATE", [key, key], 1);
    if (records.length) {
      const record = records[0]; if (record.workspaceId !== identity.workspaceId || record.actorUserId !== identity.userId || record.projectId !== scope.projectId || record.action !== `listing.auxiliary.${kind}` || record.resourceType !== "listing_auxiliary" || record.resourceId !== scope.operationId || record.status !== "success") fail("OPERATION_SCOPE_CONFLICT");
      const parsed = z.object({ scope: ListingAuxiliaryOperationInputSchema, receipt: schema }).strict().parse(json(record.metadata, 65536));
      if (!equal(parsed.scope, listingAuxiliaryOperationScope(scope)) || value !== undefined && !equal(parsed.receipt, value)) fail("OPERATION_CONTENT_CONFLICT"); return parsed.receipt;
    }
    if (value === undefined) return null;
    await write(tx, "INSERT INTO security_audit_logs (auditId,workspaceId,actorUserId,actorRole,action,resourceType,resourceId,projectId,status,riskLevel,metadata) VALUES (?,?,?,?,?,'listing_auxiliary',?,?,'success','medium',?)",
      [key, identity.workspaceId, identity.userId, role, `listing.auxiliary.${kind}`, scope.operationId, scope.projectId, canonical({ scope: listingAuxiliaryOperationScope(scope), receipt: schema.parse(value) })]);
    const readback = await audit(tx, identity, scope, role, kind, schema);
    if (readback === null) fail("JOURNAL_ACK_UNKNOWN"); return readback;
  }
  async function artifact(tx: ListingAuxiliaryExecutor, identity: ListingAuxiliaryIdentity, scope: ListingAuxiliaryOperationInput, key: string, runId: string, body?: unknown) {
    const artifactId = `laux_${hash({ identity, operationId: scope.operationId, key })}`;
    if (body !== undefined && Buffer.byteLength(canonical(body)) > 16777216) fail("ARTIFACT_LIMIT");
    if (body !== undefined) await write(tx, "INSERT INTO ai_artifacts (workspaceId,userId,projectId,artifactId,domain,artifactKey,artifactType,sourceType,sourceTable,sourceRowId,runId,sourceAiJobRunId,status,isCurrent,version,contentJson,contentHash) VALUES (?,?,?,?,'listing',?,'json','system','projects',?,?,?,'draft',0,1,JSON_QUOTE(?),?)",
      [identity.workspaceId, identity.userId, scope.projectId, artifactId, key, String(scope.projectId), runId, runId, canonical(body), hash(body)]);
    const found = await rows(tx, "SELECT workspaceId,userId,projectId,artifactId,domain,artifactKey,artifactType,sourceType,sourceTable,sourceRowId,runId,sourceAiJobRunId,status,isCurrent,version,IF(OCTET_LENGTH(JSON_UNQUOTE(contentJson))<=16777216,JSON_UNQUOTE(contentJson),NULL) AS contentJson,contentHash FROM ai_artifacts WHERE artifactId=? AND BINARY artifactId=BINARY ? LIMIT 2 FOR SHARE", [artifactId, artifactId], 1);
    const row = found[0]; if (!row || row.artifactId !== artifactId || row.domain !== "listing" || row.artifactType !== "json" || row.sourceType !== "system" || row.workspaceId !== identity.workspaceId || row.userId !== identity.userId || row.projectId !== scope.projectId || row.artifactKey !== key || row.runId !== runId || row.sourceAiJobRunId !== runId || row.sourceTable !== "projects" || row.sourceRowId !== String(scope.projectId) || row.status !== "draft" || row.isCurrent !== 0 || row.version !== 1) fail("ARTIFACT_INVALID");
    const value = json(row.contentJson, 16777216); if (hash(value) !== row.contentHash || body !== undefined && !equal(value, body)) fail("ARTIFACT_INVALID"); return { artifactId, value };
  }
  const projection = "id,runId,workspaceId,userId,projectId,kind,module,`procedure`,status,attempt,maxAttempts,lockedBy,UNIX_TIMESTAMP(leaseUntil) AS leaseUntil,DATE_FORMAT(createdAt,'%Y-%m-%dT%H:%i:%s.%fZ') AS createdAt,completedAt,IF(OCTET_LENGTH(JSON_UNQUOTE(input))<=8388608,JSON_UNQUOTE(input),NULL) AS input,IF(OCTET_LENGTH(JSON_UNQUOTE(output))<=16777216,JSON_UNQUOTE(output),NULL) AS output";
  async function load(tx: ListingAuxiliaryExecutor, identity: ListingAuxiliaryIdentity, scope: ListingAuxiliaryOperationInput): Promise<ListingAuxiliaryRun | null> {
    const runId = listingAuxiliaryRunId(identity, scope.operationId), found = await rows(tx, `SELECT ${projection} FROM ai_jobs WHERE runId=? AND BINARY runId=BINARY ? LIMIT 2 FOR UPDATE`, [runId, runId], 1);
    if (!found.length) return null; const row = found[0], input = inputSchema.parse(json(row.input)), output = outputSchema.parse(json(row.output, 16777216));
    if (row.workspaceId !== identity.workspaceId || row.userId !== identity.userId || row.projectId !== scope.projectId || row.kind !== LISTING_AUXILIARY_KIND || row.module !== "listing" || row.procedure !== "listing.auxiliaryStart" || row.maxAttempts !== 1 || ![0, 1].includes(Number(row.attempt))
      || row.status !== dbState(output.state) || terminal(output.state) !== (row.completedAt !== null) || !equal(input.identity, identity) || !equal(listingAuxiliaryOperationScope(input.request), scope)
      || input.requestHash !== hash({ identity, request: input.request }) || input.sourceHash !== input.request.expectedSourceHash || input.runtimeSnapshot.snapshotHash !== input.request.expectedRuntimeHash) fail("RUN_INVALID");
    const stored = await artifact(tx, identity, scope, "listing.auxiliary.source.v1", runId), source = ListingAuxiliarySourceSchema.parse(stored.value);
    const { sourceHash, draftHash, ...sourceBody } = source;
    if (sourceHash !== input.sourceHash || sourceHash !== hash(sourceBody) || draftHash !== hash({ operation: source.request.operation, payload: source.request.payload }) || stored.artifactId !== input.sourceArtifactId) fail("SOURCE_INVALID");
    const run = { ...input, ...output, id: Number(row.id), runId, lockedBy: row.lockedBy as string | null, leaseUntil: row.leaseUntil === null ? null : Number(row.leaseUntil), source, createdAt: String(row.createdAt) };
    if (!equal(input.configuration, input.runtimeSnapshot.configuration) || input.runtimeSnapshot.sourceHash !== sourceHash || input.runtimeSnapshot.operationId !== scope.operationId
      || !equal(input.runtimeSnapshot.entries.map(entry => entry.approval.operation), [input.request.operation])) fail("RUN_INVALID");
    for (const [index, item] of run.steps.entries()) {
      const expected = listingAuxiliaryNextStage({ ...run, steps: run.steps.slice(0, index) });
      if (!expected || !equal(expected.attempt, item.attempt) || !item.dispatch) fail("CHECKPOINT_INVALID");
      if (item.returned && !item.dispatch || item.returned && !equal(validateListingAuxiliaryReturned(source, item.attempt, item.returned.content), item.returned)) fail("CHECKPOINT_INVALID");
      if (item.dispatch) {
        const d = item.dispatch, entry = run.runtimeSnapshot.entries.find(value => value.approval.operation === item.attempt.operation), model = entry?.models[item.attempt.modelIndex];
        if (!entry || !model || d.receipt.stage !== LISTING_AUXILIARY_DEFINITIONS[item.attempt.operation].stage || d.snapshotHash !== run.runtimeSnapshot.snapshotHash || d.receipt.requestHash !== d.providerRequestHash || d.receipt.modelConfigurationHash !== model.configurationHash || d.receipt.bindingHash !== d.bindingHash
          || d.bindingHash !== hash({ schema: "listing-auxiliary-dispatch/v1", attempt: item.attempt, contextHash: d.contextHash, snapshotHash: d.snapshotHash, providerRequestHash: d.providerRequestHash })) fail("DISPATCH_INVALID");
      }
    }
    const pending = run.steps.some(item => item.dispatch && !item.returned);
    if (pending && !["dispatched", "outcome_unknown", "canceled"].includes(run.state) || !pending && ["dispatched", "outcome_unknown"].includes(run.state) || run.state === "queued" && run.steps.length) fail("CHECKPOINT_INVALID");
    if (run.state === "succeeded") {
      const candidate = listingAuxiliaryCandidate(run), storedCandidate = await artifact(tx, identity, scope, "listing.auxiliary.candidate.v1", runId);
      if (!equal(storedCandidate.value, candidate) || listingAuxiliaryNextStage(run) !== null) fail("RESULT_INVALID");
    } else if (run.resultHash !== null) fail("RESULT_INVALID");
    return run;
  }
  function output(run: ListingAuxiliaryRun) { return outputSchema.parse({ version: 1, state: run.state, steps: run.steps, resultHash: run.resultHash, errorCode: run.errorCode }); }
  async function update(tx: ListingAuxiliaryExecutor, run: ListingAuxiliaryRun, next: z.infer<typeof outputSchema>, lease?: ListingAuxiliaryLease, release = false) {
    if (Buffer.byteLength(canonical(next)) > 16777216) fail("CHECKPOINT_LIMIT");
    await write(tx, `UPDATE ai_jobs SET output=JSON_QUOTE(?),status=?,completedAt=${terminal(next.state) ? "NOW(3)" : "NULL"},lockedBy=${release || terminal(next.state) ? "NULL" : "lockedBy"},leaseUntil=${release || terminal(next.state) ? "NULL" : "leaseUntil"},updatedAt=NOW(3) WHERE id=? AND runId=? AND status=? AND ${lease ? "lockedBy=? AND leaseUntil>NOW(6) AND " : ""}BINARY JSON_UNQUOTE(output)=BINARY ?`,
      [canonical(next), dbState(next.state), run.id, run.runId, dbState(run.state), ...(lease ? [lease.token] : []), canonical(output(run))]);
    const actual = await load(tx, run.identity, listingAuxiliaryOperationScope(run.request)); if (!actual || !equal(output(actual), next)) fail("CHECKPOINT_ACK_UNKNOWN"); return actual;
  }
  async function leaseRun(tx: ListingAuxiliaryExecutor, lease: ListingAuxiliaryLease) {
    const run = await load(tx, lease.identity, lease.scope), clock = await rows(tx, "SELECT UNIX_TIMESTAMP(NOW(6)) AS nowSeconds", [], 1);
    if (!run || run.runId !== lease.runId || run.lockedBy !== lease.token || !run.leaseUntil || run.leaseUntil <= Number(clock[0]?.nowSeconds) || terminal(run.state)) fail("LEASE_LOST"); return run;
  }
  async function current(tx: ListingAuxiliaryExecutor, run: ListingAuxiliaryRun) { const actual = await capture(tx, run.identity, listingAuxiliaryPreviewRequest(run.request));
    if (actual.sourceHash !== run.sourceHash) fail("SOURCE_CHANGED"); return actual; }
  return {
    readSource(identity: ListingAuxiliaryIdentity, input: ListingAuxiliaryPreviewInput) { return transaction(identity, input, "read", tx => capture(tx, identity, input)); },
    preview(identity: ListingAuxiliaryIdentity, input: ListingAuxiliaryPreviewInput, prepare: ListingAuxiliaryPrepare) { return transaction(identity, input, "run", async tx => { if (!enabled()) fail("WRITES_DISABLED"); const source = await capture(tx, identity, input); return { source, ...await prepare(tx, source) }; }); },
    reserve(identity: ListingAuxiliaryIdentity, raw: ListingAuxiliaryStartInput, prepare: ListingAuxiliaryPrepare) { const input = ListingAuxiliaryStartInputSchema.parse(raw), scope = listingAuxiliaryOperationScope(input); return transaction(identity, scope, "run", async (tx, role) => {
      const canceled = await audit(tx, identity, scope, role, "cancel", startReceipt); if (canceled) return canceled;
      const old = await audit(tx, identity, scope, role, "start", startReceipt), requestHash = hash({ identity, request: input });
      if (old) { if (old.requestHash !== requestHash) fail("OPERATION_CONTENT_CONFLICT"); await load(tx, identity, scope); return old; }
      if (!enabled()) fail("WRITES_DISABLED"); const source = await capture(tx, identity, listingAuxiliaryPreviewRequest(input));
      const prepared = await prepare(tx, source); if (source.sourceHash !== input.expectedSourceHash || prepared.runtimeSnapshot.snapshotHash !== input.expectedRuntimeHash || prepared.runtimeSnapshot.maxCostCents > input.maxCostCents) fail("PREVIEW_CHANGED");
      const active = await rows(tx, "SELECT id FROM ai_jobs WHERE projectId=? AND workspaceId=? AND kind=? AND (status IN ('queued','running') OR JSON_UNQUOTE(JSON_EXTRACT(CAST(JSON_UNQUOTE(output) AS JSON),'$.state'))='outcome_unknown') LIMIT 2 FOR UPDATE", [input.projectId, identity.workspaceId, LISTING_AUXILIARY_KIND], 2); if (active.length) fail("ACTIVE_OPERATION_EXISTS");
      const runId = listingAuxiliaryRunId(identity, input.operationId), original = await artifact(tx, identity, scope, "listing.auxiliary.source.v1", runId, source);
      const saved = inputSchema.parse({ version: 1, identity, request: input, requestHash, sourceArtifactId: original.artifactId, sourceHash: source.sourceHash, ...prepared });
      await write(tx, "INSERT INTO ai_jobs (runId,workspaceId,userId,projectId,kind,module,`procedure`,queueName,status,progress,attempt,maxAttempts,input,output) VALUES (?,?,?,? ,?,'listing','listing.auxiliaryStart','listing_auxiliary','queued',0,0,1,JSON_QUOTE(?),JSON_QUOTE(?))", [runId, identity.workspaceId, identity.userId, input.projectId, LISTING_AUXILIARY_KIND, canonical(saved), canonical({ version: 1, state: "queued", steps: [], resultHash: null, errorCode: null })]);
      if (!await load(tx, identity, scope)) fail("WRITE_UNCONFIRMED"); return audit(tx, identity, scope, role, "start", startReceipt, { identity, scope, status: "reserved", requestHash, runId });
    }); },
    check(identity: ListingAuxiliaryIdentity, scope: ListingAuxiliaryOperationInput) { return transaction(identity, scope, "read", async (tx, role) => ({ run: await load(tx, identity, scope), receipt: await audit(tx, identity, scope, role, "cancel", startReceipt) })); },
    cancel(identity: ListingAuxiliaryIdentity, scope: ListingAuxiliaryOperationInput) { return transaction(identity, scope, "update", async (tx, role) => {
      const existing = await audit(tx, identity, scope, role, "cancel", startReceipt), run = await load(tx, identity, scope);
      const receipt = existing ?? await audit(tx, identity, scope, role, "cancel", startReceipt, { identity, scope, status: "cancelled", requestHash: null, runId: run?.runId ?? null });
      return { receipt, run: run && !["succeeded", "failed", "canceled"].includes(run.state) ? await update(tx, run, { ...output(run), state: "canceled", errorCode: "CANCELED" }, undefined, true) : run };
    }); },
    claim(identity: ListingAuxiliaryIdentity, scope: ListingAuxiliaryOperationInput, workerId: string) { return transaction(identity, scope, "run", async tx => {
      if (!enabled()) return null; let run = await load(tx, identity, scope); if (!run || terminal(run.state)) return null;
      const clock = await rows(tx, "SELECT UNIX_TIMESTAMP(NOW(6)) AS nowSeconds", [], 1); if (run.leaseUntil && run.leaseUntil > Number(clock[0]?.nowSeconds)) return null;
      if (run.steps.some(item => item.dispatch && !item.returned)) { await update(tx, run, { ...output(run), state: "outcome_unknown", errorCode: "DISPATCH_OUTCOME_UNKNOWN" }, undefined, true); return null; }
      const token = `${workerId.slice(0, 60)}:${randomUUID()}`;
      await write(tx, "UPDATE ai_jobs SET lockedBy=?,leaseUntil=DATE_ADD(NOW(6),INTERVAL 120 SECOND),status='running',attempt=1,output=JSON_QUOTE(?),updatedAt=NOW(3) WHERE id=? AND (leaseUntil IS NULL OR leaseUntil<=NOW(6))", [token, canonical({ ...output(run), state: "running" }), run.id]);
      run = await load(tx, identity, scope); if (!run || run.lockedBy !== token) fail("LEASE_LOST"); return { identity, scope, token, runId: run.runId };
    }); },
    heartbeat(lease: ListingAuxiliaryLease) { return transaction(lease.identity, lease.scope, "run", async tx => { const run = await leaseRun(tx, lease); await write(tx, "UPDATE ai_jobs SET leaseUntil=DATE_ADD(NOW(6),INTERVAL 120 SECOND) WHERE id=? AND lockedBy=? AND leaseUntil>NOW(6)", [run.id, lease.token]); }); },
    prepareStage<T>(lease: ListingAuxiliaryLease, prepare: (tx: ListingAuxiliaryExecutor, run: ListingAuxiliaryRun, source: ListingAuxiliarySource, attempt: z.infer<typeof ListingAuxiliaryAttemptSchema>, previous: ListingAuxiliaryReturned | null) => Promise<T>) { return transaction(lease.identity, lease.scope, "run", async tx => {
      if (!enabled()) fail("WRITES_DISABLED"); const run = await leaseRun(tx, lease), source = await current(tx, run), next = listingAuxiliaryNextStage(run);
      // Reserve the worst-case JSON escaping space for the bounded next reply
      // before another fee. Existing responses are never silently truncated.
      if (Buffer.byteLength(canonical(output(run))) + 7 * 1048576 > 16777216) fail("CHECKPOINT_LIMIT");
      if (!next) fail("ALREADY_COMPLETE"); return prepare(tx, run, source, next.attempt, next.previous);
    }); },
    dispatch(lease: ListingAuxiliaryLease, attempt: z.infer<typeof ListingAuxiliaryAttemptSchema>, value: z.infer<typeof dispatch>, verify: (tx: ListingAuxiliaryExecutor, run: ListingAuxiliaryRun, source: ListingAuxiliarySource) => Promise<void>) { return transaction(lease.identity, lease.scope, "run", async tx => {
      if (!enabled()) fail("WRITES_DISABLED"); const run = await leaseRun(tx, lease); if (run.steps.some(item => item.dispatch && !item.returned)) fail("DISPATCH_OUTCOME_UNKNOWN");
      const next = listingAuxiliaryNextStage(run); if (!next || !equal(next.attempt, attempt)) fail("ATTEMPT_INVALID"); const source = await current(tx, run); await verify(tx, run, source);
      return update(tx, run, { ...output(run), state: "dispatched", steps: [...run.steps, { attempt, dispatch: dispatch.parse(value), returned: null }] }, lease);
    }); },
    returned(lease: ListingAuxiliaryLease, value: { attempt: z.infer<typeof ListingAuxiliaryAttemptSchema>; runId: string; bindingHash: string; returned: ListingAuxiliaryReturned }) { return transaction(lease.identity, lease.scope, "update", async tx => {
      const run = await leaseRun(tx, lease), last = run.steps.at(-1); if (!last || !last.dispatch || last.returned || !equal(last.attempt, value.attempt) || last.dispatch.receipt.runId !== value.runId || last.dispatch.bindingHash !== value.bindingHash) fail("RESULT_INVALID");
      const validated = validateListingAuxiliaryReturned(run.source, value.attempt, value.returned.content); if (!equal(validated, value.returned)) fail("RESULT_INVALID"); last.returned = validated;
      const next = listingAuxiliaryNextAttempt(run.runtimeSnapshot, last.attempt, validated), complete = next === null && last.attempt.targetIndex === run.runtimeSnapshot.targetCount - 1;
      const nextOutput = { ...output(run), state: (complete ? "succeeded" : next === "exhausted" ? "failed" : "running") as ListingAuxiliaryRun["state"], errorCode: next === "exhausted" ? "QUALITY_EXHAUSTED" : null };
      if (complete) { const candidate = buildCandidate(run); nextOutput.resultHash = hash(candidate);
        await artifact(tx, run.identity, lease.scope, "listing.auxiliary.candidate.v1", run.runId, candidate); }
      // Preserve the pre-update CAS: response mutation is represented only in nextOutput.
      const before = await load(tx, lease.identity, lease.scope); if (!before) fail("RUN_INVALID"); return update(tx, before, nextOutput, lease);
    }); },
    failure(lease: ListingAuxiliaryLease, code: string) { return transaction(lease.identity, lease.scope, "update", async tx => { const run = await leaseRun(tx, lease); const pending = run.steps.some(item => item.dispatch && !item.returned);
      if (run.steps.at(-1)?.returned) return; return update(tx, run, { ...output(run), state: pending ? "outcome_unknown" : "failed", errorCode: pending ? "DISPATCH_OUTCOME_UNKNOWN" : /^[A-Z_]{1,120}$/u.test(code) ? code : "FAILED" }, lease, true); }); },
    apply(identity: ListingAuxiliaryIdentity, raw: ListingAuxiliaryApplyInput) { const input = ListingAuxiliaryApplyInputSchema.parse(raw), scope = listingAuxiliaryOperationScope(input), auditScope = { ...scope, operationId: input.applyOperationId };
      return transaction(identity, scope, "update", async (tx, role) => {
        const old = await audit(tx, identity, auditScope, role, "apply", ListingAuxiliaryApplyReceiptSchema), requestHash = hash({ identity, request: input });
        const applyScope = ListingAuxiliaryApplyOperationInputSchema.parse({ ...scope, applyOperationId: input.applyOperationId });
        if (old) { if (!equal(old.scope, applyScope) || old.status !== "cancelled" && old.requestHash !== requestHash) fail("OPERATION_CONTENT_CONFLICT"); return old; }
        if (!enabled()) fail("WRITES_DISABLED"); const run = await load(tx, identity, scope); if (!run || run.state !== "succeeded" || run.resultHash !== input.expectedResultHash || run.sourceHash !== input.expectedSourceHash) fail("CANDIDATE_UNAVAILABLE");
        const source = await current(tx, run); if (source.draftHash !== input.expectedDraftHash) fail("DRAFT_CHANGED");
        const publication = await (deps.publish ?? applyListingAuxiliaryCandidate)(tx, run, input);
        const candidate = listingAuxiliaryCandidate(run)!;
        const agent = run.request.operation === "optimizeBullet" ? await projectListingConfiguredApplied(tx, { identity, projectId: input.projectId, operation: "singleBullet", outputs: { singleBullet: candidate.targets[0].result },
          listingId: null, candidateIds: publication.candidateIds, sourceHash: run.sourceHash, resultHash: run.resultHash!, applyOperationId: input.applyOperationId }) : null;
        const reportArtifactId = `laux_${hash({ identity, operationId: auditScope.operationId, key: "listing.auxiliary.apply.v1" })}`;
        const receipt = ListingAuxiliaryApplyReceiptSchema.parse({ identity, scope: applyScope, status: "committed", requestHash, resultHash: run.resultHash,
          draftHash: run.source.draftHash, reportArtifactId, candidateIds: publication.candidateIds, reasonCode: null });
        await artifact(tx, identity, auditScope, "listing.auxiliary.apply.v1", run.runId, { version: 1, identity, projectId: input.projectId, operationId: input.operationId,
          applyOperationId: input.applyOperationId, operation: run.request.operation, sourceHash: run.sourceHash, resultHash: run.resultHash,
          before: source.tables, after: publication.after, candidate, receipt, ...(agent ?? {}) });
        const final = await audit(tx, identity, auditScope, role, "apply", ListingAuxiliaryApplyReceiptSchema, receipt); if (!final) fail("JOURNAL_ACK_UNKNOWN"); return final;
      }); },
    applyCheck(identity: ListingAuxiliaryIdentity, input: ListingAuxiliaryApplyOperationInput) { return transaction(identity, input, "read", async (tx, role) => { const receipt = await audit(tx, identity, { ...listingAuxiliaryOperationScope(input), operationId: input.applyOperationId }, role, "apply", ListingAuxiliaryApplyReceiptSchema);
      if (receipt && !equal(receipt.scope, input)) fail("OPERATION_SCOPE_CONFLICT"); return receipt; }); },
    applyCancel(identity: ListingAuxiliaryIdentity, input: ListingAuxiliaryApplyOperationInput) { return transaction(identity, input, "update", async (tx, role) => {
      const scope = { ...listingAuxiliaryOperationScope(input), operationId: input.applyOperationId };
      const existing = await audit(tx, identity, scope, role, "apply", ListingAuxiliaryApplyReceiptSchema); if (existing && !equal(existing.scope, input)) fail("OPERATION_SCOPE_CONFLICT");
      return existing ?? audit(tx, identity, scope, role, "apply", ListingAuxiliaryApplyReceiptSchema,
        { identity, scope: input, status: "cancelled", requestHash: null, resultHash: null, draftHash: null, reportArtifactId: null, candidateIds: [], reasonCode: "CANCELLED" }); }); },
    history(identity: ListingAuxiliaryIdentity, input: { expectedWorkspaceId: number; projectId: number; beforeId: number | null; limit: number }) {
      return transaction(identity, { ...input, operationId: "00000000-0000-4000-8000-000000000000" }, "read", async tx => {
        const found = await rows(tx, `SELECT id,JSON_UNQUOTE(JSON_EXTRACT(CAST(JSON_UNQUOTE(input) AS JSON),'$.request.operationId')) AS operationId FROM ai_jobs WHERE workspaceId=? AND userId=? AND projectId=? AND kind=?${input.beforeId === null ? "" : " AND id<?"} ORDER BY id DESC LIMIT ?`, [identity.workspaceId, identity.userId, input.projectId, LISTING_AUXILIARY_KIND, ...(input.beforeId === null ? [] : [input.beforeId]), input.limit + 1], input.limit + 1);
        const items = []; for (const row of found.slice(0, input.limit)) { const run = await load(tx, identity, { expectedWorkspaceId: identity.workspaceId, projectId: input.projectId, operationId: String(row.operationId) }); if (!run) fail("RUN_INVALID"); items.push({ id: run.id, operationId: run.request.operationId, operation: run.request.operation, state: run.state, sourceHash: run.sourceHash, draftHash: run.source.draftHash, createdAt: run.createdAt }); }
        return { items, nextBeforeId: found.length > input.limit ? Number(found[input.limit - 1].id) : null };
      }); },
  };
}
export const listingAuxiliaryRepository = createListingAuxiliaryRepository();
