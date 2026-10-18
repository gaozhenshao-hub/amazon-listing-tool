import { describe, expect, it, vi } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import type { SQL } from "drizzle-orm";
import type { OperationsBoardEditionWriteResult } from "../../../shared/operationsBoardEdition";
import {
  assertOperationsBoardOperationJournalSchema, createOperationsBoardOperationJournal,
  operationsBoardOperationAuditId, type OperationsBoardOperationJournalScope,
} from "./operationsBoardOperationJournal";

const hash = "a".repeat(64), dialect = new MySqlDialect();
const context: OperationsBoardOperationJournalScope = {
  identity: { workspaceId: 7, userId: 3 }, scope: { workspaceId: 7, storeName: "SYNTHETIC Store ? ' exact", country: "US" },
  operationId: "a0000000-0000-4000-8000-000000000001", actorRole: "admin",
};
const receipt = (action: "initialize" | "publishRevision" | "saveNote" = "initialize"): OperationsBoardEditionWriteResult => ({
  identity: context.identity, scope: context.scope, operationId: context.operationId, action, status: "committed", requestHash: hash,
  stateVersion: 2, editionId: 9, editionVersion: 2, sourceHash: hash,
  parentAsin: action === "saveNote" ? "SYNTHETIC-PARENT" : null, noteVersion: action === "saveNote" ? 3 : null, reasonCode: null,
});
type Row = Record<string, unknown>;
function fixture() {
  const column = (columnName: string, dataType: string, options: Row = {}): Row => ({ columnName, dataType, columnType: dataType, isNullable: "YES", extra: "", maxLength: null, defaultValue: null, collation: null, ...options });
  const text = (name: string, length: number, required = false) => column(name, "varchar", { columnType: `varchar(${length})`, maxLength: length, collation: "utf8mb4_unicode_ci", isNullable: required ? "NO" : "YES" });
  const columns = [column("id", "int", { isNullable: "NO", extra: "auto_increment" }), column("workspaceId", "int"), column("actorUserId", "int"),
    text("auditId", 80, true), text("actorRole", 64), text("action", 80, true), text("resourceType", 64, true), text("resourceId", 128),
    column("status", "enum", { columnType: "enum('success','denied','failed')", isNullable: "NO", defaultValue: "success", collation: "utf8mb4_unicode_ci" }),
    column("riskLevel", "enum", { columnType: "enum('low','medium','high','critical')", isNullable: "NO", defaultValue: "medium", collation: "utf8mb4_unicode_ci" }),
    column("metadata", "json"), text("resourceName", 255), column("beforeSnapshot", "json"), column("afterSnapshot", "json"),
    column("createdAt", "timestamp", { isNullable: "NO", defaultValue: "CURRENT_TIMESTAMP", extra: "DEFAULT_GENERATED" })];
  const indexes: Row[] = [{ indexName: "PRIMARY", nonUnique: 0, sequence: 1, columnName: "id", prefixLength: null },
    { indexName: "uk_security_audit_id", nonUnique: 0, sequence: 1, columnName: "auditId", prefixLength: null },
    { indexName: "idx_workspace", nonUnique: 1, sequence: 1, columnName: "workspaceId", prefixLength: null }];
  return { columns, indexes, tables: [{ tableName: "security_audit_logs", engine: "InnoDB" }] as Row[] };
}
function harness() {
  const schema = fixture(); let saved: Row[] = [], affected: unknown = 1, insertError = false, readError = false;
  let afterInsert: (() => void) | null = null, projection: ((rows: Row[]) => unknown) | null = null;
  const business = { version: 1 };
  const execute = vi.fn(async (query: SQL) => {
    const { sql, params } = dialect.sqlToQuery(query);
    if (readError) throw new Error("SYNTHETIC PRIVATE driver error");
    if (sql.includes("information_schema.TABLES")) return [structuredClone(schema.tables), []];
    if (sql.includes("information_schema.COLUMNS")) return [structuredClone(schema.columns), []];
    if (sql.includes("information_schema.STATISTICS")) return [structuredClone(schema.indexes), []];
    if (sql.startsWith("SELECT")) {
      const found = structuredClone(saved.filter(row => row.auditId === params[0]));
      return projection ? projection(found) : [found, []];
    }
    if (!sql.startsWith("INSERT INTO security_audit_logs")) throw new Error("Unexpected SQL");
    if (saved.some(row => row.auditId === params[0])) throw new Error("Duplicate audit id");
    saved.push({ auditId: params[0], workspaceId: params[1], actorUserId: params[2], action: params[4], resourceType: params[5], resourceId: params[6], status: "success", riskLevel: "medium", metadataText: params[7] });
    afterInsert?.(); if (insertError) throw new Error("SYNTHETIC PRIVATE INSERT acknowledgement unknown");
    return [{ affectedRows: affected }, []];
  });
  async function transaction<T>(body: () => Promise<T>) {
    const old = structuredClone(saved), oldVersion = business.version;
    try { return await body(); } catch (error) { saved = old; business.version = oldVersion; throw error; }
  }
  return { ...schema, execute, business, transaction, journal: createOperationsBoardOperationJournal({ execute }, context),
    get: () => saved, set: (rows: Row[]) => { saved = rows; }, ack: (value: unknown) => { affected = value; },
    throwAfterInsert: () => { insertError = true; }, throwRead: () => { readError = true; },
    mutateAfterInsert: (callback: () => void) => { afterInsert = callback; }, project: (callback: (rows: Row[]) => unknown) => { projection = callback; },
    queries: () => execute.mock.calls.map(([query]) => dialect.sqlToQuery(query)) };
}

describe("operations board actual audit-schema admission", () => {
  it("accepts the actual nullable audit identities/JSON and DEFAULT_GENERATED timestamp", async () => {
    const h = harness(); await assertOperationsBoardOperationJournalSchema(h); expect(h.queries()).toHaveLength(3);
    expect(h.queries().every(query => query.sql.startsWith("SELECT") && query.sql.includes("information_schema.") && query.params[0] === "security_audit_logs")).toBe(true);
  });
  it("admits once per caller transaction instance, never globally", async () => {
    const h = harness(); await h.journal.assertSchema(); await h.journal.read(); await h.journal.read();
    expect(h.queries().filter(query => query.sql.includes("information_schema."))).toHaveLength(3);
    await createOperationsBoardOperationJournal(h, context).assertSchema(); expect(h.queries().filter(query => query.sql.includes("information_schema."))).toHaveLength(6);
  });
  it.each(["MyISAM", "MEMORY", "innodb"])("rejects engine %s before journal reads/writes", async engine => {
    const h = harness(); h.tables[0].engine = engine; await expect(h.journal.read()).rejects.toThrow("JOURNAL_SCHEMA_UNAVAILABLE");
    expect(h.queries().every(query => query.sql.includes("information_schema."))).toBe(true);
  });
  it.each(["id", "workspaceId", "actorUserId", "auditId", "actorRole", "action", "resourceType", "resourceId", "status", "riskLevel", "metadata"])("requires actual column %s", async name => {
    const h = harness(); h.columns.splice(h.columns.findIndex(row => row.columnName === name), 1);
    await expect(h.journal.assertSchema()).rejects.toThrow("JOURNAL_SCHEMA_UNAVAILABLE");
  });
  it.each([
    ["id", { extra: "" }], ["actorUserId", { columnType: "int unsigned" }], ["workspaceId", { dataType: "tinyint", columnType: "tinyint" }],
    ["auditId", { maxLength: 75, columnType: "varchar(75)" }], ["auditId", { isNullable: "YES" }], ["auditId", { maxLength: "80" }],
    ["actorRole", { maxLength: 63, columnType: "varchar(63)" }], ["action", { collation: "latin1_swedish_ci" }], ["resourceId", { extra: "STORED GENERATED" }],
    ["status", { columnType: "enum('success','failed')" }], ["riskLevel", { isNullable: "YES" }], ["metadata", { dataType: "text", columnType: "text" }],
    ["metadata", { extra: "VIRTUAL GENERATED" }], ["workspaceId", { defaultValue: undefined }], ["createdAt", { defaultValue: Number.NaN }],
  ] as const)("rejects incompatible %s column %#", async (name, patch) => {
    const h = harness(); Object.assign(h.columns.find(row => row.columnName === name)!, patch); await expect(h.journal.read()).rejects.toThrow("JOURNAL_SCHEMA_UNAVAILABLE");
  });
  it.each(["missing_table", "duplicate_columns", "additional_required"])("refuses incomplete schema: %s", async issue => {
    const h = harness();
    if (issue === "missing_table") h.tables.splice(0);
    if (issue === "duplicate_columns") h.columns.push(h.columns[0]);
    if (issue === "additional_required") h.columns.push({ ...h.columns[1], columnName: "requiredOther", isNullable: "NO" });
    await expect(h.journal.read()).rejects.toThrow("JOURNAL_SCHEMA_UNAVAILABLE");
  });
  it.each(["absent", "nonunique", "prefix", "composite", "extra_unique", "duplicate_sequence", "string_sequence", "string_nonunique", "case_duplicate"])("requires exact unprefixed unique auditId: %s", async kind => {
    const h = harness(), unique = h.indexes[1];
    if (kind === "absent") h.indexes.splice(1, 1);
    if (kind === "nonunique") unique.nonUnique = 1;
    if (kind === "prefix") unique.prefixLength = 76;
    if (kind === "composite") h.indexes.push({ ...unique, columnName: "workspaceId", sequence: 2 });
    if (kind === "extra_unique") h.indexes.push({ ...unique, indexName: "unique_role", columnName: "actorRole" });
    if (kind === "duplicate_sequence") h.indexes.push({ ...unique });
    if (kind === "string_sequence") unique.sequence = "1";
    if (kind === "string_nonunique") unique.nonUnique = "0";
    if (kind === "case_duplicate") h.indexes.push({ ...unique, indexName: "UK_SECURITY_AUDIT_ID" });
    await expect(h.journal.read()).rejects.toThrow("JOURNAL_SCHEMA_UNAVAILABLE");
  });
  it("does not expose driver errors or mistake catalog failure for an empty journal", async () => {
    const h = harness(); h.throwRead(); await expect(h.journal.read()).rejects.toThrow("OPERATIONS_BOARD_JOURNAL_STORAGE_UNKNOWN");
    try { await h.journal.read(); } catch (error) { expect(String(error)).not.toContain("SYNTHETIC PRIVATE"); }
  });
});

describe("board-only metadata UUID journal and permanent cancel fence", () => {
  it("uses a bounded 76-character key independent of scope/action, isolated by user/workspace", () => {
    const key = operationsBoardOperationAuditId(context.identity, context.operationId);
    expect(key).toMatch(/^board_final_[a-f0-9]{64}$/u); expect(key).toHaveLength(76);
    expect(operationsBoardOperationAuditId({ ...context.identity, userId: 4 }, context.operationId)).not.toBe(key);
    expect(operationsBoardOperationAuditId({ ...context.identity, workspaceId: 8 }, context.operationId)).not.toBe(key);
  });
  it("absent receipt stays unknown with no write or invented failure", async () => {
    const h = harness(); expect(await h.journal.read()).toEqual({ final: null }); expect(h.get()).toEqual([]);
    expect(h.queries().every(query => query.sql.startsWith("SELECT"))).toBe(true);
  });
  it.each(["initialize", "publishRevision", "saveNote"] as const)("persists/replays %s metadata with one INSERT and exact readback", async action => {
    const h = harness(), result = receipt(action); expect(await h.journal.finalize(result)).toEqual(result); expect(await h.journal.finalize(result)).toEqual(result);
    const inserts = h.queries().filter(query => query.sql.startsWith("INSERT")); expect(inserts).toHaveLength(1);
    expect(inserts[0].params[4]).toBe("ops.board.operation.final"); expect(inserts[0].params[5]).toBe("ops_board_operation");
    expect(JSON.parse(String(inserts[0].params[7]))).toEqual({ version: 1, kind: "final", receipt: result });
    expect(inserts[0].sql).not.toMatch(/beforeSnapshot|afterSnapshot|resourceName|note|capture|UPDATE|DELETE/iu);
    const lookup = h.queries().find(query => query.sql.includes("metadataText"))!;
    expect(lookup.sql).toContain("IF(OCTET_LENGTH(CAST(metadata AS CHAR CHARACTER SET utf8mb4))<=32768");
    expect(lookup.sql).toContain("WHERE auditId=? AND BINARY auditId=BINARY ? LIMIT 2 FOR UPDATE");
    expect(inserts[0].sql).not.toContain(context.scope.storeName);
  });
  it.each(["requestHash", "sourceHash", "stateVersion", "editionId", "editionVersion", "action"])("rejects changed %s for the same UUID", async field => {
    const h = harness(); await h.journal.finalize(receipt());
    const changed = { ...receipt(), [field]: field === "action" ? "publishRevision" : field.endsWith("Hash") ? "b".repeat(64) : 10 };
    await expect(h.journal.finalize(changed)).rejects.toThrow("OPERATION_CONTENT_CONFLICT");
  });
  it.each(["parentAsin", "noteVersion"])("binds note mutation %s to its original final", async field => {
    const h = harness(); await h.journal.finalize(receipt("saveNote"));
    await expect(h.journal.finalize({ ...receipt("saveNote"), [field]: field === "parentAsin" ? "SYNTHETIC-OTHER" : 4 })).rejects.toThrow("OPERATION_CONTENT_CONFLICT");
  });
  it.each(["storeName", "country"])("same actor UUID reused across %s collides and fails", async field => {
    const h = harness(); await h.journal.finalize(receipt());
    const other = createOperationsBoardOperationJournal(h, { ...context, scope: { ...context.scope, [field]: field === "country" ? "CA" : "SYNTHETIC other" } });
    await expect(other.read()).rejects.toThrow("JOURNAL_SCOPE_MISMATCH"); await expect(other.cancel()).rejects.toThrow("JOURNAL_SCOPE_MISMATCH");
  });
  it("different actor/workspace cannot discover this receipt", async () => {
    const h = harness(); await h.journal.finalize(receipt());
    expect(await createOperationsBoardOperationJournal(h, { ...context, identity: { ...context.identity, userId: 4 } }).read()).toEqual({ final: null });
    expect(await createOperationsBoardOperationJournal(h, { ...context, identity: { ...context.identity, workspaceId: 8 }, scope: { ...context.scope, workspaceId: 8 } }).read()).toEqual({ final: null });
  });
  it("current actor role is not frozen in replay, but caller must still authorize it", async () => {
    const h = harness(); await h.journal.finalize(receipt());
    expect((await createOperationsBoardOperationJournal(h, { ...context, actorRole: "ops_specialist" }).read()).final).toEqual(receipt());
  });
  it("cancel persists a body-free permanent fence; late successful writes must roll back", async () => {
    const h = harness(), canceled = await h.journal.cancel();
    expect(canceled).toMatchObject({ status: "cancelled", action: null, requestHash: null, editionId: null, reasonCode: "operation_cancelled" });
    await expect(h.transaction(async () => { h.business.version = 2; return h.journal.finalize(receipt()); })).rejects.toThrow("OPERATION_CANCELLED");
    expect(h.business.version).toBe(1); expect(await h.journal.cancel()).toEqual(canceled); expect(h.get()).toHaveLength(1);
  });
  it("cancel after commit returns the original successful receipt, never claims rollback", async () => {
    const h = harness(); await h.journal.finalize(receipt()); expect(await h.journal.cancel()).toEqual(receipt()); expect(h.get()).toHaveLength(1);
  });
  it("cancel/check use no deployment flag or policy shortcut and never invoke another connection", async () => {
    const h = harness(); await h.journal.cancel(); expect((await h.journal.read()).final?.status).toBe("cancelled");
    expect(h.queries().every(query => query.sql.startsWith("SELECT") || query.sql.startsWith("INSERT INTO security_audit_logs"))).toBe(true);
  });
  it.each(["auditId", "workspaceId", "actorUserId", "action", "resourceType", "resourceId", "status", "riskLevel"])("rejects malformed persistent audit identity %s", async name => {
    const h = harness(); await h.journal.finalize(receipt());
    h.project(rows => [rows.map(row => ({ ...row, [name]: "wrong" })), []]);
    await expect(h.journal.read()).rejects.toThrow("JOURNAL_SCOPE_MISMATCH");
  });
  it.each([null, "{", "x".repeat(32769)])("rejects null, malformed or over-budget metadata %#", async value => {
    const h = harness(); await h.journal.finalize(receipt()); h.get()[0].metadataText = value;
    await expect(h.journal.read()).rejects.toThrow("JOURNAL_PAYLOAD_INVALID");
  });
  it("rejects a stored unknown final or hidden body field", async () => {
    for (const patch of [{ capture: { raw: "SYNTHETIC PRIVATE" } }, { note: "SYNTHETIC PRIVATE" }, { status: "unknown" }]) {
      const h = harness(); await h.journal.finalize(receipt());
      h.get()[0].metadataText = JSON.stringify({ version: 1, kind: "final", receipt: { ...receipt(), ...patch } });
      await expect(h.journal.read()).rejects.toThrow("JOURNAL_PAYLOAD_INVALID");
    }
  });
  it("invalid, unknown and body-bearing final requests are rejected before any SQL", async () => {
    const unknown = { ...receipt(), status: "unknown", action: null, requestHash: null, stateVersion: null, editionId: null, editionVersion: null, sourceHash: null, reasonCode: "outcome_unknown_check_same_operation" };
    for (const value of [{ ...receipt(), capture: {} }, { ...receipt(), note: "SYNTHETIC PRIVATE" }, unknown, { ...receipt(), requestHash: null }]) {
      const h = harness(); await expect(h.journal.finalize(value as OperationsBoardEditionWriteResult)).rejects.toThrow("JOURNAL_PAYLOAD_INVALID"); expect(h.execute).not.toHaveBeenCalled();
    }
  });
  it("requires cancelled action=null, not a forged successful-action cancellation", async () => {
    const h = harness(), canceled = await h.journal.cancel();
    await expect(h.journal.finalize({ ...canceled, action: "initialize" })).rejects.toThrow("JOURNAL_PAYLOAD_INVALID");
  });
  it.each([0, 2, "1", undefined])("requires exact affectedRows 1, not %s", async value => {
    const h = harness(); h.ack(value); await expect(h.transaction(async () => { h.business.version++; return h.journal.finalize(receipt()); })).rejects.toThrow("JOURNAL_WRITE_UNCONFIRMED");
    expect(h.get()).toHaveLength(0); expect(h.business.version).toBe(1);
  });
  it("mismatched readback rolls back the final receipt and preceding business mutation", async () => {
    const h = harness(); h.mutateAfterInsert(() => { const value = JSON.parse(String(h.get()[0].metadataText)); value.receipt.sourceHash = "b".repeat(64); h.get()[0].metadataText = JSON.stringify(value); });
    await expect(h.transaction(async () => { h.business.version++; return h.journal.finalize(receipt()); })).rejects.toThrow("JOURNAL_READBACK_MISMATCH");
    expect(h.get()).toEqual([]); expect(h.business.version).toBe(1);
  });
  it("unknown INSERT acknowledgement is not retried and subsequent check may recover an existing final", async () => {
    const h = harness(); h.throwAfterInsert(); await expect(h.journal.finalize(receipt())).rejects.toThrow("JOURNAL_STORAGE_UNKNOWN");
    expect((await h.journal.read()).final).toEqual(receipt()); expect(await h.journal.finalize(receipt())).toEqual(receipt());
    expect(h.queries().filter(query => query.sql.startsWith("INSERT"))).toHaveLength(1);
  });
  it.each(["duplicate", "wrong_shape"])("rejects incomplete lookup response %s instead of reporting no final", async issue => {
    const h = harness(); await h.journal.finalize(receipt()); h.project(rows => issue === "duplicate" ? [[...rows, ...rows], []] : [null, []]);
    await expect(h.journal.read()).rejects.toThrow("JOURNAL_READ_INVALID");
  });
  it("does not execute getters or permit opaque extra metadata", async () => {
    const h = harness(), getter = vi.fn(() => hash), value = { ...receipt() }; Object.defineProperty(value, "requestHash", { get: getter });
    await expect(h.journal.finalize(value)).rejects.toThrow("JOURNAL_PAYLOAD_INVALID"); expect(getter).not.toHaveBeenCalled(); expect(h.execute).not.toHaveBeenCalled();
  });
  it.each(["uppercase_uuid", "wrong_workspace", "country_alias", "blank_role"])("rejects invalid constructor binding %s", kind => {
    const h = harness(), value = structuredClone(context);
    if (kind === "uppercase_uuid") value.operationId = value.operationId.toUpperCase();
    if (kind === "wrong_workspace") value.scope.workspaceId = 8;
    if (kind === "country_alias") value.scope.country = "美国";
    if (kind === "blank_role") value.actorRole = " ";
    expect(() => createOperationsBoardOperationJournal(h, value)).toThrow("JOURNAL_PAYLOAD_INVALID"); expect(h.execute).not.toHaveBeenCalled();
  });
});
