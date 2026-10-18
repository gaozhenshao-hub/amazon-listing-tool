import { sql, type SQL } from "drizzle-orm";
import { getTableConfig, type AnyMySqlTable } from "drizzle-orm/mysql-core";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { ROLE_MODULE_ACCESS } from "../../../shared/const";
import { requireDb } from "../../repositories/dbClient";
import { assertResourceAction } from "../../services/securityGovernance";
import { strictRuntimeCanonical } from "../ai_os/services/strictSkillRuntime";
import { ImageTaggingIdentitySchema, ImageTaggingOperationIdSchema, ImageTaggingSavedConfigurationSchema,
  ImageTaggingRuntimeSnapshotSchema, ImageTaggingEvidenceSchema, ImageTaggingDispatchReceiptSchema,
  type ImageTaggingRuntimeSnapshot, type ImageTaggingSavedConfiguration,
  type ImageTaggingEvidence, type ImageTaggingDispatchReceipt } from "./imageTaggingRuntimeContract";
import { ImageTaggingSourceSchema, ImageTaggingSubmitInputSchema, ImageTaggingOperationInputSchema,
  ImageTaggingApplyInputSchema, ImageTaggingApplyOperationInputSchema, ImageTaggingCandidateSchema,
  ImageTaggingPreviewInputSchema, imageTaggingEligibility,
  IMAGE_TAGGING_TAG_FIELDS, imageTaggingHash,
  type ImageTaggingSource, type ImageTaggingSubmitInput, type ImageTaggingOperationInput,
  type ImageTaggingApplyInput, type ImageTaggingApplyOperationInput, type ImageTaggingCandidate, type ImageTaggingPreviewInput } from "../../../shared/imageTagging";
import { aiJobs, aiArtifacts } from "../../../drizzle/schema/ai_os";
import { kbImageSets, kbImages } from "../../../drizzle/schema/image";
import { assertAssistantRuleConfirmationJournalSchema } from "../ai_os/repositories/assistantRuleConfirmationJournal";

export interface ImageTaggingExecutor { execute(query: SQL): Promise<unknown> }
export class ImageTaggingRepositoryError extends Error {
  constructor(readonly code: string, readonly outcomeUnknown = false) { super(`IMAGE_TAGGING_${code}`); this.name = "ImageTaggingRepositoryError"; }
}
function fail(code: string): never { throw new ImageTaggingRepositoryError(code); }
export function imageTaggingStatement(query: string, params: unknown[] = []): SQL {
  const parts = query.split("?"); if (parts.length !== params.length + 1) return fail("SQL_INVALID");
  return sql.join(parts.flatMap((part, index) => index < params.length ? [sql.raw(part), sql`${params[index]}`] : [sql.raw(part)]), sql.raw(""));
}
async function rawRows(tx: ImageTaggingExecutor, query: string, params: unknown[], maximum: number) {
  const result = await tx.execute(imageTaggingStatement(query, params));
  if (!Array.isArray(result) || !Array.isArray(result[0]) || result[0].length > maximum
    || result[0].some(row => !row || typeof row !== "object" || Array.isArray(row))) return fail("READ_INVALID");
  return result[0] as Array<Record<string, unknown>>;
}
const writeTables = [aiJobs, aiArtifacts, kbImages] as AnyMySqlTable[];
const sourceTables = [...writeTables, kbImageSets] as AnyMySqlTable[];
const uniqueKeys: Record<string, string[][]> = { ai_jobs: [["id"], ["runId"]], ai_artifacts: [["id"], ["artifactId"]], kb_images: [["id"]] };
/** Read-only admission of existing physical tables, never DDL or best-effort
 * fallback. UUID fencing, immutable candidates and KB tag CAS need real InnoDB,
 * complete unique keys, bounded JSON, and the full non-generated row schema. */
export async function assertImageTaggingSchema(tx: ImageTaggingExecutor): Promise<void> {
  const names = [...sourceTables.map(table => getTableConfig(table).name), "users", "workspaces", "workspace_memberships", "role_permissions", "security_access_policies"];
  const tables = await rawRows(tx, `SELECT TABLE_NAME AS tableName,ENGINE AS engine FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (${names.map(() => "?").join(",")}) LIMIT 32`, names, 31);
  if (tables.length !== names.length || new Set(tables.map(row => row.tableName)).size !== names.length
    || tables.some(row => !names.includes(String(row.tableName)) || row.engine !== "InnoDB")) return fail("SCHEMA_UNAVAILABLE");
  for (const table of sourceTables) {
    const config = getTableConfig(table), columns = await rawRows(tx,
      "SELECT COLUMN_NAME AS name,COLUMN_TYPE AS columnType,IS_NULLABLE AS nullable,EXTRA AS extra,COLUMN_DEFAULT AS defaultValue,COLLATION_NAME AS collation FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? ORDER BY ORDINAL_POSITION LIMIT 129", [config.name], 128);
    if (new Set(columns.map(row => row.name)).size !== columns.length) return fail("SCHEMA_UNAVAILABLE");
    const normalize = (value: string) => value.replace(/int\(\d+\)/gu, "int").replace(/,\s+/gu, ",").toLowerCase();
    for (const expected of config.columns) {
      const actual = columns.find(column => column.name === expected.name);
      if (!actual || typeof actual.columnType !== "string" || typeof actual.extra !== "string" || normalize(actual.columnType) !== normalize(expected.getSQLType())
        || actual.nullable !== (expected.notNull ? "NO" : "YES") || /(?:virtual|stored)\s+generated/iu.test(actual.extra)
        || actual.defaultValue !== null && typeof actual.defaultValue !== "string" && typeof actual.defaultValue !== "number"
        || actual.collation !== null && !["utf8mb4_unicode_ci", "utf8mb4_general_ci", "utf8mb4_0900_ai_ci", "utf8mb4_bin", "utf8mb4_0900_bin"].includes(String(actual.collation))) return fail("SCHEMA_UNAVAILABLE");
      if (writeTables.includes(table) && expected.name === "id" && actual.extra !== "auto_increment") return fail("SCHEMA_UNAVAILABLE");
      if (writeTables.includes(table) && ["createdAt", "updatedAt"].includes(expected.name) && !/^current_timestamp(?:\(\d*\))?$/iu.test(String(actual.defaultValue))) return fail("SCHEMA_UNAVAILABLE");
      if (expected.name !== "id" && !["createdAt", "updatedAt"].includes(expected.name) && actual.extra !== "") return fail("SCHEMA_UNAVAILABLE");
      if (expected.name === "createdAt" && !/^(?:DEFAULT_GENERATED)?$/iu.test(actual.extra)
        || expected.name === "updatedAt" && !/^(?:DEFAULT_GENERATED\s*)?(?:on update CURRENT_TIMESTAMP(?:\(\d*\))?)?$/iu.test(actual.extra)) return fail("SCHEMA_UNAVAILABLE");
    }
    // A nullable column unknown to this capture code still carries source data;
    // do not silently omit it from the complete-row fingerprint.
    if (columns.some(column => !config.columns.some(expected => expected.name === column.name))) return fail("SCHEMA_UNAVAILABLE");
    if (!writeTables.includes(table)) continue;
    if (columns.some(column => !config.columns.some(expected => expected.name === column.name) && column.nullable !== "YES" && column.defaultValue === null)) return fail("SCHEMA_UNAVAILABLE");
    const indexes = await rawRows(tx,
      "SELECT INDEX_NAME AS name,NON_UNIQUE AS nonUnique,SEQ_IN_INDEX AS sequence,COLUMN_NAME AS columnName,SUB_PART AS subPart FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? ORDER BY INDEX_NAME,SEQ_IN_INDEX LIMIT 257", [config.name], 256);
    const groups = new Map<string, Array<Record<string, unknown>>>();
    for (const row of indexes) {
      if (typeof row.name !== "string" || ![0, 1].includes(Number(row.nonUnique)) || !Number.isSafeInteger(Number(row.sequence)) || Number(row.sequence) < 1
        || row.subPart !== null || typeof row.columnName !== "string") return fail("SCHEMA_UNAVAILABLE");
      groups.set(row.name, [...(groups.get(row.name) ?? []), row]);
    }
    const unique = [...groups.values()].filter(group => Number(group[0].nonUnique) === 0).map(group => {
      if (group.some((row, index) => Number(row.sequence) !== index + 1 || Number(row.nonUnique) !== 0)) return fail("SCHEMA_UNAVAILABLE");
      return group.map(row => row.columnName);
    });
    const expected = uniqueKeys[config.name];
    if (unique.length !== expected.length || expected.some(key => !unique.some(value => JSON.stringify(value) === JSON.stringify(key)))) return fail("SCHEMA_UNAVAILABLE");
  }
  try { await assertAssistantRuleConfirmationJournalSchema(tx); } catch { return fail("AUDIT_SCHEMA_UNAVAILABLE"); }
  const snapshots = await rawRows(tx, "SELECT COLUMN_NAME AS name,DATA_TYPE AS type,EXTRA AS extra FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='security_audit_logs' AND COLUMN_NAME IN ('beforeSnapshot','afterSnapshot')", [], 2);
  if (snapshots.length !== 2 || ["beforeSnapshot", "afterSnapshot"].some(name => snapshots.filter(row => row.name === name && row.type === "json" && row.extra === "").length !== 1)) return fail("AUDIT_SCHEMA_UNAVAILABLE");
  const triggers = await rawRows(tx, "SELECT TRIGGER_NAME AS triggerName FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE() AND EVENT_OBJECT_TABLE IN ('ai_jobs','ai_artifacts','kb_images','security_audit_logs') LIMIT 1", [], 1);
  if (triggers.length) fail("SCHEMA_UNAVAILABLE");
}

export const IMAGE_TAGGING_JOB_KIND = "knowledge.image_tagging.v1";
export const IMAGE_TAGGING_SOURCE_KEY = "knowledge.image_tagging.source.v1";
export const IMAGE_TAGGING_CANDIDATE_KEY = "knowledge.image_tagging.candidate.v1";
const LIMIT = 4 * 1024 * 1024, AUDIT_LIMIT = 65536;
const hash = z.string().regex(/^[a-f0-9]{64}$/u), id = z.number().int().min(1).max(2147483647);
const code = z.string().regex(/^[A-Z][A-Z0-9_]{0,99}$/u);
type Identity = z.infer<typeof ImageTaggingIdentitySchema>;
type Action = "read" | "run" | "confirm" | "cancel";
type Row = Record<string, unknown>;
export type ImageTaggingCapture = (tx: ImageTaggingExecutor, identity: Identity, imageSetId: number) => Promise<ImageTaggingSource>;
export type ImageTaggingPreparation = { configuration: ImageTaggingSavedConfiguration; runtimeSnapshot: ImageTaggingRuntimeSnapshot };
export type ImageTaggingPrepare = (tx: ImageTaggingExecutor, source: ImageTaggingSource) => Promise<ImageTaggingPreparation>;
export interface ImageTaggingDatabase { transaction<T>(body: (tx: ImageTaggingExecutor) => Promise<T>): Promise<T> }
export type ImageTaggingStageState = "pending" | "skipped_confirmed" | "skipped_complete" | "dispatched" | "candidate" | "failed" | "unknown" | "applied" | "excluded";
const dispatchSchema = z.object({ evidence: ImageTaggingEvidenceSchema, strictDispatch: ImageTaggingDispatchReceiptSchema,
  contextHash: hash, snapshotHash: hash, evidenceHash: hash, providerRequestHash: hash, bindingHash: hash }).strict();
type Dispatch = z.infer<typeof dispatchSchema>;
const stageSchema = z.object({ imageId: id, state: z.enum(["pending", "skipped_confirmed", "skipped_complete", "dispatched", "candidate", "failed", "unknown", "applied", "excluded"]),
  dispatch: dispatchSchema.nullable(), candidateArtifactId: z.string().max(80).nullable(), candidateHash: hash.nullable(),
  afterImageRevision: hash.nullable(), applyOperationId: ImageTaggingOperationIdSchema.nullable(), errorCode: code.nullable() }).strict();
export type ImageTaggingStage = z.infer<typeof stageSchema>;
const outputSchema = z.object({ version: z.literal(1), state: z.enum(["queued", "running", "succeeded", "failed", "canceled", "unknown"]),
  stages: z.array(stageSchema).min(1).max(300), resultHash: hash.nullable(), errorCode: code.nullable() }).strict();
const inputSchema = z.object({ version: z.literal(1), identity: ImageTaggingIdentitySchema, imageSetId: id,
  operationId: ImageTaggingOperationIdSchema, request: ImageTaggingSubmitInputSchema, requestHash: hash,
  sourceArtifactId: z.string().min(1).max(80), sourceHash: hash, configuration: ImageTaggingSavedConfigurationSchema,
  runtimeSnapshot: ImageTaggingRuntimeSnapshotSchema, planHash: hash }).strict();
export type ImageTaggingRun = z.infer<typeof inputSchema> & z.infer<typeof outputSchema> & {
  id: number; runId: string; source: ImageTaggingSource; candidates: Array<{ imageId: number; candidateHash: string; candidate: ImageTaggingCandidate }>;
  createdAt: string; updatedAt: string; completedAt: string | null; lockedBy: string | null; leaseUntil: number | null;
};
export type ImageTaggingLease = { identity: Identity; imageSetId: number; operationId: string; runId: string; token: string };
export type ImageTaggingDispatchInput = { imageId: number; evidence: ImageTaggingEvidence; prepared: {
  contextHash: string; snapshotHash: string; evidenceHash: string; providerRequestHash: string; bindingHash: string;
  budget: ImageTaggingDispatchReceipt["budget"] }; receipt: ImageTaggingDispatchReceipt };
export type ImageTaggingCandidateInput = { imageId: number; stage: "image_tagging"; candidate: ImageTaggingCandidate; runId: string;
  contextHash: string; bindingHash: string; snapshotHash: string; evidenceHash: string; providerRequestHash: string; auditWarnings: string[] };
export type ImageTaggingApplyReceipt = { identity: Identity; imageSetId: number; operationId: string; runOperationId: string;
  status: "committed" | "canceled"; requestHash: string | null; resultHash: string | null; beforeSourceHash: string | null;
  afterSourceHash: string | null; acceptedImageIds: number[]; excludedImageIds: number[]; afterImageRevisions: Array<{ imageId: number; revisionHash: string }> };
const applyReceiptSchema = z.object({ identity: ImageTaggingIdentitySchema, imageSetId: id, operationId: ImageTaggingOperationIdSchema,
  runOperationId: ImageTaggingOperationIdSchema, status: z.enum(["committed", "canceled"]), requestHash: hash.nullable(), resultHash: hash.nullable(),
  beforeSourceHash: hash.nullable(), afterSourceHash: hash.nullable(), acceptedImageIds: z.array(id).max(300), excludedImageIds: z.array(id).max(300),
  afterImageRevisions: z.array(z.object({ imageId: id, revisionHash: hash }).strict()).max(300) }).strict().superRefine((value, ctx) => {
  const all = [...value.acceptedImageIds, ...value.excludedImageIds];
  if (new Set(all).size !== all.length || !equal(value.acceptedImageIds, value.afterImageRevisions.map(item => item.imageId))
    || (value.status === "committed" ? !value.requestHash || !value.resultHash || !value.beforeSourceHash || !value.afterSourceHash || !all.length
      : value.requestHash !== null || value.resultHash !== null || value.beforeSourceHash !== null || value.afterSourceHash !== null || all.length !== 0)) ctx.addIssue({ code: "custom", message: "Receipt binding invalid" });
});
const startReceiptSchema = z.object({ identity: ImageTaggingIdentitySchema, imageSetId: id, operationId: ImageTaggingOperationIdSchema,
  status: z.enum(["reserved", "canceled"]), requestHash: hash.nullable(), runId: z.string().max(80).nullable() }).strict().refine(value =>
  (value.requestHash === null) === (value.runId === null) && (value.status !== "reserved" || value.requestHash !== null));
type StartReceipt = z.infer<typeof startReceiptSchema>;
function canonical(value: unknown, maximum = LIMIT): string {
  try { const result = strictRuntimeCanonical(value); if (Buffer.byteLength(result) > maximum) fail("JSON_LIMIT"); return result; }
  catch (error) { if (error instanceof ImageTaggingRepositoryError) throw error; return fail("JSON_INVALID"); }
}
const digest = (value: unknown) => imageTaggingHash(JSON.parse(canonical(value)));
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  try { const result = schema.safeParse(value); if (!result.success) fail("DATA_INVALID"); return result.data; }
  catch (error) { if (error instanceof ImageTaggingRepositoryError) throw error; return fail("DATA_INVALID"); }
}
function decoded(value: unknown, maximum = LIMIT): unknown {
  try { return JSON.parse(typeof value === "string" ? (Buffer.byteLength(value) <= maximum ? value : fail("JSON_LIMIT")) : canonical(value, maximum)); }
  catch (error) { if (error instanceof ImageTaggingRepositoryError) throw error; return fail("JSON_INVALID"); }
}
const equal = (a: unknown, b: unknown) => canonical(a) === canonical(b);
export const imageTaggingRunId = (identity: Identity, operationId: string) => `imgtag_${digest({ identity: parse(ImageTaggingIdentitySchema, identity), operationId: parse(ImageTaggingOperationIdSchema, operationId) })}`;
export const imageTaggingSubmitRequestHash = (identity: Identity, input: ImageTaggingSubmitInput) => digest({ identity, request: parse(ImageTaggingSubmitInputSchema, input) });
export const imageTaggingApplyRequestHash = (identity: Identity, input: ImageTaggingApplyInput) => digest({ identity, request: parse(ImageTaggingApplyInputSchema, input) });
const auditId = (identity: Identity, operationId: string, kind: "start" | "cancel" | "apply") => `imgtag_${kind}_${digest({ identity, operationId })}`;
function scope(identity: Identity, input: { expectedWorkspaceId: number; imageSetId: number }) {
  parse(ImageTaggingIdentitySchema, identity); parse(id, input.imageSetId);
  if (input.expectedWorkspaceId !== identity.workspaceId) fail("WORKSPACE_CHANGED");
}
const terminal = (state: ImageTaggingRun["state"]) => ["succeeded", "failed", "canceled", "unknown"].includes(state);
function imageStage(image: ImageTaggingSource["images"][number], mode: "missing" | "all_unconfirmed"): ImageTaggingStage {
  return { imageId: image.id, state: imageTaggingEligibility(image, mode), dispatch: null, candidateArtifactId: null, candidateHash: null, afterImageRevision: null, applyOperationId: null, errorCode: null };
}
/** Null differs from a deliberately saved empty value. This function never
 * changes or charges an initially human-confirmed image. */
export function planImageTaggingStages(source: ImageTaggingSource, mode: "missing" | "all_unconfirmed") {
  return source.images.map(image => imageStage(image, mode));
}
function resultHash(stages: ImageTaggingStage[]) {
  return digest(stages.map(stage => ({ imageId: stage.imageId, candidateHash: stage.candidateHash,
    state: ["applied", "excluded"].includes(stage.state) ? "candidate" : stage.state, errorCode: stage.errorCode })));
}
async function executeWrite(tx: ImageTaggingExecutor, text: string, params: unknown[]) {
  const packet = await rawRows(tx, "SELECT @@max_allowed_packet AS maximumPacket", [], 1);
  const bytes = Buffer.byteLength(text) + 4096 + params.reduce<number>((total, item) => total + (typeof item === "string" ? Buffer.byteLength(item) : 64), 0);
  if (packet.length !== 1 || !Number.isSafeInteger(Number(packet[0].maximumPacket)) || Number(packet[0].maximumPacket) < bytes) fail("PACKET_LIMIT");
  const result = await tx.execute(imageTaggingStatement(text, params));
  if (!Array.isArray(result) || !result[0] || typeof result[0] !== "object" || result[0].affectedRows !== 1 || result[0].warningStatus !== 0) fail("WRITE_UNCONFIRMED");
}

const permissionOperation = z.enum(["read", "edit", "delete"]), permissionName = z.string().min(1).max(100);
const directorySchema = z.array(z.object({ moduleId: permissionName, operations: z.array(permissionOperation).max(3),
  subModules: z.array(z.object({ subModuleId: permissionName, operations: z.array(permissionOperation).max(3) }).strict()).max(100).optional() }).strict()).max(100);
async function authorize(tx: ImageTaggingExecutor, identity: Identity, imageSetId: number, action: Action, permission: typeof assertResourceAction) {
  const workspace = await rawRows(tx, "SELECT id,status FROM workspaces WHERE id=? FOR SHARE", [identity.workspaceId], 1);
  if (workspace.length !== 1 || workspace[0].id !== identity.workspaceId || workspace[0].status !== "active") fail("ACCESS_DENIED");
  const actors = await rawRows(tx, "SELECT id,role,status,defaultWorkspaceId FROM users WHERE id=? FOR SHARE", [identity.userId], 1), actor = actors[0];
  if (!actor || actor.id !== identity.userId || actor.defaultWorkspaceId !== identity.workspaceId || actor.status !== "active" || typeof actor.role !== "string" || !actor.role || actor.role.length > 64) fail("ACCESS_DENIED");
  const members = await rawRows(tx, "SELECT id,workspaceId,userId,role,status FROM workspace_memberships WHERE workspaceId=? AND userId=? ORDER BY id LIMIT 2 FOR SHARE", [identity.workspaceId, identity.userId], 2);
  if (members.length !== 1 || !id.safeParse(members[0].id).success || members[0].workspaceId !== identity.workspaceId || members[0].userId !== identity.userId || members[0].status !== "active") fail("ACCESS_DENIED");
  if (actor.role !== "super_admin") {
    const records = await rawRows(tx, "SELECT id,workspaceId,role,IF(OCTET_LENGTH(modules)<=65536,modules,NULL) AS modules,IF(detailedPermissions IS NULL OR OCTET_LENGTH(detailedPermissions)<=65536,detailedPermissions,NULL) AS detailedPermissions FROM role_permissions WHERE role=? AND (workspaceId=? OR workspaceId IS NULL) ORDER BY workspaceId IS NULL,id LIMIT 3 FOR SHARE", [actor.role, identity.workspaceId], 2);
    if (records.some(row => !id.safeParse(row.id).success || row.role !== actor.role || row.workspaceId !== null && row.workspaceId !== identity.workspaceId) || new Set(records.map(row => row.workspaceId)).size !== records.length) fail("ACCESS_DENIED");
    const selected = records.find(row => row.workspaceId === identity.workspaceId) ?? records.find(row => row.workspaceId === null);
    const modules = selected ? parse(z.array(permissionName).max(100), decoded(selected.modules, 65536)) : ROLE_MODULE_ACCESS[actor.role] ?? [];
    if (!modules.includes("knowledge") || ["run", "confirm"].includes(action) && !modules.includes("emperor")) fail("ACCESS_DENIED");
    if (selected?.detailedPermissions !== null && selected?.detailedPermissions !== undefined) {
      const details = parse(directorySchema, decoded(selected.detailedPermissions, 65536));
      if (new Set(details.map(row => row.moduleId)).size !== details.length || details.some(row => row.subModules && new Set(row.subModules.map(item => item.subModuleId)).size !== row.subModules.length)) fail("ACCESS_DENIED");
      for (const [moduleId, sub] of [["knowledge", null], ...(["run", "confirm"].includes(action) ? [["emperor", "emperor_agents"]] : [])] as Array<[string, string | null]>) {
        const module = details.find(row => row.moduleId === moduleId), operations = sub && module?.subModules?.length ? module.subModules.find(row => row.subModuleId === sub)?.operations : module?.operations;
        if (!operations?.includes("read") || action !== "read" && !operations.includes("edit")) fail("ACCESS_DENIED");
      }
    }
  }
  const common = { actor: { id: identity.userId, role: actor.role, defaultWorkspaceId: identity.workspaceId }, workspaceId: identity.workspaceId,
    authorizationRead: { executor: tx, strict: true as const, lock: true as const, lockMode: "share" as const } };
  try {
    await permission({ ...common, resource: "knowledge", resourceId: imageSetId, action: "read", ownerUserId: identity.userId });
    if (["run", "confirm"].includes(action)) await permission({ ...common, resource: "agent", resourceId: "tagger", action: "read" });
    if (action !== "read") {
      await permission({ ...common, resource: "knowledge", resourceId: imageSetId, action: "update", ownerUserId: identity.userId });
      await permission({ ...common, resource: "knowledge", resourceId: imageSetId, action, ownerUserId: identity.userId });
      if (["run", "confirm"].includes(action)) await permission({ ...common, resource: "agent", resourceId: "tagger", action });
    }
  } catch { return fail("ACCESS_DENIED"); }
  return { role: actor.role };
}
async function lockOwnedSet(tx: ImageTaggingExecutor, identity: Identity, imageSetId: number) {
  const found = await rawRows(tx, "SELECT id,userId,workspaceId,visibility,status FROM kb_image_sets WHERE id=? FOR UPDATE", [imageSetId], 1);
  if (found.length !== 1 || found[0].id !== imageSetId || found[0].workspaceId !== identity.workspaceId || found[0].userId !== identity.userId
    || !["private", "team", "public"].includes(String(found[0].visibility)) || !["pending_review", "confirmed"].includes(String(found[0].status))) fail("ACCESS_DENIED");
}

async function readAudit<T>(tx: ImageTaggingExecutor, identity: Identity, operationId: string, kind: "start" | "cancel" | "apply", schema: z.ZodType<T>): Promise<T | null> {
  const key = auditId(identity, operationId, kind), action = `knowledge.image_tagging.${kind}`;
  const rows = await rawRows(tx, "SELECT auditId,workspaceId,actorUserId,action,resourceType,resourceId,status,riskLevel,IF(OCTET_LENGTH(metadata)<=65536,metadata,NULL) AS metadata FROM security_audit_logs WHERE auditId=? AND BINARY auditId=BINARY ? LIMIT 2 FOR UPDATE", [key, key], 1);
  if (!rows.length) return null;
  const row = rows[0];
  if (row.auditId !== key || row.workspaceId !== identity.workspaceId || row.actorUserId !== identity.userId || row.action !== action
    || row.resourceType !== "image_tagging" || row.resourceId !== operationId || row.status !== "success" || row.riskLevel !== "medium") fail("JOURNAL_SCOPE_MISMATCH");
  const value = parse(z.object({ version: z.literal(1), receipt: schema }).strict(), decoded(row.metadata, AUDIT_LIMIT));
  return value.receipt;
}
async function insertAudit<T>(tx: ImageTaggingExecutor, identity: Identity, role: string, operationId: string, kind: "start" | "cancel" | "apply", receipt: T, schema: z.ZodType<T>) {
  const validated = parse(schema, receipt), old = await readAudit(tx, identity, operationId, kind, schema);
  if (old !== null) { if (!equal(old, validated)) fail("OPERATION_CONTENT_CONFLICT"); return old; }
  const key = auditId(identity, operationId, kind);
  await executeWrite(tx, "INSERT INTO security_audit_logs (auditId,workspaceId,actorUserId,actorRole,action,resourceType,resourceId,status,riskLevel,beforeSnapshot,afterSnapshot,metadata) VALUES (?,?,?,?,?,'image_tagging',?,'success','medium',NULL,NULL,?)",
    [key, identity.workspaceId, identity.userId, role, `knowledge.image_tagging.${kind}`, operationId, canonical({ version: 1, receipt: validated }, AUDIT_LIMIT)]);
  const readback = await readAudit(tx, identity, operationId, kind, schema);
  if (!equal(readback, validated)) fail("AUDIT_READBACK_MISMATCH");
  return validated;
}
function boundReceipt<T extends { identity: Identity; imageSetId: number; operationId: string }>(receipt: T | null, identity: Identity, imageSetId: number, operationId: string): T | null {
  if (receipt && (!equal(receipt.identity, identity) || receipt.imageSetId !== imageSetId || receipt.operationId !== operationId)) fail("OPERATION_SCOPE_MISMATCH");
  return receipt;
}
async function putArtifact(tx: ImageTaggingExecutor, identity: Identity, body: { artifactId: string; artifactKey: string; runId: string; imageSetId: number; imageId?: number; content: unknown }) {
  await executeWrite(tx, "INSERT INTO ai_artifacts (workspaceId,artifactId,domain,artifactKey,artifactType,sourceType,sourceId,sourceTable,sourceRowId,runId,agentSlug,projectId,userId,status,version,isCurrent,contentJson,contentHash,metadata,sourceAiJobRunId) VALUES (?,?,'image',?,'json','system',?,?,?,?,'tagger',NULL,?,'draft',1,0,?,?,?,?)",
    [identity.workspaceId, body.artifactId, body.artifactKey, String(body.imageSetId), body.imageId === undefined ? "kb_image_sets" : "kb_images", String(body.imageId ?? body.imageSetId), body.runId, identity.userId,
      canonical(body.content), digest(body.content), canonical({ version: 1, kind: IMAGE_TAGGING_JOB_KIND, imageSetId: body.imageSetId }), body.runId]);
  const actual = await readArtifact(tx, identity, body.artifactId, body.artifactKey, body.runId, body.imageSetId, body.imageId);
  if (!equal(actual, body.content)) fail("ARTIFACT_READBACK_MISMATCH");
}
async function readArtifact(tx: ImageTaggingExecutor, identity: Identity, artifactId: string, artifactKey: string, runId: string, imageSetId: number, imageId?: number) {
  const rows = await rawRows(tx, `SELECT workspaceId,artifactId,domain,artifactKey,artifactType,sourceType,sourceId,sourceTable,sourceRowId,runId,agentSlug,projectId,userId,status,version,isCurrent,IF(OCTET_LENGTH(contentJson)<=${LIMIT},contentJson,NULL) AS contentJson,contentHash,metadata,sourceAiJobRunId FROM ai_artifacts WHERE artifactId=? AND BINARY artifactId=BINARY ? LIMIT 2 FOR SHARE`, [artifactId, artifactId], 1);
  if (rows.length !== 1) fail("ARTIFACT_MISSING");
  const row = rows[0], content = decoded(row.contentJson), metadata = decoded(row.metadata, 4096);
  if (row.workspaceId !== identity.workspaceId || row.userId !== identity.userId || row.artifactId !== artifactId || row.domain !== "image" || row.artifactKey !== artifactKey
    || row.artifactType !== "json" || row.sourceType !== "system" || row.sourceId !== String(imageSetId) || row.sourceTable !== (imageId === undefined ? "kb_image_sets" : "kb_images")
    || row.sourceRowId !== String(imageId ?? imageSetId) || row.runId !== runId || row.agentSlug !== "tagger" || row.projectId !== null || row.status !== "draft"
    || row.version !== 1 || row.isCurrent !== 0 || row.contentHash !== digest(content) || row.sourceAiJobRunId !== runId
    || !equal(metadata, { version: 1, kind: IMAGE_TAGGING_JOB_KIND, imageSetId })) fail("ARTIFACT_INVALID");
  return content;
}
const jobProjection = `id,workspaceId,userId,projectId,runId,kind,module,\`procedure\`,status,queueName,attempt,maxAttempts,lockedBy,UNIX_TIMESTAMP(leaseUntil) AS leaseUntil,DATE_FORMAT(createdAt,'%Y-%m-%dT%H:%i:%s.%fZ') AS createdAt,DATE_FORMAT(updatedAt,'%Y-%m-%dT%H:%i:%s.%fZ') AS updatedAt,DATE_FORMAT(completedAt,'%Y-%m-%dT%H:%i:%s.%fZ') AS completedAt,IF(OCTET_LENGTH(input)<=${LIMIT},input,NULL) AS input,IF(OCTET_LENGTH(output)<=${LIMIT},output,NULL) AS output`;
async function loadRun(tx: ImageTaggingExecutor, identity: Identity, imageSetId: number, operationId: string): Promise<ImageTaggingRun | null> {
  const runId = imageTaggingRunId(identity, operationId), rows = await rawRows(tx, `SELECT ${jobProjection} FROM ai_jobs WHERE runId=? AND BINARY runId=BINARY ? LIMIT 2 FOR UPDATE`, [runId, runId], 1);
  if (!rows.length) return null;
  const row = rows[0], input = parse(inputSchema, decoded(row.input)), output = parse(outputSchema, decoded(row.output));
  if (!id.safeParse(row.id).success || row.workspaceId !== identity.workspaceId || row.userId !== identity.userId || row.projectId !== null || row.runId !== runId
    || row.kind !== IMAGE_TAGGING_JOB_KIND || row.module !== "knowledge" || row.procedure !== "kbImages.taggingStart" || row.queueName !== "image_tagging"
    || row.maxAttempts !== 1 || ![0, 1].includes(Number(row.attempt)) || !equal(input.identity, identity) || input.imageSetId !== imageSetId || input.operationId !== operationId
    || row.status !== (output.state === "unknown" ? "failed" : output.state)
    || typeof row.createdAt !== "string" || typeof row.updatedAt !== "string" || row.completedAt !== null && typeof row.completedAt !== "string"
    || terminal(output.state) !== (row.completedAt !== null) || row.lockedBy !== null && (typeof row.lockedBy !== "string" || row.lockedBy.length > 128)
    || row.leaseUntil !== null && (!Number.isFinite(Number(row.leaseUntil)) || Number(row.leaseUntil) <= 0)
    || (row.lockedBy === null) !== (row.leaseUntil === null) || terminal(output.state) && row.lockedBy !== null) fail("RUN_INVALID");
  scope(identity, input.request);
  if (input.requestHash !== imageTaggingSubmitRequestHash(identity, input.request) || input.request.operationId !== operationId
    || input.request.imageSetId !== imageSetId || input.sourceHash !== input.request.expectedSourceHash
    || input.runtimeSnapshot.snapshotHash !== input.request.expectedRuntimeHash || input.runtimeSnapshot.operationId !== operationId
    || !equal(input.runtimeSnapshot.identity, identity) || input.runtimeSnapshot.sourceHash !== input.sourceHash
    || input.runtimeSnapshot.configuration.hash !== input.configuration.hash || input.runtimeSnapshot.configuration.revision !== input.configuration.revision
    || input.planHash !== digest({ sourceHash: input.sourceHash, configuration: input.configuration, runtimeSnapshot: input.runtimeSnapshot })) fail("IMMUTABLE_CHANGED");
  const source = parse(ImageTaggingSourceSchema, await readArtifact(tx, identity, input.sourceArtifactId, IMAGE_TAGGING_SOURCE_KEY, runId, imageSetId));
  if (source.sourceHash !== input.sourceHash || !equal(source.identity, identity) || source.imageSetId !== imageSetId || output.stages.length !== source.images.length
    || !equal(output.stages.map(stage => stage.imageId), source.images.map(image => image.id))) fail("SOURCE_BINDING_INVALID");
  const planned = planImageTaggingStages(source, input.request.mode), eligible = planned.filter(stage => stage.state === "pending");
  if (input.runtimeSnapshot.imageCount !== eligible.length || input.request.maxCostCents < input.runtimeSnapshot.budgetPlan.maxCostCentsTotal) fail("PLAN_INVALID");
  const candidates: ImageTaggingRun["candidates"] = [];
  for (let index = 0; index < output.stages.length; index++) {
    const stage = output.stages[index], initial = planned[index];
    if (initial.state !== "pending" ? !equal(stage, initial) : ["skipped_confirmed", "skipped_complete"].includes(stage.state)) fail("STAGE_INVALID");
    if ((stage.candidateHash === null) !== (stage.candidateArtifactId === null) || ["candidate", "applied", "excluded"].includes(stage.state) !== (stage.candidateHash !== null)
      || (stage.state === "applied") !== (stage.afterImageRevision !== null) || ["applied", "excluded"].includes(stage.state) !== (stage.applyOperationId !== null)
      || stage.dispatch === null && ["dispatched", "candidate", "applied", "excluded", "unknown"].includes(stage.state)) fail("STAGE_INVALID");
    if (stage.dispatch) verifyDispatch(input.runtimeSnapshot, source.images[index], stage.dispatch);
    if (stage.candidateArtifactId !== null) {
      const content = parse(z.object({ version: z.literal(1), imageId: id, candidate: ImageTaggingCandidateSchema, candidateHash: hash, dispatchHash: hash }).strict(),
        await readArtifact(tx, identity, stage.candidateArtifactId, IMAGE_TAGGING_CANDIDATE_KEY, runId, imageSetId, stage.imageId));
      if (content.imageId !== stage.imageId || content.candidateHash !== stage.candidateHash || content.candidateHash !== digest(content.candidate) || content.dispatchHash !== digest(stage.dispatch)) fail("CANDIDATE_INVALID");
      candidates.push({ imageId: stage.imageId, candidate: content.candidate, candidateHash: content.candidateHash });
    }
    if (stage.applyOperationId !== null) {
      const applied = boundReceipt(await readAudit(tx, identity, stage.applyOperationId, "apply", applyReceiptSchema), identity, imageSetId, stage.applyOperationId);
      if (!applied || applied.status !== "committed" || applied.runOperationId !== operationId || applied.resultHash !== output.resultHash
        || (stage.state === "applied" ? !applied.acceptedImageIds.includes(stage.imageId)
          || applied.afterImageRevisions.find(item => item.imageId === stage.imageId)?.revisionHash !== stage.afterImageRevision
          : !applied.excludedImageIds.includes(stage.imageId))) fail("APPLY_BINDING_INVALID");
    }
  }
  if (output.resultHash !== null && output.resultHash !== resultHash(output.stages) || output.state === "succeeded" && output.stages.some(stage => ["pending", "dispatched", "unknown", "failed"].includes(stage.state))) fail("RESULT_HASH_INVALID");
  return { ...input, ...output, id: row.id as number, runId, source, candidates, createdAt: row.createdAt as string,
    updatedAt: row.updatedAt as string, completedAt: row.completedAt as string | null, lockedBy: row.lockedBy as string | null, leaseUntil: row.leaseUntil === null ? null : Number(row.leaseUntil) };
}
function verifyDispatch(runtime: ImageTaggingRuntimeSnapshot, image: ImageTaggingSource["images"][number], dispatch: Dispatch) {
  const evidence = dispatch.evidence, receipt = dispatch.strictDispatch;
  const bindingHash = digest({ schema: "image-tagging-stage/v1", stage: "image_tagging", snapshotHash: dispatch.snapshotHash,
    evidenceHash: dispatch.evidenceHash, contextHash: dispatch.contextHash, providerRequestHash: dispatch.providerRequestHash });
  if (evidence.imageId !== image.id || evidence.imageSetId !== image.imageSetId || evidence.imageRevision !== image.revisionHash || evidence.sourceUrlRef !== image.imageUrl
    || image.originalContentHash !== null && evidence.contentHash !== image.originalContentHash
    || dispatch.evidenceHash !== digest(evidence) || dispatch.snapshotHash !== runtime.snapshotHash || bindingHash !== dispatch.bindingHash || receipt.bindingHash !== bindingHash
    || receipt.stage !== "image_tagging" || receipt.requestHash !== dispatch.providerRequestHash || receipt.modelConfigurationHash !== runtime.model.configurationHash
    || receipt.budget.imageBytes !== evidence.byteSize || receipt.budget.contextAdmissionUnits > runtime.budgetPlan.maxContextAdmissionUnits
    || receipt.budget.outputTokens !== runtime.budgetPlan.outputTokens || receipt.budget.contextLimit !== runtime.model.model.maxContextTokens) fail("DISPATCH_BINDING_INVALID");
}
function outputOf(run: ImageTaggingRun) {
  return parse(outputSchema, { version: 1, state: run.state, stages: run.stages, resultHash: run.resultHash, errorCode: run.errorCode });
}
/** Current rows are admissible only when each is the original immutable row or
 * the exact after-row ACKed by this same job. Excluded rows still stay original.
 * This is display/CAS comparison, never an authorization or capture substitute. */
export function imageTaggingSourceMatchesRun(run: ImageTaggingRun, current: ImageTaggingSource): boolean {
  try {
    if (!equal(run.source.identity, current.identity) || run.source.imageSetId !== current.imageSetId || run.source.set.revisionHash !== current.set.revisionHash
      || !equal(run.source.images.map(image => image.id), current.images.map(image => image.id)) || run.stages.length !== current.images.length) return false;
    for (let index = 0; index < current.images.length; index++) {
      const image = current.images[index], original = run.source.images[index], stage = run.stages[index];
      if (stage.imageId !== image.id || image.revisionHash !== (stage.afterImageRevision ?? original.revisionHash)) return false;
      if (stage.state === "applied" && (!image.tagsConfirmed || image.analysisConfirmed !== original.analysisConfirmed)) return false;
    }
    return true;
  } catch { return false; }
}
async function updateRun(tx: ImageTaggingExecutor, run: ImageTaggingRun, options: { release?: boolean; token?: string | null; leaseSeconds?: number; claim?: boolean } = {}) {
  const output = outputOf(run), released = options.release || terminal(run.state);
  await executeWrite(tx, `UPDATE ai_jobs SET status=?,output=?,progress=?,errorMessage=?,lockedBy=?,leaseUntil=${released ? "NULL" : "DATE_ADD(NOW(6),INTERVAL ? SECOND)"},${options.claim ? "attempt=1,startedAt=COALESCE(startedAt,NOW(6)),claimedAt=NOW(6)," : ""}lastHeartbeatAt=NOW(6),completedAt=${terminal(run.state) ? "NOW(6)" : "NULL"},updatedAt=NOW(6) WHERE id=? AND runId=? AND userId=? AND workspaceId=? AND kind=?`,
    [run.state === "unknown" ? "failed" : run.state, canonical(output), Math.floor(100 * run.stages.filter(stage => stage.state !== "pending" && stage.state !== "dispatched").length / run.stages.length), run.errorCode,
      released ? null : options.token ?? run.lockedBy, ...(released ? [] : [options.leaseSeconds ?? 120]), run.id, run.runId, run.identity.userId, run.identity.workspaceId, IMAGE_TAGGING_JOB_KIND]);
  const readback = await loadRun(tx, run.identity, run.imageSetId, run.operationId);
  if (!readback || !equal(outputOf(readback), output) || (released ? readback.lockedBy !== null : readback.lockedBy !== (options.token ?? run.lockedBy))) fail("JOB_READBACK_MISMATCH");
  return readback;
}

/** A dedicated private protocol over existing transactional tables. Capture is
 * server DI, never a client DTO. No method performs a network/model request.
 * Unknown dispatches retain the active-set fence until explicit cancellation. */
export function createImageTaggingRepository(dependencies: { capture: ImageTaggingCapture;
  getDb?: () => Promise<ImageTaggingDatabase | null>; permission?: typeof assertResourceAction;
  writesEnabled?: () => boolean; token?: () => string } ) {
  const db = dependencies.getDb ?? (() => requireDb("Image tagging")), permission = dependencies.permission ?? assertResourceAction,
    writesEnabled = dependencies.writesEnabled ?? (() => process.env.ENABLE_IMAGE_TAGGING_WRITES === "true"),
    token = dependencies.token ?? randomUUID;
  const enabled = () => { if (!writesEnabled()) fail("WRITES_DISABLED"); };
  async function databaseNow(tx: ImageTaggingExecutor) {
    const rows = await rawRows(tx, "SELECT UNIX_TIMESTAMP(NOW(6)) AS currentTime", [], 1), current = Number(rows[0]?.currentTime);
    if (rows.length !== 1 || !Number.isFinite(current) || current <= 0) fail("CLOCK_UNAVAILABLE");
    return current;
  }
  async function invoke<T>(identity: Identity, imageSetId: number, action: Action, write: boolean,
    body: (tx: ImageTaggingExecutor, actor: { role: string }) => Promise<T>): Promise<T> {
    parse(ImageTaggingIdentitySchema, identity); parse(id, imageSetId);
    const database = await db(); if (!database || typeof database.transaction !== "function") fail("TRANSACTION_REQUIRED");
    try {
      return await database.transaction(async tx => {
        await assertImageTaggingSchema(tx);
        const actor = await authorize(tx, identity, imageSetId, action, permission);
        return body(tx, actor);
      });
    } catch (error) {
      if (error instanceof ImageTaggingRepositoryError) throw error;
      if (error instanceof TRPCError && ["UNAUTHORIZED", "FORBIDDEN"].includes(error.code)) return fail("ACCESS_DENIED");
      if (error instanceof Error && error.name === "ImageTaggingRuntimeError" && "code" in error && code.safeParse(error.code).success) throw new ImageTaggingRepositoryError(String(error.code));
      if (error instanceof Error && /^IMAGE_TAGGING_[A-Z][A-Z0-9_]{0,99}$/u.test(error.message)) throw new ImageTaggingRepositoryError(error.message.slice("IMAGE_TAGGING_".length));
      // Neither SQL messages, URLs, model configuration nor private labels leak.
      // An ACK exception is never translated into permission to start again.
      throw new ImageTaggingRepositoryError(write ? "OUTCOME_UNVERIFIED" : "READ_UNAVAILABLE", write);
    }
  }
  async function capture(tx: ImageTaggingExecutor, identity: Identity, imageSetId: number) {
    const source = parse(ImageTaggingSourceSchema, await dependencies.capture(tx, identity, imageSetId));
    if (!equal(source.identity, identity) || source.imageSetId !== imageSetId || !["private", "team", "public"].includes(source.set.visibility)) fail("SOURCE_SCOPE_INVALID");
    return source;
  }
  async function start(tx: ImageTaggingExecutor, identity: Identity, input: ImageTaggingOperationInput) {
    const old = boundReceipt(await readAudit(tx, identity, input.operationId, "start", startReceiptSchema), identity, input.imageSetId, input.operationId);
    const canceled = boundReceipt(await readAudit(tx, identity, input.operationId, "cancel", startReceiptSchema), identity, input.imageSetId, input.operationId);
    const run = await loadRun(tx, identity, input.imageSetId, input.operationId);
    if (run && (!old || old.status !== "reserved" || old.runId !== run.runId || old.requestHash !== run.requestHash)) fail("START_RECEIPT_INVALID");
    if (old?.status === "reserved" && !run) fail("RUN_MISSING");
    if (canceled && canceled.status !== "canceled" || canceled && run && run.state !== "canceled") fail("CANCEL_RECEIPT_INVALID");
    return { run, receipt: canceled ?? old };
  }
  async function fresh(tx: ImageTaggingExecutor, identity: Identity, input: ImageTaggingOperationInput) {
    const source = await capture(tx, identity, input.imageSetId), state = await start(tx, identity, input);
    return { source, ...state };
  }
  async function preparation(tx: ImageTaggingExecutor, source: ImageTaggingSource, operationId: string, mode: "missing" | "all_unconfirmed", prepare: ImageTaggingPrepare) {
    const stages = planImageTaggingStages(source, mode), eligible = stages.filter(stage => stage.state === "pending").length;
    if (!eligible) fail("NO_ELIGIBLE_IMAGES");
    const prepared = await prepare(tx, source), configuration = parse(ImageTaggingSavedConfigurationSchema, prepared.configuration), runtimeSnapshot = parse(ImageTaggingRuntimeSnapshotSchema, prepared.runtimeSnapshot);
    if (configuration.workspaceId !== source.identity.workspaceId || !configuration.config.enabled || !equal(runtimeSnapshot.identity, source.identity)
      || runtimeSnapshot.operationId !== operationId || runtimeSnapshot.imageCount !== eligible || runtimeSnapshot.sourceHash !== source.sourceHash
      || runtimeSnapshot.configuration.hash !== configuration.hash || runtimeSnapshot.configuration.revision !== configuration.revision) fail("RUNTIME_BINDING_INVALID");
    return { configuration, runtimeSnapshot, stages };
  }
  async function fence(tx: ImageTaggingExecutor, identity: Identity, imageSetId: number, operationId: string) {
    // Capture already holds the exact KB parent before any own-job locks.
    const active = await rawRows(tx, `SELECT ${jobProjection} FROM ai_jobs WHERE kind=? AND workspaceId=? AND userId=? AND JSON_EXTRACT(input,'$.imageSetId')=? AND (status IN ('queued','running') OR JSON_UNQUOTE(JSON_EXTRACT(output,'$.state'))='unknown') ORDER BY id LIMIT 1001 FOR UPDATE`, [IMAGE_TAGGING_JOB_KIND, identity.workspaceId, identity.userId, imageSetId], 1000);
    for (const row of active) {
      const input = parse(inputSchema, decoded(row.input));
      if (!equal(input.identity, identity) || input.imageSetId !== imageSetId || row.runId !== imageTaggingRunId(identity, input.operationId)) fail("ACTIVE_FENCE_INVALID");
      if (input.imageSetId === imageSetId && input.operationId !== operationId) fail("ACTIVE_OPERATION_EXISTS");
    }
  }
  async function leased(tx: ImageTaggingExecutor, lease: ImageTaggingLease, withCapture: boolean) {
    const identity = parse(ImageTaggingIdentitySchema, lease.identity), input = { expectedWorkspaceId: identity.workspaceId, imageSetId: lease.imageSetId, operationId: lease.operationId };
    const source = withCapture ? await capture(tx, identity, lease.imageSetId) : (await lockOwnedSet(tx, identity, lease.imageSetId), null);
    const run = await loadRun(tx, identity, lease.imageSetId, lease.operationId);
    if (!run || run.runId !== lease.runId || run.lockedBy !== lease.token || run.leaseUntil === null || run.leaseUntil <= await databaseNow(tx) || run.state !== "running") fail("LEASE_LOST");
    const canceled = await readAudit(tx, identity, input.operationId, "cancel", startReceiptSchema);
    if (canceled) fail("OPERATION_CANCELED");
    if (source && source.sourceHash !== run.sourceHash) fail("SOURCE_CHANGED");
    return { run, source };
  }
  async function preview(identity: Identity, raw: ImageTaggingPreviewInput, prepare: ImageTaggingPrepare) {
    const input = parse(ImageTaggingPreviewInputSchema, raw); scope(identity, input);
    return invoke(identity, input.imageSetId, "run", false, async tx => {
      const source = await capture(tx, identity, input.imageSetId), prepared = await preparation(tx, source, input.operationId, input.mode, prepare);
      return { source, configuration: prepared.configuration, runtimeSnapshot: prepared.runtimeSnapshot, stages: prepared.stages };
    });
  }
  async function readSource(identity: Identity, input: { expectedWorkspaceId: number; imageSetId: number }) {
    scope(identity, input); return invoke(identity, input.imageSetId, "read", false, tx => capture(tx, identity, input.imageSetId));
  }
  async function reserve(identity: Identity, raw: ImageTaggingSubmitInput, prepare: ImageTaggingPrepare) {
    const input = parse(ImageTaggingSubmitInputSchema, raw); scope(identity, input);
    return invoke(identity, input.imageSetId, "run", true, async (tx, actor) => {
      const state = await fresh(tx, identity, input), requestHash = imageTaggingSubmitRequestHash(identity, input);
      if (state.receipt?.status === "canceled") fail("OPERATION_CANCELED");
      if (state.run) { if (state.run.requestHash !== requestHash) fail("OPERATION_CONTENT_CONFLICT"); return state.run; }
      enabled();
      if (state.source.sourceHash !== input.expectedSourceHash) fail("SOURCE_CHANGED");
      await fence(tx, identity, input.imageSetId, input.operationId);
      const prepared = await preparation(tx, state.source, input.operationId, input.mode, prepare);
      if (prepared.runtimeSnapshot.snapshotHash !== input.expectedRuntimeHash) fail("RUNTIME_CHANGED");
      if (input.maxCostCents < prepared.runtimeSnapshot.budgetPlan.maxCostCentsTotal) fail("COST_AUTHORIZATION_EXCEEDED");
      const runId = imageTaggingRunId(identity, input.operationId), sourceArtifactId = `imgtag_src_${digest({ identity, operationId: input.operationId })}`;
      const persistedInput = parse(inputSchema, { version: 1, identity, imageSetId: input.imageSetId, operationId: input.operationId,
        request: input, requestHash, sourceArtifactId, sourceHash: state.source.sourceHash, configuration: prepared.configuration, runtimeSnapshot: prepared.runtimeSnapshot,
        planHash: digest({ sourceHash: state.source.sourceHash, configuration: prepared.configuration, runtimeSnapshot: prepared.runtimeSnapshot }) });
      const output = parse(outputSchema, { version: 1, state: "queued", stages: prepared.stages, resultHash: null, errorCode: null });
      enabled();
      await putArtifact(tx, identity, { artifactId: sourceArtifactId, artifactKey: IMAGE_TAGGING_SOURCE_KEY, runId, imageSetId: input.imageSetId, content: state.source });
      await executeWrite(tx, "INSERT INTO ai_jobs (workspaceId,runId,kind,module,`procedure`,status,queueName,attempt,maxAttempts,userId,projectId,skillSlug,input,output) VALUES (?,?,?,'knowledge','kbImages.taggingStart','queued','image_tagging',0,1,?,NULL,?,?,?)",
        [identity.workspaceId, runId, IMAGE_TAGGING_JOB_KIND, identity.userId, prepared.runtimeSnapshot.skill.slug, canonical(persistedInput), canonical(output)]);
      const run = await loadRun(tx, identity, input.imageSetId, input.operationId);
      if (!run || !equal(outputOf(run), output) || run.requestHash !== requestHash) fail("JOB_READBACK_MISMATCH");
      await insertAudit(tx, identity, actor.role, input.operationId, "start", { identity, imageSetId: input.imageSetId, operationId: input.operationId,
        status: "reserved", requestHash, runId }, startReceiptSchema);
      return run;
    });
  }
  async function check(identity: Identity, raw: ImageTaggingOperationInput) {
    const input = parse(ImageTaggingOperationInputSchema, raw); scope(identity, input);
    return invoke(identity, input.imageSetId, "read", false, async tx => { await lockOwnedSet(tx, identity, input.imageSetId); return start(tx, identity, input); });
  }
  async function cancel(identity: Identity, raw: ImageTaggingOperationInput) {
    const input = parse(ImageTaggingOperationInputSchema, raw); scope(identity, input);
    return invoke(identity, input.imageSetId, "cancel", true, async (tx, actor) => {
      await lockOwnedSet(tx, identity, input.imageSetId);
      const state = await start(tx, identity, input); if (state.receipt?.status === "canceled") return state;
      if (state.run && state.run.state === "succeeded") return state;
      const receipt: StartReceipt = { identity, imageSetId: input.imageSetId, operationId: input.operationId, status: "canceled", requestHash: state.run?.requestHash ?? null, runId: state.run?.runId ?? null };
      if (state.run) { state.run.state = "canceled"; state.run.errorCode = "OPERATION_CANCELED"; await updateRun(tx, state.run, { release: true }); }
      await insertAudit(tx, identity, actor.role, input.operationId, "cancel", receipt, startReceiptSchema);
      return { run: state.run ? await loadRun(tx, identity, input.imageSetId, input.operationId) : null, receipt };
    });
  }
  async function history(identity: Identity, input: { expectedWorkspaceId: number; imageSetId: number }) {
    scope(identity, input);
    return invoke(identity, input.imageSetId, "read", false, async tx => {
      await lockOwnedSet(tx, identity, input.imageSetId);
      const found = await rawRows(tx, "SELECT runId,IF(OCTET_LENGTH(input)<=4194304,input,NULL) AS input,status,JSON_UNQUOTE(JSON_EXTRACT(output,'$.state')) AS logicalState,DATE_FORMAT(createdAt,'%Y-%m-%dT%H:%i:%s.%fZ') AS createdAt FROM ai_jobs WHERE kind=? AND workspaceId=? AND userId=? AND JSON_EXTRACT(input,'$.imageSetId')=? ORDER BY id DESC LIMIT 101 FOR SHARE", [IMAGE_TAGGING_JOB_KIND, identity.workspaceId, identity.userId, input.imageSetId], 101);
      const complete = found.length <= 100, selected = found.slice(0, 100);
      return { complete, operations: selected.map(row => {
        const value = parse(inputSchema, decoded(row.input)), logicalState = parse(outputSchema.shape.state, row.logicalState);
        if (!equal(value.identity, identity) || value.imageSetId !== input.imageSetId || row.runId !== imageTaggingRunId(identity, value.operationId) || typeof row.createdAt !== "string"
          || row.status !== (logicalState === "unknown" ? "failed" : logicalState)) fail("HISTORY_INVALID");
        return { operationId: value.operationId, runId: row.runId as string, state: logicalState === "unknown" ? "outcome_unknown" : logicalState, sourceHash: value.sourceHash, createdAt: row.createdAt };
      }) };
    });
  }
  async function claim(identity: Identity, raw: ImageTaggingOperationInput, workerId: string): Promise<ImageTaggingLease | null> {
    const input = parse(ImageTaggingOperationInputSchema, raw); scope(identity, input);
    if (!/^[a-zA-Z0-9_.:-]{1,80}$/u.test(workerId)) fail("WORKER_INVALID");
    return invoke(identity, input.imageSetId, "run", true, async tx => {
      enabled();
      const state = await fresh(tx, identity, input), run = state.run;
      if (!run || state.receipt?.status === "canceled" || terminal(run.state)) return null;
      if (run.state === "running" && run.leaseUntil !== null && run.leaseUntil > await databaseNow(tx)) return null;
      if (run.stages.some(stage => stage.state === "dispatched")) {
        run.state = "unknown"; run.errorCode = "DISPATCH_OUTCOME_UNKNOWN";
        for (const stage of run.stages) if (stage.state === "dispatched") { stage.state = "unknown"; stage.errorCode = "DISPATCH_OUTCOME_UNKNOWN"; }
        run.resultHash = resultHash(run.stages);
        await updateRun(tx, run, { release: true }); return null;
      }
      if (state.source.sourceHash !== run.sourceHash) {
        run.state = "failed"; run.errorCode = "SOURCE_CHANGED"; await updateRun(tx, run, { release: true }); return null;
      }
      const leaseToken = `${workerId}:${parse(ImageTaggingOperationIdSchema, token())}`;
      run.state = "running";
      await updateRun(tx, run, { token: leaseToken, leaseSeconds: 120, claim: true });
      return { identity, imageSetId: input.imageSetId, operationId: input.operationId, runId: run.runId, token: leaseToken };
    });
  }
  async function readLease(lease: ImageTaggingLease) {
    return invoke(lease.identity, lease.imageSetId, "run", false, async tx => (await leased(tx, lease, true)).run);
  }
  async function prepareStage<T>(lease: ImageTaggingLease, body: (tx: ImageTaggingExecutor, run: ImageTaggingRun, source: ImageTaggingSource) => Promise<T>): Promise<T> {
    return invoke(lease.identity, lease.imageSetId, "run", false, async tx => {
      enabled(); const state = await leased(tx, lease, true); return body(tx, state.run, state.source!);
    });
  }
  async function heartbeat(lease: ImageTaggingLease) {
    return invoke(lease.identity, lease.imageSetId, "run", true, async tx => {
      const { run } = await leased(tx, lease, false); return updateRun(tx, run, { leaseSeconds: 120 });
    });
  }
  async function dispatch(lease: ImageTaggingLease, raw: ImageTaggingDispatchInput,
    verifyFresh: (tx: ImageTaggingExecutor, run: ImageTaggingRun, source: ImageTaggingSource, evidence: ImageTaggingEvidence) => Promise<void>) {
    return invoke(lease.identity, lease.imageSetId, "run", true, async tx => {
      enabled(); const { run, source } = await leased(tx, lease, true);
      const stage = run.stages.find(item => item.imageId === raw.imageId), image = run.source.images.find(item => item.id === raw.imageId);
      if (!stage || !image || stage.state !== "pending" || stage.dispatch !== null) fail("STAGE_ALREADY_DISPATCHED");
      const value = parse(dispatchSchema, { evidence: raw.evidence, strictDispatch: raw.receipt, contextHash: raw.prepared.contextHash,
        snapshotHash: raw.prepared.snapshotHash, evidenceHash: raw.prepared.evidenceHash, providerRequestHash: raw.prepared.providerRequestHash, bindingHash: raw.prepared.bindingHash });
      if (!equal(raw.prepared.budget, value.strictDispatch.budget)) fail("DISPATCH_BINDING_INVALID");
      verifyDispatch(run.runtimeSnapshot, image, value);
      // The caller's runtime verifier must use the authoritative configuration
      // reloaded on this very tx. This checkpoint is the last action before ACK.
      await verifyFresh(tx, run, source!, value.evidence); enabled();
      stage.state = "dispatched"; stage.dispatch = value;
      return updateRun(tx, run, { leaseSeconds: 120 });
    });
  }
  async function candidate(lease: ImageTaggingLease, value: ImageTaggingCandidateInput) {
    return invoke(lease.identity, lease.imageSetId, "run", true, async tx => {
      const { run } = await leased(tx, lease, false), stage = run.stages.find(item => item.imageId === value.imageId);
      if (!stage || stage.state !== "dispatched" || !stage.dispatch) fail("RESULT_CHECKPOINT_CONFLICT");
      const dispatch = stage.dispatch, parsedCandidate = parse(ImageTaggingCandidateSchema, value.candidate);
      if (value.stage !== "image_tagging" || value.runId !== dispatch.strictDispatch.runId || value.contextHash !== dispatch.contextHash
        || value.bindingHash !== dispatch.bindingHash || value.snapshotHash !== dispatch.snapshotHash || value.evidenceHash !== dispatch.evidenceHash
        || value.providerRequestHash !== dispatch.providerRequestHash) fail("RESULT_RECEIPT_INVALID");
      const candidateHash = digest(parsedCandidate), artifactId = `imgtag_can_${digest({ runId: run.runId, imageId: value.imageId })}`;
      await putArtifact(tx, lease.identity, { artifactId, artifactKey: IMAGE_TAGGING_CANDIDATE_KEY, runId: run.runId, imageSetId: run.imageSetId, imageId: value.imageId,
        content: { version: 1, imageId: value.imageId, candidate: parsedCandidate, candidateHash, dispatchHash: digest(dispatch) } });
      stage.state = "candidate"; stage.candidateHash = candidateHash; stage.candidateArtifactId = artifactId;
      if (!run.stages.some(item => ["pending", "dispatched"].includes(item.state))) { run.state = "succeeded"; run.resultHash = resultHash(run.stages); }
      return updateRun(tx, run, { leaseSeconds: 120 });
    });
  }
  async function failure(lease: ImageTaggingLease, imageId: number | null, reasonCode: string) {
    const safeCode = code.safeParse(reasonCode).success ? reasonCode : "PROCESSING_FAILED";
    return invoke(lease.identity, lease.imageSetId, "run", true, async tx => {
      const { run } = await leased(tx, lease, false), stage = run.stages.find(item => item.imageId === imageId);
      if (stage?.state === "dispatched") { stage.state = "unknown"; stage.errorCode = "DISPATCH_OUTCOME_UNKNOWN"; run.state = "unknown"; run.errorCode = "DISPATCH_OUTCOME_UNKNOWN"; }
      else { if (stage?.state === "pending") { stage.state = "failed"; stage.errorCode = safeCode; } run.state = "failed"; run.errorCode = safeCode; }
      run.resultHash = resultHash(run.stages);
      return updateRun(tx, run, { release: true });
    });
  }
  async function readApply(tx: ImageTaggingExecutor, identity: Identity, input: ImageTaggingApplyOperationInput) {
    const old = boundReceipt(await readAudit(tx, identity, input.operationId, "apply", applyReceiptSchema), identity, input.imageSetId, input.operationId);
    if (old && old.runOperationId !== input.runOperationId) fail("OPERATION_SCOPE_MISMATCH");
    return old;
  }
  async function applyCheck(identity: Identity, raw: ImageTaggingApplyOperationInput) {
    const input = parse(ImageTaggingApplyOperationInputSchema, raw); scope(identity, input);
    return invoke(identity, input.imageSetId, "read", false, async tx => { await lockOwnedSet(tx, identity, input.imageSetId); return readApply(tx, identity, input); });
  }
  async function applyCancel(identity: Identity, raw: ImageTaggingApplyOperationInput) {
    const input = parse(ImageTaggingApplyOperationInputSchema, raw); scope(identity, input);
    return invoke(identity, input.imageSetId, "cancel", true, async (tx, actor) => {
      await lockOwnedSet(tx, identity, input.imageSetId);
      const old = await readApply(tx, identity, input); if (old) return old;
      return insertAudit(tx, identity, actor.role, input.operationId, "apply", { identity, imageSetId: input.imageSetId, operationId: input.operationId,
        runOperationId: input.runOperationId, status: "canceled", requestHash: null, resultHash: null, beforeSourceHash: null, afterSourceHash: null,
        acceptedImageIds: [], excludedImageIds: [], afterImageRevisions: [] }, applyReceiptSchema);
    });
  }
  async function apply(identity: Identity, raw: ImageTaggingApplyInput): Promise<ImageTaggingApplyReceipt> {
    const input = parse(ImageTaggingApplyInputSchema, raw); scope(identity, input);
    return invoke(identity, input.imageSetId, "confirm", true, async (tx, actor) => {
      // Full source/proof comes before our job lock; no parent↔acquisition lock
      // reversal. A replay still requires current scope ownership/authority.
      const current = await capture(tx, identity, input.imageSetId), old = await readApply(tx, identity, input), requestHash = imageTaggingApplyRequestHash(identity, input);
      if (old) { if (old.status === "canceled") fail("OPERATION_CANCELED"); if (old.requestHash !== requestHash) fail("OPERATION_CONTENT_CONFLICT"); return old; }
      enabled();
      const run = await loadRun(tx, identity, input.imageSetId, input.runOperationId);
      if (!run || run.resultHash === null || run.resultHash !== input.expectedResultHash || run.state === "canceled" || run.state === "running" || run.state === "queued") fail("RESULT_NOT_READY");
      const canceled = await readAudit(tx, identity, input.runOperationId, "cancel", startReceiptSchema); if (canceled) fail("OPERATION_CANCELED");
      if (current.sourceHash !== input.expectedSourceHash) fail("SOURCE_CHANGED");
      if (!imageTaggingSourceMatchesRun(run, current)) fail("SOURCE_CHANGED");
      const accepted: number[] = [], excluded: number[] = [];
      for (const decision of input.decisions) {
        const stage = run.stages.find(item => item.imageId === decision.imageId), image = current.images.find(item => item.id === decision.imageId),
          original = run.source.images.find(item => item.id === decision.imageId);
        if (!stage || stage.state !== "candidate" || stage.candidateHash !== decision.candidateHash || !image || !original
          || image.tagsConfirmed || image.analysisConfirmed || original.tagsConfirmed || original.analysisConfirmed) fail("CANDIDATE_CAS_CONFLICT");
        if (decision.decision === "exclude") { stage.state = "excluded"; stage.applyOperationId = input.operationId; excluded.push(image.id); continue; }
        const values = decision.tags;
        // Eight validated labels and the three existing legacy mirrors only.
        // No analysis/body/score/set fields, accent, or evidence are overwritten.
        const revision = `LOWER(SHA2(CAST(JSON_ARRAY(${getTableConfig(kbImages).columns.map(column => `\`${column.name}\``).join(",")}) AS CHAR CHARACTER SET utf8mb4),256))`;
        await executeWrite(tx, `UPDATE kb_images SET ${IMAGE_TAGGING_TAG_FIELDS.map(key => `\`${key}\`=?`).join(",")},tagImageType=?,tagColorScheme=?,tagDesignStyle=?,tagsConfirmed=1,updatedAt=NOW(6) WHERE id=? AND imageSetId=? AND BINARY imageUrl=BINARY ? AND tagsConfirmed=0 AND analysisConfirmed=0 AND ${revision}=? AND ${IMAGE_TAGGING_TAG_FIELDS.map(key => `\`${key}\`<=>?`).join(" AND ")}`,
          [...IMAGE_TAGGING_TAG_FIELDS.map(key => values[key]), values.tagImageTypeMain, values.tagColorSchemeV2, values.tagDesignStyleV2,
            image.id, input.imageSetId, image.imageUrl, image.revisionHash, ...IMAGE_TAGGING_TAG_FIELDS.map(key => image.tags[key])]);
        stage.state = "applied"; stage.applyOperationId = input.operationId; accepted.push(image.id);
      }
      const after = await capture(tx, identity, input.imageSetId);
      if (after.set.revisionHash !== current.set.revisionHash || !equal(after.images.map(image => image.id), current.images.map(image => image.id))) fail("APPLY_READBACK_MISMATCH");
      const afterImageRevisions: ImageTaggingApplyReceipt["afterImageRevisions"] = [];
      for (const image of after.images) {
        const decision = input.decisions.find(item => item.imageId === image.id), before = current.images.find(item => item.id === image.id)!;
        if (decision?.decision === "accept") {
          if (!image.tagsConfirmed || image.analysisConfirmed !== before.analysisConfirmed || !equal(image.tags, decision.tags) || image.revisionHash === before.revisionHash) fail("APPLY_READBACK_MISMATCH");
          run.stages.find(stage => stage.imageId === image.id)!.afterImageRevision = image.revisionHash;
          afterImageRevisions.push({ imageId: image.id, revisionHash: image.revisionHash });
        } else if (image.revisionHash !== before.revisionHash) fail("APPLY_READBACK_MISMATCH");
      }
      const receipt = parse(applyReceiptSchema, { identity, imageSetId: input.imageSetId, operationId: input.operationId, runOperationId: input.runOperationId,
        status: "committed", requestHash, resultHash: run.resultHash, beforeSourceHash: current.sourceHash, afterSourceHash: after.sourceHash,
        acceptedImageIds: accepted, excludedImageIds: excluded, afterImageRevisions });
      enabled();
      const saved = await insertAudit(tx, identity, actor.role, input.operationId, "apply", receipt, applyReceiptSchema);
      const persisted = await updateRun(tx, run, { release: true });
      if (persisted.resultHash !== input.expectedResultHash) fail("RESULT_HASH_INVALID");
      return saved;
    });
  }
  return { preview, readSource, reserve, check, cancel, history, claim, readLease, prepareStage, heartbeat, dispatch, candidate, failure, apply, applyCheck, applyCancel };
}
