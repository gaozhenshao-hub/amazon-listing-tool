import "../../../shared/operationsCostSheetWrite.test";
import { describe, expect, it, vi } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import type { SQL } from "drizzle-orm";
import { costSheetOperationAuditId, createCostSheetOperationJournal } from "./costSheetOperationJournal";
import { operationsCostSheetOperationRequestHash, type OperationsCostSheetWriteResult } from "../../../shared/operationsCostSheetWrite";

const identity = { userId: 3, workspaceId: 7 }, scope = { workspaceId: 7, parentAsin: "PARENT", storeName: "Exact Store", country: "US" }, operationId = "11111111-1111-4111-8111-111111111111", hash = "a".repeat(64);
const receipt = (patch: Partial<OperationsCostSheetWriteResult> = {}): OperationsCostSheetWriteResult => ({ identity, scope, operationId, status: "committed", version: 8, snapshotKey: hash, reasonCode: null, ...patch });
function fixture() {
  const rows: Record<string, unknown>[] = [], calls: { sql: string; params: unknown[] }[] = [];
  const execute = vi.fn(async (statement: SQL): Promise<unknown> => {
    const query = new MySqlDialect().sqlToQuery(statement); calls.push(query);
    if (query.sql.startsWith("SELECT")) return [rows.filter(row => query.params.includes(row.auditId)), []];
    const [auditId, workspaceId, actorUserId, actorRole, resourceId, metadataText] = query.params;
    if (rows.some(row => row.auditId === auditId)) throw new Error("duplicate auditId");
    rows.push({ auditId, workspaceId, actorUserId, actorRole, resourceId, metadataText, action: "ops_cost.final", resourceType: "ops_cost_operation", status: "success" });
    return [{ affectedRows: 1 }, []];
  });
  const journal = createCostSheetOperationJournal({ execute }, { ...identity, scope, operationId, actorRole: "operator" });
  return { rows, calls, execute, journal };
}
describe("independent immutable cost operation journal", () => {
  it("uses its own bounded resource namespace and actor/workspace UUID identity", () => {
    const audit = costSheetOperationAuditId(identity, operationId); expect(audit).toMatch(/^cost_final_[a-f0-9]{64}$/u); expect(audit.length).toBe(75);
    expect(costSheetOperationAuditId({ ...identity, userId: 4 }, operationId)).not.toBe(audit); expect(costSheetOperationAuditId({ ...identity, workspaceId: 8 }, operationId)).not.toBe(audit);
    expect(costSheetOperationAuditId(identity, operationId.toUpperCase())).toBe(audit);
  });
  it("absence is not a failed, cancelled or committed outcome", async () => expect(await fixture().journal.read()).toEqual({ final: null }));
  it("inserts once, same final replays and carries no cost payload", async () => {
    const f = fixture(); expect(await f.journal.finalize(receipt(), hash)).toEqual(receipt()); expect(await f.journal.finalize(receipt(), hash)).toEqual(receipt()); expect(f.rows).toHaveLength(1);
    expect(JSON.stringify(f.rows)).not.toContain("productCost"); expect(f.calls.filter(call => call.sql.startsWith("SELECT")).every(call => call.sql.includes("LIMIT 2 FOR UPDATE") && call.sql.includes("32768"))).toBe(true);
  });
  it("same UUID with altered content or resulting version cannot overwrite receipt", async () => {
    const f = fixture(); await f.journal.finalize(receipt(), hash);
    await expect(f.journal.finalize(receipt(), "b".repeat(64))).rejects.toThrow("CONTENT_CONFLICT"); await expect(f.journal.finalize(receipt({ version: 9 }), hash)).rejects.toThrow("CONTENT_CONFLICT"); expect(f.rows).toHaveLength(1);
  });
  it("cancel before late save is a durable fence, not permission to reuse UUID", async () => {
    const f = fixture(); expect(await f.journal.cancel()).toMatchObject({ status: "cancelled", version: null, snapshotKey: null, scope });
    await expect(f.journal.finalize(receipt(), hash)).rejects.toThrow("CANCELLED"); expect((await f.journal.cancel()).status).toBe("cancelled"); expect(f.rows).toHaveLength(1);
  });
  it("cancel cannot overwrite an already committed operation", async () => { const f = fixture(); await f.journal.finalize(receipt(), hash); expect(await f.journal.cancel()).toEqual(receipt()); });
  it("same actor/workspace UUID cannot move across exact store/parent/country", async () => {
    const f = fixture(); await f.journal.finalize(receipt(), hash);
    for (const changed of [{ ...scope, storeName: "Other" }, { ...scope, parentAsin: "Other" }, { ...scope, country: "CA" }]) await expect(createCostSheetOperationJournal({ execute: f.execute }, { ...identity, scope: changed, operationId, actorRole: "operator" }).read()).rejects.toThrow("SCOPE_MISMATCH");
  });
  it.each(["actor", "workspace", "resourceId", "resourceType", "action", "status", "scope", "malformed", "oversize", "duplicate"])("rejects forged persisted %s", async field => {
    const f = fixture(); await f.journal.finalize(receipt(), hash);
    if (field === "actor") f.rows[0].actorUserId = 4;
    if (field === "workspace") f.rows[0].workspaceId = 8;
    if (["resourceId", "resourceType", "action", "status"].includes(field)) f.rows[0][field] = "wrong";
    if (field === "scope") { const value = JSON.parse(f.rows[0].metadataText as string); value.receipt.scope.country = "CA"; f.rows[0].metadataText = JSON.stringify(value); }
    if (field === "malformed") f.rows[0].metadataText = "{";
    if (field === "oversize") f.rows[0].metadataText = " ".repeat(32769);
    if (field === "duplicate") f.rows.push({ ...f.rows[0] });
    await expect(f.journal.read()).rejects.toThrow();
  });
  it("refuses unknown and unhashed committed receipts", async () => {
    const f = fixture(); await expect(f.journal.finalize(receipt({ status: "unknown", version: null, snapshotKey: null, reasonCode: "commit_unknown" }), hash)).rejects.toThrow(); await expect(f.journal.finalize(receipt(), null)).rejects.toThrow(); expect(f.rows).toEqual([]);
  });
  it("never guesses success on uncertain write acknowledgement or missing readback", async () => {
    const journal = createCostSheetOperationJournal({ execute: async statement => new MySqlDialect().sqlToQuery(statement).sql.startsWith("SELECT") ? [[], []] : [{ affectedRows: 0 }, []] }, { ...identity, scope, operationId, actorRole: "operator" });
    await expect(journal.finalize(receipt(), hash)).rejects.toThrow("WRITE_UNCONFIRMED");
    const lost = createCostSheetOperationJournal({ execute: async statement => new MySqlDialect().sqlToQuery(statement).sql.startsWith("SELECT") ? [[], []] : [{ affectedRows: 1 }, []] }, { ...identity, scope, operationId, actorRole: "operator" });
    await expect(lost.finalize(receipt(), hash)).rejects.toThrow("READBACK_MISMATCH");
  });
  it("request hash includes full payload without storing it in final metadata", () => {
    const command = { expectedWorkspaceId: 7, parentAsin: scope.parentAsin, storeName: scope.storeName, country: scope.country, operationId, expectedVersion: 7, expectedSnapshotKey: hash, payload: { settings: { cnyPerCurrency: null, freightRate: 9, standardGoodsConfirmed: false }, rows: [] } };
    expect(operationsCostSheetOperationRequestHash(command)).not.toBe(operationsCostSheetOperationRequestHash({ ...command, payload: { ...command.payload, settings: { ...command.payload.settings, freightRate: 10 } } }));
  });
});
