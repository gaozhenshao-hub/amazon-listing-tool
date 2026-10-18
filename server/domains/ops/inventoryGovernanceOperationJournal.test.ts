import "../../../shared/inventoryGovernanceWrite.test";
import { describe, expect, it, vi } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import type { SQL } from "drizzle-orm";
import { createInventoryGovernanceOperationJournal, inventoryGovernanceOperationAuditId } from "./inventoryGovernanceOperationJournal";
import type { InventoryGovernanceWriteResult } from "../../../shared/inventoryGovernanceWrite";

const identity = { userId: 3, workspaceId: 7 }, subject = { kind: "owners" as const }, operationId = "11111111-1111-4111-8111-111111111111", hash = "a".repeat(64);
const scope = { ...identity, subject, operationId, actorRole: "ops_manager" };
const receipt = (): InventoryGovernanceWriteResult => ({ identity, subject, operationId, action: "assign", status: "committed", snapshotKey: hash, recordIds: [1], counts: { created: 1, replaced: 0, reactivated: 0, unchanged: 0, revoked: 0, restored: 0 }, reasonCode: null });
function harness() {
  let saved: Record<string, unknown>[] = [];
  const execute = vi.fn(async (query: SQL) => {
    const { sql, params } = new MySqlDialect().sqlToQuery(query);
    if (sql.startsWith("SELECT")) return [saved, []];
    saved = [{ auditId: params[0], workspaceId: params[1], actorUserId: params[2], action: "ops_inventory_governance.final", resourceType: "ops_inventory_governance_operation", resourceId: params[4], status: "success", metadataText: params[5] }];
    return [{ affectedRows: 1 }, []];
  });
  return { execute, journal: createInventoryGovernanceOperationJournal({ execute }, scope), get: () => saved, set: (value: Record<string, unknown>[]) => { saved = value; } };
}
describe("durable governance UUID journal", () => {
  it("keeps unique audit namespace within native varchar80", () => { expect(inventoryGovernanceOperationAuditId(identity, operationId)).toHaveLength(74); expect(inventoryGovernanceOperationAuditId({ ...identity, userId: 4 }, operationId)).not.toBe(inventoryGovernanceOperationAuditId(identity, operationId)); });
  it("absent durable receipt remains unknown to caller", async () => { expect(await harness().journal.read()).toEqual({ final: null }); });
  it("commits and replays exact metadata with one INSERT", async () => { const h = harness(); expect(await h.journal.finalize(receipt(), hash)).toEqual(receipt()); expect(await h.journal.finalize(receipt(), hash)).toEqual(receipt()); expect(h.execute.mock.calls.filter(([query]) => new MySqlDialect().sqlToQuery(query).sql.startsWith("INSERT"))).toHaveLength(1); });
  it("same UUID different content cannot replace final", async () => { const h = harness(); await h.journal.finalize(receipt(), hash); await expect(h.journal.finalize(receipt(), "b".repeat(64))).rejects.toThrow("CONTENT_CONFLICT"); });
  it("cancellation is a permanent fence", async () => { const h = harness(); expect((await h.journal.cancel()).status).toBe("cancelled"); await expect(h.journal.finalize(receipt(), hash)).rejects.toThrow("CANCELLED"); expect((await h.journal.cancel()).status).toBe("cancelled"); });
  it("cancel after committed returns existing commit", async () => { const h = harness(); await h.journal.finalize(receipt(), hash); expect(await h.journal.cancel()).toEqual(receipt()); });
  it("same UUID cannot cross owner/lifecycle subjects", async () => { const h = harness(); await h.journal.finalize(receipt(), hash); const other = createInventoryGovernanceOperationJournal(h, { ...scope, subject: { kind: "lifecycle", scope: { asin: "B1", storeName: "Store", country: "US" } } }); await expect(other.read()).rejects.toThrow("SCOPE_MISMATCH"); });
  it.each(["workspaceId", "actorUserId", "action", "resourceType", "resourceId", "status"])("rejects corrupt persisted %s", async key => { const h = harness(); await h.journal.finalize(receipt(), hash); h.get()[0][key] = "wrong"; await expect(h.journal.read()).rejects.toThrow("SCOPE_MISMATCH"); });
  it("rejects oversized/invalid metadata and duplicate final", async () => { const h = harness(); await h.journal.finalize(receipt(), hash); h.get()[0].metadataText = " ".repeat(32769); await expect(h.journal.read()).rejects.toThrow(); h.set([h.get()[0], h.get()[0]]); await expect(h.journal.read()).rejects.toThrow("READ_INVALID"); });
});
