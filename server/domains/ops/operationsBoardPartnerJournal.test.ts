import { describe, expect, it, vi } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import type { SQL } from "drizzle-orm";
import type { OperationsBoardPartnersWriteResult } from "../../../shared/operationsBoardPartners";
import { operationsBoardOperationAuditId } from "./operationsBoardOperationJournal";
import { createOperationsBoardPartnerJournal, operationsBoardPartnerAuditId } from "./operationsBoardPartnerJournal";

type Row = Record<string, unknown>;
const context = { identity: { workspaceId: 7, userId: 3 }, operationId: "a0000000-0000-4000-8000-000000000001", actorRole: "admin" };
const receipt = (): OperationsBoardPartnersWriteResult => ({ identity: context.identity, operationId: context.operationId, status: "committed", requestHash: "a".repeat(64),
  pair: { id: 11, workspaceId: 7, firstUserId: 3, secondUserId: 4, isActive: true, version: 2, updatedBy: 3, updatedAt: "2026-10-18 12:00:00.000000" }, reasonCode: null });
function harness() {
  const column = (columnName: string, dataType: string, patch: Row = {}) => ({ columnName, dataType, columnType: dataType, isNullable: "YES", extra: "", maxLength: null, defaultValue: null, collation: null, ...patch });
  const text = (name: string, length: number, required = false) => column(name, "varchar", { columnType: `varchar(${length})`, maxLength: length, isNullable: required ? "NO" : "YES", collation: "utf8mb4_unicode_ci" });
  const columns = [column("id", "int", { isNullable: "NO", extra: "auto_increment" }), column("workspaceId", "int"), column("actorUserId", "int"),
    text("auditId", 76, true), text("actorRole", 64), text("action", 80, true), text("resourceType", 64, true), text("resourceId", 128), column("metadata", "json"),
    column("status", "enum", { columnType: "enum('success','denied','failed')", isNullable: "NO", defaultValue: "success", collation: "utf8mb4_unicode_ci" }),
    column("riskLevel", "enum", { columnType: "enum('low','medium','high','critical')", isNullable: "NO", defaultValue: "medium", collation: "utf8mb4_unicode_ci" })];
  const indexes = [{ indexName: "PRIMARY", nonUnique: 0, sequence: 1, columnName: "id", prefixLength: null }, { indexName: "audit_key", nonUnique: 0, sequence: 1, columnName: "auditId", prefixLength: null }];
  let saved: Row[] = [], projection: ((rows: Row[]) => unknown) | null = null, postInsert: (() => void) | null = null, affected: unknown = 1, throwInsert = false, throwRead = false;
  const business = { version: 1 };
  const execute = vi.fn(async (query: SQL) => {
    const { sql, params } = new MySqlDialect().sqlToQuery(query);
    if (throwRead) throw new Error("SYNTHETIC private driver failure");
    if (sql.includes("information_schema.TABLES")) return [[{ tableName: "security_audit_logs", engine: "InnoDB" }], []];
    if (sql.includes("information_schema.COLUMNS")) return [columns, []];
    if (sql.includes("information_schema.STATISTICS")) return [indexes, []];
    if (sql.startsWith("SELECT")) { const found = structuredClone(saved.filter(row => row.auditId === params[0])); return projection ? projection(found) : [found, []]; }
    if (!sql.startsWith("INSERT INTO security_audit_logs")) throw new Error("Unexpected fixture SQL");
    if (saved.some(row => row.auditId === params[0])) throw new Error("Duplicate synthetic UUID");
    saved.push({ auditId: params[0], workspaceId: params[1], actorUserId: params[2], action: params[4], resourceType: params[5], resourceId: params[6], status: "success", riskLevel: "medium", metadataText: params[7] });
    postInsert?.(); if (throwInsert) throw new Error("SYNTHETIC private insert error"); return [{ affectedRows: affected }, []];
  });
  async function transaction<T>(body: () => Promise<T>) { const before = structuredClone(saved), version = business.version; try { return await body(); } catch (error) { saved = before; business.version = version; throw error; } }
  return { execute, columns, indexes, business, transaction, journal: createOperationsBoardPartnerJournal({ execute }, context), get: () => saved,
    project: (fn: typeof projection) => { projection = fn; }, afterInsert: (fn: () => void) => { postInsert = fn; }, ack: (value: unknown) => { affected = value; },
    failInsert: () => { throwInsert = true; }, failRead: () => { throwRead = true; }, queries: () => execute.mock.calls.map(([query]) => new MySqlDialect().sqlToQuery(query)) };
}

describe("partner namespace and reused strict audit admission", () => {
  it("uses an independent 76-character key bound to actor/workspace, not pair/body", () => {
    const key = operationsBoardPartnerAuditId(context.identity, context.operationId);
    expect(key).toMatch(/^bpair_final_[a-f0-9]{64}$/u); expect(key).toHaveLength(76);
    expect(key).not.toBe(operationsBoardOperationAuditId(context.identity, context.operationId));
    expect(key).not.toBe(operationsBoardPartnerAuditId({ ...context.identity, userId: 4 }, context.operationId));
    expect(key).not.toBe(operationsBoardPartnerAuditId({ ...context.identity, workspaceId: 8 }, context.operationId));
  });
  it("reuses actual audit schema admission once per transaction instance", async () => {
    const h = harness(); await h.journal.assertSchema(); await h.journal.read(); await h.journal.read();
    expect(h.queries().filter(query => query.sql.includes("information_schema."))).toHaveLength(3);
    await createOperationsBoardPartnerJournal(h, context).read(); expect(h.queries().filter(query => query.sql.includes("information_schema."))).toHaveLength(6);
  });
  it.each(["short_key", "no_unique", "text_metadata", "extra_required"])("rejects incompatible audit schema %s", async type => {
    const h = harness();
    if (type === "short_key") Object.assign(h.columns.find(column => column.columnName === "auditId")!, { maxLength: 75, columnType: "varchar(75)" });
    if (type === "no_unique") h.indexes[1].nonUnique = 1;
    if (type === "text_metadata") Object.assign(h.columns.find(column => column.columnName === "metadata")!, { dataType: "text", columnType: "text" });
    if (type === "extra_required") h.columns.push({ ...h.columns[1], columnName: "requiredExtra", isNullable: "NO" });
    await expect(h.journal.read()).rejects.toThrow("JOURNAL_SCHEMA_UNAVAILABLE"); expect(h.get()).toEqual([]);
  });
  it("absence is not failure and does not write", async () => {
    const h = harness(); expect(await h.journal.read()).toEqual({ final: null }); expect(h.queries().every(query => query.sql.startsWith("SELECT"))).toBe(true);
  });
});

describe("strict metadata final receipt and cancel fence", () => {
  it("persists and replays the full pair receipt exactly once", async () => {
    const h = harness(); expect(await h.journal.finalize(receipt())).toEqual(receipt()); expect(await h.journal.finalize(receipt())).toEqual(receipt());
    const writes = h.queries().filter(query => query.sql.startsWith("INSERT")); expect(writes).toHaveLength(1);
    expect(writes[0].params.slice(4, 7)).toEqual(["ops.board.partner.final", "ops_board_partner", context.operationId]);
    expect(JSON.parse(String(writes[0].params[7]))).toEqual({ version: 1, kind: "final", receipt: receipt() });
    expect(writes[0].sql).not.toMatch(/beforeSnapshot|afterSnapshot|resourceName|DELETE|UPDATE/u);
    expect(h.queries().find(query => query.sql.includes("metadataText"))?.sql).toContain("IF(OCTET_LENGTH(CAST(metadata AS CHAR CHARACTER SET utf8mb4))<=32768");
  });
  it.each(["request", "pair", "version"])("rejects same UUID changed %s", async type => {
    const h = harness(); await h.journal.finalize(receipt()); const next = receipt();
    if (type === "request") next.requestHash = "b".repeat(64); else if (type === "pair") next.pair!.secondUserId = 5; else next.pair!.version = 3;
    await expect(h.journal.finalize(next)).rejects.toThrow("OPERATION_CONTENT_CONFLICT");
  });
  it("cancel before arrival persists a body-free fence and rolls back a late business write", async () => {
    const h = harness(), cancelled = await h.journal.cancel(); expect(cancelled).toMatchObject({ status: "cancelled", requestHash: null, pair: null });
    await expect(h.transaction(async () => { h.business.version++; return h.journal.finalize(receipt()); })).rejects.toThrow("OPERATION_CANCELLED");
    expect(h.business.version).toBe(1); expect(await h.journal.cancel()).toEqual(cancelled); expect(h.get()).toHaveLength(1);
  });
  it("cancel after commit returns committed and never claims the pair was rolled back", async () => {
    const h = harness(); await h.journal.finalize(receipt()); expect(await h.journal.cancel()).toEqual(receipt());
  });
  it("another actor/workspace sees absence, never the stored receipt", async () => {
    const h = harness(); await h.journal.finalize(receipt());
    for (const identity of [{ workspaceId: 7, userId: 4 }, { workspaceId: 8, userId: 3 }]) expect(await createOperationsBoardPartnerJournal(h, { ...context, identity }).read()).toEqual({ final: null });
  });
  it.each(["auditId", "workspaceId", "actorUserId", "action", "resourceType", "resourceId", "status", "riskLevel"])("rejects mismatched stored %s", async field => {
    const h = harness(); await h.journal.finalize(receipt()); h.project(rows => [rows.map(row => ({ ...row, [field]: "wrong" })), []]);
    await expect(h.journal.read()).rejects.toThrow("JOURNAL_SCOPE_MISMATCH");
  });
  it.each([null, "{", "a".repeat(32769)])("rejects malformed/oversize metadata %#", async metadataText => {
    const h = harness(); await h.journal.finalize(receipt()); h.get()[0].metadataText = metadataText; await expect(h.journal.read()).rejects.toThrow("JOURNAL_PAYLOAD_INVALID");
  });
  it.each([{ note: "SYNTHETIC private" }, { displayName: "SYNTHETIC name" }, { status: "unknown", pair: null, requestHash: null, reasonCode: "unknown" }])("rejects body or unknown final before SQL %j", async patch => {
    const h = harness(); await expect(h.journal.finalize({ ...receipt(), ...patch } as OperationsBoardPartnersWriteResult)).rejects.toThrow("JOURNAL_PAYLOAD_INVALID"); expect(h.execute).not.toHaveBeenCalled();
  });
  it("rejects receipt identity or operation mismatch before SQL", async () => {
    const h = harness(); await expect(h.journal.finalize({ ...receipt(), operationId: "a0000000-0000-4000-8000-000000000002" })).rejects.toThrow("JOURNAL_SCOPE_MISMATCH"); expect(h.execute).not.toHaveBeenCalled();
  });
  it.each([0, 2, "1"])("requires acknowledged one-row insertion %j", async affected => {
    const h = harness(); h.ack(affected); await expect(h.transaction(async () => { h.business.version++; return h.journal.finalize(receipt()); })).rejects.toThrow("JOURNAL_WRITE_UNCONFIRMED");
    expect(h.get()).toEqual([]); expect(h.business.version).toBe(1);
  });
  it("rolls back metadata and business state on inconsistent readback", async () => {
    const h = harness(); h.afterInsert(() => { const saved = JSON.parse(String(h.get()[0].metadataText)); saved.receipt.pair.version++; h.get()[0].metadataText = JSON.stringify(saved); });
    await expect(h.transaction(async () => { h.business.version++; return h.journal.finalize(receipt()); })).rejects.toThrow("JOURNAL_READBACK_MISMATCH");
    expect(h.get()).toEqual([]); expect(h.business.version).toBe(1);
  });
  it("does not leak driver errors or open transactions on failed storage", async () => {
    const h = harness(); h.failInsert(); await expect(h.transaction(() => h.journal.finalize(receipt()))).rejects.toThrow("OPERATIONS_BOARD_PARTNER_JOURNAL_STORAGE_UNKNOWN");
    h.failRead(); await expect(h.journal.read()).rejects.toThrow("OPERATIONS_BOARD_PARTNER_JOURNAL_STORAGE_UNKNOWN");
    expect(h.queries().some(query => /\b(?:BEGIN|COMMIT|ROLLBACK)\b/u.test(query.sql))).toBe(false);
  });
});
