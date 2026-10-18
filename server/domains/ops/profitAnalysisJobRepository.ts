import { createHash, randomUUID } from "node:crypto";
import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { requireDb } from "../../repositories/dbClient";
import { assertMonthlyFinancialJson } from "../../../shared/monthlyFinancialRead";
import { ProfitAnalysisPreviewInputSchema, ProfitAnalysisSourceSchema, ProfitAnalysisEvidenceSchema, ProfitAnalysisResultSchema,
  buildProfitAnalysisEvidence, validateProfitAnalysisResultAgainstEvidence, type ProfitAnalysisSource, type ProfitAnalysisEvidence, type ProfitAnalysisResult } from "../../../shared/profitAnalysis";
import { ProfitAnalysisStartInputSchema, ProfitAnalysisSaveInputSchema, PROFIT_ANALYSIS_WORKFLOW_STATES, profitAnalysisLeaseRecovery,
  type ProfitAnalysisStartInput, type ProfitAnalysisSaveInput, type ProfitAnalysisWorkflowState } from "../../../shared/profitAnalysisWorkflow";
import { AssistantConfigurationSchema } from "../../../shared/assistantConfigurations";
import { configurationHash } from "../ai_os/services/assistantConversationSourcePrimitives";
import type { AssistantConversationSavedConfiguration } from "../ai_os/services/assistantConversationContext";

export const PROFIT_ANALYSIS_JOB_LIMITS = Object.freeze({ request: 16384, target: 4096, snapshot: 48 * 1024 * 1024, result: 8 * 1024 * 1024,
  dispatch: 16384, runtime: 512 * 1024, configuration: 129 * 1024, historyBytes: 16 * 1024 * 1024, history: 20 });
const REPORTS = "ops_profit_analysis_reports", RUNS = "ops_profit_analysis_runs", SAVES = "ops_profit_analysis_save_operations";
const ID = z.number().int().min(1).max(2147483647), VERSION = z.number().int().min(0).max(2147483646), UUID = z.string().uuid().refine(value => value === value.toLowerCase()), HASH = z.string().regex(/^[a-f0-9]{64}$/u);
const TIME = z.string().regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{6}$/u), CODE = z.string().regex(/^[A-Z][A-Z0-9_]{0,99}$/u);
const identitySchema = z.object({ workspaceId: ID, userId: ID }).strict();
const targetSchema = ProfitAnalysisPreviewInputSchema.omit({ expectedWorkspaceId: true });
export type ProfitAnalysisJobIdentity = z.infer<typeof identitySchema>;
export type ProfitAnalysisJobTarget = z.infer<typeof targetSchema>;
export interface ProfitAnalysisJobExecutor { execute(statement: SQL): Promise<unknown> }
export interface ProfitAnalysisJobDatabase { transaction<T>(body: (tx: ProfitAnalysisJobExecutor) => Promise<T>): Promise<T> }
export class ProfitAnalysisJobStorageError extends Error { constructor(readonly code: string, readonly conflict = false) { super(`PROFIT_ANALYSIS_JOB_${code}`); this.name = "ProfitAnalysisJobStorageError"; } }
function refuse(code: string, conflict = false): never { throw new ProfitAnalysisJobStorageError(code, conflict); }
function parse<T>(schema: z.ZodType<T>, value: unknown): T { const result = schema.safeParse(value); if (!result.success) refuse("DATA_INVALID"); return result.data; }
function canonical(value: unknown, limit = PROFIT_ANALYSIS_JOB_LIMITS.snapshot): string {
  try { assertMonthlyFinancialJson(value, { jsonDepth: 40, jsonNodes: 6000000, stringLength: limit }); } catch { return refuse("JSON_INVALID"); }
  const visit = (item: unknown): string => {
    if (item === null || typeof item === "number" || typeof item === "boolean") return JSON.stringify(item);
    if (typeof item === "string") { if (new TextDecoder().decode(new TextEncoder().encode(item)) !== item) refuse("JSON_INVALID"); return JSON.stringify(item); }
    if (Array.isArray(item)) return `[${item.map(visit).join(",")}]`;
    const object = item as Record<string, unknown>; return `{${Object.keys(object).sort().map(key => `${JSON.stringify(key)}:${visit(object[key])}`).join(",")}}`;
  };
  const result = visit(value); if (Buffer.byteLength(result) > limit) refuse("JSON_LIMIT"); return result;
}
export const profitAnalysisJobHash = (value: unknown, maxBytes?: number) => createHash("sha256").update(canonical(value, maxBytes)).digest("hex");
function json(value: unknown, limit: number): unknown {
  if (typeof value === "string") { if (Buffer.byteLength(value) > limit * 4) refuse("JSON_LIMIT"); try { value = JSON.parse(value); } catch { refuse("JSON_INVALID"); } }
  return JSON.parse(canonical(value, limit));
}
function target(value: ProfitAnalysisJobTarget) { const result = parse(targetSchema, value); if (canonical(value) !== canonical(result)) refuse("TARGET_NONCANONICAL"); return result; }
const scopeHash = (value: ProfitAnalysisJobTarget) => profitAnalysisJobHash(target(value), PROFIT_ANALYSIS_JOB_LIMITS.target);
function boundRequest(owner: ProfitAnalysisJobIdentity, scope: ProfitAnalysisJobTarget, request: { expectedWorkspaceId: number; scope: unknown; month: string }) {
  if (request.expectedWorkspaceId !== owner.workspaceId || canonical({ scope: request.scope, month: request.month }) !== canonical(scope)) refuse("SCOPE_MISMATCH", true);
}
export function profitAnalysisJobRequestHash(owner: ProfitAnalysisJobIdentity, scope: ProfitAnalysisJobTarget, operationId: string, raw: ProfitAnalysisStartInput) {
  parse(identitySchema, owner); target(scope); parse(UUID, operationId); const request = parse(ProfitAnalysisStartInputSchema, raw); boundRequest(owner, scope, request);
  if (request.operationId !== operationId) refuse("SCOPE_MISMATCH", true);
  return profitAnalysisJobHash({ identity: owner, target: scope, operationId, request }, PROFIT_ANALYSIS_JOB_LIMITS.request);
}
export function profitAnalysisSaveRequestHash(owner: ProfitAnalysisJobIdentity, scope: ProfitAnalysisJobTarget, saveOperationId: string, raw: ProfitAnalysisSaveInput) {
  parse(identitySchema, owner); target(scope); parse(UUID, saveOperationId); const request = parse(ProfitAnalysisSaveInputSchema, raw); boundRequest(owner, scope, request);
  if (request.saveOperationId !== saveOperationId) refuse("SCOPE_MISMATCH", true);
  return profitAnalysisJobHash({ identity: owner, target: scope, saveOperationId, request }, PROFIT_ANALYSIS_JOB_LIMITS.request);
}
export type ProfitAnalysisJobSnapshot = { source: ProfitAnalysisSource; evidence: ProfitAnalysisEvidence; configuration: AssistantConversationSavedConfiguration | null; runtime: unknown | null };
function snapshot(raw: unknown, owner: ProfitAnalysisJobIdentity, scope: ProfitAnalysisJobTarget, request: ProfitAnalysisStartInput): ProfitAnalysisJobSnapshot {
  const shape = parse(z.object({ source: ProfitAnalysisSourceSchema, evidence: ProfitAnalysisEvidenceSchema, configuration: z.unknown(), runtime: z.unknown() }).strict(), json(raw, PROFIT_ANALYSIS_JOB_LIMITS.snapshot));
  if (canonical(shape.source.identity) !== canonical(owner) || canonical(shape.source.scope) !== canonical(scope.scope) || shape.source.month !== scope.month
    || shape.source.sourceHash !== request.expectedSourceHash || shape.evidence.status !== "ready" || profitAnalysisJobHash(buildProfitAnalysisEvidence(shape.source)) !== profitAnalysisJobHash(shape.evidence)) refuse("SNAPSHOT_INVALID");
  const deterministic = shape.evidence.evidence.length === 0;
  if (deterministic ? shape.configuration !== null || shape.runtime !== null : shape.configuration === null || shape.runtime === null || shape.configuration === undefined || shape.runtime === undefined) refuse("SNAPSHOT_INVALID");
  let configuration: AssistantConversationSavedConfiguration | null = null;
  if (shape.configuration !== null) {
    configuration = parse(z.object({ workspaceId: ID, agentKey: z.literal("finance"), revision: ID, hash: HASH, config: AssistantConfigurationSchema }).strict(), json(shape.configuration, PROFIT_ANALYSIS_JOB_LIMITS.configuration));
    if (configuration.workspaceId !== owner.workspaceId || configuration.hash !== configurationHash(configuration.config)) refuse("SNAPSHOT_INVALID");
    canonical(shape.runtime, PROFIT_ANALYSIS_JOB_LIMITS.runtime);
  }
  return { source: shape.source, evidence: shape.evidence, configuration, runtime: shape.runtime };
}
// This validates only the persisted one-call fence against its already frozen
// runtime. It neither approves a source nor imports/starts the execution bridge.
const dispatchBudget = z.object({ textBytes: z.number().int().nonnegative(), imageCount: z.literal(0), imageBytes: z.literal(0), contextAdmissionUnits: z.number().int().nonnegative(), outputTokens: z.number().int().positive(), contextLimit: z.number().int().positive(), tokenEstimateIsExact: z.literal(false) }).strict();
const dispatchEnvelope = z.object({ strictDispatch: z.object({ runId: z.string().min(1).max(128).refine(value => value.trim() === value && !/[\u0000-\u001f\u007f]/u.test(value)), stage: z.literal("profit_analysis"), requestHash: HASH, modelConfigurationHash: HASH, bindingHash: HASH, budget: dispatchBudget }).strict(), runtimeSnapshotHash: HASH, contextHash: HASH, bindingHash: HASH }).strict();
function verifiedDispatch(raw: unknown, frozen: ProfitAnalysisJobSnapshot | null, owner: ProfitAnalysisJobIdentity, operationId: string) {
  const receipt = dispatchEnvelope.safeParse(json(raw, PROFIT_ANALYSIS_JOB_LIMITS.dispatch));
  const runtime = z.object({ schema: z.literal("profit-analysis-runtime/v1"), identity: identitySchema, operationId: UUID, stage: z.literal("profit_analysis"), snapshotHash: HASH, contextHash: HASH, providerRequestHash: HASH, model: z.object({ configurationHash: HASH }).passthrough(), budget: dispatchBudget }).passthrough().safeParse(frozen?.runtime);
  if (!receipt.success || !runtime.success || !frozen || !frozen.evidence.evidence.length) refuse("DISPATCH_INVALID");
  const r = runtime.data, v = receipt.data;
  const bindingHash = profitAnalysisJobHash({ schema: "profit-analysis-stage/v1", stage: "profit_analysis", snapshotHash: r.snapshotHash, contextHash: r.contextHash, providerRequestHash: r.providerRequestHash });
  if (r.identity.workspaceId !== owner.workspaceId || r.identity.userId !== owner.userId || r.operationId !== operationId || v.runtimeSnapshotHash !== r.snapshotHash || v.contextHash !== r.contextHash || v.bindingHash !== bindingHash || v.strictDispatch.bindingHash !== bindingHash || v.strictDispatch.requestHash !== r.providerRequestHash || v.strictDispatch.modelConfigurationHash !== r.model.configurationHash || canonical(v.strictDispatch.budget) !== canonical(r.budget)) refuse("DISPATCH_INVALID");
  return v;
}
type Row = Record<string, unknown>;
function statement(text: string, values: unknown[] = []): SQL { const parts = text.split("?"); if (parts.length !== values.length + 1) refuse("SQL_INVALID"); return sql.join(parts.flatMap((part, i) => i < values.length ? [sql.raw(part), sql`${values[i]}`] : [sql.raw(part)]), sql.raw("")); }
async function rows(tx: ProfitAnalysisJobExecutor, text: string, values: unknown[] = [], max = 1000): Promise<Row[]> { const raw = await tx.execute(statement(text, values)); if (!Array.isArray(raw) || !Array.isArray(raw[0]) || raw[0].length > max || raw[0].some(row => !row || typeof row !== "object" || Array.isArray(row))) refuse("READ_INVALID"); return raw[0]; }
async function write(tx: ProfitAnalysisJobExecutor, text: string, values: unknown[] = []) {
  // Canonical bounds are independent of MySQL wire/packet bounds. A deployment
  // too small for this complete statement is unavailable, not a truncated save.
  const size = values.reduce<number>((total, value) => total + (typeof value === "string" ? Buffer.byteLength(value) : 32), Buffer.byteLength(text) + 4096);
  const packet = await rows(tx, "SELECT @@max_allowed_packet AS maximumPacket", [], 1);
  if (packet.length !== 1 || !Number.isSafeInteger(Number(packet[0].maximumPacket)) || Number(packet[0].maximumPacket) < size) refuse("PACKET_LIMIT");
  const result = await tx.execute(statement(text, values)); if (!Array.isArray(result) || !result[0] || typeof result[0] !== "object" || result[0].affectedRows !== 1) refuse("WRITE_UNVERIFIABLE");
}
const time = (column: string, alias: string) => `DATE_FORMAT(${column},'%Y-%m-%d %H:%i:%s.%f') AS ${alias}`;
const jsonProjection = (column: string, alias: string, bytes: number) => `IF(OCTET_LENGTH(${column})<=${bytes * 4},${column},NULL) AS ${alias},OCTET_LENGTH(${column}) AS ${alias}Bytes`;
const commonProjection = `id,workspace_id AS workspaceId,user_id AS userId,scope_hash AS scopeHash,${jsonProjection("target_snapshot", "target", PROFIT_ANALYSIS_JOB_LIMITS.target)}`;
const reportProjection = `${commonProjection},version,active_operation_id AS activeOperationId,latest_operation_id AS latestOperationId,saved_operation_id AS savedOperationId,${time("created_at", "createdAt")},${time("updated_at", "updatedAt")},${time("saved_at", "savedAt")}`;
const runProjection = `${commonProjection},operation_id AS operationId,request_hash AS requestHash,snapshot_hash AS snapshotHash,state,attempt,lease_token AS leaseToken,lease_owner AS leaseOwner,${time("lease_expires_at", "leaseExpiresAt")},${time("heartbeat_at", "heartbeatAt")},${jsonProjection("request_snapshot", "request", PROFIT_ANALYSIS_JOB_LIMITS.request)},${jsonProjection("snapshot", "snapshot", PROFIT_ANALYSIS_JOB_LIMITS.snapshot)},${jsonProjection("dispatch_receipt", "dispatchReceipt", PROFIT_ANALYSIS_JOB_LIMITS.dispatch)},${jsonProjection("result_snapshot", "result", PROFIT_ANALYSIS_JOB_LIMITS.result)},result_hash AS resultHash,error_code AS errorCode,${time("created_at", "createdAt")},${time("updated_at", "updatedAt")},${time("completed_at", "completedAt")}`;
const saveProjection = `${commonProjection},save_operation_id AS saveOperationId,run_operation_id AS runOperationId,request_hash AS requestHash,${jsonProjection("request_snapshot", "request", PROFIT_ANALYSIS_JOB_LIMITS.request)},status,report_version AS reportVersion,result_hash AS resultHash,${time("saved_at", "savedAt")},${time("created_at", "createdAt")}`;
const common = { id: ID, workspaceId: ID, userId: ID, scopeHash: HASH, target: targetSchema };
const reportSchema = z.object({ ...common, version: VERSION, activeOperationId: UUID.nullable(), latestOperationId: UUID.nullable(), savedOperationId: UUID.nullable(), createdAt: TIME, updatedAt: TIME, savedAt: TIME.nullable() }).strict();
export type ProfitAnalysisReport = z.infer<typeof reportSchema>;
const runSchema = z.object({ ...common, operationId: UUID, requestHash: HASH.nullable(), snapshotHash: HASH.nullable(), request: ProfitAnalysisStartInputSchema.nullable(), snapshot: z.unknown(), state: z.enum(PROFIT_ANALYSIS_WORKFLOW_STATES), attempt: VERSION,
  leaseToken: UUID.nullable(), leaseOwner: z.string().min(1).max(128).nullable(), leaseExpiresAt: TIME.nullable(), heartbeatAt: TIME.nullable(), dispatchReceipt: z.unknown(), result: ProfitAnalysisResultSchema.nullable(), resultHash: HASH.nullable(), errorCode: CODE.nullable(), createdAt: TIME, updatedAt: TIME, completedAt: TIME.nullable() }).strict();
export type ProfitAnalysisJobRun = Omit<z.infer<typeof runSchema>, "snapshot"> & { snapshot: ProfitAnalysisJobSnapshot | null };
const saveSchema = z.object({ ...common, saveOperationId: UUID, runOperationId: UUID.nullable(), requestHash: HASH.nullable(), request: ProfitAnalysisSaveInputSchema.nullable(), status: z.enum(["committed", "canceled"]), reportVersion: ID.nullable(), resultHash: HASH.nullable(), savedAt: TIME.nullable(), createdAt: TIME }).strict();
export type ProfitAnalysisSaveReceipt = { saveId: string; operationId: string; requestHash: string; resultHash: string; sourceHash: string; reportVersion: number; savedAt: string };
export type ProfitAnalysisSaveOperation = z.infer<typeof saveSchema> & { receipt: ProfitAnalysisSaveReceipt | null };
const terminal = (state: ProfitAnalysisWorkflowState) => ["succeeded", "failed", "canceled", "unknown"].includes(state);
function decode(raw: Row, fields: Record<string, number>) {
  const copy = { ...raw };
  for (const [key, maximum] of Object.entries(fields)) {
    const bytes = copy[`${key}Bytes`];
    if (bytes === null ? copy[key] !== null : typeof bytes !== "number" || !Number.isSafeInteger(bytes) || bytes < 1 || bytes > maximum * 4 || copy[key] === null) refuse("JSON_LIMIT");
    copy[key] = copy[key] === null ? null : json(copy[key], maximum); delete copy[`${key}Bytes`];
  }
  return copy;
}
function verifyBound<T extends { workspaceId: number; userId: number; scopeHash: string; target: ProfitAnalysisJobTarget }>(value: T, owner: ProfitAnalysisJobIdentity, scope: ProfitAnalysisJobTarget): T {
  if (value.workspaceId !== owner.workspaceId || value.userId !== owner.userId || value.scopeHash !== scopeHash(scope) || canonical(value.target) !== canonical(scope)) refuse("SCOPE_MISMATCH", true); return value;
}
function runRecord(raw: Row, owner: ProfitAnalysisJobIdentity, scope: ProfitAnalysisJobTarget): ProfitAnalysisJobRun {
  const value = verifyBound(parse(runSchema, decode(raw, { target: PROFIT_ANALYSIS_JOB_LIMITS.target, request: PROFIT_ANALYSIS_JOB_LIMITS.request, snapshot: PROFIT_ANALYSIS_JOB_LIMITS.snapshot, dispatchReceipt: PROFIT_ANALYSIS_JOB_LIMITS.dispatch, result: PROFIT_ANALYSIS_JOB_LIMITS.result })), owner, scope);
  const tombstone = value.request === null;
  let frozen: ProfitAnalysisJobSnapshot | null = null;
  if (tombstone) { if (value.state !== "canceled" || value.requestHash !== null || value.snapshotHash !== null || value.snapshot !== null || value.attempt !== 0 || value.dispatchReceipt !== null || value.result !== null || value.resultHash !== null) refuse("RUN_INVALID"); }
  else {
    if (value.requestHash !== profitAnalysisJobRequestHash(owner, scope, value.operationId, value.request!) || value.snapshot === null) refuse("IMMUTABLE_CHANGED", true);
    frozen = snapshot(value.snapshot, owner, scope, value.request!);
    if (value.snapshotHash !== profitAnalysisJobHash({ requestHash: value.requestHash, snapshot: frozen })) refuse("IMMUTABLE_CHANGED", true);
  }
  if ((value.leaseToken === null) !== (value.leaseOwner === null) || (value.leaseToken === null) !== (value.leaseExpiresAt === null)
    || terminal(value.state) && (value.leaseToken !== null || value.completedAt === null) || !terminal(value.state) && value.completedAt !== null
    || (value.result === null) !== (value.resultHash === null)) refuse("RUN_INVALID");
  if (value.dispatchReceipt !== null) verifiedDispatch(value.dispatchReceipt, frozen, owner, value.operationId);
  if (value.result !== null) {
    if (!frozen || value.resultHash !== profitAnalysisJobHash(value.result, PROFIT_ANALYSIS_JOB_LIMITS.result)) refuse("RESULT_INVALID");
    try { validateProfitAnalysisResultAgainstEvidence(value.result, frozen.evidence); } catch { refuse("RESULT_INVALID"); }
    if (value.result.modelCalled !== (value.dispatchReceipt !== null)) refuse("RESULT_INVALID");
  }
  if (value.state === "queued" && (value.result !== null || value.dispatchReceipt !== null) || value.state === "dispatched" && (value.dispatchReceipt === null || value.result !== null)
    || ["result_ready", "succeeded"].includes(value.state) && value.result === null || value.state === "unknown" && value.dispatchReceipt === null
    || value.state === "failed" && (value.dispatchReceipt !== null || value.result !== null)) refuse("RUN_INVALID");
  return { ...value, snapshot: frozen };
}

type Spec = { type: string; nullable?: true; length?: number; values?: readonly string[] };
const integer = { type: "int" }, uuid = { type: "char", length: 36 }, hash = { type: "char", length: 64 }, date = { type: "datetime" }, nullableJson = { type: "json", nullable: true } as const;
const baseColumns = { id: integer, workspace_id: integer, user_id: integer, scope_hash: hash, target_snapshot: { type: "json" } };
const columns: Record<string, Record<string, Spec>> = {
  [REPORTS]: { ...baseColumns, version: integer, active_operation_id: { ...uuid, nullable: true }, latest_operation_id: { ...uuid, nullable: true }, saved_operation_id: { ...uuid, nullable: true }, created_at: date, updated_at: date, saved_at: { ...date, nullable: true } },
  [RUNS]: { ...baseColumns, operation_id: uuid, request_hash: { ...hash, nullable: true }, snapshot_hash: { ...hash, nullable: true }, request_snapshot: nullableJson, snapshot: nullableJson,
    state: { type: "enum", values: PROFIT_ANALYSIS_WORKFLOW_STATES }, lease_token: { ...uuid, nullable: true }, lease_owner: { type: "varchar", length: 128, nullable: true }, attempt: integer,
    lease_expires_at: { ...date, nullable: true }, heartbeat_at: { ...date, nullable: true }, dispatch_receipt: nullableJson, result_snapshot: nullableJson, result_hash: { ...hash, nullable: true }, error_code: { type: "varchar", length: 100, nullable: true }, created_at: date, updated_at: date, completed_at: { ...date, nullable: true } },
  [SAVES]: { ...baseColumns, save_operation_id: uuid, run_operation_id: { ...uuid, nullable: true }, request_hash: { ...hash, nullable: true }, request_snapshot: nullableJson, status: { type: "enum", values: ["committed", "canceled"] }, report_version: { ...integer, nullable: true }, result_hash: { ...hash, nullable: true }, saved_at: { ...date, nullable: true }, created_at: date },
};
const indexes: Record<string, { keys: string[]; unique: boolean }[]> = {
  [REPORTS]: [{ keys: ["id"], unique: true }, { keys: ["workspace_id", "user_id", "scope_hash"], unique: true }],
  [RUNS]: [{ keys: ["id"], unique: true }, { keys: ["workspace_id", "user_id", "operation_id"], unique: true }, { keys: ["workspace_id", "user_id", "scope_hash", "id"], unique: false }, { keys: ["state", "lease_expires_at", "id"], unique: false }],
  [SAVES]: [{ keys: ["id"], unique: true }, { keys: ["workspace_id", "user_id", "save_operation_id"], unique: true }],
};
export async function profitAnalysisJobSchemaReady(tx: ProfitAnalysisJobExecutor): Promise<boolean> {
  const names = Object.keys(columns), allNames = [...names, "workspaces", "users", "workspace_memberships"];
  const tables = await rows(tx, `SELECT TABLE_NAME AS tableName,ENGINE AS engine,TABLE_COLLATION AS collation FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (${allNames.map(() => "?").join(",")})`, allNames);
  const fields = await rows(tx, `SELECT TABLE_NAME AS tableName,COLUMN_NAME AS columnName,DATA_TYPE AS dataType,COLUMN_TYPE AS columnType,IS_NULLABLE AS isNullable,EXTRA AS extra,CHARACTER_MAXIMUM_LENGTH AS maxLength,DATETIME_PRECISION AS precisionValue,COLLATION_NAME AS collation,COLUMN_DEFAULT AS defaultValue FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (${names.map(() => "?").join(",")})`, names);
  const entries = await rows(tx, `SELECT TABLE_NAME AS tableName,INDEX_NAME AS indexName,COLUMN_NAME AS columnName,SEQ_IN_INDEX AS sequence,NON_UNIQUE AS nonUnique,SUB_PART AS prefixLength FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (${names.map(() => "?").join(",")})`, names);
  if (tables.length !== allNames.length || new Set(tables.map(row => row.tableName)).size !== tables.length || tables.some(row => !allNames.includes(String(row.tableName)) || row.engine !== "InnoDB" || names.includes(String(row.tableName)) && row.collation !== "utf8mb4_bin")
    || fields.length !== Object.values(columns).reduce((total, spec) => total + Object.keys(spec).length, 0) || new Set(fields.map(row => `${row.tableName}:${row.columnName}`)).size !== fields.length || entries.length > 100) return false;
  for (const row of fields) { const expected = columns[String(row.tableName)]?.[String(row.columnName)]; if (!expected || row.dataType !== expected.type || row.isNullable !== (expected.nullable ? "YES" : "NO") || row.extra !== (row.columnName === "id" ? "auto_increment" : "") || row.defaultValue !== null || typeof row.columnType !== "string" || /unsigned/iu.test(row.columnType)
    || expected.length && (Number(row.maxLength) !== expected.length || row.collation !== "utf8mb4_bin" || row.columnType !== `${expected.type}(${expected.length})`)
    || expected.values && (row.columnType !== `enum(${expected.values.map(value => `'${value}'`).join(",")})` || row.collation !== "utf8mb4_bin") || expected.type === "datetime" && (Number(row.precisionValue) !== 3 || row.columnType !== "datetime(3)") || expected.type === "int" && !/^int(?:\(\d+\))?$/u.test(row.columnType)) return false; }
  const groups = new Map<string, Row[]>(); for (const row of entries) { if (!names.includes(String(row.tableName)) || ![0, 1].includes(Number(row.nonUnique)) || row.prefixLength !== null || !ID.safeParse(Number(row.sequence)).success) return false; const key = `${row.tableName}:${row.indexName}`; groups.set(key, [...(groups.get(key) ?? []), row]); }
  const actual = [...groups.values()].map(group => group.sort((a, b) => Number(a.sequence) - Number(b.sequence)));
  const matches = (group: Row[], table: string, wanted: { keys: string[]; unique: boolean }) => group[0].tableName === table && Number(group[0].nonUnique) === (wanted.unique ? 0 : 1) && group.length === wanted.keys.length && group.every((row, i) => Number(row.sequence) === i + 1 && row.columnName === wanted.keys[i] && row.nonUnique === group[0].nonUnique);
  return Object.entries(indexes).every(([table, required]) => required.every(index => actual.some(group => matches(group, table, index)))) && actual.every(group => Number(group[0].nonUnique) !== 0 || indexes[String(group[0].tableName)].some(index => matches(group, String(group[0].tableName), index)));
}

export type ProfitAnalysisJobLease = { target: ProfitAnalysisJobTarget; operationId: string; leaseToken: string; workerId: string; attempt: number };
export type ProfitAnalysisJobEnqueueInput = { target: ProfitAnalysisJobTarget; operationId: string; expectedReportVersion: number; request: ProfitAnalysisStartInput; requestHash: string; snapshot: ProfitAnalysisJobSnapshot };
export type ProfitAnalysisJobSaveInput = { target: ProfitAnalysisJobTarget; saveOperationId: string; runOperationId: string; expectedReportVersion: number; expectedResultHash: string; requestHash: string; request: ProfitAnalysisSaveInput };
function session(tx: ProfitAnalysisJobExecutor, owner: ProfitAnalysisJobIdentity, actor: { id: number; role: string }, enabled: () => boolean, readOnly: boolean) {
  let open = true;
  function check(requireEnabled = false, mutation = requireEnabled) { if (!open) refuse("SESSION_CLOSED"); if (mutation && readOnly) refuse("READ_ONLY_SESSION"); if (requireEnabled && enabled() !== true) refuse("WRITES_DISABLED"); }
  async function report(scope: ProfitAnalysisJobTarget) {
    check(); target(scope); const found = await rows(tx, `SELECT ${reportProjection} FROM ${REPORTS} WHERE workspace_id=? AND user_id=? AND scope_hash=? LIMIT 2 FOR UPDATE`, [owner.workspaceId, owner.userId, scopeHash(scope)], 2);
    if (found.length > 1) refuse("REPORT_INVALID"); if (!found.length) return null;
    const result = verifyBound(parse(reportSchema, decode(found[0], { target: PROFIT_ANALYSIS_JOB_LIMITS.target })), owner, scope);
    if ((result.savedOperationId === null) !== (result.savedAt === null) || result.activeOperationId !== null && result.latestOperationId !== result.activeOperationId) refuse("REPORT_INVALID"); return result;
  }
  async function run(scope: ProfitAnalysisJobTarget, operationId: string) {
    check(); target(scope); parse(UUID, operationId);
    const found = await rows(tx, `SELECT ${runProjection} FROM ${RUNS} WHERE workspace_id=? AND user_id=? AND operation_id=? LIMIT 2 FOR UPDATE`, [owner.workspaceId, owner.userId, operationId], 2);
    if (found.length > 1) refuse("RUN_INVALID"); if (!found.length) return null;
    const value = runRecord(found[0], owner, scope); if (value.operationId !== operationId) refuse("SCOPE_MISMATCH", true); return value;
  }
  async function saveOperation(scope: ProfitAnalysisJobTarget, saveOperationId: string) {
    check(); target(scope); parse(UUID, saveOperationId);
    const found = await rows(tx, `SELECT ${saveProjection} FROM ${SAVES} WHERE workspace_id=? AND user_id=? AND save_operation_id=? LIMIT 2 FOR UPDATE`, [owner.workspaceId, owner.userId, saveOperationId], 2);
    if (found.length > 1) refuse("SAVE_INVALID"); if (!found.length) return null;
    const value = verifyBound(parse(saveSchema, decode(found[0], { target: PROFIT_ANALYSIS_JOB_LIMITS.target, request: PROFIT_ANALYSIS_JOB_LIMITS.request })), owner, scope);
    if (value.saveOperationId !== saveOperationId) refuse("SCOPE_MISMATCH", true);
    if (value.status === "canceled") { if ([value.request, value.requestHash, value.runOperationId, value.reportVersion, value.resultHash, value.savedAt].some(item => item !== null)) refuse("SAVE_INVALID"); }
    else if (!value.request || value.requestHash !== profitAnalysisSaveRequestHash(owner, scope, saveOperationId, value.request) || value.runOperationId !== value.request.runOperationId || value.reportVersion !== value.request.expectedReportVersion + 1 || value.resultHash !== value.request.expectedResultHash || value.savedAt === null) refuse("SAVE_INVALID");
    const receipt: ProfitAnalysisSaveReceipt | null = value.status === "committed" ? { saveId: value.saveOperationId, operationId: value.runOperationId!, requestHash: value.requestHash!, resultHash: value.resultHash!, sourceHash: value.request!.expectedSourceHash, reportVersion: value.reportVersion!, savedAt: value.savedAt! } : null;
    return { ...value, receipt };
  }
  async function bound(lease: ProfitAnalysisJobLease) {
    const head = await report(lease.target), value = await run(lease.target, lease.operationId);
    if (!head || !value || head.activeOperationId !== value.operationId || terminal(value.state) || value.leaseToken !== lease.leaseToken || value.leaseOwner !== lease.workerId || value.attempt !== lease.attempt) refuse("LEASE_LOST", true);
    parse(UUID, lease.leaseToken); parse(ID, lease.attempt);
    const alive = await rows(tx, `SELECT id FROM ${RUNS} WHERE workspace_id=? AND user_id=? AND operation_id=? AND lease_token=? AND attempt=? AND lease_expires_at>NOW(3) FOR UPDATE`, [owner.workspaceId, owner.userId, value.operationId, lease.leaseToken, lease.attempt], 1);
    if (alive.length !== 1 || alive[0].id !== value.id) refuse("LEASE_LOST", true); return { head, value };
  }
  async function terminalize(head: ProfitAnalysisReport, value: ProfitAnalysisJobRun, state: "succeeded" | "failed" | "canceled" | "unknown", errorCode: string | null, lease?: ProfitAnalysisJobLease) {
    if (head.activeOperationId !== value.operationId || head.version >= 2147483646) refuse("REPORT_CONFLICT", true);
    await write(tx, `UPDATE ${RUNS} SET state=?,error_code=?,lease_token=NULL,lease_owner=NULL,lease_expires_at=NULL,heartbeat_at=NULL,completed_at=NOW(3),updated_at=NOW(3) WHERE workspace_id=? AND user_id=? AND operation_id=? AND state=?${lease ? " AND lease_token=? AND attempt=? AND lease_expires_at>NOW(3)" : ""}`,
      [state, errorCode, owner.workspaceId, owner.userId, value.operationId, value.state, ...(lease ? [lease.leaseToken, lease.attempt] : [])]);
    await write(tx, `UPDATE ${REPORTS} SET active_operation_id=NULL,version=version+1,updated_at=NOW(3) WHERE workspace_id=? AND user_id=? AND scope_hash=? AND version=? AND active_operation_id=?`, [owner.workspaceId, owner.userId, head.scopeHash, head.version, value.operationId]);
    const after = await report(value.target), result = await run(value.target, value.operationId);
    if (!after || !result || after.version !== head.version + 1 || after.activeOperationId !== null || after.latestOperationId !== head.latestOperationId || after.savedOperationId !== head.savedOperationId || after.savedAt !== head.savedAt || result.state !== state || result.errorCode !== errorCode) refuse("WRITE_UNVERIFIABLE"); return result;
  }
  const api = {
    executor: tx, identity: owner, actor, report, run, saveOperation,
    /** Worker-only metadata discovery hydration. Identity is still locked and private. */
    async runById(id: number, operationId: string) {
      check(); parse(ID, id); parse(UUID, operationId);
      const found = await rows(tx, `SELECT ${jsonProjection("target_snapshot", "target", PROFIT_ANALYSIS_JOB_LIMITS.target)} FROM ${RUNS} WHERE workspace_id=? AND user_id=? AND id=? AND operation_id=? LIMIT 2 FOR UPDATE`, [owner.workspaceId, owner.userId, id, operationId], 2);
      if (found.length > 1) refuse("RUN_INVALID"); if (!found.length) return null;
      const scope = target(parse(targetSchema, decode(found[0], { target: PROFIT_ANALYSIS_JOB_LIMITS.target }).target));
      const value = await run(scope, operationId); if (!value || value.id !== id) refuse("RUN_INVALID"); return value;
    },
    async history(scope: ProfitAnalysisJobTarget, input: { beforeId?: number; limit: number }) {
      check(); target(scope); const limit = parse(z.number().int().min(1).max(PROFIT_ANALYSIS_JOB_LIMITS.history), input.limit); if (input.beforeId !== undefined) parse(ID, input.beforeId);
      const filter = `workspace_id=? AND user_id=? AND scope_hash=?${input.beforeId === undefined ? "" : " AND id<?"}`;
      const params = [owner.workspaceId, owner.userId, scopeHash(scope), ...(input.beforeId === undefined ? [] : [input.beforeId]), limit + 1];
      // Freeze page IDs and preflight their total before loading any result body.
      const directory = await rows(tx, `SELECT id,OCTET_LENGTH(result_snapshot) AS resultBytes FROM ${RUNS} WHERE ${filter} ORDER BY id DESC LIMIT ? FOR SHARE`, params, limit + 1);
      let budget = 0;
      directory.forEach((row, index) => { if (!ID.safeParse(row.id).success || index > 0 && Number(row.id) >= Number(directory[index - 1].id) || input.beforeId !== undefined && Number(row.id) >= input.beforeId || row.resultBytes !== null && (typeof row.resultBytes !== "number" || !Number.isSafeInteger(row.resultBytes) || row.resultBytes < 1 || row.resultBytes > PROFIT_ANALYSIS_JOB_LIMITS.result * 4)) refuse("HISTORY_INVALID"); budget += Number(row.resultBytes ?? 0); if (budget > PROFIT_ANALYSIS_JOB_LIMITS.historyBytes) refuse("READ_LIMIT"); });
      const found = directory.length ? await rows(tx, `SELECT id,operation_id AS operationId,state,result_hash AS resultHash,error_code AS errorCode,${time("created_at", "createdAt")},${time("updated_at", "updatedAt")},${time("completed_at", "completedAt")},${jsonProjection("result_snapshot", "result", PROFIT_ANALYSIS_JOB_LIMITS.result)} FROM ${RUNS} WHERE workspace_id=? AND user_id=? AND scope_hash=? AND id IN (${directory.map(() => "?").join(",")}) ORDER BY id DESC FOR SHARE`, [owner.workspaceId, owner.userId, scopeHash(scope), ...directory.map(row => row.id)], limit + 1) : [];
      if (found.length !== directory.length || found.some((row, index) => row.id !== directory[index].id || row.resultBytes !== directory[index].resultBytes)) refuse("HISTORY_CHANGED", true);
      const summaries = found.map(row => {
        const value = parse(z.object({ id: ID, operationId: UUID, state: z.enum(PROFIT_ANALYSIS_WORKFLOW_STATES), resultHash: HASH.nullable(), errorCode: CODE.nullable(), createdAt: TIME, updatedAt: TIME, completedAt: TIME.nullable(), result: ProfitAnalysisResultSchema.nullable() }).strict(), decode(row, { result: PROFIT_ANALYSIS_JOB_LIMITS.result }));
        if ((value.result === null) !== (value.resultHash === null) || value.result !== null && (value.resultHash !== profitAnalysisJobHash(value.result) || canonical(value.result.identity) !== canonical(owner) || canonical(value.result.scope) !== canonical(scope.scope) || value.result.month !== scope.month)) refuse("HISTORY_INVALID"); return value; });
      return { report: await report(scope), items: summaries.slice(0, limit), nextBeforeId: summaries.length > limit ? summaries[limit - 1].id : null };
    },
    async enqueue(input: ProfitAnalysisJobEnqueueInput) {
      check(true); const requestHash = profitAnalysisJobRequestHash(owner, input.target, input.operationId, input.request); if (requestHash !== parse(HASH, input.requestHash) || input.expectedReportVersion !== input.request.expectedReportVersion) refuse("REQUEST_HASH_MISMATCH", true);
      const previous = await run(input.target, input.operationId);
      if (previous) { if (previous.state === "canceled" || previous.requestHash === null) refuse("OPERATION_CANCELED", true); if (previous.requestHash !== requestHash) refuse("OPERATION_CONTENT_CONFLICT", true); return { report: await report(input.target), run: previous, created: false }; }
      const frozen = snapshot(input.snapshot, owner, input.target, input.request), snapshotHash = profitAnalysisJobHash({ requestHash, snapshot: frozen });
      let head = await report(input.target);
      if ((head?.version ?? 0) !== input.expectedReportVersion || head?.activeOperationId !== null && head !== null || head && head.version >= 2147483645 || head?.latestOperationId && !input.request.regenerateConfirmed) refuse("REPORT_CONFLICT", true);
      if (head?.latestOperationId) { const latest = await run(input.target, head.latestOperationId); if (!latest) refuse("REPORT_INVALID"); if (latest.state === "unknown") refuse("UNKNOWN_REQUIRES_CANCEL", true); }
      if (!head) { await write(tx, `INSERT INTO ${REPORTS} (workspace_id,user_id,scope_hash,target_snapshot,version,created_at,updated_at) VALUES (?,?,?,?,0,NOW(3),NOW(3))`, [owner.workspaceId, owner.userId, scopeHash(input.target), canonical(input.target)]); head = await report(input.target); if (!head || head.version !== 0) refuse("WRITE_UNVERIFIABLE"); }
      await write(tx, `INSERT INTO ${RUNS} (workspace_id,user_id,scope_hash,target_snapshot,operation_id,request_hash,snapshot_hash,request_snapshot,snapshot,state,attempt,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,'queued',0,NOW(3),NOW(3))`, [owner.workspaceId, owner.userId, head.scopeHash, canonical(input.target), input.operationId, requestHash, snapshotHash, canonical(input.request, PROFIT_ANALYSIS_JOB_LIMITS.request), canonical(frozen)]);
      await write(tx, `UPDATE ${REPORTS} SET active_operation_id=?,latest_operation_id=?,version=version+1,updated_at=NOW(3) WHERE workspace_id=? AND user_id=? AND scope_hash=? AND version=? AND active_operation_id IS NULL`, [input.operationId, input.operationId, owner.workspaceId, owner.userId, head.scopeHash, head.version]);
      const updated = await report(input.target), result = await run(input.target, input.operationId);
      if (!updated || !result || updated.version !== head.version + 1 || updated.activeOperationId !== input.operationId || updated.latestOperationId !== input.operationId || updated.savedOperationId !== head.savedOperationId || result.requestHash !== requestHash || result.snapshotHash !== snapshotHash || result.state !== "queued") refuse("WRITE_UNVERIFIABLE");
      return { report: updated, run: result, created: true };
    },
    async claim(input: { target: ProfitAnalysisJobTarget; operationId: string; workerId: string; leaseSeconds: number }) {
      check(true); parse(z.string().min(1).max(128), input.workerId); const seconds = parse(z.number().int().min(30).max(7200), input.leaseSeconds), head = await report(input.target), value = await run(input.target, input.operationId);
      if (!value) refuse("RUN_UNAVAILABLE"); if (terminal(value.state)) return { run: value, lease: null };
      if (!head || head.activeOperationId !== value.operationId) refuse("REPORT_CONFLICT", true);
      const eligible = await rows(tx, `SELECT id FROM ${RUNS} WHERE workspace_id=? AND user_id=? AND operation_id=? AND (lease_expires_at IS NULL OR lease_expires_at<=NOW(3)) FOR UPDATE`, [owner.workspaceId, owner.userId, input.operationId], 1);
      if (!eligible.length) return { run: value, lease: null }; if (eligible[0].id !== value.id) refuse("RUN_INVALID");
      if (profitAnalysisLeaseRecovery(value.state) === "mark_unknown") return { run: await terminalize(head, value, "unknown", "MODEL_RESULT_UNKNOWN"), lease: null };
      if (value.attempt >= 2147483646) refuse("ATTEMPT_EXHAUSTED"); const token = randomUUID();
      await write(tx, `UPDATE ${RUNS} SET lease_token=?,lease_owner=?,attempt=attempt+1,lease_expires_at=DATE_ADD(NOW(3),INTERVAL ? SECOND),heartbeat_at=NOW(3),updated_at=NOW(3) WHERE workspace_id=? AND user_id=? AND operation_id=? AND state=? AND (lease_expires_at IS NULL OR lease_expires_at<=NOW(3))`, [token, input.workerId, seconds, owner.workspaceId, owner.userId, value.operationId, value.state]);
      const result = await run(input.target, value.operationId); if (!result || result.leaseToken !== token || result.leaseOwner !== input.workerId || result.attempt !== value.attempt + 1) refuse("WRITE_UNVERIFIABLE");
      return { run: result, lease: { target: input.target, operationId: value.operationId, leaseToken: token, workerId: input.workerId, attempt: result.attempt } };
    },
    async heartbeat(lease: ProfitAnalysisJobLease, leaseSeconds: number) { check(true); await bound(lease); const seconds = parse(z.number().int().min(30).max(7200), leaseSeconds); await write(tx, `UPDATE ${RUNS} SET lease_expires_at=DATE_ADD(NOW(3),INTERVAL ? SECOND),heartbeat_at=NOW(3) WHERE workspace_id=? AND user_id=? AND operation_id=? AND lease_token=? AND attempt=? AND lease_expires_at>NOW(3)`, [seconds, owner.workspaceId, owner.userId, lease.operationId, lease.leaseToken, lease.attempt]); },
    async dispatch(lease: ProfitAnalysisJobLease, receipt: unknown) {
      check(true); const { value } = await bound(lease); if (value.state !== "queued" || !value.snapshot?.evidence.evidence.length) refuse("CHECKPOINT_CONFLICT", true);
      const admitted = verifiedDispatch(receipt, value.snapshot, owner, value.operationId);
      await write(tx, `UPDATE ${RUNS} SET state='dispatched',dispatch_receipt=?,updated_at=NOW(3) WHERE workspace_id=? AND user_id=? AND operation_id=? AND state='queued' AND lease_token=? AND attempt=? AND lease_expires_at>NOW(3)`, [canonical(admitted, PROFIT_ANALYSIS_JOB_LIMITS.dispatch), owner.workspaceId, owner.userId, value.operationId, lease.leaseToken, lease.attempt]);
      const result = await run(lease.target, lease.operationId); if (!result || result.state !== "dispatched" || canonical(result.dispatchReceipt) !== canonical(admitted)) refuse("WRITE_UNVERIFIABLE"); return result;
    },
    async resultReady(lease: ProfitAnalysisJobLease, raw: ProfitAnalysisResult) {
      check(false, true); const { value } = await bound(lease); if (!value.snapshot || !["queued", "dispatched"].includes(value.state)) refuse("CHECKPOINT_CONFLICT", true);
      // Gate-off cleanup may persist only the already-returned paid result of
      // this live, authorized, durably dispatched lease. No new execution is
      // enabled; queued deterministic work still needs the write gate.
      if (value.state === "queued") check(true);
      else verifiedDispatch(value.dispatchReceipt, value.snapshot, owner, value.operationId);
      const result = parse(ProfitAnalysisResultSchema, json(raw, PROFIT_ANALYSIS_JOB_LIMITS.result));
      try { validateProfitAnalysisResultAgainstEvidence(result, value.snapshot.evidence); } catch { refuse("RESULT_INVALID"); }
      if (result.modelCalled !== (value.state === "dispatched") || value.state === "queued" && value.snapshot.evidence.evidence.length) refuse("CHECKPOINT_CONFLICT", true);
      const resultHash = profitAnalysisJobHash(result, PROFIT_ANALYSIS_JOB_LIMITS.result);
      await write(tx, `UPDATE ${RUNS} SET state='result_ready',result_snapshot=?,result_hash=?,updated_at=NOW(3) WHERE workspace_id=? AND user_id=? AND operation_id=? AND state=? AND lease_token=? AND attempt=? AND lease_expires_at>NOW(3)`, [canonical(result, PROFIT_ANALYSIS_JOB_LIMITS.result), resultHash, owner.workspaceId, owner.userId, value.operationId, value.state, lease.leaseToken, lease.attempt]);
      const saved = await run(lease.target, lease.operationId); if (!saved || saved.state !== "result_ready" || saved.resultHash !== resultHash) refuse("WRITE_UNVERIFIABLE"); return saved;
    },
    async finish(lease: ProfitAnalysisJobLease) { check(true); const { head, value } = await bound(lease); if (value.state !== "result_ready") refuse("CHECKPOINT_CONFLICT", true); return terminalize(head, value, "succeeded", null, lease); },
    async fail(lease: ProfitAnalysisJobLease, errorCode: string) { check(true); parse(CODE, errorCode); const { head, value } = await bound(lease); if (value.state === "result_ready") return value; return terminalize(head, value, value.state === "dispatched" ? "unknown" : "failed", errorCode, lease); },
    async cancel(input: { target: ProfitAnalysisJobTarget; operationId: string }) {
      check(false, true); target(input.target); parse(UUID, input.operationId); const previous = await run(input.target, input.operationId);
      if (previous) {
        if (previous.state === "unknown") { await write(tx, `UPDATE ${RUNS} SET state='canceled',error_code='USER_CANCELED',updated_at=NOW(3) WHERE workspace_id=? AND user_id=? AND operation_id=? AND state='unknown'`, [owner.workspaceId, owner.userId, input.operationId]); const result = await run(input.target, input.operationId); if (result?.state !== "canceled") refuse("WRITE_UNVERIFIABLE"); return result; }
        if (terminal(previous.state)) return previous;
        const head = await report(input.target); if (!head) refuse("REPORT_INVALID"); return terminalize(head, previous, "canceled", "USER_CANCELED");
      }
      await write(tx, `INSERT INTO ${RUNS} (workspace_id,user_id,scope_hash,target_snapshot,operation_id,state,attempt,error_code,created_at,updated_at,completed_at) VALUES (?,?,?,?,?,'canceled',0,'USER_CANCELED',NOW(3),NOW(3),NOW(3))`, [owner.workspaceId, owner.userId, scopeHash(input.target), canonical(input.target), input.operationId]);
      const result = await run(input.target, input.operationId); if (!result || result.state !== "canceled" || result.requestHash !== null) refuse("WRITE_UNVERIFIABLE"); return result;
    },
    async save(input: ProfitAnalysisJobSaveInput) {
      check(true); const requestHash = profitAnalysisSaveRequestHash(owner, input.target, input.saveOperationId, input.request);
      if (input.requestHash !== requestHash || input.runOperationId !== input.request.runOperationId || input.expectedReportVersion !== input.request.expectedReportVersion || input.expectedResultHash !== input.request.expectedResultHash) refuse("REQUEST_HASH_MISMATCH", true);
      const previous = await saveOperation(input.target, input.saveOperationId);
      if (previous) { if (previous.status === "canceled") refuse("SAVE_CANCELED", true); if (previous.requestHash !== requestHash) refuse("OPERATION_CONTENT_CONFLICT", true); return previous; }
      const head = await report(input.target), value = await run(input.target, input.runOperationId);
      if (!head || head.version !== input.expectedReportVersion || head.version >= 2147483646 || head.activeOperationId !== null || head.latestOperationId !== input.runOperationId || !value || value.state !== "succeeded" || value.result === null || value.resultHash !== input.expectedResultHash || value.snapshot?.source.sourceHash !== input.request.expectedSourceHash) refuse("SAVE_CONFLICT", true);
      await write(tx, `UPDATE ${REPORTS} SET saved_operation_id=?,saved_at=NOW(3),version=version+1,updated_at=NOW(3) WHERE workspace_id=? AND user_id=? AND scope_hash=? AND version=? AND active_operation_id IS NULL AND latest_operation_id=?`, [value.operationId, owner.workspaceId, owner.userId, head.scopeHash, head.version, value.operationId]);
      const savedHead = await report(input.target); if (!savedHead?.savedAt) refuse("WRITE_UNVERIFIABLE");
      await write(tx, `INSERT INTO ${SAVES} (workspace_id,user_id,scope_hash,target_snapshot,save_operation_id,run_operation_id,request_hash,request_snapshot,status,report_version,result_hash,saved_at,created_at) VALUES (?,?,?,?,?,?,?,?,'committed',?,?,?,NOW(3))`, [owner.workspaceId, owner.userId, head.scopeHash, canonical(input.target), input.saveOperationId, value.operationId, requestHash, canonical(input.request, PROFIT_ANALYSIS_JOB_LIMITS.request), head.version + 1, value.resultHash, savedHead.savedAt]);
      const updated = await report(input.target), receipt = await saveOperation(input.target, input.saveOperationId);
      if (!updated || updated.version !== head.version + 1 || updated.savedOperationId !== value.operationId || updated.activeOperationId !== null || updated.latestOperationId !== head.latestOperationId || !updated.savedAt || !receipt || receipt.status !== "committed" || receipt.requestHash !== requestHash) refuse("WRITE_UNVERIFIABLE"); return receipt;
    },
    async cancelSave(input: { target: ProfitAnalysisJobTarget; saveOperationId: string }) {
      check(false, true); target(input.target); parse(UUID, input.saveOperationId); const previous = await saveOperation(input.target, input.saveOperationId); if (previous) return previous;
      await write(tx, `INSERT INTO ${SAVES} (workspace_id,user_id,scope_hash,target_snapshot,save_operation_id,status,created_at) VALUES (?,?,?,?,?,'canceled',NOW(3))`, [owner.workspaceId, owner.userId, scopeHash(input.target), canonical(input.target), input.saveOperationId]);
      const saved = await saveOperation(input.target, input.saveOperationId); if (!saved || saved.status !== "canceled") refuse("WRITE_UNVERIFIABLE"); return saved;
    },
  };
  return { api, close: () => { open = false; } };
}
export type ProfitAnalysisJobSession = ReturnType<typeof session>["api"];
export function createProfitAnalysisJobRepository(options: { database?: () => Promise<ProfitAnalysisJobDatabase>; enabled?: () => boolean } = {}) {
  const database = options.database ?? (async () => await requireDb("Private profit analysis") as unknown as ProfitAnalysisJobDatabase), enabled = options.enabled ?? (() => process.env.ENABLE_PROFIT_ANALYSIS_WRITES === "true");
  async function transact<T>(rawOwner: ProfitAnalysisJobIdentity, body: (session: ProfitAnalysisJobSession) => Promise<T>, readOnly: boolean) {
    const owner = parse(identitySchema, rawOwner), db = await database(); if (!db || typeof db.transaction !== "function") refuse("TRANSACTION_REQUIRED");
    try { return await db.transaction(async tx => {
      if (!await profitAnalysisJobSchemaReady(tx)) refuse("SCHEMA_UNAVAILABLE");
      const workspace = await rows(tx, "SELECT id,status FROM workspaces WHERE id=? FOR UPDATE", [owner.workspaceId], 1); if (workspace.length !== 1 || workspace[0].id !== owner.workspaceId || workspace[0].status !== "active") refuse("WORKSPACE_UNAVAILABLE");
      const actors = await rows(tx, "SELECT id,role,status FROM users WHERE id=? FOR UPDATE", [owner.userId], 1); if (actors.length !== 1 || actors[0].id !== owner.userId || actors[0].status !== "active" || typeof actors[0].role !== "string" || !actors[0].role || actors[0].role.length > 64) refuse("ACTOR_UNAVAILABLE");
      const memberships = await rows(tx, "SELECT id,workspaceId,userId,status FROM workspace_memberships WHERE workspaceId=? AND userId=? ORDER BY id LIMIT 2 FOR SHARE", [owner.workspaceId, owner.userId], 2);
      if (memberships.length !== 1 || !ID.safeParse(memberships[0].id).success || memberships[0].workspaceId !== owner.workspaceId || memberships[0].userId !== owner.userId || memberships[0].status !== "active") refuse("MEMBERSHIP_UNAVAILABLE");
      const current = session(tx, owner, { id: owner.userId, role: actors[0].role }, enabled, readOnly); try { return await body(current.api); } finally { current.close(); }
    }); } catch (error) {
      if (error instanceof ProfitAnalysisJobStorageError) throw error;
      if (error instanceof TRPCError && ["BAD_REQUEST", "CONFLICT", "PRECONDITION_FAILED", "FORBIDDEN", "UNAUTHORIZED", "NOT_FOUND"].includes(error.code) && /^PROFIT_ANALYSIS_[A-Z_]{1,100}$/u.test(error.message)) throw error;
      // Only fixed, already-sanitized permission failures from the same-TX
      // service callback may escape; never leak SQL/provider/raw source errors.
      const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
      if (["FORBIDDEN", "UNAUTHORIZED"].includes(code)) refuse("ACCESS_DENIED");
      if (["ER_DUP_ENTRY", "ER_LOCK_DEADLOCK"].includes(code)) refuse("CONCURRENT_CONFLICT", true);
      refuse("STORAGE_OUTCOME_UNKNOWN");
    }
  }
  return { read: <T>(owner: ProfitAnalysisJobIdentity, body: (session: ProfitAnalysisJobSession) => Promise<T>) => transact(owner, body, true), transaction: <T>(owner: ProfitAnalysisJobIdentity, body: (session: ProfitAnalysisJobSession) => Promise<T>) => transact(owner, body, false) };
}
export const profitAnalysisJobRepository = createProfitAnalysisJobRepository();
