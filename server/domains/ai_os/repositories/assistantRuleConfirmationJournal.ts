import { createHash } from "node:crypto";
import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { AgentLibraryKeySchema } from "../../../../shared/agentLibraryContracts";
import { AssistantRuleConfirmationResultSchema, type AssistantRuleConfirmationResult } from "../../../../shared/assistantRuleConfirmation";
import { assistantConversationCanonical } from "./assistantConversations";

const TABLE = "security_audit_logs", MAX_BYTES = 32768;
const ACTION = "assistant.rules.confirmation.final", RESOURCE = "assistant_rule_confirmation";
const id = z.number().int().min(1).max(2147483647);
const uuid = z.string().uuid().refine(value => value === value.toLowerCase());
const identitySchema = z.object({ workspaceId: id, userId: id }).strict();
const scopeSchema = identitySchema.extend({ agentKey: AgentLibraryKeySchema, threadId: uuid, operationId: uuid, confirmationId: uuid,
  actorRole: z.string().min(1).max(64).refine(value => value === value.trim() && !/[\u0000-\u001f\u007f]/u.test(value)) }).strict().refine(value => value.operationId !== value.confirmationId);
export type AssistantRuleConfirmationJournalScope = z.infer<typeof scopeSchema>;
export interface AssistantRuleConfirmationJournalExecutor { execute(statement: SQL): Promise<unknown> }
export class AssistantRuleConfirmationJournalError extends Error {
  constructor(readonly code: string) { super(`ASSISTANT_RULE_CONFIRMATION_${code}`); this.name = "AssistantRuleConfirmationJournalError"; }
}
function fail(code: string): never { throw new AssistantRuleConfirmationJournalError(code); }
function encode(value: unknown): string { try { return assistantConversationCanonical(value, MAX_BYTES); } catch { return fail("JOURNAL_PAYLOAD_INVALID"); } }
function parsed<T>(schema: z.ZodType<T>, value: unknown): T {
  const safe = schema.safeParse(JSON.parse(encode(value)));
  if (!safe.success) fail("JOURNAL_PAYLOAD_INVALID");
  return safe.data;
}
function statement(text: string, params: unknown[]): SQL {
  const parts = text.split("?"); if (parts.length !== params.length + 1) fail("JOURNAL_SQL_INVALID");
  return sql.join(parts.flatMap((part, index) => index < params.length ? [sql.raw(part), sql`${params[index]}`] : [sql.raw(part)]), sql.raw(""));
}
type Row = Record<string, unknown>;
async function rows(executor: AssistantRuleConfirmationJournalExecutor, query: string, params: unknown[], max: number): Promise<Row[]> {
  let result: unknown;
  try { result = await executor.execute(statement(query, params)); }
  catch { return fail("JOURNAL_STORAGE_UNKNOWN"); }
  if (!Array.isArray(result) || !Array.isArray(result[0]) || result[0].length > max || result[0].some(value => !value || typeof value !== "object" || Array.isArray(value))) fail("JOURNAL_READ_INVALID");
  return result[0];
}
const collations = new Set(["utf8mb4_unicode_ci", "utf8mb4_general_ci", "utf8mb4_0900_ai_ci", "utf8mb4_bin", "utf8mb4_0900_bin"]);

/** Read-only admission for the existing audit table. No DDL, permission grant,
 * default mutation or metadata body read. A successful check does not prove a
 * caller holds a transaction: the service must supply its locked session. */
export async function assertAssistantRuleConfirmationJournalSchema(executor: AssistantRuleConfirmationJournalExecutor): Promise<void> {
  const tables = await rows(executor, "SELECT TABLE_NAME AS tableName,ENGINE AS engine FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? LIMIT 2", [TABLE], 1);
  const columns = await rows(executor, "SELECT COLUMN_NAME AS columnName,DATA_TYPE AS dataType,COLUMN_TYPE AS columnType,IS_NULLABLE AS isNullable,EXTRA AS extra,CHARACTER_MAXIMUM_LENGTH AS maxLength,COLUMN_DEFAULT AS defaultValue,COLLATION_NAME AS collation FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? LIMIT 129", [TABLE], 128);
  const indexes = await rows(executor, "SELECT INDEX_NAME AS indexName,NON_UNIQUE AS nonUnique,SEQ_IN_INDEX AS sequence,COLUMN_NAME AS columnName,SUB_PART AS prefixLength FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? ORDER BY INDEX_NAME,SEQ_IN_INDEX LIMIT 257", [TABLE], 256);
  if (tables.length !== 1 || tables[0].tableName !== TABLE || tables[0].engine !== "InnoDB" || !columns.length || !indexes.length
    || new Set(columns.map(row => row.columnName)).size !== columns.length
    || columns.some(row => typeof row.columnName !== "string" || typeof row.dataType !== "string" || typeof row.columnType !== "string" || typeof row.extra !== "string"
      || !["YES", "NO"].includes(String(row.isNullable)) || row.defaultValue !== null && typeof row.defaultValue !== "string" && !(typeof row.defaultValue === "number" && Number.isFinite(row.defaultValue)))) fail("JOURNAL_SCHEMA_UNAVAILABLE");
  const fields = new Map(columns.map(row => [String(row.columnName), row]));
  const ordinary = (name: string) => {
    const value = fields.get(name);
    return value && !/(?:virtual|stored)\s+generated|unsigned/iu.test(`${value.extra} ${value.columnType}`) ? value : null;
  };
  const integer = (name: string, nullable: boolean) => {
    const value = ordinary(name); return value?.dataType === "int" && /^int(?:\(\d+\))?$/u.test(String(value.columnType))
      && (nullable || value.isNullable === "NO") && (name === "id" ? value.extra === "auto_increment" : value.extra === "");
  };
  const varchar = (name: string, length: number, nullable: boolean) => {
    const value = ordinary(name); return value?.dataType === "varchar" && value.extra === "" && (nullable || value.isNullable === "NO")
      && Number.isSafeInteger(Number(value.maxLength)) && Number(value.maxLength) >= length && Number(value.maxLength) <= 2000
      && value.columnType === `varchar(${value.maxLength})` && collations.has(String(value.collation));
  };
  const enumeration = (name: string, type: string) => { const value = ordinary(name); return value?.dataType === "enum" && value.columnType === type && value.isNullable === "NO" && value.extra === "" && collations.has(String(value.collation)); };
  const metadata = ordinary("metadata");
  if (!integer("id", false) || !integer("workspaceId", true) || !integer("actorUserId", true)
    || !varchar("auditId", 77, false) || !varchar("actorRole", 64, true) || !varchar("action", ACTION.length, false)
    || !varchar("resourceType", RESOURCE.length, false) || !varchar("resourceId", 36, true)
    || !enumeration("status", "enum('success','denied','failed')") || !enumeration("riskLevel", "enum('low','medium','high','critical')")
    || metadata?.dataType !== "json" || metadata.extra !== "") fail("JOURNAL_SCHEMA_UNAVAILABLE");
  const supplied = new Set(["id", "auditId", "workspaceId", "actorUserId", "actorRole", "action", "resourceType", "resourceId", "status", "riskLevel", "metadata"]);
  if (columns.some(row => !supplied.has(String(row.columnName)) && row.isNullable === "NO" && row.defaultValue === null && !/(?:virtual|stored)\s+generated/iu.test(String(row.extra)))) fail("JOURNAL_SCHEMA_UNAVAILABLE");
  const groups = new Map<string, Row[]>();
  for (const row of indexes) {
    if (typeof row.indexName !== "string" || !row.indexName || ![0, 1].includes(Number(row.nonUnique)) || !Number.isSafeInteger(Number(row.sequence)) || Number(row.sequence) < 1
      || typeof row.columnName !== "string" || !fields.has(row.columnName) || row.prefixLength !== null && (!Number.isSafeInteger(Number(row.prefixLength)) || Number(row.prefixLength) < 1)) fail("JOURNAL_SCHEMA_UNAVAILABLE");
    groups.set(row.indexName, [...(groups.get(row.indexName) ?? []), row]);
  }
  const all = [...groups.values()].map(group => group.sort((a, b) => Number(a.sequence) - Number(b.sequence)));
  if (all.some(group => group.some((row, index) => Number(row.sequence) !== index + 1 || Number(row.nonUnique) !== Number(group[0].nonUnique)))) fail("JOURNAL_SCHEMA_UNAVAILABLE");
  const exactUnique = (group: Row[], name: string) => group.length === 1 && Number(group[0].nonUnique) === 0 && group[0].columnName === name && group[0].prefixLength === null;
  if (!all.some(group => group[0].indexName === "PRIMARY" && exactUnique(group, "id")) || !all.some(group => exactUnique(group, "auditId"))
    || all.some(group => Number(group[0].nonUnique) === 0 && !exactUnique(group, "id") && !exactUnique(group, "auditId"))) fail("JOURNAL_SCHEMA_UNAVAILABLE");
}

/** UUID ownership excludes thread/agent deliberately: using one confirmation
 * UUID for a different target must collide and be rejected, not create a second
 * independent approval. Exact full target is bound in the final receipt. */
export function assistantRuleConfirmationAuditId(identity: { workspaceId: number; userId: number }, confirmationId: string): string {
  return `asrule_final_${createHash("sha256").update(encode({ identity: parsed(identitySchema, identity), confirmationId: parsed(uuid, confirmationId) })).digest("hex")}`;
}

const finalSchema = z.object({ version: z.literal(1), kind: z.literal("final"), receipt: AssistantRuleConfirmationResultSchema }).strict()
  .refine(value => value.receipt.status !== "unknown");
export type AssistantRuleConfirmationJournalState = { final: AssistantRuleConfirmationResult | null };

/** This helper never opens its own connection/transaction. Supply only the
 * current private service transaction after workspace→actor locks and fresh
 * permission checks. Configuration CAS, version insert and final receipt must
 * all commit in that same transaction. Do not retain an instance past it. */
export function createAssistantRuleConfirmationJournal(executor: AssistantRuleConfirmationJournalExecutor, raw: AssistantRuleConfirmationJournalScope) {
  const scope = parsed(scopeSchema, raw), identity = { workspaceId: scope.workspaceId, userId: scope.userId, agentKey: scope.agentKey };
  const auditId = assistantRuleConfirmationAuditId({ workspaceId: scope.workspaceId, userId: scope.userId }, scope.confirmationId);
  let admitted: Promise<void> | null = null;
  const assertSchema = () => admitted ??= assertAssistantRuleConfirmationJournalSchema(executor);
  function bound(receipt: AssistantRuleConfirmationResult) {
    if (encode(receipt.identity) !== encode(identity) || receipt.threadId !== scope.threadId || receipt.operationId !== scope.operationId || receipt.confirmationId !== scope.confirmationId) fail("JOURNAL_SCOPE_MISMATCH");
  }
  async function read(): Promise<AssistantRuleConfirmationJournalState> {
    await assertSchema();
    const result = await rows(executor, "SELECT auditId,workspaceId,actorUserId,action,resourceType,resourceId,status,riskLevel,IF(OCTET_LENGTH(CAST(metadata AS CHAR CHARACTER SET utf8mb4))<=32768,CAST(metadata AS CHAR CHARACTER SET utf8mb4),NULL) AS metadataText FROM security_audit_logs WHERE auditId=? AND BINARY auditId=BINARY ? LIMIT 2 FOR UPDATE", [auditId, auditId], 1);
    if (!result.length) return { final: null };
    const row = result[0];
    if (row.auditId !== auditId || row.workspaceId !== scope.workspaceId || row.actorUserId !== scope.userId || row.action !== ACTION || row.resourceType !== RESOURCE || row.resourceId !== scope.confirmationId || row.status !== "success" || row.riskLevel !== "medium") fail("JOURNAL_SCOPE_MISMATCH");
    if (typeof row.metadataText !== "string" || Buffer.byteLength(row.metadataText, "utf8") > MAX_BYTES) fail("JOURNAL_PAYLOAD_INVALID");
    let decoded: unknown;
    try { decoded = JSON.parse(row.metadataText); } catch { return fail("JOURNAL_PAYLOAD_INVALID"); }
    const resultValue = parsed(finalSchema, decoded); bound(resultValue.receipt);
    return { final: resultValue.receipt };
  }
  async function finalize(rawReceipt: AssistantRuleConfirmationResult): Promise<AssistantRuleConfirmationResult> {
    const value = parsed(finalSchema, { version: 1, kind: "final", receipt: rawReceipt }); bound(value.receipt);
    const previous = await read();
    if (previous.final) {
      if (previous.final.status === "canceled") {
        if (value.receipt.status !== "canceled") fail("CONFIRMATION_CANCELED");
        return previous.final;
      }
      if (encode(previous.final) !== encode(value.receipt)) fail("CONFIRMATION_CONTENT_CONFLICT");
      return previous.final;
    }
    let result: unknown;
    try { result = await executor.execute(statement("INSERT INTO security_audit_logs (auditId,workspaceId,actorUserId,actorRole,action,resourceType,resourceId,status,riskLevel,metadata) VALUES (?,?,?,?,?,?,?,'success','medium',?)", [auditId, scope.workspaceId, scope.userId, scope.actorRole, ACTION, RESOURCE, scope.confirmationId, encode(value)])); }
    catch { return fail("JOURNAL_STORAGE_UNKNOWN"); }
    if (!Array.isArray(result) || !result[0] || typeof result[0] !== "object" || result[0].affectedRows !== 1) fail("JOURNAL_WRITE_UNCONFIRMED");
    const saved = await read();
    if (saved.final === null || encode(saved.final) !== encode(value.receipt)) fail("JOURNAL_READBACK_MISMATCH");
    return saved.final;
  }
  async function cancel(): Promise<AssistantRuleConfirmationResult> {
    const state = await read(); if (state.final) return state.final;
    return finalize({ identity, threadId: scope.threadId, operationId: scope.operationId, confirmationId: scope.confirmationId, status: "canceled",
      requestHash: null, proposalHash: null, configurationRevision: null, configurationHash: null, reasonCode: "CONFIRMATION_CANCELED" });
  }
  return { assertSchema, read, finalize, cancel };
}
