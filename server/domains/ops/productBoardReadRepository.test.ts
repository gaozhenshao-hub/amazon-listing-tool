import { beforeEach, describe, expect, it, vi } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import type { SQL } from "drizzle-orm";
import type { TrpcContext } from "../../_core/context";
import { MONTHLY_FINANCIAL_METRICS } from "../../../shared/monthlyFinancialRead";
import { normalizeMarketplaceCode } from "../../../shared/marketplaceIdentity";
import { createProductBoardReadRepository } from "./productBoardReadRepository";

type Row = Record<string, unknown>;
const input = { expectedWorkspaceId: 7, month: "2026-09", storeName: "Exact Store", country: "US", search: "", highReturnsOffset: 0, highProfitOffset: 0, losingOffset: 0, allOffset: 0, pageSize: 10 };
const parent = "B000000001";
const context = (role = "ops_manager", patch: Row = {}) => ({ user: { id: 3, role, status: "active", defaultWorkspaceId: 7, name: "" }, workspaceId: 7, ...patch }) as TrpcContext;
const businessRow = (patch: Row = {}): Row => ({ ...Object.fromEntries(MONTHLY_FINANCIAL_METRICS.map(metric => [metric, 0])), yearMonth: input.month, parentAsin: parent, asin: "B000000002", sku: "SKU-original", title: "Original 产品名称", storeName: input.storeName, site: "美国站", operator: "Alice", financialProfit: 12, salesQty: 2, salesAmount: 40, raw: { currency: "USD", "1:产品/原始标题": "完整原文<script>alert(1)</script>" }, ...patch });
const batch = (patch: Row = {}, business: Row[] = [businessRow()]): Row => {
  const payload = JSON.stringify(business), months = JSON.stringify([...new Set(business.map(row => row.yearMonth))]);
  return { id: 11, workspaceId: 7, userId: 99, fileName: "PRIVATE-FILENAME.xlsx", fileHash: "a".repeat(64), status: "completed", totalRows: business.length, skippedRows: 4, unallocatedRows: business.filter(row => !row.parentAsin).length, months, monthsBytes: Buffer.byteLength(months), payload, payloadBytes: Buffer.byteLength(payload), createdAt: "2026-10-12 09:08:07.123000", confirmedAt: "2026-10-12 10:08:07.456000", fileReferenceKind: "storage", sourceRunId: null, ...patch };
};
const assignment = (patch: Row = {}): Row => ({ id: 51, workspaceId: 7, parentAsin: parent, storeName: input.storeName, country: "美国", assigneeUserId: 3, isActive: 1, ...patch });
const mapping = (patch: Row = {}): Row => ({ id: 61, workspaceId: 7, externalName: "Alice", sourceType: "all", systemUserId: 3, isConfirmed: 1, ...patch });
let actors: Row[], batches: Row[], assignments: Row[], mappings: Row[], policies: Row[], overrides: Row[];
let failures: Record<string, unknown>, candidateOverride: Row[] | null, detailOverride: Row[] | null, assignmentOverride: Row[] | null, mappingOverride: Row[] | null;
let afterCandidates: (() => void) | null, queries: { sql: string; params: unknown[] }[], commits: number, rollbacks: number;
const execute = vi.fn(async (statement: SQL) => {
  const query = new MySqlDialect().sqlToQuery(statement); queries.push(query);
  for (const table of ["users", "ops_monthly_profit_imports", "ops_inventory_owner_assignments", "operator_name_mappings", "security_access_policies", "role_permissions"]) if (query.sql.includes(`FROM ${table}`) && failures[table]) throw failures[table];
  if (query.sql.includes("FROM users")) return [actors, []];
  if (query.sql.includes("FROM security_access_policies")) return [policies, []];
  if (query.sql.includes("FROM role_permissions")) return [overrides, []];
  if (query.sql.includes("FROM ops_inventory_owner_assignments")) return [assignmentOverride ?? assignments.filter(row => row.workspaceId === query.params[0] && row.storeName === query.params[1] && normalizeMarketplaceCode(String(row.country)) === query.params[2] && row.isActive === 1 && query.params.slice(3).includes(row.parentAsin)), []];
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
const database = vi.fn(async () => ({ transaction }));
const repo = createProductBoardReadRepository({ database });
function regular() { actors[0].role = "ops_specialist"; return context("ops_specialist"); }
beforeEach(() => {
  vi.clearAllMocks(); actors = [{ id: 3, role: "ops_manager", status: "active", defaultWorkspaceId: 7 }]; batches = [batch()]; assignments = []; mappings = []; policies = []; overrides = [];
  failures = {}; candidateOverride = null; detailOverride = null; assignmentOverride = null; mappingOverride = null; afterCandidates = null; queries = []; commits = 0; rollbacks = 0;
});

describe("product board full-history stable source scan", () => {
  it("reads only original monthly facts under one locked actor and strict policy transaction", async () => {
    const result = await repo.get(context(), input); expect(result.status).toBe("ready"); expect(Object.keys(repo)).toEqual(["get"]);
    expect(result.products[0].financial.profit).toBe(12); expect(result.products[0].financial.margin.value).toBe(0.3);
    expect(transaction).toHaveBeenCalledTimes(1); expect(commits).toBe(1); expect(rollbacks).toBe(0);
    expect(queries.every(query => /^SELECT /u.test(query.sql))).toBe(true);
    expect(queries.map(query => query.sql).join("\n")).not.toMatch(/SELECT \*|INSERT |CREATE TABLE|ALTER TABLE|DELETE |UPDATE .* SET|profit_board_editions|profit_board_state|profit_board_notes|product_weekly|workspace_memberships|sync_runs|team_tasks/u);
    expect(queries[0]).toMatchObject({ sql: "SELECT id,role,status,defaultWorkspaceId FROM users WHERE id=? FOR SHARE", params: [3] });
    expect(queries.find(query => query.sql.includes("FROM security_access_policies"))?.sql).toMatch(/FOR UPDATE\s*$/u);
    expect(JSON.stringify(result)).toContain("完整原文<script>alert(1)</script>");
  });
  it("locks a fixed candidate set and bounds each exact-ID transfer with database date text", async () => {
    const result = await repo.get(context(), input), source = queries.filter(query => query.sql.includes("FROM ops_monthly_profit_imports"));
    expect(source).toHaveLength(2); expect(source[0].sql).toMatch(/status='completed' ORDER BY id DESC LIMIT 201 FOR SHARE$/u); expect(source[0].params).toEqual([7]);
    expect(source[0].sql).not.toMatch(/fileName|fileHash|CAST\(payload AS CHAR[^]* AS payload,/u);
    expect(source[1].params).toEqual([7, 11]); expect(source[1].sql).toMatch(/WHERE workspaceId=\? AND id=\? LIMIT 2 FOR SHARE$/u);
    expect(source[1].sql).toContain("<=33554432"); expect(source[1].sql).toContain("DATE_FORMAT(createdAt,'%Y-%m-%d %H:%i:%s.%f')"); expect(source[1].sql).not.toContain("UNIX_TIMESTAMP");
    expect(JSON.stringify(result)).toContain("2026-10-12 09:08:07.123000"); expect(JSON.stringify(result)).not.toMatch(/2026-10-12T|fileUrl/u);
  });
  it("preserves the product-specific shared driver guard and rolls back malformed responses", async () => {
    execute.mockResolvedValueOnce([[null] as unknown as Row[], []]);
    await expect(repo.get(context(), input)).rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: "PRODUCT_BOARD_READ_RESPONSE_INVALID" });
    expect(commits).toBe(0); expect(rollbacks).toBe(1);
    expect(execute).toHaveBeenCalledTimes(1);
  });
  it("cannot admit a newly inserted/newly completed batch halfway through the view", async () => {
    batches.push(batch({ id: 12, status: "previewing", confirmedAt: null }, [businessRow({ title: "LATE_SECRET" })]));
    afterCandidates = () => { batches[1] = batch({ id: 12 }, [businessRow({ title: "LATE_SECRET" })]); batches.push(batch({ id: 13 }, [businessRow({ title: "INSERTED_SECRET" })])); };
    expect(JSON.stringify(await repo.get(context(), input))).not.toMatch(/LATE_SECRET|INSERTED_SECRET/u);
    expect(queries.filter(query => query.sql.includes("LIMIT 201"))).toHaveLength(1); expect(queries.some(query => query.sql.includes("AND id<?"))).toBe(false);
  });
  it("scans to the bottom and preserves history older than six months after the complete recent quarter", async () => {
    batches = [batch({ id: 12 }, ["2026-07", "2026-08", "2026-09"].map(yearMonth => businessRow({ yearMonth }))), batch({ id: 11 }, [businessRow({ yearMonth: "2019-01", title: "EARLIEST_REAL_HISTORY" })])];
    const result = await repo.get(context(), input); expect(result.status).toBe("ready"); expect(JSON.stringify(result)).toContain("EARLIEST_REAL_HISTORY");
    expect(result.periods?.total.start).toBe("2019-01"); expect(result.products[0].rates.total.profit).toBe(48); expect(result.products[0].rates.quarter.profit).toBe(36);
    expect(queries.filter(query => query.sql.includes("AND id=?")).map(query => query.params[1])).toEqual([12, 11]);
  });
  it("uses one multi-month body and never a request per month", async () => {
    batches = [batch({}, ["2024-01", "2025-01", "2026-07", "2026-08", "2026-09"].map(yearMonth => businessRow({ yearMonth })))];
    expect((await repo.get(context(), input)).status).toBe("ready"); expect(queries.filter(query => query.sql.includes("FROM ops_monthly_profit_imports"))).toHaveLength(2);
  });
  it("ignores future and foreign scopes without splicing old parents into a newer whole-scope winner", async () => {
    batches = [batch({ id: 15 }, [businessRow({ yearMonth: "2026-10", title: "FUTURE_SECRET" })]), batch({ id: 14 }, [businessRow({ storeName: "OTHER", title: "STORE_SECRET" })]), batch({ id: 13 }, [businessRow({ site: "CA", title: "SITE_SECRET" })]), batch({ id: 12 }, [businessRow({ parentAsin: "OTHER-PARENT", asin: "OTHER", title: "NEW_OTHER_PARENT" })]), batch({ id: 11 }, [businessRow({ title: "SUPERSEDED_PARENT" })])];
    assignments = [assignment()]; const result = await repo.get(regular(), { ...input, parentAsin: parent });
    expect(JSON.stringify(result)).not.toMatch(/FUTURE_SECRET|STORE_SECRET|SITE_SECRET|NEW_OTHER_PARENT|SUPERSEDED_PARENT|PRIVATE-FILENAME/u);
    expect(queries.filter(query => query.sql.includes("FROM ops_monthly_profit_imports")).every(query => !/AND userId=|parent_asin|parentAsin|storeName=|country=/u.test(query.sql))).toBe(true);
  });
  it("rejects an incomplete 201-candidate history even when the first batch already contains the recent quarter", async () => {
    batches = [batch({ id: 300 }, ["2026-07", "2026-08", "2026-09"].map(yearMonth => businessRow({ yearMonth }))), ...Array.from({ length: 200 }, (_, index) => batch({ id: index + 1 }, [businessRow({ yearMonth: "2020-01" })]))];
    const result = await repo.get(context(), input); expect(result).toMatchObject({ status: "invalid", reasonCode: "scan_incomplete" });
    expect(JSON.stringify(result)).not.toMatch(/Original 产品名称|PRIVATE-FILENAME/u); expect(queries.filter(query => query.sql.includes("AND id=?"))).toHaveLength(200);
  });
  it("exactly 200 candidates establish complete history and duplicate imports do not multiply originals", async () => {
    batches = Array.from({ length: 200 }, (_, index) => batch({ id: index + 1 }, [businessRow({ title: index === 199 ? "WINNER_ORIGINAL" : "SUPERSEDED_ORIGINAL" })]));
    const result = await repo.get(context(), input); expect(result.status).toBe("ready"); expect(JSON.stringify(result)).toContain("WINNER_ORIGINAL"); expect(JSON.stringify(result)).not.toContain("SUPERSEDED_ORIGINAL");
    expect(result.products[0].rates.total.profit).toBe(12); expect(result.history?.scannedCount).toBe(200); expect(result.pageRows).toHaveLength(1);
    expect(queries.filter(query => query.sql.includes("AND id=?"))).toHaveLength(200);
  });
  it("does not overlook corrupt older candidates just because the recent quarter is known", async () => {
    batches = [batch({ id: 12 }, ["2026-07", "2026-08", "2026-09"].map(yearMonth => businessRow({ yearMonth }))), batch({ id: 11, payload: "bad", payloadBytes: 3 })];
    expect(await repo.get(context(), input)).toMatchObject({ status: "invalid", reasonCode: "invalid_source" });
  });
  it("checks cumulative body bytes before transfer without slicing a large latest candidate", async () => {
    candidateOverride = [{ id: 11, workspaceId: 7, status: "completed", payloadBytes: 33_554_432, monthsBytes: 10 }];
    expect(await repo.get(context(), input)).toMatchObject({ status: "invalid", reasonCode: "scan_incomplete" }); expect(queries.some(query => query.sql.includes("AND id=?"))).toBe(false);
  });
  it.each([{ id: 0 }, { id: "11" }, { workspaceId: 8 }, { status: "previewing" }, { payloadBytes: "5" }, { monthsBytes: -1 }])("rejects malformed fixed candidate metadata %j", async patch => {
    candidateOverride = [{ id: 11, workspaceId: 7, status: "completed", payloadBytes: 5, monthsBytes: 2, ...patch }]; expect((await repo.get(context(), input)).status).toBe("invalid");
  });
  it.each([{ id: 12 }, { status: "deleted" }, { payloadBytes: 4 }, { monthsBytes: 1 }, { workspaceId: 8 }, { sourceRunId: "21.0" }, { createdAt: new Date() }, { payload: "bad" }])("rejects locked body drift and real driver protocol errors %j", async patch => {
    detailOverride = [batch(patch)]; expect((await repo.get(context(), input)).status).toBe("invalid");
  });
  it("rejects missing locked body or duplicate/non-descending candidate identity", async () => {
    detailOverride = []; expect((await repo.get(context(), input)).status).toBe("invalid"); detailOverride = null;
    candidateOverride = [batch(), batch()]; expect((await repo.get(context(), input)).status).toBe("invalid");
  });
  it("distinguishes source-table absence, genuine empty source and other SQL exceptions", async () => {
    batches = []; const result = await repo.get(context(), input); expect(["ready", "not_found"]).toContain(result.status);
    failures.ops_monthly_profit_imports = { cause: { errno: 1146 } }; expect((await repo.get(context(), input)).status).toBe("missing");
    failures.ops_monthly_profit_imports = { code: "ER_BAD_FIELD_ERROR", message: "secret password" }; await expect(repo.get(context(), input)).rejects.toMatchObject({ message: "PRODUCT_BOARD_READ_FAILED" });
  });
});
describe("product board current exact parent-month ownership and no history leakage", () => {
  it("returns all exact currently owned parents, never just the first page of owner candidates", async () => {
    batches = [batch({}, [businessRow({ title: "FIRST_OWN" }), businessRow({ parentAsin: "P2", asin: "C2", title: "SECOND_OWN" }), businessRow({ parentAsin: "P3", asin: "C3", title: "FOREIGN_SECRET" })])];
    assignments = [assignment(), assignment({ id: 52, parentAsin: "P2" }), assignment({ id: 53, parentAsin: "P3", assigneeUserId: 4 })];
    const result = await repo.get(regular(), input), text = JSON.stringify(result); expect(result.status).toBe("ready"); expect(text).toContain("FIRST_OWN"); expect(text).toContain("SECOND_OWN");
    expect(text).not.toMatch(/FOREIGN_SECRET|PRIVATE-FILENAME|fileHash|skippedRows|userId":99/u);
    expect(queries.find(query => query.sql.includes("owner_assignments"))?.params).toEqual([7, input.storeName, "US", parent, "P2", "P3"]);
  });
  it("current manual numeric owner covers exact-scope history without historical usernames", async () => {
    batches = [batch({}, [businessRow({ operator: "Unmapped current" }), businessRow({ yearMonth: "2019-01", operator: "Unmapped past", title: "AUTHORIZED_HISTORY" })])]; assignments = [assignment()];
    expect(JSON.stringify(await repo.get(regular(), input))).toContain("AUTHORIZED_HISTORY"); expect(queries.some(query => query.sql.includes("operator_name_mappings"))).toBe(false);
  });
  it("a visible current month never authorizes or discloses an older source-owner month", async () => {
    batches = [batch({ id: 12 }), batch({ id: 11 }, [businessRow({ yearMonth: "2019-01", title: "SECRET_OLDEST", operator: "Other" })])]; mappings = [mapping(), mapping({ id: 62, externalName: "Other", systemUserId: 4 })];
    const withHidden = await repo.get(regular(), input); expect(JSON.stringify(withHidden)).not.toMatch(/SECRET_OLDEST|2019-01|PRIVATE-FILENAME/u);
    batches = [batch({ id: 12 })]; expect(await repo.get(context("ops_specialist"), input)).toEqual(withHidden);
  });
  it("all-unauthorized history and genuinely absent history are indistinguishable", async () => {
    mappings = [mapping({ systemUserId: 4 })]; const hidden = await repo.get(regular(), input);
    batches = []; expect(await repo.get(context("ops_specialist"), input)).toEqual(hidden); expect(JSON.stringify(hidden)).not.toMatch(/PRIVATE-FILENAME|Original 产品名称/u);
  });
  it("a current other-owner manual rule blocks any mapped-name fallback", async () => {
    assignments = [assignment({ assigneeUserId: 4 })]; mappings = [mapping()];
    expect(JSON.stringify(await repo.get(regular(), input))).not.toContain("Original 产品名称"); expect(queries.some(query => query.sql.includes("operator_name_mappings"))).toBe(false);
  });
  it.each([{ assigneeUserId: "3" }, { assigneeUserId: null }, { workspaceId: 8 }, { parentAsin: "OTHER" }, { storeName: "OTHER STORE" }, { country: "CA" }, { isActive: 0 }])("fails closed on malformed owner structure %j", async patch => {
    assignmentOverride = [assignment(patch)]; await expect(repo.get(regular(), input)).rejects.toMatchObject({ message: "PRODUCT_BOARD_READ_OWNER_STRUCTURE_INVALID" });
  });
  it("rejects duplicate manual owner structure without choosing an arbitrary record", async () => {
    assignmentOverride = [assignment(), assignment({ id: 52 })]; await expect(repo.get(regular(), input)).rejects.toMatchObject({ message: "PRODUCT_BOARD_READ_OWNER_STRUCTURE_INVALID" });
  });
  it("requires trusted batch lineage AND raw Saihu marker for source-specific mappings", async () => {
    const raw = { source: "sellfox_monthly_api", currency: "USD" }; batches = [batch({}, [businessRow({ raw })])]; mappings = [mapping({ sourceType: "saihu" })];
    expect(JSON.stringify(await repo.get(regular(), input))).not.toContain("Original 产品名称");
    batches = [batch({ fileReferenceKind: "saihu_sync_run", sourceRunId: "21" }, [businessRow({ raw })])]; expect(JSON.stringify(await repo.get(context("ops_specialist"), input))).toContain("Original 产品名称");
    batches = [batch({ fileReferenceKind: "saihu_sync_run", sourceRunId: "21" })]; expect(JSON.stringify(await repo.get(context("ops_specialist"), input))).not.toContain("Original 产品名称");
    mappings = [mapping()]; expect(JSON.stringify(await repo.get(context("ops_specialist"), input))).toContain("Original 产品名称");
  });
  it.each([{ systemUserId: "3" }, { systemUserId: null }, { sourceType: "lingxing" }, { isConfirmed: 0 }, { workspaceId: 8 }, { externalName: "OTHER" }])("does not swallow invalid mapping records %j", async patch => {
    mappingOverride = [mapping(patch)]; await expect(repo.get(regular(), input)).rejects.toMatchObject({ message: "PRODUCT_BOARD_READ_OWNER_STRUCTURE_INVALID" });
  });
  it("requires consistent full owner-ID membership for every original sibling in a parent/month", async () => {
    batches = [batch({}, [businessRow(), businessRow({ asin: "C3", operator: "Alice/Bob" })])]; mappings = [mapping(), mapping({ id: 62, externalName: "Bob", systemUserId: 4 })];
    expect(JSON.stringify(await repo.get(regular(), input))).not.toContain("Original 产品名称");
    batches = [batch({}, [businessRow({ operator: "Alice/Bob" }), businessRow({ asin: "C3", operator: "Alice/Bob" })])]; expect(JSON.stringify(await repo.get(context("ops_specialist"), input))).toContain("Original 产品名称");
  });
  it("excludes unallocated/ambiguous source rows for ordinary users, retaining them separately for managers", async () => {
    batches = [batch({}, [businessRow(), businessRow({ parentAsin: "", asin: "", title: "SECRET_UNALLOCATED" }), businessRow({ asin: "AMB", title: "SECRET_AMBIGUOUS", raw: { currency: "USD", api: { parentAsinList: [parent, "OTHER"] } } })])]; assignments = [assignment()];
    expect(JSON.stringify(await repo.get(regular(), input))).not.toMatch(/SECRET_UNALLOCATED|SECRET_AMBIGUOUS/u);
    actors[0].role = "ops_manager"; const text = JSON.stringify(await repo.get(context(), input)); expect(text).toContain("SECRET_UNALLOCATED"); expect(text).toContain("SECRET_AMBIGUOUS");
  });
  it("authorizes every parent before display paging using bounded exact-ID owner query chunks", async () => {
    const rows = Array.from({ length: 501 }, (_, index) => businessRow({ parentAsin: "P" + index, asin: "C" + index, sku: "SKU" + index }));
    batches = [batch({}, rows)]; assignments = rows.map((row, index) => assignment({ id: 51 + index, parentAsin: row.parentAsin }));
    const result = await repo.get(regular(), { ...input, pageSize: 1 }); expect(result.status).toBe("ready"); expect(result.sections.all.page.totalProducts).toBe(501); expect(result.matchedRows).toBe(501);
    expect(queries.filter(query => query.sql.includes("FROM ops_inventory_owner_assignments")).map(query => query.params.length)).toEqual([503, 4]);
  });
  it.each(["users", "security_access_policies", "role_permissions", "ops_inventory_owner_assignments", "operator_name_mappings"])("never relabels missing %s as missing financial source", async table => {
    failures[table] = { code: "ER_NO_SUCH_TABLE" }; await expect(repo.get(regular(), input)).rejects.toMatchObject({ message: "PRODUCT_BOARD_READ_FAILED" });
  });
  it("rejects login/workspace drift before database access", async () => {
    await expect(repo.get(context("ops_manager", { user: null }), input)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(repo.get(context(), { ...input, expectedWorkspaceId: 8 })).rejects.toMatchObject({ code: "FORBIDDEN" }); expect(database).not.toHaveBeenCalled();
  });
  it.each([{ id: 4 }, { role: "admin" }, { status: "disabled" }, { defaultWorkspaceId: 8 }])("reloads and locks the exact active actor %j", async patch => {
    Object.assign(actors[0], patch); await expect(repo.get(context(), input)).rejects.toMatchObject({ code: "FORBIDDEN" }); expect(queries).toHaveLength(1);
  });
  it("applies strict ops_data.read even for a manager", async () => {
    policies = [{ effect: "deny" }]; await expect(repo.get(context(), input)).rejects.toMatchObject({ code: "FORBIDDEN" }); expect(queries.some(query => query.sql.includes("ops_monthly_profit_imports"))).toBe(false);
  });
  it("honors explicit role revocation before any source selection", async () => {
    overrides = [{ modules: "[]", detailedPermissions: "[]" }]; await expect(repo.get(context(), input)).rejects.toMatchObject({ code: "FORBIDDEN" }); expect(queries.some(query => query.sql.includes("ops_monthly_profit_imports"))).toBe(false);
  });
  it.each([null, {}])("requires transactional database execution %j", async db => {
    const service = createProductBoardReadRepository({ database: async () => db }); await expect(service.get(context(), input)).rejects.toMatchObject({ message: "PRODUCT_BOARD_READ_TRANSACTION_REQUIRED" });
  });
  it.each([{ month: "2026-00" }, { userId: 3 }, { operatorId: 3 }, { pageSize: 21 }, { expectedWorkspaceId: null }])("rejects malformed and authority-bearing direct input %j", async patch => {
    await expect(repo.get(context(), { ...input, ...patch } as never)).rejects.toMatchObject({ code: "BAD_REQUEST" }); expect(database).not.toHaveBeenCalled();
  });
  it("cannot declare success when transaction completion fails", async () => {
    const service = createProductBoardReadRepository({ database: async () => ({ transaction: async body => { await body({ execute } as never); throw new Error("completion failure secret"); } }) });
    await expect(service.get(context(), input)).rejects.toMatchObject({ message: "PRODUCT_BOARD_READ_FAILED" });
  });
});
