import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import {
  OperationsBoardEditionScopeSchema, OperationsBoardEditionWriteResultSchema,
  operationsBoardEditionCanonical, operationsBoardEditionHash, type OperationsBoardEditionWriteResult,
} from "../../../shared/operationsBoardEdition";

const TABLE = "security_audit_logs", MAX_BYTES = 32768;
const ACTION = "ops.board.operation.final", RESOURCE = "ops_board_operation";
const id = z.number().int().min(1).max(2147483647);
const uuid = z.string().uuid().refine(value => value === value.toLowerCase());
const identitySchema = z.object({ workspaceId: id, userId: id }).strict();
const scopeSchema = z.object({ identity: identitySchema, scope: OperationsBoardEditionScopeSchema, operationId: uuid,
  actorRole: z.string().min(1).max(64).refine(value => value === value.trim() && !/[\u0000-\u001f\u007f]/u.test(value)),
}).strict().refine(value => value.identity.workspaceId === value.scope.workspaceId);
export type OperationsBoardOperationJournalScope = z.infer<typeof scopeSchema>;
export interface OperationsBoardOperationJournalExecutor { execute(query: SQL): Promise<unknown> }
export class OperationsBoardOperationJournalError extends Error {
  constructor(public readonly code: string) { super(`OPERATIONS_BOARD_${code}`); this.name = "OperationsBoardOperationJournalError"; }
}
function fail(code: string): never { throw new OperationsBoardOperationJournalError(code); }
function encode(value: unknown): string {
  try { return operationsBoardEditionCanonical(value, MAX_BYTES); } catch { return fail("JOURNAL_PAYLOAD_INVALID"); }
}
function parsed<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(JSON.parse(encode(value)));
  if (!result.success) fail("JOURNAL_PAYLOAD_INVALID"); return result.data;
}
function statement(text: string, params: unknown[]): SQL {
  const parts = text.split("?"); if (parts.length !== params.length + 1) fail("JOURNAL_SQL_INVALID");
  return sql.join(parts.flatMap((part, i) => i < params.length ? [sql.raw(part), sql`${params[i]}`] : [sql.raw(part)]), sql.raw(""));
}
type Row = Record<string, unknown>;
async function rows(tx: OperationsBoardOperationJournalExecutor, query: string, params: unknown[], max: number): Promise<Row[]> {
  let result: unknown;
  try { result = await tx.execute(statement(query, params)); } catch { return fail("JOURNAL_STORAGE_UNKNOWN"); }
  if (!Array.isArray(result) || !Array.isArray(result[0]) || result[0].length > max || result[0].some(row => !row || typeof row !== "object" || Array.isArray(row))) fail("JOURNAL_READ_INVALID");
  return result[0];
}
const collations = new Set(["utf8mb4_unicode_ci", "utf8mb4_general_ci", "utf8mb4_0900_ai_ci", "utf8mb4_bin", "utf8mb4_0900_bin"]);
const unsignedInteger = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

/** Admission for the EXISTING audit table, not a DDL operation. InnoDB and a
 * full-column unique auditId are mandatory for atomic mutations and UUID fences.
 * Caller still must supply one current, authorized workspace→actor transaction. */
export async function assertOperationsBoardOperationJournalSchema(tx: OperationsBoardOperationJournalExecutor): Promise<void> {
  const tables = await rows(tx, "SELECT TABLE_NAME AS tableName,ENGINE AS engine FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? LIMIT 2", [TABLE], 1);
  const columns = await rows(tx, "SELECT COLUMN_NAME AS columnName,DATA_TYPE AS dataType,COLUMN_TYPE AS columnType,IS_NULLABLE AS isNullable,EXTRA AS extra,CHARACTER_MAXIMUM_LENGTH AS maxLength,COLUMN_DEFAULT AS defaultValue,COLLATION_NAME AS collation FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? LIMIT 129", [TABLE], 128);
  const indexes = await rows(tx, "SELECT INDEX_NAME AS indexName,NON_UNIQUE AS nonUnique,SEQ_IN_INDEX AS sequence,COLUMN_NAME AS columnName,SUB_PART AS prefixLength FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? ORDER BY INDEX_NAME,SEQ_IN_INDEX LIMIT 257", [TABLE], 256);
  if (tables.length !== 1 || tables[0].tableName !== TABLE || tables[0].engine !== "InnoDB" || !columns.length || !indexes.length
    || new Set(columns.map(row => row.columnName)).size !== columns.length
    || columns.some(row => typeof row.columnName !== "string" || !/^[A-Za-z_][A-Za-z0-9_]{0,63}$/u.test(row.columnName)
      || typeof row.dataType !== "string" || typeof row.columnType !== "string" || typeof row.extra !== "string" || !["YES", "NO"].includes(String(row.isNullable))
      || row.defaultValue !== null && typeof row.defaultValue !== "string" && !(typeof row.defaultValue === "number" && Number.isFinite(row.defaultValue))
      || row.maxLength !== null && (!unsignedInteger(row.maxLength) || row.maxLength === 0))) fail("JOURNAL_SCHEMA_UNAVAILABLE");
  const fields = new Map(columns.map(row => [String(row.columnName), row]));
  const ordinary = (name: string) => {
    const field = fields.get(name);
    return field && !/(?:virtual|stored)\s+generated|unsigned/iu.test(`${field.extra} ${field.columnType}`) ? field : null;
  };
  const integer = (name: string, nullable: boolean) => {
    const field = ordinary(name);
    return field?.dataType === "int" && /^int(?:\(\d+\))?$/u.test(String(field.columnType)) && (nullable || field.isNullable === "NO")
      && (name === "id" ? field.extra === "auto_increment" : field.extra === "");
  };
  const varchar = (name: string, length: number, nullable: boolean) => {
    const field = ordinary(name);
    return field?.dataType === "varchar" && field.extra === "" && (nullable || field.isNullable === "NO")
      && unsignedInteger(field.maxLength) && field.maxLength >= length && field.maxLength <= 2000 && field.columnType === `varchar(${field.maxLength})` && collations.has(String(field.collation));
  };
  const enumeration = (name: string, type: string) => { const field = ordinary(name); return field?.dataType === "enum" && field.columnType === type && field.isNullable === "NO" && field.extra === "" && collations.has(String(field.collation)); };
  const metadata = ordinary("metadata");
  if (!integer("id", false) || !integer("workspaceId", true) || !integer("actorUserId", true)
    || !varchar("auditId", 76, false) || !varchar("actorRole", 64, true) || !varchar("action", ACTION.length, false)
    || !varchar("resourceType", RESOURCE.length, false) || !varchar("resourceId", 36, true)
    || !enumeration("status", "enum('success','denied','failed')") || !enumeration("riskLevel", "enum('low','medium','high','critical')")
    || metadata?.dataType !== "json" || metadata.columnType !== "json" || metadata.extra !== "") fail("JOURNAL_SCHEMA_UNAVAILABLE");
  const supplied = new Set(["id", "auditId", "workspaceId", "actorUserId", "actorRole", "action", "resourceType", "resourceId", "status", "riskLevel", "metadata"]);
  if (columns.some(row => !supplied.has(String(row.columnName)) && row.isNullable === "NO" && row.defaultValue === null && !/(?:virtual|stored)\s+generated/iu.test(String(row.extra)))) fail("JOURNAL_SCHEMA_UNAVAILABLE");
  const groups = new Map<string, Row[]>();
  for (const row of indexes) {
    if (typeof row.indexName !== "string" || !/^[A-Za-z_][A-Za-z0-9_]{0,63}$/u.test(row.indexName) || ![0, 1].includes(row.nonUnique as number)
      || !unsignedInteger(row.sequence) || row.sequence < 1 || row.sequence > 64 || typeof row.columnName !== "string" || !fields.has(row.columnName)
      || row.prefixLength !== null && (!unsignedInteger(row.prefixLength) || row.prefixLength < 1)) fail("JOURNAL_SCHEMA_UNAVAILABLE");
    groups.set(row.indexName, [...(groups.get(row.indexName) ?? []), row]);
  }
  if (new Set([...groups.keys()].map(name => name.toLowerCase())).size !== groups.size) fail("JOURNAL_SCHEMA_UNAVAILABLE");
  const all = [...groups.values()].map(group => group.sort((a, b) => Number(a.sequence) - Number(b.sequence)));
  if (all.some(group => group.some((row, i) => row.sequence !== i + 1 || row.nonUnique !== group[0].nonUnique))) fail("JOURNAL_SCHEMA_UNAVAILABLE");
  const exactUnique = (group: Row[], name: string) => group.length === 1 && group[0].nonUnique === 0 && group[0].columnName === name && group[0].prefixLength === null;
  if (!all.some(group => group[0].indexName === "PRIMARY" && exactUnique(group, "id")) || !all.some(group => exactUnique(group, "auditId"))
    || all.some(group => group[0].nonUnique === 0 && !exactUnique(group, "id") && !exactUnique(group, "auditId"))) fail("JOURNAL_SCHEMA_UNAVAILABLE");
}

/** Intentionally does NOT include store/country or action. One actor's UUID
 * cannot be reused for another scope or a different mutation. */
export function operationsBoardOperationAuditId(identity: OperationsBoardOperationJournalScope["identity"], operationId: string): string {
  return `board_final_${operationsBoardEditionHash({ identity: parsed(identitySchema, identity), operationId: parsed(uuid, operationId) }, MAX_BYTES)}`;
}
const finalSchema = z.object({ version: z.literal(1), kind: z.literal("final"), receipt: OperationsBoardEditionWriteResultSchema }).strict()
  .refine(value => value.receipt.status !== "unknown" && (value.receipt.status !== "cancelled" || value.receipt.action === null));
export type OperationsBoardOperationJournalState = { final: OperationsBoardEditionWriteResult | null };

/** Instance is scoped to one caller-owned transaction. Business store changes
 * and final receipt commit together. No independent transaction, writes flag,
 * authorization shortcuts, model call, queue or best-effort audit is used here. */
export function createOperationsBoardOperationJournal(tx: OperationsBoardOperationJournalExecutor, raw: OperationsBoardOperationJournalScope) {
  const context = parsed(scopeSchema, raw), { identity, scope, operationId } = context;
  const auditId = operationsBoardOperationAuditId(identity, operationId);
  let admitted: Promise<void> | null = null;
  const assertSchema = () => admitted ??= assertOperationsBoardOperationJournalSchema(tx);
  function bound(receipt: OperationsBoardEditionWriteResult) {
    if (encode(receipt.identity) !== encode(identity) || encode(receipt.scope) !== encode(scope) || receipt.operationId !== operationId) fail("JOURNAL_SCOPE_MISMATCH");
  }
  async function read(): Promise<OperationsBoardOperationJournalState> {
    await assertSchema();
    const found = await rows(tx, "SELECT auditId,workspaceId,actorUserId,action,resourceType,resourceId,status,riskLevel,IF(OCTET_LENGTH(CAST(metadata AS CHAR CHARACTER SET utf8mb4))<=32768,CAST(metadata AS CHAR CHARACTER SET utf8mb4),NULL) AS metadataText FROM security_audit_logs WHERE auditId=? AND BINARY auditId=BINARY ? LIMIT 2 FOR UPDATE", [auditId, auditId], 1);
    if (!found.length) return { final: null };
    const row = found[0];
    if (row.auditId !== auditId || row.workspaceId !== identity.workspaceId || row.actorUserId !== identity.userId || row.action !== ACTION || row.resourceType !== RESOURCE || row.resourceId !== operationId || row.status !== "success" || row.riskLevel !== "medium") fail("JOURNAL_SCOPE_MISMATCH");
    if (typeof row.metadataText !== "string" || Buffer.byteLength(row.metadataText, "utf8") > MAX_BYTES) fail("JOURNAL_PAYLOAD_INVALID");
    let decoded: unknown; try { decoded = JSON.parse(row.metadataText); } catch { return fail("JOURNAL_PAYLOAD_INVALID"); }
    const value = parsed(finalSchema, decoded); bound(value.receipt); return { final: value.receipt };
  }
  async function finalize(rawReceipt: OperationsBoardEditionWriteResult): Promise<OperationsBoardEditionWriteResult> {
    const value = parsed(finalSchema, { version: 1, kind: "final", receipt: rawReceipt }); bound(value.receipt);
    const previous = await read();
    if (previous.final) {
      if (previous.final.status === "cancelled") {
        // Throw rather than returning cancelled after a caller already changed
        // the edition/note: its transaction must roll that business write back.
        if (value.receipt.status !== "cancelled") fail("OPERATION_CANCELLED");
        return previous.final;
      }
      if (encode(previous.final) !== encode(value.receipt)) fail("OPERATION_CONTENT_CONFLICT");
      return previous.final;
    }
    let result: unknown;
    try { result = await tx.execute(statement("INSERT INTO security_audit_logs (auditId,workspaceId,actorUserId,actorRole,action,resourceType,resourceId,status,riskLevel,metadata) VALUES (?,?,?,?,?,?,?,'success','medium',?)", [auditId, identity.workspaceId, identity.userId, context.actorRole, ACTION, RESOURCE, operationId, encode(value)])); }
    catch { return fail("JOURNAL_STORAGE_UNKNOWN"); }
    if (!Array.isArray(result) || !result[0] || typeof result[0] !== "object" || result[0].affectedRows !== 1) fail("JOURNAL_WRITE_UNCONFIRMED");
    const saved = await read(); if (!saved.final || encode(saved.final) !== encode(value.receipt)) fail("JOURNAL_READBACK_MISMATCH");
    return saved.final;
  }
  async function cancel(): Promise<OperationsBoardEditionWriteResult> {
    const previous = await read(); if (previous.final) return previous.final;
    return finalize({ identity, scope, operationId, action: null, status: "cancelled", requestHash: null, stateVersion: null, editionId: null, editionVersion: null,
      sourceHash: null, parentAsin: null, noteVersion: null, reasonCode: "operation_cancelled" });
  }
  return { assertSchema, read, finalize, cancel };
}
