import "../../../shared/inventoryPlanningWrite.test";
import { describe, expect, it, vi } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import type { SQL } from "drizzle-orm";
import { createInventoryPlanningOperationJournal, inventoryPlanningOperationAuditId } from "./inventoryPlanningOperationJournal";
import type { InventoryPlanningWriteResult } from "../../../shared/inventoryPlanningWrite";

const identity = { userId: 7, workspaceId: 11 }, scope = { scopeType: "asin" as const, asin: "B012345678", storeName: "Exact Store", country: "US" }, operationId = "11111111-1111-4111-8111-111111111111", hash = "a".repeat(64);
const context = { ...identity, scope, asOfDate: "2026-10-18", marketplace: "ALL", operationId, actorRole: "admin" };
const receipt = (patch: Partial<InventoryPlanningWriteResult> = {}): InventoryPlanningWriteResult => ({ identity, scope, asOfDate: context.asOfDate, marketplace: context.marketplace, operationId, action: "saveParameters", status: "committed", recordId: 8, snapshotKey: hash, reasonCode: null, ...patch });
function fixture() {
  const rows: Record<string, unknown>[] = [], calls: { sql: string; params: unknown[] }[] = [];
  const execute = vi.fn(async (statement: SQL): Promise<unknown> => {
    const query = new MySqlDialect().sqlToQuery(statement); calls.push(query);
    if (query.sql.startsWith("SELECT")) return [rows.filter(row => query.params.includes(row.auditId)), []];
    const [auditId, workspaceId, actorUserId, actorRole, resourceId, metadataText] = query.params;
    if (rows.some(row => row.auditId === auditId)) throw new Error("duplicate auditId");
    rows.push({ auditId, workspaceId, actorUserId, actorRole, resourceId, metadataText, action: "ops_inventory_planning.final", resourceType: "ops_inventory_planning_operation", status: "success" });
    return [{ affectedRows: 1 }, []];
  });
  return { rows, calls, execute, journal: createInventoryPlanningOperationJournal({ execute }, context) };
}
describe("durable independent per-user inventory planning journal", () => {
  it("uses bounded own namespace and fixed actor/workspace/UUID, not scope-derived audit keys", () => {
    const key = inventoryPlanningOperationAuditId(identity, operationId); expect(key).toMatch(/^planning_final_[a-f0-9]{64}$/u); expect(key.length).toBe(79);
    expect(inventoryPlanningOperationAuditId({ ...identity, userId: 8 }, operationId)).not.toBe(key); expect(inventoryPlanningOperationAuditId({ ...identity, workspaceId: 12 }, operationId)).not.toBe(key);
    expect(inventoryPlanningOperationAuditId(identity, operationId.toUpperCase())).toBe(key);
  });
  it("absence cannot prove not committed", async () => expect(await fixture().journal.read()).toEqual({ final: null }));
  it("final receipt and request hash replay once without source or private field payload", async () => {
    const f = fixture(); expect(await f.journal.finalize(receipt(), hash)).toEqual(receipt()); expect(await f.journal.finalize(receipt(), hash)).toEqual(receipt()); expect(f.rows).toHaveLength(1);
    expect(JSON.stringify(f.rows)).not.toContain("productCost"); expect(f.calls.filter(call => call.sql.startsWith("SELECT")).every(call => call.sql.includes("LIMIT 2 FOR UPDATE") && call.sql.includes("32768"))).toBe(true);
  });
  it.each(["hash", "record", "action", "snapshot"])("rejects same UUID altered %s", async field => {
    const f = fixture(); await f.journal.finalize(receipt(), hash); const changed = receipt();
    if (field === "record") changed.recordId = 9;
    if (field === "action") changed.action = "confirmLocal";
    if (field === "snapshot") changed.snapshotKey = "b".repeat(64);
    await expect(f.journal.finalize(changed, field === "hash" ? "c".repeat(64) : hash)).rejects.toThrow("CONTENT_CONFLICT"); expect(f.rows).toHaveLength(1);
  });
  it("cancel is a permanent tombstone and cannot later be reused", async () => {
    const f = fixture(); expect(await f.journal.cancel()).toMatchObject({ status: "cancelled", action: null, recordId: null, snapshotKey: null });
    await expect(f.journal.finalize(receipt(), hash)).rejects.toThrow("CANCELLED"); expect((await f.journal.cancel()).status).toBe("cancelled"); expect(f.rows).toHaveLength(1);
  });
  it("cancel after commit returns original commit, not a rollback claim", async () => { const f = fixture(); await f.journal.finalize(receipt(), hash); expect(await f.journal.cancel()).toEqual(receipt()); });
  it.each([{ scope: { ...scope, storeName: "Other" } }, { scope: { ...scope, country: "美国" } }, { scope: { ...scope, asin: "OTHER" } }, { asOfDate: "2026-10-17" }, { marketplace: "US" }])("same operation cannot move exact scope/source cutoff", async patch => {
    const f = fixture(); await f.journal.finalize(receipt(), hash); await expect(createInventoryPlanningOperationJournal({ execute: f.execute }, { ...context, ...patch }).read()).rejects.toThrow("SCOPE_MISMATCH");
  });
  it("canonical child parent metadata does not split the same operation", async () => {
    const f = fixture(); await f.journal.finalize(receipt({ scope: { ...scope, parentAsin: "PARENT" } }), hash); expect((await createInventoryPlanningOperationJournal({ execute: f.execute }, { ...context, scope: { ...scope, parentAsin: "OTHER" } }).read()).final?.receipt.scope).toEqual(scope);
  });
  it.each(["actor", "workspace", "resourceId", "resourceType", "action", "status", "scope", "malformed", "oversize", "duplicate"])("rejects forged persisted %s", async field => {
    const f = fixture(); await f.journal.finalize(receipt(), hash);
    if (field === "actor") f.rows[0].actorUserId = 8;
    if (field === "workspace") f.rows[0].workspaceId = 12;
    if (["resourceId", "resourceType", "action", "status"].includes(field)) f.rows[0][field] = "wrong";
    if (field === "scope") { const value = JSON.parse(f.rows[0].metadataText as string); value.receipt.scope.country = "CA"; f.rows[0].metadataText = JSON.stringify(value); }
    if (field === "malformed") f.rows[0].metadataText = "{";
    if (field === "oversize") f.rows[0].metadataText = " ".repeat(32769);
    if (field === "duplicate") f.rows.push({ ...f.rows[0] });
    await expect(f.journal.read()).rejects.toThrow();
  });
  it("refuses unknown and unhashed committed outcomes as durable final", async () => {
    const f = fixture(); await expect(f.journal.finalize(receipt({ status: "unknown", action: null, recordId: null, snapshotKey: null, reasonCode: "commit_unknown" }), hash)).rejects.toThrow(); await expect(f.journal.finalize(receipt(), null)).rejects.toThrow(); expect(f.rows).toEqual([]);
  });
  it.each([0, 1])("does not guess success after uncertain affectedRows/readback %s", async affectedRows => {
    const journal = createInventoryPlanningOperationJournal({ execute: async statement => new MySqlDialect().sqlToQuery(statement).sql.startsWith("SELECT") ? [[], []] : [{ affectedRows }, []] }, context);
    await expect(journal.finalize(receipt(), hash)).rejects.toThrow(affectedRows === 0 ? "WRITE_UNCONFIRMED" : "READBACK_MISMATCH");
  });
});
