import { describe, expect, it, vi } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import type { SQL } from "drizzle-orm";
import type { AssistantRuleConfirmationResult } from "../../../../shared/assistantRuleConfirmation";
import { assertAssistantRuleConfirmationJournalSchema, assistantRuleConfirmationAuditId, createAssistantRuleConfirmationJournal, type AssistantRuleConfirmationJournalScope } from "./assistantRuleConfirmationJournal";

const hash = "a".repeat(64), dialect = new MySqlDialect();
const scope: AssistantRuleConfirmationJournalScope = { workspaceId: 3, userId: 7, agentKey: "listing", threadId: "a0000000-0000-4000-8000-000000000001", operationId: "a0000000-0000-4000-8000-000000000002", confirmationId: "a0000000-0000-4000-8000-000000000003", actorRole: "admin" };
const receipt = (): AssistantRuleConfirmationResult => ({ identity: { workspaceId: 3, userId: 7, agentKey: "listing" }, threadId: scope.threadId, operationId: scope.operationId, confirmationId: scope.confirmationId, status: "committed", requestHash: hash, proposalHash: hash, configurationRevision: 2, configurationHash: hash, reasonCode: null });
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
  const indexes = [{ indexName: "PRIMARY", nonUnique: 0, sequence: 1, columnName: "id", prefixLength: null },
    { indexName: "uk_security_audit_id", nonUnique: 0, sequence: 1, columnName: "auditId", prefixLength: null },
    { indexName: "idx_workspace", nonUnique: 1, sequence: 1, columnName: "workspaceId", prefixLength: null }];
  return { columns, indexes, tables: [{ tableName: "security_audit_logs", engine: "InnoDB" }] as Row[] };
}
function harness() {
  const schema = fixture(); let saved: Row[] = [], affectedRows: unknown = 1, insertError: Error | null = null, afterInsert: (() => void) | null = null;
  const execute = vi.fn(async (query: SQL) => {
    const { sql, params } = dialect.sqlToQuery(query);
    if (sql.includes("information_schema.TABLES")) return [structuredClone(schema.tables), []];
    if (sql.includes("information_schema.COLUMNS")) return [structuredClone(schema.columns), []];
    if (sql.includes("information_schema.STATISTICS")) return [structuredClone(schema.indexes), []];
    if (sql.startsWith("SELECT")) return [structuredClone(saved), []];
    if (!sql.startsWith("INSERT INTO security_audit_logs")) throw new Error("Unexpected SQL");
    if (saved.length) throw new Error("Duplicate audit ID");
    saved = [{ auditId: params[0], workspaceId: params[1], actorUserId: params[2], action: params[4], resourceType: params[5], resourceId: params[6], status: "success", riskLevel: "medium", metadataText: params[7] }];
    afterInsert?.(); if (insertError) throw insertError;
    return [{ affectedRows }, []];
  });
  return { ...schema, execute, journal: createAssistantRuleConfirmationJournal({ execute }, scope),
    get: () => saved, set: (rows: Row[]) => { saved = rows; }, ack: (value: unknown) => { affectedRows = value; },
    throwAfterInsert: () => { insertError = new Error("private password and SQL"); }, mutateAfterInsert: (callback: () => void) => { afterInsert = callback; },
    queries: () => execute.mock.calls.map(([query]) => dialect.sqlToQuery(query)) };
}

describe("rule confirmation strict existing-audit schema admission", () => {
  it("admits the existing nullable identity schema and legal DEFAULT_GENERATED timestamp", async () => {
    const h = harness(); await assertAssistantRuleConfirmationJournalSchema(h); expect(h.queries()).toHaveLength(3);
    expect(h.queries().every(query => query.sql.startsWith("SELECT") && query.sql.includes("information_schema."))).toBe(true);
  });
  it("caches admission only inside one explicitly transaction-owned helper", async () => {
    const h = harness(); await h.journal.assertSchema(); await h.journal.read(); await h.journal.read();
    expect(h.queries().filter(query => query.sql.includes("information_schema.")).length).toBe(3);
    await createAssistantRuleConfirmationJournal(h, scope).assertSchema(); expect(h.queries().filter(query => query.sql.includes("information_schema.")).length).toBe(6);
  });
  it.each(["MyISAM", "MEMORY", "innodb"])("rejects engine %s without touching journal data", async engine => {
    const h = harness(); h.tables[0].engine = engine; await expect(h.journal.read()).rejects.toThrow("SCHEMA_UNAVAILABLE"); expect(h.queries().every(query => query.sql.includes("information_schema."))).toBe(true);
  });
  it.each(["id", "workspaceId", "actorUserId", "auditId", "actorRole", "action", "resourceType", "resourceId", "status", "riskLevel", "metadata"])("requires column %s", async name => {
    const h = harness(); h.columns.splice(h.columns.findIndex(row => row.columnName === name), 1); await expect(h.journal.assertSchema()).rejects.toThrow("SCHEMA_UNAVAILABLE");
  });
  it.each([
    ["id", { extra: "" }], ["workspaceId", { dataType: "tinyint", columnType: "tinyint" }], ["actorUserId", { columnType: "int unsigned" }],
    ["auditId", { columnType: "varchar(76)", maxLength: 76 }], ["auditId", { isNullable: "YES" }], ["actorRole", { extra: "STORED GENERATED" }],
    ["action", { collation: "latin1_swedish_ci" }], ["status", { columnType: "enum('success','failed')" }], ["riskLevel", { isNullable: "YES" }], ["metadata", { dataType: "text", columnType: "text" }],
  ] as const)("rejects unsafe schema %s %#", async (name, patch) => {
    const h = harness(); Object.assign(h.columns.find(row => row.columnName === name)!, patch); await expect(h.journal.read()).rejects.toThrow("SCHEMA_UNAVAILABLE");
  });
  it("rejects duplicate fields, missing table and additional required insert columns", async () => {
    const duplicate = harness(); duplicate.columns.push(duplicate.columns[0]); await expect(duplicate.journal.read()).rejects.toThrow("SCHEMA_UNAVAILABLE");
    const missing = harness(); missing.tables.splice(0); await expect(missing.journal.read()).rejects.toThrow("SCHEMA_UNAVAILABLE");
    const extra = harness(); extra.columns.push({ ...extra.columns[1], columnName: "requiredOther", isNullable: "NO" }); await expect(extra.journal.read()).rejects.toThrow("SCHEMA_UNAVAILABLE");
  });
  it.each(["absent", "nonunique", "prefix", "composite", "extra_unique", "duplicate_sequence"])("requires exact unique full auditId with no extra uniqueness: %s", async change => {
    const h = harness(), unique = h.indexes[1];
    if (change === "absent") h.indexes.splice(1, 1);
    if (change === "nonunique") unique.nonUnique = 1;
    if (change === "prefix") Object.assign(unique, { prefixLength: 76 });
    if (change === "composite") h.indexes.push({ ...unique, columnName: "workspaceId", sequence: 2 });
    if (change === "extra_unique") h.indexes.push({ ...unique, indexName: "uq_role", columnName: "actorRole" });
    if (change === "duplicate_sequence") h.indexes.push({ ...unique });
    await expect(h.journal.read()).rejects.toThrow("SCHEMA_UNAVAILABLE");
  });
});

describe("metadata-only durable rule confirmation UUID fence", () => {
  it("uses 77 ASCII characters and excludes target while separating workspace/actor", () => {
    const identity = { workspaceId: 3, userId: 7 }, value = assistantRuleConfirmationAuditId(identity, scope.confirmationId);
    expect(value).toMatch(/^asrule_final_[a-f0-9]{64}$/u); expect(value).toHaveLength(77);
    expect(assistantRuleConfirmationAuditId({ ...identity, userId: 8 }, scope.confirmationId)).not.toBe(value);
    expect(assistantRuleConfirmationAuditId({ ...identity, workspaceId: 4 }, scope.confirmationId)).not.toBe(value);
  });
  it("missing means unknown, never a persisted failure or implicit success", async () => { const h = harness(); expect(await h.journal.read()).toEqual({ final: null }); expect(h.queries().some(query => query.sql.startsWith("INSERT"))).toBe(false); });
  it("commits and replays exact receipt with one INSERT, no rules or conversation bodies", async () => {
    const h = harness(); expect(await h.journal.finalize(receipt())).toEqual(receipt()); expect(await h.journal.finalize(receipt())).toEqual(receipt());
    const inserts = h.queries().filter(query => query.sql.startsWith("INSERT")); expect(inserts).toHaveLength(1);
    expect(JSON.parse(String(inserts[0].params[7]))).toEqual({ version: 1, kind: "final", receipt: receipt() });
    expect(inserts[0].sql).not.toMatch(/beforeSnapshot|afterSnapshot|resourceName|reason|requestId|emperor_assistant|UPDATE|DELETE/iu);
    const lookup = h.queries().find(query => query.sql.includes("metadataText"))!;
    expect(lookup.sql).toContain("WHERE auditId=? AND BINARY auditId=BINARY ? LIMIT 2 FOR UPDATE");
    const expectedId = assistantRuleConfirmationAuditId({ workspaceId: scope.workspaceId, userId: scope.userId }, scope.confirmationId);
    expect(lookup.params).toEqual([expectedId, expectedId]);
  });
  it.each(["requestHash", "proposalHash", "configurationHash", "configurationRevision"])("refuses a different %s on the same confirmation UUID", async field => {
    const h = harness(); await h.journal.finalize(receipt()); await expect(h.journal.finalize({ ...receipt(), [field]: field === "configurationRevision" ? 3 : "b".repeat(64) })).rejects.toThrow("CONTENT_CONFLICT");
  });
  it("cancellation is permanent and canceling committed returns existing commit", async () => {
    const h = harness(); expect(await h.journal.cancel()).toMatchObject({ status: "canceled", requestHash: null, proposalHash: null, configurationRevision: null, configurationHash: null });
    await expect(h.journal.finalize(receipt())).rejects.toThrow("CONFIRMATION_CANCELED"); expect((await h.journal.cancel()).status).toBe("canceled");
    const done = harness(); await done.journal.finalize(receipt()); expect(await done.journal.cancel()).toEqual(receipt());
  });
  it.each(["threadId", "operationId", "agentKey"])("same confirmation UUID cannot be moved to another %s", async key => {
    const h = harness(); await h.journal.finalize(receipt());
    const changed = { ...scope, [key]: key === "agentKey" ? "images" : "a0000000-0000-4000-8000-000000000004" } as AssistantRuleConfirmationJournalScope;
    await expect(createAssistantRuleConfirmationJournal(h, changed).read()).rejects.toThrow("SCOPE_MISMATCH");
  });
  it("does not bind replay to a historical actor role, but still requires caller authorization", async () => {
    const h = harness(); await h.journal.finalize(receipt()); expect((await createAssistantRuleConfirmationJournal(h, { ...scope, actorRole: "ops_manager" }).read()).final).toEqual(receipt());
  });
  it.each(["auditId", "workspaceId", "actorUserId", "action", "resourceType", "resourceId", "status", "riskLevel"])("refuses altered audit projection %s", async name => {
    const h = harness(); await h.journal.finalize(receipt()); h.get()[0][name] = "wrong"; await expect(h.journal.read()).rejects.toThrow("SCOPE_MISMATCH");
  });
  it("rejects unknown or extra-body receipts before any SQL", async () => {
    for (const value of [{ ...receipt(), rules: ["PRIVATE_RULE"] }, { ...receipt(), status: "unknown", requestHash: null, proposalHash: null, configurationRevision: null, configurationHash: null, reasonCode: "CONFIRMATION_UNKNOWN" }, { ...receipt(), requestHash: null }]) {
      const h = harness(); await expect(h.journal.finalize(value as AssistantRuleConfirmationResult)).rejects.toThrow("PAYLOAD_INVALID"); expect(h.execute).not.toHaveBeenCalled();
    }
  });
  it("rejects duplicate records, oversized or malformed metadata and forged unknown finals", async () => {
    for (const value of [null, "{", "x".repeat(32769), JSON.stringify({ version: 1, kind: "final", receipt: { ...receipt(), status: "unknown" } })]) {
      const h = harness(); await h.journal.finalize(receipt()); h.get()[0].metadataText = value; await expect(h.journal.read()).rejects.toThrow("PAYLOAD_INVALID");
    }
    const h = harness(); await h.journal.finalize(receipt()); h.set([h.get()[0], h.get()[0]]); await expect(h.journal.read()).rejects.toThrow("READ_INVALID");
  });
  it.each([0, 2, "1", undefined])("does not accept affectedRows %s as a successful receipt", async value => { const h = harness(); h.ack(value); await expect(h.journal.finalize(receipt())).rejects.toThrow("WRITE_UNCONFIRMED"); });
  it("requires exact readback of the committed configuration metadata", async () => {
    const h = harness(); h.mutateAfterInsert(() => { const value = JSON.parse(String(h.get()[0].metadataText)); value.receipt.configurationHash = "b".repeat(64); h.get()[0].metadataText = JSON.stringify(value); });
    await expect(h.journal.finalize(receipt())).rejects.toThrow("READBACK_MISMATCH");
  });
  it("lost INSERT acknowledgement is unknown, and later check replays without another insert", async () => {
    const h = harness(); h.throwAfterInsert(); await expect(h.journal.finalize(receipt())).rejects.toThrow("JOURNAL_STORAGE_UNKNOWN");
    expect((await h.journal.read()).final).toEqual(receipt()); expect(await h.journal.finalize(receipt())).toEqual(receipt()); expect(h.queries().filter(query => query.sql.startsWith("INSERT"))).toHaveLength(1);
  });
  it("does not invoke getters or accept non-plain hidden private metadata", async () => {
    const h = harness(), getter = vi.fn(() => "PRIVATE_BODY"); const value = { ...receipt() }; Object.defineProperty(value, "requestHash", { get: getter });
    await expect(h.journal.finalize(value)).rejects.toThrow("PAYLOAD_INVALID"); expect(getter).not.toHaveBeenCalled(); expect(h.execute).not.toHaveBeenCalled();
  });
});
