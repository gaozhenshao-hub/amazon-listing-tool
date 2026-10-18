import { randomUUID } from "node:crypto";
import { z } from "zod";
import { devAnalysisStages } from "../../../../drizzle/schema/project";
import { DevelopmentMarketIdentitySchema, DevelopmentMarketOperationSchema, DevelopmentMarketStartSchema, DevelopmentMarketApplyOperationSchema,
  DevelopmentMarketApplySchema, DevelopmentMarketSourceSchema, DevelopmentMarketResultSchema, validateDevelopmentMarketCandidate,
  developmentMarketCanonical as canonical, type DevelopmentMarketIdentity as Identity, type DevelopmentMarketOperation as Operation,
  type DevelopmentMarketStart as Start, type DevelopmentMarketApplyOperation as ApplyOperation, type DevelopmentMarketApply as Apply,
  type DevelopmentMarketSource as Source, type DevelopmentMarketResult as Result } from "../../../../shared/developmentMarket";
import { ConfiguredBusinessSavedConfigurationSchema, ConfiguredBusinessRuntimeSnapshotSchema, ConfiguredBusinessDispatchReceiptSchema,
  type ConfiguredBusinessSavedConfiguration as Configuration, type ConfiguredBusinessRuntimeSnapshot as Runtime,
  type ConfiguredBusinessDispatchReceipt as StrictReceipt } from "../../ai_os/services/configuredBusinessRuntimeContract";
import { requireDb } from "../../../repositories/dbClient";
import type { assertResourceAction } from "../../../services/securityGovernance";
import { captureDevelopmentMarketSource, developmentMarketSourceContext } from "./developmentMarketSource";
import { DevelopmentMarketError, authorizeDevelopmentMarket, assertDevelopmentMarketSchema, digest, decoded, equal, parse, refuse, rows, write, rowFingerprint, archivalProjection,
  type DevelopmentMarketExecutor as Tx, type DevelopmentMarketDatabase } from "./developmentMarketCore";

export const DEVELOPMENT_MARKET_JOB_KIND = "product.development.market_overview.v1";
export const DEVELOPMENT_MARKET_KEYS = Object.freeze({ source: "product.development.market_overview.source.v1", candidate: "product.development.market_overview.candidate.v1", apply: "product.development.market_overview.apply.v1" });
const hash = z.string().regex(/^[a-f0-9]{64}$/u), uuid = z.string().uuid().refine(value => value === value.toLowerCase()), id = z.number().int().min(1).max(2147483647), code = z.string().regex(/^[A-Z][A-Z0-9_]{0,120}$/u);
const dispatchSchema = z.object({ receipt: ConfiguredBusinessDispatchReceiptSchema, snapshotHash: hash, contextHash: hash, providerRequestHash: hash, bindingHash: hash }).strict();
const outputSchema = z.object({ version: z.literal(1), state: z.enum(["queued", "running", "dispatched", "candidate", "applied", "failed", "canceled", "outcome_unknown"]),
  dispatch: dispatchSchema.nullable(), resultHash: hash.nullable(), candidateArtifactId: z.string().max(80).nullable(), appliedOperationId: uuid.nullable(), reasonCode: code.nullable() }).strict();
const inputSchema = z.object({ version: z.literal(1), identity: DevelopmentMarketIdentitySchema, devProjectId: id, operationId: uuid, request: DevelopmentMarketStartSchema,
  requestHash: hash, sourceHash: hash, sourceArtifactId: z.string().max(80), configuration: ConfiguredBusinessSavedConfigurationSchema, runtimeSnapshot: ConfiguredBusinessRuntimeSnapshotSchema }).strict();
export type DevelopmentMarketRun = z.infer<typeof inputSchema> & z.infer<typeof outputSchema> & { id: number; runId: string; source: Source; result: Result | null; lockedBy: string | null; leaseUntil: number | null };
export type DevelopmentMarketPreparation = { configuration: Configuration; runtimeSnapshot: Runtime };
export type DevelopmentMarketPrepare = (tx: Tx, source: Source) => Promise<DevelopmentMarketPreparation>;
export type DevelopmentMarketLease = { identity: Identity; devProjectId: number; operationId: string; runId: string; token: string };
const receiptSchema = z.object({ identity: DevelopmentMarketIdentitySchema, devProjectId: id, operationId: uuid, runOperationId: uuid.nullable(),
  status: z.enum(["queued", "canceled", "committed"]), requestHash: hash.nullable(), resultHash: hash.nullable(), stageId: id.nullable(), stageRevision: z.number().int().nonnegative().nullable(), artifactId: z.string().max(80).nullable() }).strict();
export type DevelopmentMarketReceipt = z.infer<typeof receiptSchema>;
const terminal = (state: DevelopmentMarketRun["state"]) => ["candidate", "applied", "failed", "canceled", "outcome_unknown"].includes(state);
export const developmentMarketRunId = (identity: Identity, operationId: string) => `devmarket_${digest({ identity, operationId })}`;
const auditId = (identity: Identity, operationId: string, kind: "start" | "cancel" | "apply") => `devmk_${kind}_${digest({ identity, operationId })}`;
function bound(identity: Identity, input: { expectedWorkspaceId: number; devProjectId: number }) { parse(DevelopmentMarketIdentitySchema, identity); if (identity.workspaceId !== input.expectedWorkspaceId) refuse("ACCESS_DENIED"); }
function checkedReceipt(value: DevelopmentMarketReceipt | null, identity: Identity, input: Operation | ApplyOperation) { if (value && (!equal(value.identity, identity) || value.devProjectId !== input.devProjectId || value.operationId !== input.operationId || "runOperationId" in input && value.runOperationId !== input.runOperationId)) refuse("OPERATION_SCOPE_MISMATCH"); return value; }
async function readReceipt(tx: Tx, identity: Identity, operationId: string, kind: "start" | "cancel" | "apply") {
  const key = auditId(identity, operationId, kind), found = await rows(tx, "SELECT auditId,workspaceId,actorUserId,action,resourceType,resourceId,status,riskLevel,IF(OCTET_LENGTH(metadata)<=32768,metadata,NULL) AS metadata FROM security_audit_logs WHERE auditId=? AND BINARY auditId=BINARY ? FOR UPDATE", [key, key]);
  if (!found.length) return null; const row = found[0];
  if (row.auditId !== key || row.workspaceId !== identity.workspaceId || row.actorUserId !== identity.userId || row.action !== `development.market.${kind}` || row.resourceType !== "development_market" || row.resourceId !== operationId || row.status !== "success" || row.riskLevel !== "medium") refuse("JOURNAL_INVALID");
  return parse(z.object({ version: z.literal(1), receipt: receiptSchema }).strict(), decoded(row.metadata)).receipt;
}
async function recordReceipt(tx: Tx, role: string, identity: Identity, operationId: string, kind: "start" | "cancel" | "apply", value: DevelopmentMarketReceipt) {
  const old = await readReceipt(tx, identity, operationId, kind); if (old) { if (!equal(old, value)) refuse("OPERATION_CONTENT_CONFLICT"); return old; }
  await write(tx, "INSERT INTO security_audit_logs (auditId,workspaceId,actorUserId,actorRole,action,resourceType,resourceId,status,riskLevel,metadata) VALUES (?,?,?,?,?,'development_market',?,'success','medium',?)",
    [auditId(identity, operationId, kind), identity.workspaceId, identity.userId, role, `development.market.${kind}`, operationId, canonical({ version: 1, receipt: parse(receiptSchema, value) })]);
  if (!equal(await readReceipt(tx, identity, operationId, kind), value)) refuse("JOURNAL_READBACK_MISMATCH"); return value;
}
async function artifact(tx: Tx, identity: Identity, runId: string, devProjectId: number, artifactId: string, key: string) {
  const [row] = await rows(tx, "SELECT artifactId,workspaceId,userId,projectId,domain,artifactKey,artifactType,sourceType,sourceTable,sourceRowId,runId,sourceAiJobRunId,status,version,isCurrent,IF(OCTET_LENGTH(contentJson)<=4194304,contentJson,NULL) AS contentJson,contentHash FROM ai_artifacts WHERE artifactId=? AND BINARY artifactId=BINARY ? FOR SHARE", [artifactId, artifactId]);
  if (!row || row.artifactId !== artifactId || row.workspaceId !== identity.workspaceId || row.userId !== identity.userId || row.projectId !== null || row.domain !== "project"
    || row.artifactKey !== key || row.artifactType !== "json" || row.sourceType !== "system" || row.sourceTable !== "dev_projects" || row.sourceRowId !== String(devProjectId)
    || row.runId !== runId || row.sourceAiJobRunId !== runId || row.status !== "draft" || row.version !== 1 || row.isCurrent !== 0) refuse("ARTIFACT_INVALID");
  const content = decoded(row.contentJson); if (row.contentHash !== digest(content)) refuse("ARTIFACT_HASH_MISMATCH"); return content;
}
async function putArtifact(tx: Tx, identity: Identity, runId: string, devProjectId: number, artifactId: string, key: string, content: unknown) {
  await write(tx, "INSERT INTO ai_artifacts (workspaceId,artifactId,domain,artifactKey,artifactType,sourceType,sourceTable,sourceRowId,runId,sourceAiJobRunId,agentSlug,projectId,userId,status,version,isCurrent,contentJson,contentHash) VALUES (?,?,'project',?,'json','system','dev_projects',?,?,?,'development',NULL,?,'draft',1,0,?,?)", [identity.workspaceId, artifactId, key, String(devProjectId), runId, runId, identity.userId, canonical(content), digest(content)]);
  if (!equal(await artifact(tx, identity, runId, devProjectId, artifactId, key), content)) refuse("ARTIFACT_READBACK_MISMATCH");
}
const projection = "id,workspaceId,userId,projectId,runId,kind,module,`procedure`,status,queueName,attempt,maxAttempts,lockedBy,UNIX_TIMESTAMP(leaseUntil) AS leaseUntil,IF(OCTET_LENGTH(input)<=4194304,input,NULL) AS input,IF(OCTET_LENGTH(output)<=4194304,output,NULL) AS output";
function verifyDispatch(runtime: Runtime, dispatch: z.infer<typeof dispatchSchema>) {
  const bindingHash = digest({ schema: "configured-business-stage/v1", stage: "development_market_overview", snapshotHash: dispatch.snapshotHash, contextHash: dispatch.contextHash, providerRequestHash: dispatch.providerRequestHash });
  if (dispatch.snapshotHash !== runtime.snapshotHash || dispatch.bindingHash !== bindingHash || dispatch.receipt.stage !== "development_market_overview" || dispatch.receipt.bindingHash !== bindingHash
    || dispatch.receipt.requestHash !== dispatch.providerRequestHash || dispatch.receipt.modelConfigurationHash !== runtime.model.configurationHash || !equal(dispatch.receipt.budget, runtime.budgetPlan.budget)) refuse("DISPATCH_BINDING_INVALID");
}
async function load(tx: Tx, identity: Identity, input: Operation): Promise<DevelopmentMarketRun | null> {
  const runId = developmentMarketRunId(identity, input.operationId), [row] = await rows(tx, `SELECT ${projection} FROM ai_jobs WHERE runId=? AND BINARY runId=BINARY ? FOR UPDATE`, [runId, runId]);
  if (!row) return null; const frozen = parse(inputSchema, decoded(row.input)), output = parse(outputSchema, decoded(row.output));
  if (row.runId !== runId || row.workspaceId !== identity.workspaceId || row.userId !== identity.userId || row.projectId !== null || row.kind !== DEVELOPMENT_MARKET_JOB_KIND || row.module !== "productDevelopment"
    || !id.safeParse(row.id).success || row.lockedBy !== null && (typeof row.lockedBy !== "string" || !/^[a-zA-Z0-9_.:-]{1,128}$/u.test(row.lockedBy))
    || row.leaseUntil !== null && (!Number.isFinite(Number(row.leaseUntil)) || Number(row.leaseUntil) <= 0)
    || row.procedure !== "devAnalysis.marketStart" || row.queueName !== "development_market" || row.maxAttempts !== 1 || ![0, 1].includes(Number(row.attempt))
    || !equal(frozen.identity, identity) || frozen.devProjectId !== input.devProjectId || frozen.operationId !== input.operationId || frozen.requestHash !== digest({ identity, request: frozen.request })
    || frozen.request.devProjectId !== input.devProjectId || frozen.request.operationId !== input.operationId || frozen.sourceHash !== frozen.request.expectedSourceHash
    || frozen.runtimeSnapshot.snapshotHash !== frozen.request.expectedRuntimeHash || frozen.runtimeSnapshot.stage !== "development_market_overview" || frozen.configuration.agentKey !== "development"
    || frozen.runtimeSnapshot.sourceHash !== frozen.sourceHash || !equal(frozen.runtimeSnapshot.identity, identity) || frozen.runtimeSnapshot.operationId !== input.operationId
    || frozen.runtimeSnapshot.configuration.hash !== frozen.configuration.hash || frozen.runtimeSnapshot.configuration.revision !== frozen.configuration.revision
    || frozen.request.maxCostCents < frozen.runtimeSnapshot.budgetPlan.maxCostCentsTotal) refuse("RUN_INVALID");
  const dbState = output.state === "queued" ? "queued" : ["running", "dispatched"].includes(output.state) ? "running" : ["candidate", "applied"].includes(output.state) ? "succeeded" : output.state === "outcome_unknown" ? "failed" : output.state;
  if (row.status !== dbState || (row.lockedBy === null) !== (row.leaseUntil === null) || terminal(output.state) && row.lockedBy !== null) refuse("RUN_INVALID");
  const source = parse(DevelopmentMarketSourceSchema, await artifact(tx, identity, runId, input.devProjectId, frozen.sourceArtifactId, DEVELOPMENT_MARKET_KEYS.source));
  if (!equal(source.identity, identity) || source.devProjectId !== input.devProjectId || source.sourceHash !== frozen.sourceHash || frozen.runtimeSnapshot.sourceContextHash !== digest(developmentMarketSourceContext(source))) refuse("SOURCE_BINDING_INVALID");
  if (output.dispatch) verifyDispatch(frozen.runtimeSnapshot, output.dispatch);
  if (["dispatched", "candidate", "applied", "outcome_unknown"].includes(output.state) && output.dispatch === null || (output.resultHash === null) !== (output.candidateArtifactId === null)
    || ["candidate", "applied"].includes(output.state) !== (output.resultHash !== null) || (output.state === "applied") !== (output.appliedOperationId !== null)) refuse("CHECKPOINT_INVALID");
  let result: Result | null = null;
  if (output.candidateArtifactId) {
    const content = parse(z.object({ version: z.literal(1), sourceHash: hash, dispatchHash: hash, result: DevelopmentMarketResultSchema, resultHash: hash }).strict(), await artifact(tx, identity, runId, input.devProjectId, output.candidateArtifactId, DEVELOPMENT_MARKET_KEYS.candidate));
    if (content.resultHash !== output.resultHash || content.resultHash !== digest(content.result) || content.sourceHash !== source.sourceHash || content.dispatchHash !== digest(output.dispatch) || !equal(content.result.stats, source.stats)) refuse("RESULT_INVALID");
    validateDevelopmentMarketCandidate(content.result.ai, source); result = content.result;
  }
  if (output.appliedOperationId) {
    const applied = await readReceipt(tx, identity, output.appliedOperationId, "apply");
    if (!applied || applied.status !== "committed" || applied.runOperationId !== input.operationId || applied.devProjectId !== input.devProjectId || applied.resultHash !== output.resultHash || !applied.artifactId) refuse("APPLY_BINDING_INVALID");
    const archived = await artifact(tx, identity, runId, input.devProjectId, applied.artifactId, DEVELOPMENT_MARKET_KEYS.apply);
    if (!archived || typeof archived !== "object" || Array.isArray(archived)) refuse("APPLY_BINDING_INVALID");
    const receiptBody = archived as Record<string, unknown>, after = receiptBody.after;
    if (receiptBody.version !== 1 || !equal(receiptBody.identity, identity) || receiptBody.devProjectId !== input.devProjectId || receiptBody.operationId !== output.appliedOperationId
      || receiptBody.runOperationId !== input.operationId || receiptBody.requestHash !== applied.requestHash || receiptBody.sourceHash !== frozen.sourceHash || receiptBody.resultHash !== output.resultHash
      || !Array.isArray(receiptBody.before) || !Array.isArray(after) || after.length > 3 || after.filter(row => row && typeof row === "object" && row.id === applied.stageId && row.workspaceId === identity.workspaceId
        && row.projectId === input.devProjectId && row.stageType === "market_overview" && row.rowVersion === applied.stageRevision && row.rawResult === canonical(result)
        && row.editedResult === null && row.confirmedAt === null && row.status === "completed").length !== 1) refuse("APPLY_BINDING_INVALID");
  }
  return { ...frozen, ...output, id: Number(row.id), runId, source, result, lockedBy: row.lockedBy as string | null, leaseUntil: row.leaseUntil === null ? null : Number(row.leaseUntil) };
}
function outputOf(run: DevelopmentMarketRun) { return parse(outputSchema, { version: 1, state: run.state, dispatch: run.dispatch, resultHash: run.resultHash, candidateArtifactId: run.candidateArtifactId, appliedOperationId: run.appliedOperationId, reasonCode: run.reasonCode }); }
async function update(tx: Tx, run: DevelopmentMarketRun, token?: string) {
  const done = terminal(run.state), state = run.state === "dispatched" ? "running" : ["candidate", "applied"].includes(run.state) ? "succeeded" : run.state === "outcome_unknown" ? "failed" : run.state, value = outputOf(run);
  await write(tx, `UPDATE ai_jobs SET status=?,output=?,lockedBy=?,leaseUntil=${done ? "NULL" : "DATE_ADD(NOW(6),INTERVAL 120 SECOND)"},attempt=1,lastHeartbeatAt=NOW(6),completedAt=${done ? "NOW(6)" : "NULL"},updatedAt=NOW(6) WHERE id=? AND runId=? AND workspaceId=? AND userId=? AND kind=?`, [state, canonical(value), done ? null : token ?? run.lockedBy, run.id, run.runId, run.identity.workspaceId, run.identity.userId, DEVELOPMENT_MARKET_JOB_KIND]);
  const saved = await load(tx, run.identity, { expectedWorkspaceId: run.identity.workspaceId, devProjectId: run.devProjectId, operationId: run.operationId });
  if (!saved || !equal(outputOf(saved), value) || !done && saved.lockedBy !== (token ?? run.lockedBy)) refuse("JOB_READBACK_MISMATCH"); return saved;
}
export function createDevelopmentMarketRepository(dependencies: { getDb?: () => Promise<DevelopmentMarketDatabase | null>; permission?: typeof assertResourceAction;
  capture?: typeof captureDevelopmentMarketSource; enabled?: () => boolean; token?: () => string } = {}) {
  const getDb = dependencies.getDb ?? (() => requireDb("Development market")), enabled = dependencies.enabled ?? (() => process.env.ENABLE_DEVELOPMENT_MARKET_WRITES === "true"),
    capture = dependencies.capture ?? captureDevelopmentMarketSource, token = dependencies.token ?? randomUUID;
  const writable = () => { if (!enabled()) refuse("WRITES_DISABLED"); };
  async function invoke<T>(identity: Identity, scope: { expectedWorkspaceId: number; devProjectId: number }, action: "read" | "run" | "apply" | "cancel", mutation: boolean,
    body: (tx: Tx, actor: Awaited<ReturnType<typeof authorizeDevelopmentMarket>>) => Promise<T>): Promise<T> {
    bound(identity, scope); const db = await getDb(); if (!db || typeof db.transaction !== "function") refuse("TRANSACTION_REQUIRED");
    try { return await db.transaction(async tx => { await assertDevelopmentMarketSchema(tx); return body(tx, await authorizeDevelopmentMarket(tx, identity, scope.devProjectId, action, dependencies.permission)); }); }
    catch (error) { if (error instanceof DevelopmentMarketError) throw error; if (error instanceof Error && /^(?:DEVELOPMENT_MARKET_|CONFIGURED_BUSINESS_)[A-Z][A-Z0-9_]{0,120}$/u.test(error.message)) throw new DevelopmentMarketError(error.message.replace(/^(?:DEVELOPMENT_MARKET_|CONFIGURED_BUSINESS_)/u, "")); throw new DevelopmentMarketError(mutation ? "OUTCOME_UNVERIFIED" : "READ_UNAVAILABLE", mutation); }
  }
  const sourceIn = (tx: Tx, actor: Awaited<ReturnType<typeof authorizeDevelopmentMarket>>, identity: Identity, devProjectId: number) => capture(tx, identity, devProjectId, actor.project);
  async function receipts(tx: Tx, identity: Identity, input: Operation) {
    const start = checkedReceipt(await readReceipt(tx, identity, input.operationId, "start"), identity, input), canceled = checkedReceipt(await readReceipt(tx, identity, input.operationId, "cancel"), identity, input), run = await load(tx, identity, input);
    if (run && (!start || start.status !== "queued" || start.requestHash !== run.requestHash) || start && !run || canceled && run && run.state !== "canceled") refuse("START_RECEIPT_INVALID");
    return { run, receipt: canceled ?? start };
  }
  async function databaseNow(tx: Tx) { const [clock] = await rows(tx, "SELECT UNIX_TIMESTAMP(NOW(6)) AS currentTime"); if (!clock || !Number.isFinite(Number(clock.currentTime)) || Number(clock.currentTime) <= 0) refuse("CLOCK_UNAVAILABLE"); return Number(clock.currentTime); }
  async function leaseIn(tx: Tx, identity: Identity, lease: DevelopmentMarketLease) { const state = await receipts(tx, identity, { expectedWorkspaceId: identity.workspaceId, devProjectId: lease.devProjectId, operationId: lease.operationId }), run = state.run; if (!run || run.runId !== lease.runId || run.lockedBy !== lease.token || !["running", "dispatched"].includes(run.state) || run.leaseUntil === null || run.leaseUntil <= await databaseNow(tx) || state.receipt?.status === "canceled") refuse("LEASE_LOST"); return run; }
  function prepared(source: Source, operationId: string, value: DevelopmentMarketPreparation) {
    const runtimeSnapshot = parse(ConfiguredBusinessRuntimeSnapshotSchema, value.runtimeSnapshot), configuration = parse(ConfiguredBusinessSavedConfigurationSchema, value.configuration);
    if (configuration.agentKey !== "development" || !configuration.config.enabled || runtimeSnapshot.stage !== "development_market_overview" || runtimeSnapshot.sourceHash !== source.sourceHash || runtimeSnapshot.operationId !== operationId
      || !equal(runtimeSnapshot.identity, source.identity) || runtimeSnapshot.configuration.hash !== configuration.hash || runtimeSnapshot.configuration.revision !== configuration.revision || runtimeSnapshot.sourceContextHash !== digest(developmentMarketSourceContext(source))) refuse("RUNTIME_BINDING_INVALID");
    if (Buffer.byteLength(canonical(source.stats)) + runtimeSnapshot.budgetPlan.budget.outputTokens * 8 + 4096 > 65535) refuse("OUTPUT_STORAGE_BUDGET_UNAVAILABLE");
    return { runtimeSnapshot, configuration };
  }
  async function readSource(identity: Identity, input: Operation) { return invoke(identity, input, "read", false, (tx, actor) => sourceIn(tx, actor, identity, input.devProjectId)); }
  async function preview(identity: Identity, raw: Operation, prepare: DevelopmentMarketPrepare) { const input = parse(DevelopmentMarketOperationSchema, raw); return invoke(identity, input, "run", false, async (tx, actor) => { const source = await sourceIn(tx, actor, identity, input.devProjectId); return { source, ...prepared(source, input.operationId, await prepare(tx, source)) }; }); }
  async function reserve(identity: Identity, raw: Start, prepare: DevelopmentMarketPrepare) {
    const input = parse(DevelopmentMarketStartSchema, raw);
    return invoke(identity, input, "run", true, async (tx, actor) => {
      const state = await receipts(tx, identity, input), requestHash = digest({ identity, request: input });
      if (state.receipt?.status === "canceled") refuse("OPERATION_CANCELED"); if (state.run) { if (state.run.requestHash !== requestHash) refuse("OPERATION_CONTENT_CONFLICT"); return state.run; }
      writable(); const source = await sourceIn(tx, actor, identity, input.devProjectId); if (source.sourceHash !== input.expectedSourceHash) refuse("SOURCE_CHANGED");
      const active = await rows(tx, "SELECT id FROM ai_jobs WHERE kind=? AND workspaceId=? AND JSON_EXTRACT(input,'$.devProjectId')=? AND (status IN ('queued','running') OR JSON_UNQUOTE(JSON_EXTRACT(output,'$.state'))='outcome_unknown') ORDER BY id LIMIT 2 FOR UPDATE", [DEVELOPMENT_MARKET_JOB_KIND, identity.workspaceId, input.devProjectId], 1); if (active.length) refuse("ACTIVE_OPERATION_EXISTS");
      const plan = prepared(source, input.operationId, await prepare(tx, source)); if (plan.runtimeSnapshot.snapshotHash !== input.expectedRuntimeHash) refuse("RUNTIME_CHANGED"); if (input.maxCostCents < plan.runtimeSnapshot.budgetPlan.maxCostCentsTotal) refuse("COST_AUTHORIZATION_EXCEEDED");
      const runId = developmentMarketRunId(identity, input.operationId), sourceArtifactId = `devmk_src_${digest({ identity, operationId: input.operationId })}`, frozen = parse(inputSchema, { version: 1, identity, devProjectId: input.devProjectId, operationId: input.operationId, request: input, requestHash, sourceHash: source.sourceHash, sourceArtifactId, ...plan }), output = parse(outputSchema, { version: 1, state: "queued", dispatch: null, resultHash: null, candidateArtifactId: null, appliedOperationId: null, reasonCode: null });
      writable(); await putArtifact(tx, identity, runId, input.devProjectId, sourceArtifactId, DEVELOPMENT_MARKET_KEYS.source, source);
      await write(tx, "INSERT INTO ai_jobs (workspaceId,runId,kind,module,`procedure`,status,queueName,attempt,maxAttempts,userId,projectId,skillSlug,input,output) VALUES (?,?,?,'productDevelopment','devAnalysis.marketStart','queued','development_market',0,1,?,NULL,?,?,?)", [identity.workspaceId, runId, DEVELOPMENT_MARKET_JOB_KIND, identity.userId, plan.runtimeSnapshot.skill.slug, canonical(frozen), canonical(output)]);
      await recordReceipt(tx, actor.role, identity, input.operationId, "start", { identity, devProjectId: input.devProjectId, operationId: input.operationId, runOperationId: null, status: "queued", requestHash, resultHash: null, stageId: null, stageRevision: null, artifactId: null });
      const saved = await load(tx, identity, input); if (!saved || !equal(outputOf(saved), output)) refuse("JOB_READBACK_MISMATCH"); return saved;
    });
  }
  async function check(identity: Identity, raw: Operation) { const input = parse(DevelopmentMarketOperationSchema, raw); return invoke(identity, input, "read", false, tx => receipts(tx, identity, input)); }
  async function cancel(identity: Identity, raw: Operation) {
    const input = parse(DevelopmentMarketOperationSchema, raw); return invoke(identity, input, "cancel", true, async (tx, actor) => {
      const state = await receipts(tx, identity, input); if (state.receipt?.status === "canceled" || state.run && ["candidate", "applied"].includes(state.run.state)) return state;
      if (state.run) { state.run.state = "canceled"; state.run.reasonCode = "OPERATION_CANCELED"; await update(tx, state.run); }
      const receipt = await recordReceipt(tx, actor.role, identity, input.operationId, "cancel", { identity, devProjectId: input.devProjectId, operationId: input.operationId, runOperationId: null, status: "canceled", requestHash: state.run?.requestHash ?? null, resultHash: null, stageId: null, stageRevision: null, artifactId: null });
      return { run: state.run ? await load(tx, identity, input) : null, receipt };
    });
  }
  async function claim(identity: Identity, raw: Operation, workerId: string): Promise<DevelopmentMarketLease | null> {
    const input = parse(DevelopmentMarketOperationSchema, raw); if (!/^[a-zA-Z0-9_.:-]{1,80}$/u.test(workerId)) refuse("WORKER_INVALID");
    return invoke(identity, input, "run", true, async (tx, actor) => {
      writable(); const state = await receipts(tx, identity, input), run = state.run; if (!run || terminal(run.state) || state.receipt?.status === "canceled") return null;
      if (run.leaseUntil !== null && run.leaseUntil > await databaseNow(tx)) return null;
      if (run.state === "dispatched") { run.state = "outcome_unknown"; run.reasonCode = "DISPATCH_OUTCOME_UNKNOWN"; await update(tx, run); return null; }
      const source = await sourceIn(tx, actor, identity, input.devProjectId); if (source.sourceHash !== run.sourceHash) { run.state = "failed"; run.reasonCode = "SOURCE_CHANGED"; await update(tx, run); return null; }
      const leaseToken = `${workerId}:${parse(uuid, token())}`; run.state = "running"; await update(tx, run, leaseToken); return { identity, devProjectId: input.devProjectId, operationId: input.operationId, runId: run.runId, token: leaseToken };
    });
  }
  async function prepareStage<T>(lease: DevelopmentMarketLease, body: (tx: Tx, run: DevelopmentMarketRun, source: Source) => Promise<T>) {
    return invoke(lease.identity, { expectedWorkspaceId: lease.identity.workspaceId, devProjectId: lease.devProjectId }, "run", false, async (tx, actor) => { writable(); const source = await sourceIn(tx, actor, lease.identity, lease.devProjectId), run = await leaseIn(tx, lease.identity, lease); if (run.state !== "running" || run.sourceHash !== source.sourceHash) refuse("SOURCE_CHANGED"); return body(tx, run, source); });
  }
  async function heartbeat(lease: DevelopmentMarketLease) { return invoke(lease.identity, { expectedWorkspaceId: lease.identity.workspaceId, devProjectId: lease.devProjectId }, "run", true, async tx => update(tx, await leaseIn(tx, lease.identity, lease))); }
  async function dispatch(lease: DevelopmentMarketLease, value: z.infer<typeof dispatchSchema>, verifyFresh: (tx: Tx, run: DevelopmentMarketRun, source: Source) => Promise<void>) {
    return invoke(lease.identity, { expectedWorkspaceId: lease.identity.workspaceId, devProjectId: lease.devProjectId }, "run", true, async (tx, actor) => { writable(); const source = await sourceIn(tx, actor, lease.identity, lease.devProjectId), run = await leaseIn(tx, lease.identity, lease); if (run.state !== "running" || run.dispatch || source.sourceHash !== run.sourceHash) refuse("DISPATCH_CONFLICT"); const dispatch = parse(dispatchSchema, value); verifyDispatch(run.runtimeSnapshot, dispatch); await verifyFresh(tx, run, source); writable(); run.state = "dispatched"; run.dispatch = dispatch; return update(tx, run); });
  }
  async function candidate(lease: DevelopmentMarketLease, value: { stage: string; runId: string; candidate: unknown; contextHash: string; snapshotHash: string; providerRequestHash: string; bindingHash: string }) {
    return invoke(lease.identity, { expectedWorkspaceId: lease.identity.workspaceId, devProjectId: lease.devProjectId }, "run", true, async tx => {
      const run = await leaseIn(tx, lease.identity, lease), dispatch = run.dispatch; if (run.state !== "dispatched" || !dispatch || value.stage !== "development_market_overview" || value.runId !== dispatch.receipt.runId || value.contextHash !== dispatch.contextHash || value.snapshotHash !== dispatch.snapshotHash || value.providerRequestHash !== dispatch.providerRequestHash || value.bindingHash !== dispatch.bindingHash) refuse("RESULT_RECEIPT_INVALID");
      const result = parse(DevelopmentMarketResultSchema, { stats: run.source.stats, ai: validateDevelopmentMarketCandidate(value.candidate, run.source) }), resultHash = digest(result), artifactId = `devmk_can_${digest({ runId: run.runId })}`;
      await putArtifact(tx, lease.identity, run.runId, lease.devProjectId, artifactId, DEVELOPMENT_MARKET_KEYS.candidate, { version: 1, sourceHash: run.sourceHash, dispatchHash: digest(dispatch), result, resultHash });
      run.state = "candidate"; run.resultHash = resultHash; run.candidateArtifactId = artifactId; return update(tx, run);
    });
  }
  async function failure(lease: DevelopmentMarketLease, reasonCode: string) { return invoke(lease.identity, { expectedWorkspaceId: lease.identity.workspaceId, devProjectId: lease.devProjectId }, "read", true, async tx => { const run = await leaseIn(tx, lease.identity, lease); run.state = run.dispatch ? "outcome_unknown" : "failed"; run.reasonCode = run.dispatch ? "DISPATCH_OUTCOME_UNKNOWN" : code.safeParse(reasonCode).success ? reasonCode : "PROCESSING_FAILED"; return update(tx, run); }); }
  async function applyReceipt(tx: Tx, identity: Identity, input: ApplyOperation) {
    const receipt = checkedReceipt(await readReceipt(tx, identity, input.operationId, "apply"), identity, input);
    if (receipt?.status === "committed") { const run = await load(tx, identity, { expectedWorkspaceId: input.expectedWorkspaceId, devProjectId: input.devProjectId, operationId: input.runOperationId });
      if (!run || run.state !== "applied" || run.appliedOperationId !== input.operationId || run.resultHash !== receipt.resultHash) refuse("APPLY_BINDING_INVALID"); }
    return receipt;
  }
  async function applyCheck(identity: Identity, raw: ApplyOperation) { const input = parse(DevelopmentMarketApplyOperationSchema, raw); return invoke(identity, input, "read", false, tx => applyReceipt(tx, identity, input)); }
  async function applyCancel(identity: Identity, raw: ApplyOperation) { const input = parse(DevelopmentMarketApplyOperationSchema, raw); return invoke(identity, input, "cancel", true, async (tx, actor) => { const old = await applyReceipt(tx, identity, input); return old ?? recordReceipt(tx, actor.role, identity, input.operationId, "apply", { identity, devProjectId: input.devProjectId, operationId: input.operationId, runOperationId: input.runOperationId, status: "canceled", requestHash: null, resultHash: null, stageId: null, stageRevision: null, artifactId: null }); }); }
  async function apply(identity: Identity, raw: Apply) {
    const input = parse(DevelopmentMarketApplySchema, raw); return invoke(identity, input, "apply", true, async (tx, actor) => {
      const old = await applyReceipt(tx, identity, input), requestHash = digest({ identity, request: input });
      if (old) { if (old.status !== "committed") refuse("OPERATION_CANCELED"); if (old.requestHash !== requestHash) refuse("OPERATION_CONTENT_CONFLICT"); return old; }
      writable(); const source = await sourceIn(tx, actor, identity, input.devProjectId), run = await load(tx, identity, { ...input, operationId: input.runOperationId });
      if (!run || run.state !== "candidate" || !run.result || run.resultHash !== input.expectedResultHash || run.sourceHash !== input.expectedSourceHash || source.sourceHash !== run.sourceHash) refuse("SOURCE_OR_RESULT_CHANGED");
      const body = canonical(run.result); if (Buffer.byteLength(body) > 65535) refuse("OUTPUT_STORAGE_BUDGET_UNAVAILABLE");
      const prior = await rows(tx, `SELECT ${archivalProjection(devAnalysisStages)} FROM dev_analysis_stages WHERE projectId=? AND stageType IN ('market_overview','information_summary','decision_dashboard') ORDER BY stageType,id LIMIT 4 FOR UPDATE`, [input.devProjectId], 3), current = prior.find(row => row.stageType === "market_overview");
      if (prior.some(row => row.workspaceId !== identity.workspaceId || ["running", "generating"].includes(String(row.status))) || current?.status === "confirmed") refuse("STAGE_CONFIRMATION_CHANGED");
      if (current) await write(tx, `UPDATE dev_analysis_stages SET status='completed',rawResult=?,editedResult=NULL,runId=NULL,runProgress=100,runError=NULL,runCompletedAt=NOW(6),confirmedAt=NULL,rowVersion=rowVersion+1,lastMutationKey=?,updatedAt=NOW(6) WHERE id=? AND workspaceId=? AND projectId=? AND rowVersion=? AND ${rowFingerprint(devAnalysisStages)}=?`, [body, `development-market:${input.operationId}`, current.id, identity.workspaceId, input.devProjectId, source.stage?.rowVersion, source.stage?.revisionHash]);
      else await write(tx, "INSERT INTO dev_analysis_stages (workspaceId,projectId,userId,stageType,status,rawResult,runProgress,rowVersion,lastMutationKey) VALUES (?,?,?,'market_overview','completed',?,100,1,?)", [identity.workspaceId, input.devProjectId, identity.userId, body, `development-market:${input.operationId}`]);
      for (const downstream of prior.filter(row => row.stageType !== "market_overview")) await write(tx, "UPDATE dev_analysis_stages SET status=IF(rawResult IS NULL AND editedResult IS NULL,'pending','generated'),confirmedAt=NULL,runId=NULL,runProgress=0,rowVersion=rowVersion+1,lastMutationKey=?,updatedAt=NOW(6) WHERE id=? AND workspaceId=? AND projectId=? AND rowVersion=?", [`invalidate:development-market:${input.operationId}`, downstream.id, identity.workspaceId, input.devProjectId, downstream.rowVersion]);
      const after = await rows(tx, `SELECT ${archivalProjection(devAnalysisStages)} FROM dev_analysis_stages WHERE projectId=? AND stageType IN ('market_overview','information_summary','decision_dashboard') ORDER BY stageType,id LIMIT 4 FOR UPDATE`, [input.devProjectId], 3), updated = after.find(row => row.stageType === "market_overview");
      if (!updated || updated.rawResult !== body || updated.editedResult !== null || updated.confirmedAt !== null || updated.rowVersion !== (source.stage?.rowVersion ?? 0) + 1 || updated.status !== "completed") refuse("APPLY_READBACK_MISMATCH");
      const artifactId = `devmk_apply_${digest({ identity, operationId: input.operationId })}`;
      await putArtifact(tx, identity, run.runId, input.devProjectId, artifactId, DEVELOPMENT_MARKET_KEYS.apply, { version: 1, identity, devProjectId: input.devProjectId, operationId: input.operationId, runOperationId: input.runOperationId, requestHash, sourceHash: run.sourceHash, resultHash: run.resultHash, before: prior, after });
      const receipt = await recordReceipt(tx, actor.role, identity, input.operationId, "apply", { identity, devProjectId: input.devProjectId, operationId: input.operationId, runOperationId: input.runOperationId, status: "committed", requestHash, resultHash: run.resultHash, stageId: Number(updated.id), stageRevision: Number(updated.rowVersion), artifactId });
      run.state = "applied"; run.appliedOperationId = input.operationId; writable(); await update(tx, run); return receipt;
    });
  }
  return { readSource, preview, reserve, check, cancel, claim, prepareStage, heartbeat, dispatch, candidate, failure, apply, applyCheck, applyCancel };
}
