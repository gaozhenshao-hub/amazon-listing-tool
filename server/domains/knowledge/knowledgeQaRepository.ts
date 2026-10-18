import { randomUUID } from "node:crypto";
import { z } from "zod";
import { requireDb } from "../../repositories/dbClient";
import { assertResourceAction } from "../../services/securityGovernance";
import { KnowledgeQaIdSchema as id, KnowledgeQaUuidSchema as uuid, KnowledgeQaHashSchema as hash, KnowledgeQaIdentitySchema, KnowledgeQaScopeSchema,
  KnowledgeQaOperationInputSchema, KnowledgeQaStartInputSchema, KnowledgeQaSourceSchema, KnowledgeQaAnswerSchema, KnowledgeQaStageSchema,
  KnowledgeQaThreadSchema, KnowledgeQaHistoryInputSchema, KnowledgeQaPageInputSchema, KnowledgeQaRenameInputSchema, KnowledgeQaDeleteInputSchema, KnowledgeQaFeedbackInputSchema, KnowledgeQaClearInputSchema,
  knowledgeQaHash, knowledgeQaCanonical, knowledgeQaOperation, knowledgeQaValidateSelection, knowledgeQaValidateAnswer,
  type KnowledgeQaIdentity, type KnowledgeQaScope, type KnowledgeQaOperationInput, type KnowledgeQaPreviewInput, type KnowledgeQaStartInput, type KnowledgeQaSource, type KnowledgeQaAnswer } from "../../../shared/knowledgeQa";
import { KnowledgeQaConfigurationSchema, KnowledgeQaRuntimeSnapshotSchema, KnowledgeQaDispatchSchema, type KnowledgeQaConfiguration, type KnowledgeQaRuntimeSnapshot } from "./knowledgeQaRuntimeContract";
import { captureKnowledgeQaSource } from "./knowledgeQaSource";
import { authorizeKnowledgeQa, assertKnowledgeQaSchema, knowledgeQaRows as rows, knowledgeQaWrite as write, knowledgeQaJson as json, knowledgeQaFail as fail,
  KnowledgeQaError, type KnowledgeQaExecutor, type KnowledgeQaAuthority } from "./knowledgeQaStorePrimitives";
import type { KnowledgeQaPreparedStage } from "./knowledgeQaRuntime";
export const KNOWLEDGE_QA_JOB_KIND = "knowledge.qa.v1";
export const KNOWLEDGE_QA_SOURCE_KEY = "knowledge.qa.source.v1";
export const KNOWLEDGE_QA_ANSWER_KEY = "knowledge.qa.answer.v1";
export const KNOWLEDGE_QA_THREAD_KEY = "knowledge.qa.thread.v1";
const equal = (a: unknown, b: unknown) => knowledgeQaCanonical(a) === knowledgeQaCanonical(b);
const code = z.string().regex(/^[A-Z][A-Z0-9_]{0,159}$/u);
export const knowledgeQaRunId = (identity: KnowledgeQaIdentity, operationId: string) => `kqa_${knowledgeQaHash({ identity: KnowledgeQaIdentitySchema.parse(identity), operationId: uuid.parse(operationId) })}`;
const threadId = (identity: KnowledgeQaIdentity, value: string) => `kqt_${knowledgeQaHash({ identity, threadId: uuid.parse(value) })}`;
const scopeOf = (input: KnowledgeQaScope) => KnowledgeQaScopeSchema.parse({ expectedWorkspaceId: input.expectedWorkspaceId, threadId: input.threadId });
const requestSchema = z.object({ version: z.literal(1), identity: KnowledgeQaIdentitySchema, request: KnowledgeQaStartInputSchema, requestHash: hash,
  sourceArtifactId: z.string(), sourceHash: hash, configuration: KnowledgeQaConfigurationSchema, runtimeSnapshot: KnowledgeQaRuntimeSnapshotSchema }).strict();
const checkpointSchema = z.object({ stageKey: KnowledgeQaStageSchema, indices: z.array(id).max(10), dispatch: z.object({ receipt: KnowledgeQaDispatchSchema,
  contextHash: hash, snapshotHash: hash, bindingHash: hash, providerRequestHash: hash }).strict().nullable(), result: z.union([z.array(id).max(10), z.string().min(1)]).nullable(), tokensUsed: z.number().int().nonnegative().nullable() }).strict();
const stateSchema = z.enum(["queued", "running", "dispatched", "succeeded", "failed", "canceled", "outcome_unknown"]);
const outputSchema = z.object({ version: z.literal(1), state: stateSchema, checkpoints: z.array(checkpointSchema).max(3), candidateArtifactId: z.string().nullable(), resultHash: hash.nullable(), errorCode: code.nullable() }).strict();
const threadBodySchema = z.object({ version: z.literal(1), identity: KnowledgeQaIdentitySchema, threadId: uuid, title: z.string().min(1).max(255), revision: id, deleted: z.boolean() }).strict();
export type KnowledgeQaRun = z.infer<typeof requestSchema> & z.infer<typeof outputSchema> & { id: number; runId: string; source: KnowledgeQaSource; answer: KnowledgeQaAnswer | null; lockedBy: string | null; leaseUntil: number | null; createdAt: string; currentSourceHash?: string };
export type KnowledgeQaLease = { identity: KnowledgeQaIdentity; scope: KnowledgeQaOperationInput; runId: string; token: string };
export type KnowledgeQaPreparation = { configuration: KnowledgeQaConfiguration; runtimeSnapshot: KnowledgeQaRuntimeSnapshot };
export type KnowledgeQaPrepare = (tx: KnowledgeQaExecutor, source: KnowledgeQaSource) => Promise<KnowledgeQaPreparation>;
export interface KnowledgeQaDatabase { transaction<T>(work: (tx: KnowledgeQaExecutor) => Promise<T>): Promise<T> }
const terminal = (state: KnowledgeQaRun["state"]) => ["succeeded", "failed", "canceled", "outcome_unknown"].includes(state);
const dbState = (state: KnowledgeQaRun["state"]) => state === "outcome_unknown" ? "failed" : state === "dispatched" ? "running" : state;
const artifactProjection = "id,workspaceId,artifactId,domain,artifactKey,artifactType,sourceType,sourceId,sourceTable,sourceRowId,runId,agentSlug,projectId,userId,status,version,isCurrent,IF(OCTET_LENGTH(contentJson)<=4194304,contentJson,NULL) AS contentJson,contentHash,IF(OCTET_LENGTH(metadata)<=65536,metadata,NULL) AS metadata,sourceAiJobRunId,DATE_FORMAT(createdAt,'%Y-%m-%dT%H:%i:%s.%fZ') AS createdAt,DATE_FORMAT(updatedAt,'%Y-%m-%dT%H:%i:%s.%fZ') AS updatedAt";
async function artifactRead(tx: KnowledgeQaExecutor, identity: KnowledgeQaIdentity, scope: KnowledgeQaScope, artifactId: string, key: string, runId: string, absent = false) {
  const data = await rows(tx, `SELECT ${artifactProjection} FROM ai_artifacts WHERE artifactId=? AND BINARY artifactId=BINARY ? LIMIT 2 FOR UPDATE`, [artifactId, artifactId], 1), row = data[0];
  if (!row && absent) return null; if (!row) return fail("ARTIFACT_MISSING");
  const content = json(row.contentJson);
  if (!id.safeParse(row.id).success || row.workspaceId !== identity.workspaceId || row.userId !== identity.userId || row.projectId !== null || row.artifactId !== artifactId
    || row.domain !== "knowledge" || row.artifactKey !== key || row.artifactType !== "json" || row.sourceType !== "system" || row.sourceId !== scope.threadId || row.sourceRowId !== scope.threadId
    || row.sourceTable !== "knowledge_qa_private_threads" || row.runId !== runId || row.agentSlug !== "knowledge" || row.status !== "draft" || row.version !== 1 || row.isCurrent !== 0
    || row.sourceAiJobRunId !== runId || row.contentHash !== knowledgeQaHash(content) || !equal(json(row.metadata, 65536), { version: 1, kind: KNOWLEDGE_QA_JOB_KIND, scope: scopeOf(scope) })
    || typeof row.createdAt !== "string" || typeof row.updatedAt !== "string") return fail("ARTIFACT_INVALID");
  return { row, content };
}
async function artifactPut(tx: KnowledgeQaExecutor, identity: KnowledgeQaIdentity, scope: KnowledgeQaScope, artifactId: string, key: string, runId: string, content: unknown) {
  if (Buffer.byteLength(knowledgeQaCanonical(content)) > 4194304) return fail("ARTIFACT_LIMIT");
  await write(tx, "INSERT INTO ai_artifacts (workspaceId,artifactId,domain,artifactKey,artifactType,sourceType,sourceId,sourceTable,sourceRowId,runId,agentSlug,projectId,userId,status,version,isCurrent,contentJson,contentHash,metadata,sourceAiJobRunId) VALUES (?,?,'knowledge',?,'json','system',?,'knowledge_qa_private_threads',?,?,'knowledge',NULL,?,'draft',1,0,?,?,?,?)",
    [identity.workspaceId, artifactId, key, scope.threadId, scope.threadId, runId, identity.userId, knowledgeQaCanonical(content), knowledgeQaHash(content), knowledgeQaCanonical({ version: 1, kind: KNOWLEDGE_QA_JOB_KIND, scope: scopeOf(scope) }), runId]);
  if (!equal((await artifactRead(tx, identity, scope, artifactId, key, runId))!.content, content)) return fail("ARTIFACT_READBACK_INVALID");
}
async function thread(tx: KnowledgeQaExecutor, identity: KnowledgeQaIdentity, scope: KnowledgeQaScope, allowAbsent = false) {
  const key = threadId(identity, scope.threadId), found = await artifactRead(tx, identity, scope, key, KNOWLEDGE_QA_THREAD_KEY, key, allowAbsent);
  if (!found) return null; const body = threadBodySchema.parse(found.content);
  if (!equal(body.identity, identity) || body.threadId !== scope.threadId || body.deleted) return fail("THREAD_UNAVAILABLE");
  return { ...body, id: Number(found.row.id), createdAt: String(found.row.createdAt), updatedAt: String(found.row.updatedAt), artifactId: key, contentHash: String(found.row.contentHash) };
}
const journalSchema = z.object({ version: z.literal(1), identity: KnowledgeQaIdentitySchema, scope: KnowledgeQaOperationInputSchema, status: z.enum(["reserved", "canceled"]), requestHash: hash.nullable(), runId: z.string().nullable() }).strict();
async function journal(tx: KnowledgeQaExecutor, identity: KnowledgeQaIdentity, scope: KnowledgeQaOperationInput, kind: "start" | "cancel") {
  const key = `kqa_${kind}_${knowledgeQaHash({ identity, operationId: scope.operationId })}`, found = await rows(tx, "SELECT auditId,workspaceId,actorUserId,action,resourceType,resourceId,projectId,status,riskLevel,IF(OCTET_LENGTH(metadata)<=65536,metadata,NULL) AS metadata FROM security_audit_logs WHERE auditId=? AND BINARY auditId=BINARY ? LIMIT 2 FOR UPDATE", [key, key], 1);
  if (!found.length) return null; const row = found[0], body = journalSchema.parse(json(row.metadata, 65536));
  if (row.auditId !== key || row.workspaceId !== identity.workspaceId || row.actorUserId !== identity.userId || row.projectId !== null || row.action !== `knowledge.qa.${kind}`
    || row.resourceType !== "knowledge_qa" || row.resourceId !== scope.operationId || row.status !== "success" || row.riskLevel !== "medium" || !equal(body.identity, identity) || !equal(body.scope, knowledgeQaOperation(scope))) return fail("JOURNAL_INVALID");
  return body;
}
async function journalPut(tx: KnowledgeQaExecutor, identity: KnowledgeQaIdentity, scope: KnowledgeQaOperationInput, role: string, kind: "start" | "cancel", requestHash: string | null, runId: string | null) {
  const body = journalSchema.parse({ version: 1, identity, scope: knowledgeQaOperation(scope), status: kind === "start" ? "reserved" : "canceled", requestHash, runId });
  const old = await journal(tx, identity, scope, kind); if (old) { if (!equal(old, body)) return fail("OPERATION_CONFLICT"); return old; }
  await write(tx, "INSERT INTO security_audit_logs (workspaceId,auditId,actorUserId,actorRole,action,resourceType,resourceId,projectId,status,riskLevel,metadata) VALUES (?,?,?,?,?,'knowledge_qa',?,NULL,'success','medium',?)",
    [identity.workspaceId, `kqa_${kind}_${knowledgeQaHash({ identity, operationId: scope.operationId })}`, identity.userId, role, `knowledge.qa.${kind}`, scope.operationId, knowledgeQaCanonical(body)]);
  if (!equal(await journal(tx, identity, scope, kind), body)) return fail("JOURNAL_READBACK_INVALID"); return body;
}
const projection = "id,workspaceId,userId,projectId,runId,kind,module,`procedure`,queueName,status,attempt,maxAttempts,lockedBy,UNIX_TIMESTAMP(leaseUntil) AS leaseUntil,DATE_FORMAT(createdAt,'%Y-%m-%dT%H:%i:%s.%fZ') AS createdAt,completedAt,IF(OCTET_LENGTH(input)<=1048576,input,NULL) AS input,IF(OCTET_LENGTH(output)<=262144,output,NULL) AS output";
function outputOf(run: KnowledgeQaRun) { return outputSchema.parse({ version: 1, state: run.state, checkpoints: run.checkpoints, candidateArtifactId: run.candidateArtifactId, resultHash: run.resultHash, errorCode: run.errorCode }); }
async function load(tx: KnowledgeQaExecutor, identity: KnowledgeQaIdentity, scope: KnowledgeQaOperationInput): Promise<KnowledgeQaRun | null> {
  const runId = knowledgeQaRunId(identity, scope.operationId), found = await rows(tx, `SELECT ${projection} FROM ai_jobs WHERE runId=? AND BINARY runId=BINARY ? LIMIT 2 FOR UPDATE`, [runId, runId], 1); if (!found.length) return null;
  const row = found[0], input = requestSchema.parse(json(row.input, 1048576)), output = outputSchema.parse(json(row.output, 262144));
  if (!id.safeParse(row.id).success || row.workspaceId !== identity.workspaceId || row.userId !== identity.userId || row.projectId !== null || row.runId !== runId || row.kind !== KNOWLEDGE_QA_JOB_KIND
    || row.module !== "knowledge" || row.procedure !== "kbBot.qaStart" || row.queueName !== "knowledge_qa" || row.maxAttempts !== 1 || ![0, 1].includes(Number(row.attempt))
    || !equal(input.identity, identity) || !equal(knowledgeQaOperation(input.request), knowledgeQaOperation(scope)) || row.status !== dbState(output.state) || typeof row.createdAt !== "string"
    || terminal(output.state) !== (row.completedAt !== null) || (row.lockedBy === null) !== (row.leaseUntil === null) || row.lockedBy !== null && (typeof row.lockedBy !== "string" || row.lockedBy.length > 128)
    || row.leaseUntil !== null && (!Number.isFinite(Number(row.leaseUntil)) || Number(row.leaseUntil) <= 0) || terminal(output.state) && row.lockedBy !== null) return fail("RUN_INVALID");
  if (input.requestHash !== knowledgeQaHash({ identity, request: input.request }) || input.sourceHash !== input.request.expectedSourceHash || input.runtimeSnapshot.snapshotHash !== input.request.expectedRuntimeHash
    || input.runtimeSnapshot.operationId !== scope.operationId || input.runtimeSnapshot.sourceHash !== input.sourceHash || !equal(input.runtimeSnapshot.identity, identity)
    || input.runtimeSnapshot.configuration.hash !== input.configuration.hash || input.runtimeSnapshot.configuration.revision !== input.configuration.revision) return fail("IMMUTABLE_CHANGED");
  const source = KnowledgeQaSourceSchema.parse((await artifactRead(tx, identity, scope, input.sourceArtifactId, KNOWLEDGE_QA_SOURCE_KEY, runId))!.content);
  const { sourceHash, ...sourceBody } = source; if (sourceHash !== input.sourceHash || sourceHash !== knowledgeQaHash(sourceBody) || !equal(source.identity, identity) || !equal(source.scope, scopeOf(scope))) return fail("SOURCE_INVALID");
  let prior = -1; for (const checkpoint of output.checkpoints) {
    const ordinal = ["l1_select", "l2_select", "answer"].indexOf(checkpoint.stageKey); if (ordinal <= prior) return fail("CHECKPOINT_INVALID"); prior = ordinal;
    if (checkpoint.indices.some(index => index > source.items.length) || new Set(checkpoint.indices).size !== checkpoint.indices.length) return fail("CHECKPOINT_INVALID");
    if (checkpoint.dispatch) { const dispatch = checkpoint.dispatch, entry = input.runtimeSnapshot[checkpoint.stageKey === "answer" ? "answer" : "select"];
      if (dispatch.snapshotHash !== input.runtimeSnapshot.snapshotHash || dispatch.receipt.stage !== entry.approval.stage || dispatch.receipt.modelConfigurationHash !== entry.model.configurationHash
        || dispatch.receipt.requestHash !== dispatch.providerRequestHash || dispatch.receipt.bindingHash !== dispatch.bindingHash || dispatch.receipt.budget.outputTokens !== entry.skill.maxTokens
        || dispatch.bindingHash !== knowledgeQaHash({ schema: "knowledge-qa-stage/v1", stage: dispatch.receipt.stage, stageKey: checkpoint.stageKey, contextHash: dispatch.contextHash, snapshotHash: dispatch.snapshotHash, providerRequestHash: dispatch.providerRequestHash })) return fail("DISPATCH_INVALID");
    }
    if (checkpoint.result !== null) { if (checkpoint.stageKey === "answer") knowledgeQaValidateAnswer(checkpoint.result, checkpoint.indices.map(index => source.items[index - 1]));
      else knowledgeQaValidateSelection({ selectedIndices: checkpoint.result }, checkpoint.stageKey === "l1_select" ? source.items.length : checkpoint.indices.length, checkpoint.stageKey === "l1_select" ? 10 : 5); }
  }
  if ((output.candidateArtifactId === null) !== (output.resultHash === null) || (output.state === "succeeded") !== (output.resultHash !== null)
    || ["dispatched", "outcome_unknown"].includes(output.state) && (!output.checkpoints.at(-1)?.dispatch || output.checkpoints.at(-1)?.result !== null)) return fail("STATE_INVALID");
  let answer: KnowledgeQaAnswer | null = null;
  if (output.candidateArtifactId) { const body = z.object({ answer: KnowledgeQaAnswerSchema, resultHash: hash, checkpointsHash: hash }).strict().parse((await artifactRead(tx, identity, scope, output.candidateArtifactId, KNOWLEDGE_QA_ANSWER_KEY, runId))!.content);
    if (body.resultHash !== output.resultHash || body.resultHash !== knowledgeQaHash(body.answer) || body.checkpointsHash !== knowledgeQaHash(output.checkpoints)) return fail("ANSWER_INVALID"); answer = body.answer; }
  return { ...input, ...output, id: Number(row.id), runId, source, answer, lockedBy: row.lockedBy as string | null, leaseUntil: row.leaseUntil === null ? null : Number(row.leaseUntil), createdAt: row.createdAt };
}
async function update(tx: KnowledgeQaExecutor, run: KnowledgeQaRun, token: string | null = run.lockedBy, claim = false) {
  const release = terminal(run.state), output = outputOf(run);
  await write(tx, `UPDATE ai_jobs SET status=?,output=?,errorMessage=?,progress=?,lockedBy=?,leaseUntil=${release ? "NULL" : "DATE_ADD(NOW(6),INTERVAL 120 SECOND)"},lastHeartbeatAt=NOW(6),completedAt=${release ? "NOW(6)" : "NULL"},${claim ? "attempt=1,startedAt=COALESCE(startedAt,NOW(6)),claimedAt=NOW(6)," : ""}updatedAt=NOW(6) WHERE id=? AND runId=? AND workspaceId=? AND userId=? AND kind=?`,
    [dbState(run.state), knowledgeQaCanonical(output), run.errorCode, run.state === "succeeded" ? 100 : run.checkpoints.length * 25, release ? null : token, run.id, run.runId, run.identity.workspaceId, run.identity.userId, KNOWLEDGE_QA_JOB_KIND]);
  const after = await load(tx, run.identity, run.request); if (!after || !equal(outputOf(after), output) || after.lockedBy !== (release ? null : token)) return fail("RUN_READBACK_INVALID"); return after;
}
export function nextKnowledgeQaStage(run: KnowledgeQaRun): { stageKey: "l1_select" | "l2_select" | "answer"; indices: number[]; deterministic: boolean } | null {
  const first = run.checkpoints.find(item => item.stageKey === "l1_select"), second = run.checkpoints.find(item => item.stageKey === "l2_select"), answer = run.checkpoints.find(item => item.stageKey === "answer");
  if (!first) return { stageKey: "l1_select", indices: [], deterministic: run.source.items.length <= 10 };
  if (!Array.isArray(first.result)) return fail("CHECKPOINT_INVALID");
  if (!second) return { stageKey: "l2_select", indices: first.result, deterministic: first.result.length <= 5 };
  if (!Array.isArray(second.result)) return fail("CHECKPOINT_INVALID");
  const firstResult = first.result, indices = second.result.map(index => firstResult[index - 1]);
  if (!answer) return { stageKey: "answer", indices, deterministic: indices.length === 0 };
  return null;
}
export function createKnowledgeQaRepository(deps: { database?: () => Promise<KnowledgeQaDatabase | null>; permission?: typeof assertResourceAction; schemaReady?: typeof assertKnowledgeQaSchema;
  capture?: typeof captureKnowledgeQaSource; enabled?: () => boolean; token?: () => string } = {}) {
  const database = deps.database ?? (() => requireDb("Knowledge QA")), permission = deps.permission ?? assertResourceAction, schemaReady = deps.schemaReady ?? assertKnowledgeQaSchema,
    capture = deps.capture ?? captureKnowledgeQaSource, enabled = deps.enabled ?? (() => process.env.ENABLE_KNOWLEDGE_QA_WRITES === "true");
  const gate = () => { if (!enabled()) return fail("WRITES_DISABLED"); };
  async function invoke<T>(identity: KnowledgeQaIdentity, scope: KnowledgeQaScope | { expectedWorkspaceId: number }, action: "read" | "run" | "cancel" | "update" | "delete", body: (tx: KnowledgeQaExecutor, authority: KnowledgeQaAuthority) => Promise<T>): Promise<T> {
    KnowledgeQaIdentitySchema.parse(identity); if (identity.workspaceId !== scope.expectedWorkspaceId) return fail("ACCESS_DENIED");
    try { const db = await database(); if (!db || typeof db.transaction !== "function") return fail("DATABASE_UNAVAILABLE"); return await db.transaction(async tx => { await schemaReady(tx); const authority = await authorizeKnowledgeQa(tx, identity, action, permission); return body(tx, authority); }); }
    catch (error) { if (error instanceof KnowledgeQaError) throw error; return fail(action === "read" ? "READ_UNAVAILABLE" : "OUTCOME_UNVERIFIED"); }
  }
  async function verifyReadable(tx: KnowledgeQaExecutor, run: KnowledgeQaRun, authority: KnowledgeQaAuthority) {
    const current = await capture(tx, run.identity, run.request, authority, run.source.history, run.source.coverage.historyAvailable, run.source.threadVersion, run.source.historySourceKeys);
    // Revalidate all frozen source entries, including histories' original match
    // universe. Revoked visibility/role is not disguised as a stale answer.
    const keys = new Set(current.items.map(item => item.key)); if (run.source.items.some(item => !keys.has(item.key))) return fail("SOURCE_ACCESS_CHANGED");
    if (run.source.historySourceKeys.length) {
      // A prior answer can carry facts from a different question/type. Its
      // transitive source keys are retained, never inferred from current hits.
      // This bounded complete authorization read deliberately refuses overflow.
      const available = await capture(tx, run.identity, { ...run.request, question: "请找一些" }, authority, [], 0, run.source.threadVersion);
      const allowed = new Set(available.items.map(item => item.key)); if (run.source.historySourceKeys.some(key => !allowed.has(key))) return fail("SOURCE_ACCESS_CHANGED");
    }
    return current;
  }
  async function fresh(tx: KnowledgeQaExecutor, identity: KnowledgeQaIdentity, input: KnowledgeQaPreviewInput, authority: KnowledgeQaAuthority) {
    const value = await thread(tx, identity, input, true); let history: KnowledgeQaSource["history"] = [], historyAvailable = 0; const historySourceKeys = new Set<string>();
    if (value) {
      const counts = await rows(tx, "SELECT COUNT(*) AS count FROM ai_jobs WHERE kind=? AND workspaceId=? AND userId=? AND JSON_UNQUOTE(JSON_EXTRACT(input,'$.request.threadId'))=? AND status='succeeded'", [KNOWLEDGE_QA_JOB_KIND, identity.workspaceId, identity.userId, input.threadId], 1);
      const count = Number(counts[0]?.count); if (counts.length !== 1 || !Number.isSafeInteger(count) || count < 0) return fail("HISTORY_INVALID"); historyAvailable = count * 2;
      const recent = await rows(tx, "SELECT JSON_UNQUOTE(JSON_EXTRACT(input,'$.request.operationId')) AS operationId FROM ai_jobs WHERE kind=? AND workspaceId=? AND userId=? AND JSON_UNQUOTE(JSON_EXTRACT(input,'$.request.threadId'))=? AND status='succeeded' ORDER BY id DESC LIMIT 3 FOR SHARE", [KNOWLEDGE_QA_JOB_KIND, identity.workspaceId, identity.userId, input.threadId], 3);
      for (const item of recent.reverse()) { const run = await load(tx, identity, { ...scopeOf(input), operationId: uuid.parse(item.operationId) }); if (!run?.answer || run.state !== "succeeded") return fail("HISTORY_INVALID"); await verifyReadable(tx, run, authority); history.push({ role: "user", content: run.request.question }, { role: "assistant", content: run.answer.content }); for (const key of [...run.source.historySourceKeys, ...run.source.items.map(source => source.key)]) historySourceKeys.add(key); }
    }
    return capture(tx, identity, input, authority, history, historyAvailable, value?.revision ?? 1, [...historySourceKeys].sort());
  }
  async function state(tx: KnowledgeQaExecutor, identity: KnowledgeQaIdentity, scope: KnowledgeQaOperationInput) { const start = await journal(tx, identity, scope, "start"), canceled = await journal(tx, identity, scope, "cancel"), run = await load(tx, identity, scope);
    if (run && (!start || start.status !== "reserved" || start.requestHash !== run.requestHash || start.runId !== run.runId) || start && !run || canceled && (canceled.status !== "canceled" || run && run.state !== "canceled")) return fail("START_JOURNAL_INVALID"); return { run, canceled: canceled !== null }; }
  async function prepare(tx: KnowledgeQaExecutor, source: KnowledgeQaSource, operationId: string, fn: KnowledgeQaPrepare) { const value = await fn(tx, source), configuration = KnowledgeQaConfigurationSchema.parse(value.configuration), runtimeSnapshot = KnowledgeQaRuntimeSnapshotSchema.parse(value.runtimeSnapshot);
    if (configuration.workspaceId !== source.identity.workspaceId || runtimeSnapshot.sourceHash !== source.sourceHash || runtimeSnapshot.operationId !== operationId || !equal(runtimeSnapshot.identity, source.identity)
      || runtimeSnapshot.configuration.hash !== configuration.hash || runtimeSnapshot.configuration.revision !== configuration.revision) return fail("PREPARATION_INVALID"); return { configuration, runtimeSnapshot }; }
  async function now(tx: KnowledgeQaExecutor) { const value = await rows(tx, "SELECT UNIX_TIMESTAMP(NOW(6)) AS currentTime", [], 1), time = Number(value[0]?.currentTime); if (value.length !== 1 || !Number.isFinite(time) || time <= 0) return fail("CLOCK_UNAVAILABLE"); return time; }
  async function leased(tx: KnowledgeQaExecutor, lease: KnowledgeQaLease, authority: KnowledgeQaAuthority, sourceRequired: boolean) {
    const value = await state(tx, lease.identity, lease.scope), run = value.run; await thread(tx, lease.identity, lease.scope);
    if (!run || !["running", "dispatched"].includes(run.state) || run.runId !== lease.runId || run.lockedBy !== lease.token || run.leaseUntil === null || run.leaseUntil <= await now(tx) || value.canceled) return fail("LEASE_LOST");
    const source = sourceRequired ? await verifyReadable(tx, run, authority) : run.source;
    if (sourceRequired && source.sourceHash !== run.sourceHash) return fail("SOURCE_CHANGED"); return { run, source };
  }
  async function complete(tx: KnowledgeQaExecutor, run: KnowledgeQaRun) {
    const checkpoint = run.checkpoints.at(-1); if (checkpoint?.stageKey !== "answer" || typeof checkpoint.result !== "string") return fail("ANSWER_NOT_READY");
    const items = checkpoint.indices.map(index => run.source.items[index - 1]), calls = run.checkpoints.filter(item => item.dispatch !== null);
    const answer = KnowledgeQaAnswerSchema.parse({ content: checkpoint.result, references: items.map(item => ({ id: item.id, type: item.type, key: item.key, title: item.title, asin: item.asin, score: item.score, excerpt: item.summary, category: item.category, revisionHash: item.revisionHash })),
      searchPath: run.checkpoints.map(item => ({ level: item.stageKey === "l1_select" ? "L1" : item.stageKey === "l2_select" ? "L2" : "L3",
        scannedCount: item.stageKey === "l1_select" ? run.source.items.length : item.indices.length, matchedCount: Array.isArray(item.result) ? item.result.length : item.indices.length,
        modelCalled: item.dispatch !== null, tokensUsed: item.dispatch ? item.tokensUsed : 0 })), tokensUsed: calls.some(item => item.tokensUsed === null) ? null : calls.reduce((sum, item) => sum + (item.tokensUsed ?? 0), 0), reviewRequired: true, writesKnowledge: false });
    const artifactId = `kqa_answer_${knowledgeQaHash({ runId: run.runId })}`, resultHash = knowledgeQaHash(answer);
    await artifactPut(tx, run.identity, run.request, artifactId, KNOWLEDGE_QA_ANSWER_KEY, run.runId, { answer, resultHash, checkpointsHash: knowledgeQaHash(run.checkpoints) });
    run.state = "succeeded"; run.resultHash = resultHash; run.candidateArtifactId = artifactId; run.answer = answer; return update(tx, run);
  }
  return {
    source(identity: KnowledgeQaIdentity, input: KnowledgeQaPreviewInput) { return invoke(identity, input, "read", (tx, auth) => fresh(tx, identity, input, auth)); },
    preview(identity: KnowledgeQaIdentity, input: KnowledgeQaPreviewInput, fn: KnowledgeQaPrepare) { return invoke(identity, input, "run", async (tx, auth) => { gate(); const source = await fresh(tx, identity, input, auth); return { source, ...await prepare(tx, source, input.operationId, fn) }; }); },
    reserve(identity: KnowledgeQaIdentity, raw: KnowledgeQaStartInput, fn: KnowledgeQaPrepare) { const input = KnowledgeQaStartInputSchema.parse(raw); return invoke(identity, input, "run", async (tx, auth) => {
      const old = await state(tx, identity, input), requestHash = knowledgeQaHash({ identity, request: input }); if (old.canceled) return fail("OPERATION_CANCELED"); if (old.run) { if (old.run.requestHash !== requestHash) return fail("OPERATION_CONTENT_CONFLICT"); await thread(tx, identity, input); old.run.currentSourceHash = (await verifyReadable(tx, old.run, auth)).sourceHash; return old.run; }
      gate(); const source = await fresh(tx, identity, input, auth); if (source.sourceHash !== input.expectedSourceHash) return fail("SOURCE_CHANGED");
      const active = await rows(tx, "SELECT runId FROM ai_jobs WHERE kind=? AND workspaceId=? AND userId=? AND JSON_UNQUOTE(JSON_EXTRACT(input,'$.request.threadId'))=? AND (status IN ('queued','running') OR JSON_UNQUOTE(JSON_EXTRACT(output,'$.state'))='outcome_unknown') ORDER BY id LIMIT 2 FOR UPDATE", [KNOWLEDGE_QA_JOB_KIND, identity.workspaceId, identity.userId, input.threadId], 1); if (active.length) return fail("ACTIVE_OPERATION_EXISTS");
      const prepared = await prepare(tx, source, input.operationId, fn); if (prepared.runtimeSnapshot.snapshotHash !== input.expectedRuntimeHash || prepared.runtimeSnapshot.budgetPlan.maxCostCentsTotal > input.maxCostCents) return fail("RUNTIME_OR_COST_CHANGED");
      if (!await thread(tx, identity, input, true)) { const key = threadId(identity, input.threadId); await artifactPut(tx, identity, input, key, KNOWLEDGE_QA_THREAD_KEY, key, threadBodySchema.parse({ version: 1, identity, threadId: input.threadId, title: input.question.slice(0, 255), revision: 1, deleted: false })); }
      const runId = knowledgeQaRunId(identity, input.operationId), sourceArtifactId = `kqa_source_${knowledgeQaHash({ identity, operationId: input.operationId })}`;
      const saved = requestSchema.parse({ version: 1, identity, request: input, requestHash, sourceArtifactId, sourceHash: source.sourceHash, ...prepared }), output = outputSchema.parse({ version: 1, state: "queued", checkpoints: [], candidateArtifactId: null, resultHash: null, errorCode: null });
      await artifactPut(tx, identity, input, sourceArtifactId, KNOWLEDGE_QA_SOURCE_KEY, runId, source); gate();
      await write(tx, "INSERT INTO ai_jobs (workspaceId,runId,kind,module,`procedure`,status,queueName,attempt,maxAttempts,userId,projectId,skillSlug,input,output) VALUES (?,?,?,'knowledge','kbBot.qaStart','queued','knowledge_qa',0,1,?,NULL,'knowledge.qa.answer',?,?)", [identity.workspaceId, runId, KNOWLEDGE_QA_JOB_KIND, identity.userId, knowledgeQaCanonical(saved), knowledgeQaCanonical(output)]);
      const actual = await load(tx, identity, input); if (!actual || !equal(outputOf(actual), output)) return fail("RUN_READBACK_INVALID"); await journalPut(tx, identity, input, auth.role, "start", requestHash, runId); return actual;
    }); },
    check(identity: KnowledgeQaIdentity, input: KnowledgeQaOperationInput) { KnowledgeQaOperationInputSchema.parse(input); return invoke(identity, input, "read", async (tx, auth) => { const value = await state(tx, identity, input); if (value.run) { await thread(tx, identity, input); value.run.currentSourceHash = (await verifyReadable(tx, value.run, auth)).sourceHash; } return value; }); },
    cancel(identity: KnowledgeQaIdentity, input: KnowledgeQaOperationInput) { KnowledgeQaOperationInputSchema.parse(input); return invoke(identity, input, "cancel", async (tx, auth) => { const value = await state(tx, identity, input); if (value.canceled || value.run?.state === "succeeded") return value;
      if (value.run) { value.run.state = "canceled"; value.run.errorCode = "OPERATION_CANCELED"; value.run = await update(tx, value.run); } await journalPut(tx, identity, input, auth.role, "cancel", value.run?.requestHash ?? null, value.run?.runId ?? null); return { ...value, canceled: true }; }); },
    async threads(identity: KnowledgeQaIdentity, raw: z.infer<typeof KnowledgeQaPageInputSchema>) { const input = KnowledgeQaPageInputSchema.parse(raw); return invoke(identity, input, "read", async tx => {
      const found = await rows(tx, `SELECT id,sourceId FROM ai_artifacts WHERE workspaceId=? AND userId=? AND domain='knowledge' AND artifactKey=? AND JSON_EXTRACT(contentJson,'$.deleted')=false ${input.beforeId ? "AND id<?" : ""} ORDER BY id DESC LIMIT ? FOR SHARE`, [identity.workspaceId, identity.userId, KNOWLEDGE_QA_THREAD_KEY, ...(input.beforeId ? [input.beforeId] : []), input.limit + 1], input.limit + 1);
      const items = []; for (const row of found.slice(0, input.limit)) { const value = await thread(tx, identity, { expectedWorkspaceId: identity.workspaceId, threadId: uuid.parse(row.sourceId) }); if (!value || value.id !== row.id) return fail("THREAD_INVALID"); items.push(KnowledgeQaThreadSchema.parse({ threadId: value.threadId, title: value.title, version: value.revision, createdAt: value.createdAt, updatedAt: value.updatedAt })); }
      return { items, nextBeforeId: found.length > input.limit ? id.parse(found[input.limit - 1].id) : null };
    }); },
    history(identity: KnowledgeQaIdentity, raw: z.infer<typeof KnowledgeQaHistoryInputSchema>) { const input = KnowledgeQaHistoryInputSchema.parse(raw); return invoke(identity, input, "read", async (tx, auth) => {
      const current = await thread(tx, identity, input); if (!current) return fail("THREAD_UNAVAILABLE");
      const found = await rows(tx, `SELECT id,JSON_UNQUOTE(JSON_EXTRACT(input,'$.request.operationId')) AS operationId FROM ai_jobs WHERE kind=? AND workspaceId=? AND userId=? AND JSON_UNQUOTE(JSON_EXTRACT(input,'$.request.threadId'))=? ${input.beforeId ? "AND id<?" : ""} ORDER BY id DESC LIMIT ? FOR SHARE`, [KNOWLEDGE_QA_JOB_KIND, identity.workspaceId, identity.userId, input.threadId, ...(input.beforeId ? [input.beforeId] : []), input.limit + 1], input.limit + 1);
      const runs: KnowledgeQaRun[] = []; for (const row of found.slice(0, input.limit)) { const run = await load(tx, identity, { ...scopeOf(input), operationId: uuid.parse(row.operationId) }); if (!run || run.id !== row.id) return fail("HISTORY_INVALID"); run.currentSourceHash = (await verifyReadable(tx, run, auth)).sourceHash; runs.push(run); }
      return { thread: KnowledgeQaThreadSchema.parse({ threadId: current.threadId, title: current.title, version: current.revision, createdAt: current.createdAt, updatedAt: current.updatedAt }), runs, nextBeforeId: found.length > input.limit ? id.parse(found[input.limit - 1].id) : null };
    }); },
    rename(identity: KnowledgeQaIdentity, raw: z.infer<typeof KnowledgeQaRenameInputSchema>) { const input = KnowledgeQaRenameInputSchema.parse(raw); return invoke(identity, input, "update", async tx => { gate(); const current = await thread(tx, identity, input); if (!current || current.revision !== input.expectedVersion) return fail("THREAD_VERSION_CHANGED");
      const body = threadBodySchema.parse({ version: 1, identity, threadId: input.threadId, title: input.title, revision: current.revision + 1, deleted: false });
      await write(tx, "UPDATE ai_artifacts SET contentJson=?,contentHash=?,updatedAt=NOW(6) WHERE artifactId=? AND workspaceId=? AND userId=? AND contentHash=?", [knowledgeQaCanonical(body), knowledgeQaHash(body), current.artifactId, identity.workspaceId, identity.userId, current.contentHash]);
      const actual = await thread(tx, identity, input); if (!actual || actual.revision !== body.revision || actual.title !== input.title) return fail("THREAD_READBACK_INVALID"); return KnowledgeQaThreadSchema.parse({ threadId: actual.threadId, title: actual.title, version: actual.revision, createdAt: actual.createdAt, updatedAt: actual.updatedAt });
    }); },
    delete(identity: KnowledgeQaIdentity, raw: z.infer<typeof KnowledgeQaDeleteInputSchema>) { const input = KnowledgeQaDeleteInputSchema.parse(raw); return invoke(identity, input, "delete", async tx => { gate(); const current = await thread(tx, identity, input); if (!current || current.revision !== input.expectedVersion) return fail("THREAD_VERSION_CHANGED");
      const active = await rows(tx, "SELECT id FROM ai_jobs WHERE kind=? AND workspaceId=? AND userId=? AND JSON_UNQUOTE(JSON_EXTRACT(input,'$.request.threadId'))=? AND (status IN ('queued','running') OR JSON_UNQUOTE(JSON_EXTRACT(output,'$.state'))='outcome_unknown') LIMIT 1 FOR UPDATE", [KNOWLEDGE_QA_JOB_KIND, identity.workspaceId, identity.userId, input.threadId], 1); if (active.length) return fail("ACTIVE_OPERATION_EXISTS");
      const body = threadBodySchema.parse({ version: 1, identity, threadId: input.threadId, title: current.title, revision: current.revision + 1, deleted: true });
      await write(tx, "UPDATE ai_artifacts SET contentJson=?,contentHash=?,updatedAt=NOW(6) WHERE artifactId=? AND workspaceId=? AND userId=? AND contentHash=?", [knowledgeQaCanonical(body), knowledgeQaHash(body), current.artifactId, identity.workspaceId, identity.userId, current.contentHash]);
      if (!equal((await artifactRead(tx, identity, input, current.artifactId, KNOWLEDGE_QA_THREAD_KEY, current.artifactId))!.content, body)) return fail("THREAD_READBACK_INVALID"); return { deleted: true as const };
    }); },
    clear(identity: KnowledgeQaIdentity, raw: z.infer<typeof KnowledgeQaClearInputSchema>) { const input = KnowledgeQaClearInputSchema.parse(raw); return invoke(identity, input, "delete", async tx => {
      gate(); const active = await rows(tx, "SELECT id FROM ai_jobs WHERE kind=? AND workspaceId=? AND userId=? AND (status IN ('queued','running') OR JSON_UNQUOTE(JSON_EXTRACT(output,'$.state'))='outcome_unknown') LIMIT 1 FOR UPDATE", [KNOWLEDGE_QA_JOB_KIND, identity.workspaceId, identity.userId], 1);
      if (active.length) return fail("ACTIVE_OPERATION_EXISTS");
      const found = await rows(tx, "SELECT id,sourceId FROM ai_artifacts WHERE workspaceId=? AND userId=? AND domain='knowledge' AND artifactKey=? AND JSON_EXTRACT(contentJson,'$.deleted')=false ORDER BY id LIMIT 1001 FOR UPDATE", [identity.workspaceId, identity.userId, KNOWLEDGE_QA_THREAD_KEY], 1000);
      for (const row of found) { const scope = { expectedWorkspaceId: identity.workspaceId, threadId: uuid.parse(row.sourceId) }, current = await thread(tx, identity, scope); if (!current || current.id !== row.id) return fail("THREAD_INVALID");
        const body = threadBodySchema.parse({ version: 1, identity, threadId: scope.threadId, title: current.title, revision: current.revision + 1, deleted: true });
        await write(tx, "UPDATE ai_artifacts SET contentJson=?,contentHash=?,updatedAt=NOW(6) WHERE artifactId=? AND workspaceId=? AND userId=? AND contentHash=?", [knowledgeQaCanonical(body), knowledgeQaHash(body), current.artifactId, identity.workspaceId, identity.userId, current.contentHash]);
        if (!equal((await artifactRead(tx, identity, scope, current.artifactId, KNOWLEDGE_QA_THREAD_KEY, current.artifactId))!.content, body)) return fail("THREAD_READBACK_INVALID");
      }
      return { cleared: found.length };
    }); },
    claim(identity: KnowledgeQaIdentity, input: KnowledgeQaOperationInput, workerId: string): Promise<KnowledgeQaLease | null> { return invoke(identity, input, "run", async (tx, auth) => { gate(); if (!/^[a-zA-Z0-9_.:-]{1,80}$/u.test(workerId)) return fail("WORKER_INVALID"); await thread(tx, identity, input);
      const value = await state(tx, identity, input), run = value.run; if (!run || terminal(run.state) || run.leaseUntil !== null && run.leaseUntil > await now(tx)) return null;
      if (run.state === "dispatched") { run.state = "outcome_unknown"; run.errorCode = "DISPATCH_OUTCOME_UNKNOWN"; await update(tx, run); return null; }
      const current = await verifyReadable(tx, run, auth); if (current.sourceHash !== run.sourceHash) { run.state = "failed"; run.errorCode = "SOURCE_CHANGED"; await update(tx, run); return null; }
      const token = `${workerId}:${uuid.parse((deps.token ?? randomUUID)())}`; run.state = "running"; await update(tx, run, token, true); return { identity, scope: knowledgeQaOperation(input), runId: run.runId, token };
    }); },
    stage<T>(lease: KnowledgeQaLease, work: (tx: KnowledgeQaExecutor, run: KnowledgeQaRun, source: KnowledgeQaSource) => Promise<T>) { return invoke(lease.identity, lease.scope, "run", async (tx, auth) => { gate(); const value = await leased(tx, lease, auth, true); return work(tx, value.run, value.source); }); },
    heartbeat(lease: KnowledgeQaLease) { return invoke(lease.identity, lease.scope, "run", async (tx, auth) => update(tx, (await leased(tx, lease, auth, false)).run)); },
    deterministic(lease: KnowledgeQaLease) { return invoke(lease.identity, lease.scope, "run", async (tx, auth) => { gate(); const { run } = await leased(tx, lease, auth, true), next = nextKnowledgeQaStage(run); if (!next?.deterministic || run.state !== "running") return fail("STAGE_INVALID");
      const result = next.stageKey === "answer" ? "知识库中暂未找到足以回答此问题的相关资料。请换个关键词，或先补充并人工确认共享知识。" : next.stageKey === "l1_select" ? run.source.items.map((_, i) => i + 1) : next.indices.map((_, i) => i + 1);
      run.checkpoints.push({ stageKey: next.stageKey, indices: next.indices, dispatch: null, result, tokensUsed: 0 }); return next.stageKey === "answer" ? complete(tx, run) : update(tx, run);
    }); },
    dispatch(lease: KnowledgeQaLease, prepared: KnowledgeQaPreparedStage, rawReceipt: unknown, verify: (tx: KnowledgeQaExecutor, run: KnowledgeQaRun, source: KnowledgeQaSource) => Promise<void>) { return invoke(lease.identity, lease.scope, "run", async (tx, auth) => { gate(); const { run, source } = await leased(tx, lease, auth, true), next = nextKnowledgeQaStage(run), receipt = KnowledgeQaDispatchSchema.parse(rawReceipt);
      if (!next || next.deterministic || next.stageKey !== prepared.stageKey || run.state !== "running" || prepared.snapshotHash !== run.runtimeSnapshot.snapshotHash || receipt.requestHash !== prepared.providerRequestHash || receipt.bindingHash !== prepared.bindingHash) return fail("DISPATCH_INVALID");
      await verify(tx, run, source); gate(); run.checkpoints.push({ stageKey: next.stageKey, indices: next.indices, dispatch: { receipt, contextHash: prepared.contextHash, snapshotHash: prepared.snapshotHash, bindingHash: prepared.bindingHash, providerRequestHash: prepared.providerRequestHash }, result: null, tokensUsed: null }); run.state = "dispatched"; return update(tx, run);
    }); },
    checkpoint(lease: KnowledgeQaLease, result: KnowledgeQaPreparedStage & { runId: string; candidate: string | number[]; tokensUsed: number | null }) { return invoke(lease.identity, lease.scope, "run", async (tx, auth) => {
      const { run } = await leased(tx, lease, auth, false), checkpoint = run.checkpoints.at(-1), dispatch = checkpoint?.dispatch;
      if (run.state !== "dispatched" || !checkpoint || !dispatch || checkpoint.result !== null || checkpoint.stageKey !== result.stageKey || result.runId !== dispatch.receipt.runId
        || result.contextHash !== dispatch.contextHash || result.snapshotHash !== dispatch.snapshotHash || result.bindingHash !== dispatch.bindingHash || result.providerRequestHash !== dispatch.providerRequestHash) return fail("RESULT_RECEIPT_INVALID");
      checkpoint.result = checkpoint.stageKey === "answer" ? knowledgeQaValidateAnswer(result.candidate, checkpoint.indices.map(index => run.source.items[index - 1])) : knowledgeQaValidateSelection({ selectedIndices: result.candidate }, checkpoint.stageKey === "l1_select" ? run.source.items.length : checkpoint.indices.length, checkpoint.stageKey === "l1_select" ? 10 : 5);
      checkpoint.tokensUsed = result.tokensUsed; run.state = "running"; return checkpoint.stageKey === "answer" ? complete(tx, run) : update(tx, run);
    }); },
    failure(lease: KnowledgeQaLease, reason: string) { return invoke(lease.identity, lease.scope, "run", async (tx, auth) => { const { run } = await leased(tx, lease, auth, false); run.state = run.state === "dispatched" ? "outcome_unknown" : "failed"; run.errorCode = run.state === "outcome_unknown" ? "DISPATCH_OUTCOME_UNKNOWN" : code.safeParse(reason).success ? reason : "PROCESSING_FAILED"; return update(tx, run); }); },
    feedback(identity: KnowledgeQaIdentity, raw: z.infer<typeof KnowledgeQaFeedbackInputSchema>) { const input = KnowledgeQaFeedbackInputSchema.parse(raw); return invoke(identity, input, "update", async (tx, auth) => { gate(); const run = await load(tx, identity, input); if (!run?.answer || run.state !== "succeeded" || !run.answer.references.some(item => item.key === input.itemKey)) return fail("REFERENCE_UNAVAILABLE"); await thread(tx, identity, input); await verifyReadable(tx, run, auth);
      const key = `kqfb_${knowledgeQaHash({ identity, operationId: input.operationId, itemKey: input.itemKey })}`;
      const old = await rows(tx, "SELECT auditId FROM security_audit_logs WHERE auditId=? LIMIT 1 FOR UPDATE", [key], 1); if (old.length) return fail("FEEDBACK_ALREADY_RECORDED");
      await write(tx, "INSERT INTO security_audit_logs (workspaceId,auditId,actorUserId,actorRole,action,resourceType,resourceId,projectId,status,riskLevel,metadata) VALUES (?,?,?,?,'knowledge.qa.feedback','knowledge_qa',?,NULL,'success','low',?)", [identity.workspaceId, key, identity.userId, auth.role, input.operationId, knowledgeQaCanonical({ version: 1, identity, request: input, resultHash: run.resultHash })]); return { recorded: true as const };
    }); },
  };
}
