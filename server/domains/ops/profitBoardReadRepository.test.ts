import { beforeEach, describe, expect, it, vi } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import type { SQL } from "drizzle-orm";
import type { TrpcContext } from "../../_core/context";
import type { DbExecutor } from "../../repositories/dbClient";
import { MONTHLY_FINANCIAL_METRICS } from "../../../shared/monthlyFinancialRead";
import { normalizeMarketplaceCode } from "../../../shared/marketplaceIdentity";
import { createProfitBoardReadRepository } from "./profitBoardReadRepository";

type Row = Record<string, unknown>;
const input = { expectedWorkspaceId: 7, month: "2026-09", storeName: "Exact Store", country: "US", search: "", groupOffset: 0, groupLimit: 10 };
const parent = "B000000001";
const context = (role = "ops_manager", patch: Row = {}) => ({ user: { id: 3, role, status: "active", defaultWorkspaceId: 7, name: "" }, workspaceId: 7, ...patch }) as TrpcContext;
const businessRow = (patch: Row = {}): Row => ({ ...Object.fromEntries(MONTHLY_FINANCIAL_METRICS.map(metric => [metric, 0])), yearMonth: input.month, parentAsin: parent, asin: "B000000002", sku: "SKU-original", title: "Original 产品名称", storeName: input.storeName, site: "美国站", operator: "Alice", financialProfit: 12, salesQty: 2, salesAmount: 40, raw: { currency: "USD", "1:产品/原始标题": "完整原文<script>alert(1)</script>" }, ...patch });
const batch = (patch: Row = {}, business: Row[] = [businessRow()]): Row => {
  const payload = JSON.stringify(business), months = JSON.stringify([...new Set(business.map(row => row.yearMonth))]);
  return { id: 11, workspaceId: 7, userId: 99, fileName: "PRIVATE-FILENAME.xlsx", fileHash: "a".repeat(64), status: "completed", totalRows: business.length, skippedRows: 4, unallocatedRows: business.filter(row => !row.parentAsin).length, months, monthsBytes: Buffer.byteLength(months), payload, payloadBytes: Buffer.byteLength(payload), createdAt: "2026-10-12 09:08:07.123000", confirmedAt: "2026-10-12 10:08:07.456000", fileReferenceKind: "storage", sourceRunId: null, ...patch };
};
const assignment = (patch: Row = {}): Row => ({ id: 51, workspaceId: 7, parentAsin: parent, storeName: input.storeName, country: "美国", assigneeUserId: 3, isActive: 1, ...patch });
const mapping = (patch: Row = {}): Row => ({ id: 61, workspaceId: 7, externalName: "Alice", sourceType: "all", systemUserId: 3, isConfirmed: 1, ...patch });
const member = (userId: number, patch: Row = {}): Row => ({ id: userId + 100, workspaceId: 7, userId, membershipStatus: "active", actorId: userId, actorStatus: "active", defaultWorkspaceId: 7, displayName: "Same Name", nameBytes: 9, nameCharacters: 9, ...patch });
let actors: Row[], batches: Row[], assignments: Row[], mappings: Row[], policies: Row[], overrides: Row[], members: Row[];
let failures: Record<string, unknown>, candidateOverride: Row[] | null, detailOverride: Row[] | null, assignmentOverride: Row[] | null, mappingOverride: Row[] | null;
let afterCandidates: (() => void) | null, queries: { sql: string; params: unknown[] }[], commits: number, rollbacks: number;
const execute = vi.fn(async (statement: SQL) => {
  const query = new MySqlDialect().sqlToQuery(statement); queries.push(query);
  for (const table of ["users", "ops_monthly_profit_imports", "ops_inventory_owner_assignments", "operator_name_mappings", "workspace_memberships", "security_access_policies", "role_permissions"]) if (query.sql.includes(`FROM ${table}`) && failures[table]) throw failures[table];
  if (query.sql.includes("FROM workspace_memberships")) return [members.filter(row => row.workspaceId === query.params[0] && query.params.slice(1).includes(row.userId)), []];
  if (query.sql.includes("FROM users")) return [actors, []];
  if (query.sql.includes("FROM security_access_policies")) return [policies, []];
  if (query.sql.includes("FROM role_permissions")) return [overrides, []];
  if (query.sql.includes("FROM ops_inventory_owner_assignments")) {
    const allCountries = query.sql.includes("ORDER BY id");
    return [assignmentOverride ?? assignments.filter(row => row.workspaceId === query.params[0] && row.storeName === query.params[1] && (allCountries || normalizeMarketplaceCode(String(row.country)) === query.params[2]) && row.isActive === 1 && query.params.slice(allCountries ? 2 : 3).includes(row.parentAsin)), []];
  }
  if (query.sql.includes("FROM operator_name_mappings")) return [mappingOverride ?? mappings.filter(row => row.workspaceId === query.params[0] && row.isConfirmed === 1 && (query.sql.includes("IN ('saihu','all')") ? ["saihu", "all"] : ["all"]).includes(String(row.sourceType)) && query.params.slice(1).includes(row.externalName)), []];
  if (query.sql.includes("FROM ops_monthly_profit_imports")) {
    if (query.sql.includes("LIMIT 201")) {
      const result = candidateOverride ?? batches.filter(row => row.workspaceId === query.params[0] && row.status === "completed").sort((a, b) => Number(b.id) - Number(a.id)).slice(0, 201).map(({ id, workspaceId, status, payloadBytes, monthsBytes }) => ({ id, workspaceId, status, payloadBytes, monthsBytes }));
      afterCandidates?.(); return [result, []];
    }
    return [detailOverride ?? batches.filter(row => row.workspaceId === query.params[0] && row.id === query.params[1]).slice(0, 2), []];
  }
  throw new Error(`Unexpected query ${query.sql}`);
});
const transaction = vi.fn(async <T>(body: (tx: { execute: typeof execute }) => Promise<T>) => { try { const result = await body({ execute }); commits++; return result; } catch (error) { rollbacks++; throw error; } });
// Keep generic callback/result correlation across vi.fn's unknown return.
async function transactionAdapter<T>(body: (tx: DbExecutor) => Promise<T>): Promise<T> {
  let result: Promise<T> | undefined;
  await transaction(tx => { result = body(tx); return result; });
  if (!result) throw new Error("Transaction mock did not execute its callback");
  return result;
}
const database = vi.fn(async () => ({ transaction: transactionAdapter }));
const repo = createProfitBoardReadRepository({ database });
function regular() { actors[0].role = "ops_specialist"; return context("ops_specialist"); }
describe("profit board current numeric-owner directory integration", () => {
  it("filters whole parents before paging, retains all historical siblings, and never uses duplicate display names as identity", async () => {
    batches = [batch({}, [
      businessRow({ operator: "Alice/Bob" }), businessRow({ asin: "CHILD-2", operator: "Alice/Bob" }),
      businessRow({ yearMonth: "2026-08", operator: "Former" }),
      businessRow({ parentAsin: "FOREIGN", asin: "CHILD-3", operator: "Alice", title: "NOT_SELECTED_PARENT" }),
    ])];
    mappings = [mapping(), mapping({ id: 62, externalName: "Bob", systemUserId: 4 })];
    const result = await repo.get(context(), { ...input, operatorId: 4, ...{ groupLimit: 1 } });
    expect(result.status).toBe("ready");
    expect(result.products.map(item => item.parentAsin)).toEqual([parent]);
    expect(result.pageRows).toHaveLength(3);
    expect(result.pageRows.every(row => row.parentAsin === parent)).toBe(true);
    expect(result.ownership?.operators).toEqual([{ userId: 3, displayName: "Same Name" }, { userId: 4, displayName: "Same Name" }]);
    expect(result.ownership?.parents.find(item => item.parentAsin === parent)).toMatchObject({ operatorIds: [3, 4], sourceMonth: "2026-09" });
    expect(queries.find(query => query.sql.includes("FROM workspace_memberships"))?.sql).toMatch(/FOR SHARE$/u);
    expect(queries.every(query => /^SELECT /u.test(query.sql))).toBe(true);
  });
  it("a live manual numeric owner takes precedence over historical and current operator names", async () => {
    assignments = [assignment({ assigneeUserId: 4 })]; mappings = [mapping()];
    const result = await repo.get(context(), { ...input, operatorId: 4 });
    expect(result.status).toBe("ready"); expect(result.products).toHaveLength(1);
    expect(result.ownership?.parents[0]).toMatchObject({ basis: "manual", sourceMonth: null, operatorIds: [4] });
    expect(queries.some(query => query.sql.includes("FROM operator_name_mappings"))).toBe(false);
  });
  it("ordinary callers can narrow only existing authorized rows and cannot select a co-owner or partner", async () => {
    batches = [batch({}, [businessRow({ operator: "Alice/Bob" })])];
    mappings = [mapping(), mapping({ id: 62, externalName: "Bob", systemUserId: 4 })];
    const own = await repo.get(regular(), { ...input, operatorId: 3 });
    expect(own.status).toBe("ready"); expect(own.products).toHaveLength(1);
    expect(own.ownership).toMatchObject({ visibility: "scoped", operators: [{ userId: 3, displayName: "Same Name" }], partners: { status: "not_configured" } });
    expect(own.ownership?.parents[0].operatorIds).toEqual([3]);
    const peer = await repo.get(context("ops_specialist"), { ...input, operatorId: 4 });
    expect(peer.status).toBe("invalid"); expect(peer.products).toEqual([]); expect(peer.pageRows).toEqual([]);
  });
  it.each(["ops_inventory_owner_assignments", "operator_name_mappings", "workspace_memberships"])("manager unfiltered legacy read survives an explicitly missing %s without inventing a directory", async table => {
    mappings = [mapping()]; failures[table] = { cause: { code: "ER_NO_SUCH_TABLE" } };
    const all = await repo.get(context(), input);
    expect(all.status).toBe("ready"); expect(all.products).toHaveLength(1);
    expect(all.ownership).toMatchObject({ status: "unavailable", reasonCode: "registry_unavailable", operators: [], parents: [{ parentAsin: parent, operatorIds: [], status: "unresolved", basis: "none", sourceMonth: null, reasonCode: "registry_unavailable" }] });
    await expect(repo.get(context(), { ...input, operatorId: 3 })).rejects.toMatchObject({ message: "PROFIT_BOARD_READ_OWNER_REGISTRY_UNAVAILABLE" });
  });
  it("does not turn unknown registry outages or invalid member records into successful all-owner fallback", async () => {
    mappings = [mapping()]; failures.workspace_memberships = { code: "ETIMEDOUT", message: "PRIVATE_ERROR" };
    await expect(repo.get(context(), input)).rejects.toMatchObject({ message: "PROFIT_BOARD_READ_FAILED" });
    failures = {}; members = [member(3, { actorId: 4 })];
    await expect(repo.get(context(), input)).rejects.toMatchObject({ message: "PROFIT_BOARD_READ_OWNER_MEMBER_INVALID" });
  });
  it("ordinary authorization never bypasses a missing source-owner registry", async () => {
    failures.ops_inventory_owner_assignments = { code: "ER_NO_SUCH_TABLE" };
    await expect(repo.get(regular(), input)).rejects.toMatchObject({ message: "PROFIT_BOARD_READ_FAILED" });
    expect(queries.some(query => query.sql.includes("FROM workspace_memberships"))).toBe(false);
  });
  it.each([{ membershipStatus: "disabled" }, { actorStatus: "disabled" }, { defaultWorkspaceId: 8 }])("rejects stale numeric selection when its member is no longer active in this workspace %j", async patch => {
    mappings = [mapping()]; members = [member(3, patch)];
    const all = await repo.get(context(), input);
    expect(all.status).toBe("ready"); expect(all.products).toHaveLength(1);
    expect(all.ownership?.operators).toEqual([]);
    expect(all.ownership?.parents[0]).toMatchObject({ status: "unresolved", reasonCode: "owner_inactive" });
    const stale = await repo.get(context(), { ...input, operatorId: 3 });
    expect(stale.status).toBe("invalid"); expect(stale.products).toEqual([]); expect(stale.pageRows).toEqual([]);
  });
  it("source events and subsequent reads resolve ownership fresh rather than reusing a prior ID directory", async () => {
    assignments = [assignment()];
    expect((await repo.get(context(), { ...input, operatorId: 3 })).status).toBe("ready");
    assignments = [assignment({ assigneeUserId: 4 })];
    expect((await repo.get(context(), { ...input, operatorId: 3 })).status).toBe("invalid");
    expect((await repo.get(context(), { ...input, operatorId: 4 })).status).toBe("ready");
    expect(transaction).toHaveBeenCalledTimes(3);
  });
});
beforeEach(() => {
  members = [member(3), member(4)];
  vi.clearAllMocks(); actors = [{ id: 3, role: "ops_manager", status: "active", defaultWorkspaceId: 7 }]; batches = [batch()]; assignments = []; mappings = []; policies = []; overrides = [];
  failures = {}; candidateOverride = null; detailOverride = null; assignmentOverride = null; mappingOverride = null; afterCandidates = null; queries = []; commits = 0; rollbacks = 0;
});
describe("profit board same-transaction fixed six-month source set", () => {
  it("retains exactly the existing six months after the private selector also supports seven explicit months", async () => {
    batches = [batch({}, [businessRow({ yearMonth: "2026-03" }), businessRow({ yearMonth: "2026-04" })])];
    const result = await repo.get(context(), input);
    expect(result.months).toEqual(["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"]);
    expect(result.sources).toHaveLength(6); expect(JSON.stringify(result)).not.toContain('"month":"2026-03"');
  });
  it("preserves the original profit-specific driver guard after extracting monthly source helpers", async () => {
    execute.mockResolvedValueOnce([[null] as unknown as Row[], []]);
    await expect(repo.get(context(), input)).rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: "PROFIT_BOARD_READ_RESPONSE_INVALID" });
    expect(commits).toBe(0); expect(rollbacks).toBe(1);
    expect(execute).toHaveBeenCalledTimes(1);
  });
  it("only reads monthly sources with locked actor/policy, no editions/refresh/enrichment or writes", async () => {
    const result = await repo.get(context(), input); expect(result.status).toBe("ready"); expect(Object.keys(repo)).toEqual(["get"]);
    expect(result.months).toEqual(["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"]); expect(result.products[0].current.profit).toBe(12);
    expect(transaction).toHaveBeenCalledTimes(1); expect(commits).toBe(1); expect(rollbacks).toBe(0);
    expect(queries.every(query => /^SELECT /u.test(query.sql))).toBe(true);
    expect(queries.map(query => query.sql).join("\n")).not.toMatch(/SELECT \*|INSERT |CREATE TABLE|ALTER TABLE|DELETE |UPDATE .* SET|profit_board_editions|profit_board_state|profit_board_notes|product_weekly|workspace_memberships|sync_runs/u);
    expect(queries[0]).toMatchObject({ sql: "SELECT id,role,status,defaultWorkspaceId FROM users WHERE id=? FOR SHARE", params: [3] });
    expect(queries.find(query => query.sql.includes("FROM security_access_policies"))?.sql).toMatch(/FOR UPDATE\s*$/u);
  });
  it("fixes candidate identities once, then fetches exact IDs with bounded body and original DATETIME semantics", async () => {
    await repo.get(context(), input); const source = queries.filter(query => query.sql.includes("FROM ops_monthly_profit_imports"));
    expect(source).toHaveLength(2); expect(source[0].sql).toMatch(/status='completed' ORDER BY id DESC LIMIT 201 FOR SHARE$/u); expect(source[0].params).toEqual([7]);
    expect(source[0].sql).not.toMatch(/fileName|fileHash|CAST\(payload AS CHAR[^]* AS payload,/u);
    expect(source[1].params).toEqual([7, 11]); expect(source[1].sql).toMatch(/WHERE workspaceId=\? AND id=\? LIMIT 2 FOR SHARE$/u);
    expect(source[1].sql).toContain("<=33554432"); expect(source[1].sql).toContain("DATE_FORMAT(createdAt,'%Y-%m-%d %H:%i:%s.%f')"); expect(source[1].sql).not.toContain("UNIX_TIMESTAMP");
    const text = JSON.stringify(await repo.get(context(), input)); expect(text).toContain("2026-10-12 09:08:07.123000"); expect(text).not.toContain("2026-10-12T"); expect(text).not.toContain("fileUrl");
  });
  it("does not admit newly inserted or newly completed rows after locking candidate set", async () => {
    batches.push(batch({ id: 12, status: "previewing", confirmedAt: null }, [businessRow({ financialProfit: 999 })]));
    afterCandidates = () => { batches[1] = batch({ id: 12 }, [businessRow({ financialProfit: 999 })]); batches.push(batch({ id: 13 }, [businessRow({ financialProfit: 1000 })])); };
    const result = await repo.get(context(), input); expect(result.products[0].current.profit).toBe(12); expect(result.sources[5].selectedBatchId).toBe(11);
    expect(queries.filter(query => query.sql.includes("LIMIT 201"))).toHaveLength(1); expect(queries.some(query => query.sql.includes("AND id<?"))).toBe(false);
  });
  it("selects a single multi-month batch for six months without six queries", async () => {
    const months = ["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"];
    batches = [batch({}, months.map(yearMonth => businessRow({ yearMonth })))];
    const result = await repo.get(context(), input); expect(result.sources.every(source => source.selectedBatchId === 11)).toBe(true);
    expect(queries.filter(query => query.sql.includes("FROM ops_monthly_profit_imports"))).toHaveLength(2);
  });
  it("keeps six exact month/store/site winners, ignores foreign scope but not a corrupt newer candidate", async () => {
    batches = [batch({ id: 13 }, [businessRow({ storeName: "OTHER STORE", financialProfit: 999 })]), batch({ id: 12 }, [businessRow({ site: "CA", financialProfit: 777 })]), batch(), batch({ id: 10 }, [businessRow({ yearMonth: "2026-08", financialProfit: 6 })])];
    const result = await repo.get(context(), input); expect(result.products[0].comparison.profit.delta).toBe(6); expect(result.sources[4].selectedBatchId).toBe(10); expect(result.sources[5].selectedBatchId).toBe(11);
    batches[0] = batch({ id: 13, payload: "bad", payloadBytes: 3 }); const invalid = await repo.get(context(), input); expect(invalid.status).toBe("invalid"); expect(invalid.products).toEqual([]);
  });
  it("new whole-scope winner excludes an absent parent; no older parent repair or uploader filter", async () => {
    batches = [batch({ id: 12, userId: 99 }, [businessRow({ parentAsin: "OTHER-PARENT", title: "SECRET_OTHER" })]), batch({ id: 11, userId: 3 })]; assignments = [assignment()];
    const result = await repo.get(regular(), { ...input, parentAsin: parent }); expect(result.products).toEqual([]); expect(JSON.stringify(result)).not.toMatch(/SECRET_OTHER|PRIVATE-FILENAME|"selectedBatchId":12/u);
    const source = queries.filter(query => query.sql.includes("FROM ops_monthly_profit_imports")); expect(source.every(query => !/AND userId=|parent_asin|parentAsin|storeName=|country=/u.test(query.sql))).toBe(true);
  });
  it("returns invalid rather than partial success at 201-candidate scan bound", async () => {
    batches = Array.from({ length: 201 }, (_, index) => batch({ id: index + 1 }, [businessRow({ yearMonth: "2020-01" })]));
    const result = await repo.get(context(), input); expect(result).toMatchObject({ status: "invalid", reasonCode: "scan_incomplete" }); expect(result.sources).toEqual([]);
    expect(queries.filter(query => query.sql.includes("AND id=?"))).toHaveLength(200);
  });
  it("exactly 200 fixed candidates can establish genuinely absent months without hidden truncation", async () => {
    batches = Array.from({ length: 200 }, (_, index) => batch({ id: index + 1 }, [businessRow({ yearMonth: "2020-01" })]));
    const result = await repo.get(context(), input); expect(result.status).toBe("ready"); expect(result.sources.every(source => source.status === "not_found")).toBe(true); expect(result.products).toEqual([]);
  });
  it("stops after all six winners even if older locked candidate list continues", async () => {
    batches = [batch({ id: 300 }, ["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"].map(yearMonth => businessRow({ yearMonth }))), ...Array.from({ length: 201 }, (_, index) => batch({ id: index + 1 }, [businessRow({ yearMonth: "2020-01" })]))];
    const result = await repo.get(context(), input); expect(result.status).toBe("ready"); expect(queries.filter(query => query.sql.includes("AND id=?"))).toHaveLength(1);
  });
  it("bounds cumulative payload before transfer and never slices a large latest candidate", async () => {
    candidateOverride = [{ id: 11, workspaceId: 7, status: "completed", payloadBytes: 33_554_432, monthsBytes: 10 }];
    const result = await repo.get(context(), input); expect(result).toMatchObject({ status: "invalid", reasonCode: "scan_incomplete" }); expect(queries.some(query => query.sql.includes("AND id=?"))).toBe(false);
  });
  it.each([{ id: 0 }, { id: "11" }, { workspaceId: 8 }, { status: "previewing" }, { payloadBytes: "5" }, { monthsBytes: -1 }])("rejects malformed frozen candidate metadata %j", async patch => {
    candidateOverride = [{ id: 11, workspaceId: 7, status: "completed", payloadBytes: 5, monthsBytes: 2, ...patch }]; expect((await repo.get(context(), input)).status).toBe("invalid");
  });
  it.each([{ id: 12 }, { status: "deleted" }, { payloadBytes: 4 }, { monthsBytes: 1 }, { workspaceId: 8 }, { sourceRunId: "21.0" }, { createdAt: new Date() }, { payload: "bad" }])("rejects fetched winner drift/protocol corruption %j", async patch => {
    detailOverride = [batch(patch)]; expect((await repo.get(context(), input)).status).toBe("invalid");
  });
  it("refuses missing/deleted locked record or duplicate candidate order", async () => {
    detailOverride = []; expect((await repo.get(context(), input)).status).toBe("invalid"); detailOverride = null;
    candidateOverride = [batch(), batch()]; expect((await repo.get(context(), input)).status).toBe("invalid");
  });
  it("missing source table is distinct from source empty; unrelated SQL failures are sanitized", async () => {
    batches = []; expect((await repo.get(context(), input)).status).toBe("ready");
    failures.ops_monthly_profit_imports = { cause: { errno: 1146 } }; expect((await repo.get(context(), input)).status).toBe("missing");
    failures.ops_monthly_profit_imports = { code: "ER_BAD_FIELD_ERROR", message: "secret password" }; await expect(repo.get(context(), input)).rejects.toMatchObject({ message: "PROFIT_BOARD_READ_FAILED" });
  });
});

describe("profit board complete ordinary-user parent-month authorization", () => {
  it("returns every exact currently owned parent, not only an optional single-parent shortcut", async () => {
    batches = [batch({}, [businessRow(), businessRow({ parentAsin: "P2", asin: "C2", title: "SECOND_OWN" }), businessRow({ parentAsin: "P3", asin: "C3", title: "FOREIGN_SECRET" })])];
    assignments = [assignment(), assignment({ id: 52, parentAsin: "P2" }), assignment({ id: 53, parentAsin: "P3", assigneeUserId: 4 })];
    const result = await repo.get(regular(), input); expect(result.status).toBe("ready"); expect(result.products.map(product => product.parentAsin).sort()).toEqual([parent, "P2"].sort());
    const text = JSON.stringify(result); expect(text).not.toMatch(/FOREIGN_SECRET|PRIVATE-FILENAME|fileHash|skippedRows|userId":99/u); expect(result.sources[5].batch?.visibility).toBe("scoped");
    expect(queries.find(query => query.sql.includes("owner_assignments"))?.params).toEqual([7, input.storeName, "US", parent, "P2", "P3"]);
  });
  it("current manual user-ID rule covers same-scope history without using historical usernames", async () => {
    batches = [batch({}, [businessRow({ operator: "Unmapped past owner" }), businessRow({ yearMonth: "2026-08", operator: "Another past owner", financialProfit: 4 })])]; assignments = [assignment()];
    const result = await repo.get(regular(), input); expect(result.products[0].comparison.profit.delta).toBe(8); expect(queries.some(query => query.sql.includes("operator_name_mappings"))).toBe(false);
  });
  it("without manual authority, one month owner cannot authorize another month's rows", async () => {
    batches = [batch({}, [businessRow(), businessRow({ yearMonth: "2026-08", title: "SECRET_OLD_MONTH", operator: "Other" })])]; mappings = [mapping(), mapping({ id: 62, externalName: "Other", systemUserId: 4 })];
    const result = await repo.get(regular(), input); expect(result.products[0].current.profit).toBe(12); expect(result.products[0].previous.profit).toBeNull(); expect(result.products[0].comparison.profit.delta).toBeNull();
    expect(result.sources[4]).toMatchObject({ status: "not_visible", selectedBatchId: null, batch: null, selection: { scannedCount: null } }); expect(JSON.stringify(result)).not.toContain("SECRET_OLD_MONTH");
    expect(result.partitions.every(partition => !partition.rising.length && !partition.falling.length)).toBe(true);
  });
  it("regular zero-authorized month is indistinguishable from absent month and leaks no winner metadata", async () => {
    mappings = [mapping({ systemUserId: 4 })]; const hidden = await repo.get(regular(), input);
    batches = []; const absent = await repo.get(context("ops_specialist"), input); expect(hidden).toEqual(absent);
    expect(hidden.sources.every(source => source.status === "not_visible" && source.batch === null && source.selectedBatchId === null && source.selection.scannedCount === null)).toBe(true);
  });
  it("other-owner manual rule blocks mapped-name fallback", async () => {
    assignments = [assignment({ assigneeUserId: 4 })]; mappings = [mapping()]; const result = await repo.get(regular(), input);
    expect(result.products).toEqual([]); expect(queries.some(query => query.sql.includes("operator_name_mappings"))).toBe(false);
  });
  it.each([{ assigneeUserId: "3" }, { assigneeUserId: null }, { workspaceId: 8 }, { parentAsin: "OTHER" }, { storeName: "OTHER STORE" }, { country: "CA" }, { isActive: 0 }])("does not swallow malformed owner structures as no rule %j", async patch => {
    assignmentOverride = [assignment(patch)]; await expect(repo.get(regular(), input)).rejects.toMatchObject({ message: "PROFIT_BOARD_READ_OWNER_STRUCTURE_INVALID" });
  });
  it("duplicate manual rule structure is an error, never absent or arbitrary owner", async () => {
    assignmentOverride = [assignment(), assignment({ id: 52 })]; await expect(repo.get(regular(), input)).rejects.toMatchObject({ message: "PROFIT_BOARD_READ_OWNER_STRUCTURE_INVALID" });
  });
  it("only confirmed numeric all mappings can identify an uploaded or unknown source", async () => {
    mappings = [mapping({ sourceType: "saihu" })]; expect((await repo.get(regular(), input)).products).toEqual([]);
    mappings = [mapping()]; expect((await repo.get(context("ops_specialist"), input)).products).toHaveLength(1);
    expect(queries.filter(query => query.sql.includes("operator_name_mappings")).every(query => query.sql.includes("source_type='all'"))).toBe(true);
  });
  it("requires both trusted source provenance and raw Saihu marker before Saihu mappings", async () => {
    const raw = { source: "sellfox_monthly_api", currency: "USD" }; batches = [batch({}, [businessRow({ raw })])]; mappings = [mapping({ sourceType: "saihu" })];
    expect((await repo.get(regular(), input)).products).toEqual([]);
    batches = [batch({ fileReferenceKind: "saihu_sync_run", sourceRunId: "21" }, [businessRow({ raw })])];
    expect((await repo.get(context("ops_specialist"), input)).products).toHaveLength(1);
    expect(queries.some(query => query.sql.includes("source_type IN ('saihu','all')"))).toBe(true);
  });
  it.each([{ systemUserId: "3" }, { systemUserId: null }, { sourceType: "lingxing" }, { isConfirmed: 0 }, { workspaceId: 8 }, { externalName: "OTHER" }])("mapping structure exceptions are not swallowed %j", async patch => {
    mappingOverride = [mapping(patch)]; await expect(repo.get(regular(), input)).rejects.toMatchObject({ message: "PROFIT_BOARD_READ_OWNER_STRUCTURE_INVALID" });
  });
  it("same parent/month must have consistent complete numeric owner memberships", async () => {
    batches = [batch({}, [businessRow(), businessRow({ asin: "C3", operator: "Alice/Bob" })])]; mappings = [mapping(), mapping({ id: 62, externalName: "Bob", systemUserId: 4 })];
    expect((await repo.get(regular(), input)).products).toEqual([]);
    batches = [batch({}, [businessRow({ operator: "Alice/Bob" }), businessRow({ asin: "C3", operator: "Alice/Bob" })])];
    expect((await repo.get(context("ops_specialist"), input)).products).toHaveLength(1);
  });
  it("ordinary view excludes unallocated rows while manager preserves an independent section", async () => {
    batches = [batch({}, [businessRow(), businessRow({ parentAsin: "", asin: "", title: "SECRET_UNALLOCATED" })])]; assignments = [assignment()];
    expect(JSON.stringify(await repo.get(regular(), input))).not.toContain("SECRET_UNALLOCATED");
    actors[0].role = "ops_manager"; const full = await repo.get(context(), input); expect(full.partitions.some(partition => partition.basis === "unallocated_rows")).toBe(true);
  });
  it("search and pagination happen after all ownership checks and rank the complete visible population", async () => {
    const rows = Array.from({ length: 7 }, (_, index) => businessRow({ parentAsin: `P${index}`, asin: `C${index}`, title: `OWN-${index}`, financialProfit: 10 + index }));
    batches = [batch({}, [...rows, ...rows.map(row => ({ ...row, yearMonth: "2026-08", financialProfit: 1 }))])]; assignments = rows.map((row, index) => assignment({ id: 51 + index, parentAsin: row.parentAsin }));
    const result = await repo.get(regular(), { ...input, groupLimit: 1 }); expect(result.products).toHaveLength(1); expect(result.page.totalGroups).toBe(7); expect(result.partitions[0].rising).toHaveLength(5); expect(result.partitions[0].rising[0].delta).toBe(15);
  });
  it("authorizes a full large parent population in bounded exact-identity SQL chunks, not a first-page slice", async () => {
    const rows = Array.from({ length: 501 }, (_, index) => businessRow({ parentAsin: `P${index}`, asin: `C${index}`, sku: `SKU-${index}` }));
    batches = [batch({}, rows)]; assignments = rows.map((row, index) => assignment({ id: 51 + index, parentAsin: row.parentAsin }));
    const result = await repo.get(regular(), { ...input, groupLimit: 1 }); expect(result.status).toBe("ready"); expect(result.page.totalGroups).toBe(501); expect(result.page.totalRows).toBe(501);
    const ownerQueries = queries.filter(query => query.sql.includes("FROM ops_inventory_owner_assignments")); expect(ownerQueries).toHaveLength(4); expect(ownerQueries.map(query => query.params.length)).toEqual([503, 4, 502, 3]);
    expect(result.partitions[0].trend[5].profit).toBe(6012);
  });
  it.each(["users", "security_access_policies", "role_permissions", "ops_inventory_owner_assignments", "operator_name_mappings"])("missing %s is never relabeled missing financial source", async table => {
    failures[table] = { code: "ER_NO_SUCH_TABLE" }; await expect(repo.get(regular(), input)).rejects.toMatchObject({ message: "PROFIT_BOARD_READ_FAILED" });
  });
  it("no login/changed expected workspace is rejected before DB", async () => {
    await expect(repo.get(context("ops_manager", { user: null }), input)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(repo.get(context(), { ...input, expectedWorkspaceId: 8 })).rejects.toMatchObject({ code: "FORBIDDEN" }); expect(database).not.toHaveBeenCalled();
  });
  it.each([{ id: 4 }, { role: "admin" }, { status: "disabled" }, { defaultWorkspaceId: 8 }])("rejects stale live actor %j", async patch => {
    Object.assign(actors[0], patch); await expect(repo.get(context(), input)).rejects.toMatchObject({ code: "FORBIDDEN" }); expect(queries).toHaveLength(1);
  });
  it("manager still requires strict current ops_data.read", async () => {
    policies = [{ effect: "deny" }]; await expect(repo.get(context(), input)).rejects.toMatchObject({ code: "FORBIDDEN" }); expect(queries.some(query => query.sql.includes("ops_monthly_profit_imports"))).toBe(false);
  });
  it("an explicit role-permission revocation fails before source selection", async () => {
    overrides = [{ modules: "[]", detailedPermissions: "[]" }]; await expect(repo.get(context(), input)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(queries.some(query => query.sql.includes("ops_monthly_profit_imports"))).toBe(false);
  });
  it.each([null, {}])("requires a real transactional database %j", async db => {
    const service = createProfitBoardReadRepository({ database: async () => db }); await expect(service.get(context(), input)).rejects.toMatchObject({ message: "PROFIT_BOARD_READ_TRANSACTION_REQUIRED" });
  });
  it.each([{ month: "2026-00" }, { month: "1000-01" }, { userId: 3 }, { operatorId: "3" }, { operatorId: 0 }, { operatorId: 1.5 }, { groupLimit: 51 }, { expectedWorkspaceId: null }])("repository also rejects malformed and authority-bearing input before DB %j", async patch => {
    await expect(repo.get(context(), { ...input, ...patch } as never)).rejects.toMatchObject({ code: "BAD_REQUEST" }); expect(database).not.toHaveBeenCalled();
  });
  it("does not claim success on failed transaction completion", async () => {
    const service = createProfitBoardReadRepository({ database: async () => ({ transaction: async body => { await body({ execute } as never); throw new Error("commit failure secret"); } }) });
    await expect(service.get(context(), input)).rejects.toMatchObject({ message: "PROFIT_BOARD_READ_FAILED" });
  });
});
