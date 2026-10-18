import { beforeEach, describe, expect, it, vi } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import type { SQL } from "drizzle-orm";
import { MONTHLY_FINANCIAL_METRICS, parseMonthlyFinancialBatch, type MonthlyFinancialBatchRecord } from "../../../shared/monthlyFinancialRead";
import { resolveOperationsBoardOwnership, unavailableOperationsBoardOwnership } from "./operationsBoardOwnership";
import type { MonthlyBoardMonthSelection, Row, Session } from "./monthlyBoardReadCore";

const scope = { storeName: "Exact Store", country: "US" }, parent = "B000000001";
const storedRow = (patch: Row = {}) => ({ ...Object.fromEntries(MONTHLY_FINANCIAL_METRICS.map(key => [key, 0])), yearMonth: "2026-09", parentAsin: parent, asin: "B000000002", sku: "SKU", title: "Original title", storeName: scope.storeName, site: "美国", operator: "External A", raw: { currency: "USD" }, ...patch });
function selection(rows = [storedRow()], patch: Partial<MonthlyFinancialBatchRecord> = {}, month = "2026-09"): MonthlyBoardMonthSelection {
  const record: MonthlyFinancialBatchRecord = { id: 11, workspaceId: 7, userId: 99, fileName: "synthetic.xlsx", fileHash: "a".repeat(64), status: "completed", totalRows: rows.length, skippedRows: 0,
    unallocatedRows: rows.filter(row => !row.parentAsin).length, months: [...new Set(rows.map(row => row.yearMonth))], payload: rows,
    createdAt: "2026-10-12 09:00:00.000000", confirmedAt: "2026-10-12 09:10:00.000000", fileReferenceKind: "storage", sourceRunId: null, ...patch };
  return { month, selection: { selected: parseMonthlyFinancialBatch(record), scannedBatchIds: [record.id], complete: true }, metadataVisibility: "full" };
}
const manual = (patch: Row = {}): Row => ({ id: 51, workspaceId: 7, parentAsin: parent, storeName: scope.storeName, country: "US", assigneeUserId: 3, isActive: 1, ...patch });
const mapping = (patch: Row = {}): Row => ({ id: 61, workspaceId: 7, externalName: "External A", sourceType: "all", systemUserId: 3, isConfirmed: 1, ...patch });
const member = (patch: Row = {}): Row => ({ id: 71, workspaceId: 7, userId: 3, membershipStatus: "active", actorId: 3, actorStatus: "active", defaultWorkspaceId: 7, displayName: "Display A", nameBytes: 9, nameCharacters: 9, ...patch });
let manuals: Row[], mapRows: Row[], memberRows: Row[], calls: { sql: string; params: unknown[] }[], override: Partial<Record<"manual" | "mapping" | "member", Row[]>>, failure: unknown;
const execute = vi.fn(async (statement: SQL) => {
  const query = new MySqlDialect().sqlToQuery(statement); calls.push(query); if (failure) throw failure;
  if (query.sql.includes("FROM ops_inventory_owner_assignments")) return [override.manual ?? manuals.filter(row => row.workspaceId === query.params[0] && row.storeName === query.params[1] && row.isActive === 1 && query.params.slice(2).includes(row.parentAsin)), []];
  if (query.sql.includes("FROM operator_name_mappings")) return [override.mapping ?? mapRows.filter(row => row.workspaceId === query.params[0] && row.isConfirmed === 1 && (query.sql.includes("IN ('saihu','all')") ? ["saihu", "all"] : ["all"]).includes(String(row.sourceType)) && query.params.slice(1).includes(row.externalName)), []];
  if (query.sql.includes("FROM workspace_memberships")) return [override.member ?? memberRows.filter(row => row.workspaceId === query.params[0] && query.params.slice(1).includes(row.userId)), []];
  throw new Error("Unexpected synthetic query");
});
const session = (manager = true): Session => ({ tx: { execute }, identity: { userId: 3, workspaceId: 7 }, manager });
beforeEach(() => { vi.clearAllMocks(); manuals = []; mapRows = [mapping()]; memberRows = [member()]; calls = []; override = {}; failure = null; });
describe("operations board current ownership metadata", () => {
  it("resolves confirmed numeric ownership without writes, emails or names-as-authority", async () => {
    const result = await resolveOperationsBoardOwnership(session(), scope, [selection()]);
    expect(result).toMatchObject({ version: 1, status: "ready", reasonCode: null, visibility: "full", operators: [{ userId: 3, displayName: "Display A" }], parents: [{ parentAsin: parent, operatorIds: [3], status: "resolved", basis: "confirmed_source_mapping", sourceMonth: "2026-09", reasonCode: null }], partners: { status: "not_configured" } });
    expect(calls).toHaveLength(3); expect(calls.every(query => query.sql.startsWith("SELECT ") && query.sql.endsWith("FOR SHARE"))).toBe(true);
    expect(calls.map(query => query.sql).join("\n")).not.toMatch(/\bemail\b|system_user_name|assignee_name|INSERT |UPDATE .* SET|CREATE |DELETE |SELECT \*/u);
    expect(calls[0].sql).toContain("BINARY store_name=BINARY ?"); expect(calls[1].sql).toContain("BINARY external_name IN");
  });
  it("uses latest visible month, retains all earlier rows, and does not mutate selections", async () => {
    const prior = selection([storedRow({ yearMonth: "2026-08", operator: "Older" })], { id: 10 }, "2026-08"), current = selection();
    mapRows.push(mapping({ id: 62, externalName: "Older", systemUserId: 4 }));
    const before = JSON.stringify([prior, current]); const result = await resolveOperationsBoardOwnership(session(), scope, [prior, current]);
    expect(result.parents[0]).toMatchObject({ operatorIds: [3], sourceMonth: "2026-09" });
    expect(calls.find(query => query.sql.includes("FROM operator_name_mappings"))?.params).toEqual([7, "External A"]); expect(JSON.stringify([prior, current])).toBe(before);
  });
  it("never falls back to a previous resolved month when the latest is unresolved", async () => {
    const prior = selection([storedRow({ yearMonth: "2026-08" })], { id: 10 }, "2026-08");
    const result = await resolveOperationsBoardOwnership(session(), scope, [prior, selection([storedRow({ operator: "Missing" })])]);
    expect(result.parents[0]).toMatchObject({ sourceMonth: "2026-09", status: "unresolved", operatorIds: [], reasonCode: "mapping_missing" });
  });
  it("manual rule overrides all current source names and has no source month", async () => {
    manuals = [manual()]; const result = await resolveOperationsBoardOwnership(session(), scope, [selection([storedRow({ operator: "Unmapped" })])]);
    expect(result.parents[0]).toMatchObject({ status: "resolved", basis: "manual", sourceMonth: null, operatorIds: [3] }); expect(calls.some(query => query.sql.includes("FROM operator_name_mappings"))).toBe(false);
  });
  it.each([null, "3", 0, -1])("invalid manual numeric ID %s blocks mapping fallback", async assigneeUserId => {
    manuals = [manual({ assigneeUserId })]; const result = await resolveOperationsBoardOwnership(session(), scope, [selection()]);
    expect(result.parents[0]).toMatchObject({ basis: "manual", status: "unresolved", reasonCode: "manual_assignment_invalid", operatorIds: [] }); expect(calls.some(query => query.sql.includes("FROM operator_name_mappings"))).toBe(false);
  });
  it("duplicate country aliases conflict; inactive manual records alone do not override", async () => {
    manuals = [manual(), manual({ id: 52, country: "美国" })];
    expect((await resolveOperationsBoardOwnership(session(), scope, [selection()])).parents[0]).toMatchObject({ status: "conflict", basis: "manual", reasonCode: "manual_assignment_conflict" });
    manuals = [manual({ isActive: 0, assigneeUserId: 4 })];
    expect((await resolveOperationsBoardOwnership(session(), scope, [selection()])).parents[0]).toMatchObject({ status: "resolved", basis: "confirmed_source_mapping", operatorIds: [3] });
  });
  it("other store/country/parent manual rules cannot replace the precise scope", async () => {
    manuals = [manual({ id: 51, storeName: "Other" }), manual({ id: 52, country: "CA", assigneeUserId: 4 }), manual({ id: 53, parentAsin: "OTHER", assigneeUserId: 4 })];
    expect((await resolveOperationsBoardOwnership(session(), scope, [selection()])).parents[0].basis).toBe("confirmed_source_mapping");
  });
  it("requires both trusted batch origin and API marker for saihu-specific mappings", async () => {
    mapRows = [mapping({ sourceType: "saihu" })];
    const api = storedRow({ raw: { currency: "USD", source: "sellfox_monthly_api" } });
    expect((await resolveOperationsBoardOwnership(session(), scope, [selection([api])])).parents[0].status).toBe("unresolved");
    expect((await resolveOperationsBoardOwnership(session(), scope, [selection([storedRow()], { fileReferenceKind: "saihu_sync_run", sourceRunId: 9 })])).parents[0].status).toBe("unresolved");
    expect((await resolveOperationsBoardOwnership(session(), scope, [selection([api], { fileReferenceKind: "saihu_sync_run", sourceRunId: 9 })])).parents[0].status).toBe("resolved");
  });
  it("same numeric saihu/all mapping is consistent; disagreement is conflict", async () => {
    const selected = selection([storedRow({ raw: { currency: "USD", source: "sellfox_monthly_api" } })], { fileReferenceKind: "saihu_sync_run", sourceRunId: 9 });
    mapRows = [mapping(), mapping({ id: 62, sourceType: "saihu" })]; expect((await resolveOperationsBoardOwnership(session(), scope, [selected])).parents[0].status).toBe("resolved");
    mapRows[1].systemUserId = 4; expect((await resolveOperationsBoardOwnership(session(), scope, [selected])).parents[0]).toMatchObject({ status: "conflict", reasonCode: "mapping_conflict", operatorIds: [] });
  });
  it.each(["External A/Missing", "", null])("partial or absent source name %s never resolves", async operator => {
    const result = await resolveOperationsBoardOwnership(session(), scope, [selection([storedRow({ operator })])]); expect(result.parents[0].status).toBe("unresolved"); expect(result.operators).toEqual([]);
  });
  it("every latest-month row must agree on the complete numeric owner set", async () => {
    mapRows.push(mapping({ id: 62, externalName: "B", systemUserId: 4 })); memberRows.push(member({ id: 72, userId: 4, actorId: 4, displayName: "B", nameBytes: 1, nameCharacters: 1 }));
    const rows = [storedRow({ operator: "External A/B" }), storedRow({ asin: "CHILD2", operator: "B、External A" })];
    expect((await resolveOperationsBoardOwnership(session(), scope, [selection(rows)])).parents[0].operatorIds).toEqual([3, 4]);
    rows[1].operator = "External A"; expect((await resolveOperationsBoardOwnership(session(), scope, [selection(rows)])).parents[0]).toMatchObject({ status: "conflict", reasonCode: "row_owners_conflict" });
  });
  it.each([{ actorStatus: "disabled" }, { membershipStatus: "invited" }, { defaultWorkspaceId: 8 }])("inactive/foreign current member %j blocks resolution", async patch => {
    manuals = [manual()]; memberRows = [member(patch)]; expect((await resolveOperationsBoardOwnership(session(), scope, [selection()])).parents[0]).toMatchObject({ basis: "manual", status: "unresolved", reasonCode: "owner_inactive" });
  });
  it("missing account or membership is unresolved, not an invented directory entry", async () => {
    memberRows = []; expect((await resolveOperationsBoardOwnership(session(), scope, [selection()])).parents[0].reasonCode).toBe("owner_inactive");
    memberRows = [member({ actorId: null, actorStatus: null, defaultWorkspaceId: null, displayName: null, nameBytes: null, nameCharacters: null })];
    expect((await resolveOperationsBoardOwnership(session(), scope, [selection()])).operators).toEqual([]);
  });
  it("ordinary user only exposes self even when a valid co-owner exists", async () => {
    mapRows.push(mapping({ id: 62, externalName: "PRIVATE OTHER", systemUserId: 4 })); memberRows.push(member({ id: 72, userId: 4, actorId: 4, displayName: "PRIVATE NAME", nameBytes: 12, nameCharacters: 12 }));
    const selected = selection([storedRow({ operator: "External A/PRIVATE OTHER" })]); selected.metadataVisibility = "scoped"; selected.authorizedRowRefs = [{ batchId: 11, rowIndex: 0 }];
    const result = await resolveOperationsBoardOwnership(session(false), scope, [selected]); expect(result.operators).toEqual([{ userId: 3, displayName: "Display A" }]); expect(result.parents[0].operatorIds).toEqual([3]); expect(JSON.stringify(result)).not.toMatch(/PRIVATE|"userId":4/u);
    memberRows[1].actorStatus = "disabled"; expect((await resolveOperationsBoardOwnership(session(false), scope, [selected])).parents[0].status).toBe("unresolved");
  });
  it("only considers authorized original rows, never hidden parent names or latest hidden months", async () => {
    const current = selection([storedRow({ operator: "SECRET" }), storedRow({ parentAsin: "HIDDEN", asin: "HIDDEN_CHILD", operator: "SECRET" })]); current.metadataVisibility = "scoped"; current.authorizedRowRefs = [];
    const prior = selection([storedRow({ yearMonth: "2026-08" })], { id: 10 }, "2026-08"); prior.metadataVisibility = "scoped"; prior.authorizedRowRefs = [{ batchId: 10, rowIndex: 0 }];
    const result = await resolveOperationsBoardOwnership(session(false), scope, [prior, current]); expect(result.parents).toHaveLength(1); expect(result.parents[0].sourceMonth).toBe("2026-08"); expect(JSON.stringify(calls)).not.toContain("SECRET");
  });
  it("does not turn ambiguous or unallocated rows into owner candidates", async () => {
    const selected = selection([storedRow({ raw: { currency: "USD", api: { parentAsinList: [parent, "OTHER"] } } }), storedRow({ parentAsin: "", asin: "", sku: "UNALLOCATED" })]);
    expect(selected.selection.selected!.rows[0].allocation).toBe("ambiguous");
    const result = await resolveOperationsBoardOwnership(session(), scope, [selected]); expect(result.parents).toEqual([]); expect(calls).toEqual([]);
  });
  it("bounds SQL display-name transfer and uses numeric fallback, never email", async () => {
    memberRows = [member({ displayName: null, nameBytes: null, nameCharacters: null })]; expect((await resolveOperationsBoardOwnership(session(), scope, [selection()])).operators[0].displayName).toBe("成员 #3");
    memberRows = [member({ displayName: null, nameBytes: 900, nameCharacters: 900 })]; expect((await resolveOperationsBoardOwnership(session(), scope, [selection()])).operators[0].displayName).toBe("成员 #3");
    expect(calls.find(query => query.sql.includes("FROM workspace_memberships"))?.sql).toContain("OCTET_LENGTH(u.name)<=800");
  });
  it.each(["manual", "mapping", "member"] as const)("refuses truncated %s candidate sets", async kind => {
    override[kind] = Array.from({ length: 1001 }, (_, index) => ({ ...(kind === "manual" ? manual() : kind === "mapping" ? mapping() : member()), id: index + 1 }));
    await expect(resolveOperationsBoardOwnership(session(), scope, [selection()])).rejects.toMatchObject({ message: "OWNER_REGISTRY_LIMIT" });
  });
  it.each(["manual", "mapping", "member"] as const)("refuses cross-workspace %s rows even when a driver returns them", async kind => {
    override[kind] = [{ ...(kind === "manual" ? manual() : kind === "mapping" ? mapping() : member()), workspaceId: 8 }];
    await expect(resolveOperationsBoardOwnership(session(), scope, [selection()])).rejects.toThrow();
  });
  it("refuses wrong source types and duplicate mapping row identities", async () => {
    override.mapping = [mapping({ sourceType: "lingxing" })]; await expect(resolveOperationsBoardOwnership(session(), scope, [selection()])).rejects.toMatchObject({ message: "OWNER_REGISTRY_INVALID" });
    override.mapping = [mapping(), mapping()]; await expect(resolveOperationsBoardOwnership(session(), scope, [selection()])).rejects.toThrow();
  });
  it.each([{ userId: "3" }, { actorId: "3" }, { membershipStatus: "inactive" }, { displayName: "cut", nameBytes: 9 }])("strictly validates membership/display wire %j", async patch => {
    override.member = [member(patch)]; await expect(resolveOperationsBoardOwnership(session(), scope, [selection()])).rejects.toMatchObject({ message: "OWNER_MEMBER_INVALID" });
  });
  it("duplicate active/disabled memberships are not guessed into one member", async () => {
    override.member = [member(), member({ id: 72, membershipStatus: "disabled" })]; await expect(resolveOperationsBoardOwnership(session(), scope, [selection()])).rejects.toMatchObject({ message: "OWNER_MEMBER_INVALID" });
  });
  it.each([{ code: "ER_NO_SUCH_TABLE" }, { cause: { errno: 1054 } }])("classifies only known registry absence %j for caller policy", async error => {
    failure = error; await expect(resolveOperationsBoardOwnership(session(), scope, [selection()])).rejects.toMatchObject({ message: "OWNER_REGISTRY_UNAVAILABLE" });
  });
  it("does not swallow arbitrary query or privilege failures", async () => {
    const error = new Error("synthetic failure"); failure = error; await expect(resolveOperationsBoardOwnership(session(), scope, [selection()])).rejects.toBe(error);
  });
  it.each([undefined, [{ batchId: 11, rowIndex: 9 }], [{ batchId: 11, rowIndex: 0 }, { batchId: 11, rowIndex: 0 }]])("rejects missing/forged ordinary authorized refs %j", async authorizedRowRefs => {
    const selected = selection(); selected.metadataVisibility = "scoped"; selected.authorizedRowRefs = authorizedRowRefs;
    await expect(resolveOperationsBoardOwnership(session(false), scope, [selected])).rejects.toMatchObject({ message: "OWNER_AUTHORIZATION_INVALID" }); expect(calls).toEqual([]);
  });
  it("rejects incomplete/foreign selections before touching registries", async () => {
    const selected = selection(); selected.selection.complete = false; await expect(resolveOperationsBoardOwnership(session(), scope, [selected])).rejects.toThrow();
    selected.selection.complete = true; selected.selection.selected!.batch.workspaceId = 8; await expect(resolveOperationsBoardOwnership(session(), scope, [selected])).rejects.toThrow(); expect(calls).toEqual([]);
  });
  it("chunks a complete 501-parent directory without truncation or unrelated member loading", async () => {
    const rows = Array.from({ length: 501 }, (_, index) => storedRow({ parentAsin: `P${index}`, asin: `C${index}` }));
    const result = await resolveOperationsBoardOwnership(session(), scope, [selection(rows)]); expect(result.parents).toHaveLength(501); expect(result.operators).toHaveLength(1);
    const queries = calls.filter(query => query.sql.includes("FROM ops_inventory_owner_assignments")); expect(queries).toHaveLength(2); expect(queries.map(query => query.params.length)).toEqual([502, 3]);
  });
  it("a legal multibyte display label is not truncated; oversized UTF16 labels use numeric ID", async () => {
    memberRows = [member({ displayName: "运营甲", nameBytes: 9, nameCharacters: 3 })];
    expect((await resolveOperationsBoardOwnership(session(), scope, [selection()])).operators[0].displayName).toBe("运营甲");
    memberRows = [member({ displayName: "😀".repeat(200), nameBytes: 800, nameCharacters: 200 })];
    expect((await resolveOperationsBoardOwnership(session(), scope, [selection()])).operators[0].displayName).toBe("成员 #3");
  });
  it("unavailable fallback keeps complete parent metadata and cannot bypass ordinary authorization", () => {
    const result = unavailableOperationsBoardOwnership(session(), scope, [selection()]);
    expect(result).toMatchObject({ status: "unavailable", reasonCode: "registry_unavailable", operators: [], parents: [{ parentAsin: parent, status: "unresolved", basis: "none", sourceMonth: null, reasonCode: "registry_unavailable" }] });
    expect(() => unavailableOperationsBoardOwnership(session(false), scope, [selection()])).toThrow("OWNER_FALLBACK_DENIED");
    const selected = selection(); selected.selection.complete = false;
    expect(() => unavailableOperationsBoardOwnership(session(), scope, [selected])).toThrow("OWNER_SOURCE_INVALID"); expect(calls).toEqual([]);
  });
});
