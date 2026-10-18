import { beforeEach, describe, expect, it, vi } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import type { SQL } from "drizzle-orm";
import { MONTHLY_FINANCIAL_METRICS } from "../../../shared/monthlyFinancialRead";
import type { TrpcContext } from "../../_core/context";
import { createMonthlyFinancialReadRepository } from "./monthlyFinancialReadRepository";
import { projection as boardProjection } from "./monthlyBoardReadCore";

type Row = Record<string, unknown>;
const scope = { yearMonth: "2026-09", parentAsin: "B000000001", storeName: "Exact Store", country: "US" };
const historyInput = { expectedWorkspaceId: 7, cursor: null, limit: 2 };
const batchInput = { expectedWorkspaceId: 7, batchId: 11, rowOffset: 0, pageSize: 1 };
const snapshotInput = { expectedWorkspaceId: 7, yearMonth: scope.yearMonth, storeName: scope.storeName, country: scope.country, rowOffset: 0, pageSize: 1 };
const context = (role = "ops_manager", patch: Row = {}) => ({ user: { id: 3, role, status: "active", defaultWorkspaceId: 7, name: "" }, workspaceId: 7, ...patch }) as TrpcContext;
const businessRow = (patch: Row = {}): Row => ({ ...Object.fromEntries(MONTHLY_FINANCIAL_METRICS.map(metric => [metric, 0])),
  yearMonth: scope.yearMonth, parentAsin: scope.parentAsin, asin: "B000000002", sku: "SKU-original", title: "Original 产品名称", storeName: scope.storeName, site: "美国站", operator: "Alice",
  financialProfit: 12.34, salesQty: 2, salesAmount: 40, raw: { "1:产品/原始标题": "完整保留原文<script>alert(1)</script>", currency: "USD", "2:采购成本/": -11.7 }, ...patch });
const batch = (patch: Row = {}, business: Row[] = [businessRow()]): Row => {
  const payload = JSON.stringify(business), months = JSON.stringify([...new Set(business.map(row => row.yearMonth))]);
  return { id: 11, workspaceId: 7, userId: 3, fileName: "Original 私有源文件.xlsx", fileHash: "a".repeat(64), status: "completed", totalRows: business.length,
    skippedRows: 4, unallocatedRows: business.filter(row => !row.parentAsin).length, months, monthsBytes: Buffer.byteLength(months), payload, payloadBytes: Buffer.byteLength(payload),
    createdAt: "2026-10-12 09:08:07.123000", confirmedAt: "2026-10-12 10:08:07.456000", fileReferenceKind: "storage", sourceRunId: null, ...patch };
};
const assignment = (patch: Row = {}): Row => ({ id: 51, workspaceId: 7, parentAsin: scope.parentAsin, storeName: scope.storeName, country: "美国", assigneeUserId: 3, isActive: 1, ...patch });
const mapping = (patch: Row = {}): Row => ({ id: 71, workspaceId: 7, externalName: "Alice", sourceType: "all", systemUserId: 3, isConfirmed: 1, ...patch });
let actors: Row[], batches: Row[], assignments: Row[], mappings: Row[], policies: Row[], overrides: Row[];
let failures: Record<string, unknown>, sourceOverride: Partial<Record<"history" | "batch" | "snapshot", Row[]>>, queries: { sql: string; params: unknown[] }[];
let commits: number, rollbacks: number;
const execute = vi.fn(async (statement: SQL) => {
  const query = new MySqlDialect().sqlToQuery(statement); queries.push(query);
  for (const table of ["users", "ops_monthly_profit_imports", "ops_inventory_owner_assignments", "operator_name_mappings", "security_access_policies", "role_permissions"]) {
    if (query.sql.includes(`FROM ${table}`) && failures[table]) throw failures[table];
  }
  if (query.sql.includes("FROM users")) return [actors, []];
  if (query.sql.includes("FROM security_access_policies")) return [policies, []];
  if (query.sql.includes("FROM role_permissions")) return [overrides, []];
  if (query.sql.includes("FROM ops_inventory_owner_assignments")) return [assignments, []];
  if (query.sql.includes("FROM operator_name_mappings")) return [mappings, []];
  if (query.sql.includes("FROM ops_monthly_profit_imports")) {
    const kind = query.sql.includes("status='completed'") ? "snapshot" : query.sql.includes("AND id=?") ? "batch" : "history";
    if (sourceOverride[kind]) return [sourceOverride[kind], []];
    let result = batches.filter(row => row.workspaceId === query.params[0]).sort((a, b) => Number(b.id) - Number(a.id));
    if (kind === "batch") result = result.filter(row => row.id === query.params[1]).slice(0, 2);
    else if (kind === "snapshot") result = result.filter(row => row.status === "completed" && (query.params.length === 1 || Number(row.id) < Number(query.params[1]))).slice(0, 1);
    else {
      let index = 1;
      if (query.sql.includes("AND userId=?")) { result = result.filter(row => row.userId === query.params[index]); index++; }
      if (query.sql.includes("AND id<?")) result = result.filter(row => Number(row.id) < Number(query.params[index]));
      result = result.slice(0, Number(query.params.at(-1)));
      result = result.map(({ payload: _payload, payloadBytes: _bytes, ...metadata }) => metadata);
    }
    return [result, []];
  }
  throw new Error(`Unexpected query ${query.sql}`);
});
const transaction = vi.fn(async <T>(body: (tx: { execute: typeof execute }) => Promise<T>) => {
  try { const result = await body({ execute }); commits++; return result; } catch (error) { rollbacks++; throw error; }
});
const database = vi.fn(async () => ({ transaction }));
const repo = createMonthlyFinancialReadRepository({ database });
function regular() { actors[0].role = "ops_specialist"; return context("ops_specialist"); }
beforeEach(() => {
  vi.clearAllMocks(); queries = []; commits = 0; rollbacks = 0; failures = {}; sourceOverride = {};
  actors = [{ id: 3, role: "ops_manager", status: "active", defaultWorkspaceId: 7 }]; assignments = []; mappings = []; policies = []; overrides = []; batches = [batch()];
});
describe("monthly financial readonly SQL boundary", () => {
  it("recognizes only the workspace-bound private monthly object namespace in both projections", async () => {
    await repo.listBatches(context(), historyInput);
    const query = queries.find(query => query.sql.includes("FROM ops_monthly_profit_imports"))!;
    for (const text of [query.sql, boardProjection(1024)]) {
      expect(text).toContain("^storage://(s3|oss)/monthly-financial/',workspaceId,'/[a-f0-9]{64}[.](xlsx|csv)$");
      expect(text).toContain("BINARY fileUrl=BINARY LOWER(fileUrl)");
      expect(text).not.toContain("^(https://|s3://|oss://|storage://)");
    }
  });
  it("private upload origin keeps original-byte hash provenance without exposing the storage URI", async () => {
    const result = await repo.listBatches(context(), historyInput);
    expect(result.batches[0].origin).toEqual({ kind: "uploaded_file", hashBasis: "original_file_bytes", sourceRunId: null });
    expect(JSON.stringify(result)).not.toContain("storage://");
  });
  it("has exactly three read operations, never initializes schema or fetches storage files", async () => {
    expect(Object.keys(repo)).toEqual(["listBatches", "getBatch", "getEffectiveSnapshot"]);
    await repo.listBatches(context(), historyInput); await repo.getBatch(context(), batchInput); await repo.getEffectiveSnapshot(context(), snapshotInput);
    expect(queries.every(query => /^SELECT /u.test(query.sql))).toBe(true);
    expect(queries.map(query => query.sql).join("\n")).not.toMatch(/SELECT \*|INSERT |CREATE TABLE|ALTER TABLE|DELETE |UPDATE .* SET|profitboard|lingxing_product_weekly|saihu_product_weekly/u);
    expect(transaction).toHaveBeenCalledTimes(3); expect(commits).toBe(3); expect(rollbacks).toBe(0);
  });
  it("preserves timezone-free DATETIME calendar text and projects only safe file provenance", async () => {
    const result = await repo.getBatch(context(), batchInput), text = JSON.stringify(result);
    expect(result.status).toBe("ready"); expect(result.timestampBasis).toBe("database_datetime_without_timezone");
    expect(text).toContain("2026-10-12 09:08:07.123000"); expect(text).not.toContain("2026-10-12T");
    const query = queries.find(query => query.sql.includes("FROM ops_monthly_profit_imports"))!;
    expect(query.sql).toContain("DATE_FORMAT(createdAt,'%Y-%m-%d %H:%i:%s.%f')"); expect(query.sql).not.toContain("UNIX_TIMESTAMP");
    expect(query.sql).not.toMatch(/SELECT[^]*,\s*fileUrl\s*[,\s]/u); expect(text).not.toContain("fileUrl");
    expect(query.sql).toContain("saihu-sync-run:"); expect(query.sql).toContain("SUBSTRING(fileUrl,16)");
    expect(query.sql).toContain("OCTET_LENGTH(CAST(payload"); expect(query.sql).toContain("<=67108864");
    expect(query.params).toEqual([7, 11]); expect(query.sql).toMatch(/LIMIT 2 FOR SHARE$/u);
  });
  it("retains source rows and complete original raw fields; aggregate is full selection not current page", async () => {
    batches = [batch({}, [businessRow(), businessRow({ asin: "B000000003", sku: "Second", salesAmount: 60, financialProfit: 23 })])];
    const result = await repo.getBatch(context(), batchInput);
    expect(result.rows).toHaveLength(1); expect(result.page).toMatchObject({ totalRows: 2, matchedRows: 2, hasMore: true, nextOffset: 1 });
    expect(result.rows[0].raw["1:产品/原始标题"]).toBe("完整保留原文<script>alert(1)</script>");
    expect(result.aggregates.find(value => value.dimension === "parent")?.metrics.salesAmount).toBe(100);
    const next = await repo.getBatch(context(), { ...batchInput, rowOffset: 1 }); expect(next.rows[0].sku).toBe("Second"); expect(next.page.hasMore).toBe(false);
  });
  it("returns manager all-row detail including unallocated without assigning it to a product", async () => {
    batches = [batch({}, [businessRow({ parentAsin: "", asin: "", sku: "unallocated", operator: null })])];
    const result = await repo.getBatch(context(), batchInput); expect(result.rows[0].allocation).toBe("unallocated");
    expect(result.aggregates.every(value => value.dimension === "unallocated")).toBe(true);
  });
  it("history is true descending keyset, includes preview/deleted states, never fetches payload", async () => {
    batches = [batch({ id: 9, status: "deleted" }), batch({ id: 12, status: "previewing", confirmedAt: null }), batch({ id: 11 })];
    const first = await repo.listBatches(context(), historyInput);
    expect(first.batches.map(value => value.id)).toEqual([12, 11]); expect(first.page).toMatchObject({ hasMore: true, nextCursor: 11 });
    const next = await repo.listBatches(context(), { ...historyInput, cursor: 11 }); expect(next.batches.map(value => value.id)).toEqual([9]); expect(next.page.hasMore).toBe(false);
    const historyQueries = queries.filter(query => query.sql.includes("FROM ops_monthly_profit_imports"));
    expect(historyQueries.every(query => !query.sql.includes("payload") && !query.sql.includes("status='completed'"))).toBe(true);
    expect(historyQueries[1].params).toEqual([7, 11, 3]); expect(historyQueries[1].sql).toContain("AND id<? ORDER BY id DESC LIMIT ? FOR SHARE");
  });
  it("ordinary history is only own uploaded metadata, never username or business owner inference", async () => {
    batches = [batch({ id: 12, userId: 99 }), batch({ id: 11 }), batch({ id: 10, workspaceId: 8 })];
    const result = await repo.listBatches(regular(), historyInput); expect(result.batches.map(value => value.id)).toEqual([11]);
    expect(queries.find(query => query.sql.includes("FROM ops_monthly_profit_imports"))?.params).toEqual([7, 3, 3]);
    expect(queries.some(query => /owner_assignments|operator_name_mappings/u.test(query.sql))).toBe(false);
  });
  it("rejects foreign-uploader rows returned unexpectedly from history query", async () => {
    sourceOverride.history = [batch({ userId: 99 })];
    await expect(repo.listBatches(regular(), historyInput)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("empty history is ready but missing table explicitly missing, not fabricated empty success", async () => {
    batches = []; const empty = await repo.listBatches(context(), historyInput); expect(empty.status).toBe("ready"); expect(empty.batches).toEqual([]);
    failures.ops_monthly_profit_imports = { code: "ER_NO_SUCH_TABLE" };
    const missing = await repo.listBatches(context(), historyInput); expect(missing.status).toBe("missing"); expect(missing.reasonCode).toBe("table_missing");
  });
  it.each(["listBatches", "getBatch", "getEffectiveSnapshot"] as const)("%s uses actor, permission, source locks in one transaction", async method => {
    const input = method === "listBatches" ? historyInput : method === "getBatch" ? batchInput : snapshotInput;
    await repo[method](context(), input as never);
    expect(queries[0]).toMatchObject({ sql: "SELECT id,role,status,defaultWorkspaceId FROM users WHERE id=? FOR SHARE", params: [3] });
    const policy = queries.find(query => query.sql.includes("FROM security_access_policies"))!;
    expect(policy.params.slice(0, 3)).toEqual(["ops_data", "read", 7]); expect(policy.sql).toMatch(/FOR UPDATE\s*$/u);
    expect(transaction).toHaveBeenCalledTimes(1);
  });
  it.each(["listBatches", "getBatch", "getEffectiveSnapshot"] as const)("%s rejects no user before connecting", async method => {
    await expect(repo[method](context("ops_manager", { user: null }), {} as never)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(database).not.toHaveBeenCalled();
  });
  it.each([{ expectedWorkspaceId: 8 }, { expectedWorkspaceId: null }, { expectedWorkspaceId: "7" }, { expectedWorkspaceId: 0 }, { userId: 9 }, { status: "completed" }])("rejects expected identity drift or extra input %j", async patch => {
    await expect(repo.listBatches(context(), { ...historyInput, ...patch } as never)).rejects.toBeInstanceOf(Error); expect(database).not.toHaveBeenCalled();
  });
  it.each([{ id: 4 }, { role: "admin" }, { status: "disabled" }, { defaultWorkspaceId: 8 }])("reloads and rejects changed actor %j", async patch => {
    Object.assign(actors[0], patch); await expect(repo.listBatches(context(), historyInput)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(queries).toHaveLength(1); expect(rollbacks).toBe(1);
  });
  it("ctx workspace mismatch never falls back to another user default", async () => {
    await expect(repo.listBatches(context("ops_manager", { workspaceId: 8 }), historyInput)).rejects.toMatchObject({ code: "FORBIDDEN" }); expect(database).not.toHaveBeenCalled();
  });
  it.each([null, {}])("requires a real transaction interface %j", async db => {
    const reader = createMonthlyFinancialReadRepository({ database: async () => db });
    await expect(reader.listBatches(context(), historyInput)).rejects.toMatchObject({ message: "MONTHLY_FINANCIAL_READ_TRANSACTION_REQUIRED" });
  });
  it("manager role is not a bypass for a strict read denial", async () => {
    policies = [{ effect: "deny" }]; await expect(repo.getBatch(context(), batchInput)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(queries.some(query => query.sql.includes("FROM ops_monthly_profit_imports"))).toBe(false);
  });
  it("honors revoked detailed role permissions", async () => {
    overrides = [{ modules: "[]", detailedPermissions: "[]" }]; await expect(repo.listBatches(context(), historyInput)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it.each(["security_access_policies", "role_permissions", "users"])("does not relabel missing %s governance as monthly schema missing", async table => {
    failures[table] = { code: "ER_NO_SUCH_TABLE" }; await expect(repo.listBatches(context(), historyInput)).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR", message: "MONTHLY_FINANCIAL_READ_FAILED" });
  });
  it.each([{ code: "ER_BAD_FIELD_ERROR" }, { code: "ER_ACCESS_DENIED_ERROR" }, { errno: 1213 }, new Error("password=secret missing table")])("does not swallow native source failures %j", async error => {
    failures.ops_monthly_profit_imports = error; await expect(repo.getBatch(context(), batchInput)).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR", message: "MONTHLY_FINANCIAL_READ_FAILED" });
  });
  it.each(["listBatches", "getBatch", "getEffectiveSnapshot"] as const)("%s recognizes actual nested missing source-table errors only", async method => {
    failures.ops_monthly_profit_imports = { cause: { errno: 1146 } };
    const input = method === "listBatches" ? historyInput : method === "getBatch" ? batchInput : snapshotInput;
    expect((await repo[method](context(), input as never)).status).toBe("missing");
  });
  it.each(["getBatch", "getEffectiveSnapshot"] as const)("ordinary %s requires exact nonempty business parent scope", async method => {
    const input = method === "getBatch" ? batchInput : snapshotInput;
    await expect(repo[method](regular(), input as never)).rejects.toMatchObject({ code: "FORBIDDEN", message: "MONTHLY_FINANCIAL_READ_EXACT_SCOPE_REQUIRED" });
    expect(queries.some(query => query.sql.includes("FROM ops_monthly_profit_imports"))).toBe(false);
  });
  it("own uploaded file does not bypass ordinary business ownership", async () => {
    await expect(repo.getBatch(regular(), { ...batchInput, scope })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(rollbacks).toBe(1);
  });
  it("exact assigned owner can read own full metadata but only matching month/store/site/parent rows", async () => {
    assignments = [assignment()]; batches = [batch({}, [businessRow(), businessRow({ parentAsin: "B000000005", asin: "B000000006", sku: "foreign-parent" }),
      businessRow({ storeName: "Other Store", sku: "foreign-store" }), businessRow({ yearMonth: "2026-08", sku: "foreign-month" }), businessRow({ site: "CA", sku: "foreign-country" })])];
    const result = await repo.getBatch(regular(), { ...batchInput, scope, pageSize: 100 });
    expect(result.rows).toHaveLength(1); expect(result.rows[0].sku).toBe("SKU-original"); expect(result.batch?.visibility).toBe("full");
    const query = queries.find(query => query.sql.includes("FROM ops_inventory_owner_assignments"))!;
    expect(query.params).toEqual([7, scope.parentAsin, scope.storeName, "US"]); expect(query.sql).toContain("BINARY parent_asin=BINARY ?"); expect(query.sql).toContain("BINARY store_name=BINARY ?"); expect(query.sql).toMatch(/FOR SHARE$/u);
  });
  it("business owner may read another uploader exact scope without leaking batch metadata or cross-scope totals", async () => {
    assignments = [assignment()]; batches = [batch({ userId: 99 }, [businessRow(), businessRow({ parentAsin: "B000000005", asin: "B000000006", sku: "confidential-outside", raw: { private: "private-outside" } })])];
    const result = await repo.getBatch(regular(), { ...batchInput, scope }); const text = JSON.stringify(result);
    expect(result.batch).toEqual({ visibility: "scoped", id: 11, status: "completed", createdAt: "2026-10-12 09:08:07.123000", confirmedAt: "2026-10-12 10:08:07.456000", timestampBasis: "database_datetime_without_timezone" });
    expect(result.page.totalRows).toBeNull(); expect(result.page.matchedRows).toBe(1);
    for (const secret of ["Original 私有源文件", "a".repeat(64), "private-outside", "confidential-outside", "skippedRows", '"userId":99']) expect(text).not.toContain(secret);
  });
  it.each([{ assigneeUserId: 99 }, { workspaceId: 8 }, { parentAsin: "B000000009" }, { storeName: "Other" }, { country: "CA" }, { isActive: 0 }, { assigneeUserId: null }, { assigneeUserId: "3" }])("rejects wrong/invalid exact owner and never falls back to a mapping %j", async patch => {
    assignments = [assignment(patch)]; mappings = [mapping()]; await expect(repo.getBatch(regular(), { ...batchInput, scope })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(queries.some(query => query.sql.includes("FROM operator_name_mappings"))).toBe(false);
  });
  it("duplicate manual owners are ambiguous even if same person", async () => {
    assignments = [assignment(), assignment({ id: 52 })]; await expect(repo.getBatch(regular(), { ...batchInput, scope })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("confirmed numeric all mapping can authorize exact-scope spreadsheet rows without username", async () => {
    mappings = [mapping()]; const result = await repo.getBatch(regular(), { ...batchInput, scope }); expect(result.status).toBe("ready");
    const query = queries.find(query => query.sql.includes("FROM operator_name_mappings"))!; expect(query.params).toEqual([7, "Alice"]); expect(query.sql).toContain("source_type='all'"); expect(query.sql).toMatch(/FOR SHARE$/u);
  });
  it("verified Saihu marker uses Saihu or all mappings only, not Lingxing names", async () => {
    batches = [batch({}, [businessRow({ raw: { source: "sellfox_monthly_api", api: { currency: "USD" } } })])]; mappings = [mapping({ sourceType: "saihu" })];
    expect((await repo.getBatch(regular(), { ...batchInput, scope })).status).toBe("ready");
    expect(queries.find(query => query.sql.includes("FROM operator_name_mappings"))?.sql).toContain("source_type IN ('saihu','all')");
  });
  it.each([{ sourceType: "lingxing" }, { sourceType: "saihu" }, { workspaceId: 8 }, { isConfirmed: 0 }, { systemUserId: null }, { systemUserId: "3" }, { systemUserId: 99 }, { externalName: "Bob" }])("rejects unconfirmed, cross-source or wrong numeric mapping %j", async patch => {
    mappings = [mapping(patch)]; await expect(repo.getBatch(regular(), { ...batchInput, scope })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("conflicting confirmed mappings and partial compound names do not authorize", async () => {
    mappings = [mapping(), mapping({ id: 72, systemUserId: 99 })]; await expect(repo.getBatch(regular(), { ...batchInput, scope })).rejects.toMatchObject({ code: "FORBIDDEN" });
    mappings = [mapping()]; batches = [batch({}, [businessRow({ operator: "Alice/Unknown" })])]; await expect(repo.getBatch(regular(), { ...batchInput, scope })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("same-scope conflicting owner sets cannot be combined into authorization", async () => {
    mappings = [mapping(), mapping({ id: 72, externalName: "Bob", systemUserId: 8 })];
    batches = [batch({}, [businessRow(), businessRow({ asin: "B000000003", operator: "Alice/Bob", sku: "other" })])];
    await expect(repo.getBatch(regular(), { ...batchInput, scope })).rejects.toMatchObject({ message: "MONTHLY_FINANCIAL_READ_OWNER_CONFLICT" });
  });
  it.each([null, "", "/,", "Unknown"])("empty/unmapped names are not inferred from current user %j", async operator => {
    batches = [batch({}, [businessRow({ operator })])]; mappings = [mapping()]; await expect(repo.getBatch(regular(), { ...batchInput, scope })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it.each(["ops_inventory_owner_assignments", "operator_name_mappings"])("missing owner source %s is not monthly missing", async table => {
    failures[table] = { code: "ER_NO_SUCH_TABLE" }; await expect(repo.getBatch(regular(), { ...batchInput, scope })).rejects.toMatchObject({ message: "MONTHLY_FINANCIAL_READ_FAILED" });
  });
  it("returns manager missing batch and empty effective source without inventing data", async () => {
    batches = []; expect((await repo.getBatch(context(), batchInput)).status).toBe("not_found"); expect((await repo.getEffectiveSnapshot(context(), snapshotInput)).status).toBe("not_found");
  });
  it("cannot establish ordinary owner from an absent batch or absent snapshot", async () => {
    batches = []; await expect(repo.getBatch(regular(), { ...batchInput, scope })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(repo.getEffectiveSnapshot(regular(), { ...snapshotInput, parentAsin: scope.parentAsin })).rejects.toMatchObject({ code: "FORBIDDEN" });
    assignments = [assignment()]; expect((await repo.getBatch(regular(), { ...batchInput, scope })).status).toBe("not_found");
  });
  it("effective snapshot selects full scope before parent/uploader filtering; missing parent never falls back", async () => {
    batches = [batch({ id: 12, userId: 99 }, [businessRow({ parentAsin: "B000000004", asin: "B000000005", sku: "latest-other-parent" })]), batch({ id: 11 })]; assignments = [assignment()];
    const result = await repo.getEffectiveSnapshot(regular(), { ...snapshotInput, parentAsin: scope.parentAsin });
    expect(result.status).toBe("ready"); expect(result.selectedBatchId).toBe(12); expect(result.rows).toEqual([]); expect(result.page.matchedRows).toBe(0);
    expect(result.batch?.visibility).toBe("scoped"); expect(result.selection.scannedCount).toBeNull();
    const selects = queries.filter(query => query.sql.includes("FROM ops_monthly_profit_imports")); expect(selects).toHaveLength(1); expect(selects[0].params).toEqual([7]);
    const where = selects[0].sql.slice(selects[0].sql.indexOf("FROM ops_monthly_profit_imports")); expect(where).not.toMatch(/userId|parent|operator|storeName|yearMonth/u);
  });
  it("scans newer unrelated scope batches by true keyset, retaining only first matching full scope", async () => {
    batches = [batch({ id: 14 }, [businessRow({ storeName: "Other" })]), batch({ id: 13 }, [businessRow({ site: "CA" })]), batch({ id: 12 }, [businessRow({ yearMonth: "2026-08" })]), batch({ id: 11 })];
    const result = await repo.getEffectiveSnapshot(context(), snapshotInput); expect(result.selectedBatchId).toBe(11); expect(result.selection.scannedCount).toBe(4);
    const queriesToSource = queries.filter(query => query.sql.includes("FROM ops_monthly_profit_imports")); expect(queriesToSource.map(query => query.params)).toEqual([[7], [7, 14], [7, 13], [7, 12]]);
    expect(queriesToSource.every(query => query.sql.endsWith("LIMIT 1 FOR SHARE"))).toBe(true);
  });
  it("preview and deleted batches are not effective; highest completed id wins rather than timestamp", async () => {
    batches = [batch({ id: 14, status: "deleted" }), batch({ id: 13, status: "previewing", confirmedAt: null }), batch({ id: 12, createdAt: "2020-01-01 00:00:00.000000" }), batch({ id: 11 })];
    expect((await repo.getEffectiveSnapshot(context(), snapshotInput)).selectedBatchId).toBe(12);
  });
  it("corrupt newer unrelated candidate prevents fallback to older apparently good result", async () => {
    batches = [batch({ id: 12, payload: "{}", payloadBytes: 2 }), batch({ id: 11 })];
    const result = await repo.getEffectiveSnapshot(context(), snapshotInput); expect(result.status).toBe("invalid"); expect(result.selectedBatchId).toBeNull();
    expect(queries.filter(query => query.sql.includes("FROM ops_monthly_profit_imports"))).toHaveLength(1);
  });
  it("bounds snapshot scans explicitly, never marks partial scan as current", async () => {
    batches = Array.from({ length: 201 }, (_, index) => batch({ id: 1000 - index }, []));
    const result = await repo.getEffectiveSnapshot(context(), snapshotInput); expect(result.status).toBe("invalid"); expect(result.reasonCode).toBe("scan_incomplete"); expect(result.selection.complete).toBe(false);
    expect(queries.filter(query => query.sql.includes("FROM ops_monthly_profit_imports"))).toHaveLength(200);
  });
  it("caps aggregate snapshot transport and never fetches an over-budget JSON body", async () => {
    sourceOverride.snapshot = [batch({ payload: null, payloadBytes: 33 * 1024 * 1024 })];
    const result = await repo.getEffectiveSnapshot(context(), snapshotInput); expect(result.status).toBe("invalid"); expect(result.reasonCode).toBe("scan_incomplete");
    const query = queries.find(query => query.sql.includes("FROM ops_monthly_profit_imports"))!;
    expect(query.sql).toContain("<=33554432"); expect(query.sql).toContain("CAST(payload AS CHAR CHARACTER SET utf8mb4),NULL) AS payload");
  });
  it("decreases later snapshot transport budgets by already-read payload and month bytes", async () => {
    const newer = batch({ id: 12 }, [businessRow({ storeName: "Other" })]); batches = [newer, batch()];
    await repo.getEffectiveSnapshot(context(), snapshotInput);
    const selected = queries.filter(query => query.sql.includes("FROM ops_monthly_profit_imports"));
    expect(selected[1].sql).toContain(`<=${32 * 1024 * 1024 - Number(newer.payloadBytes) - Number(newer.monthsBytes)}`);
  });
  it("ambiguous API parent references are excluded from ordinary scoped rows even with manual owner", async () => {
    assignments = [assignment()]; batches = [batch({}, [businessRow({ raw: { source: "sellfox_monthly_api", api: { parentAsinList: [scope.parentAsin, "B000000009"] } } })])];
    const result = await repo.getBatch(regular(), { ...batchInput, scope }); expect(result.rows).toEqual([]); expect(result.page.matchedRows).toBe(0);
  });
  it("unallocated rows never escape through a nonempty ordinary parent filter", async () => {
    assignments = [assignment()]; batches = [batch({}, [businessRow({ parentAsin: "", asin: "", operator: "Alice" })])];
    const result = await repo.getBatch(regular(), { ...batchInput, scope }); expect(result.rows).toEqual([]);
  });
  it("a bad cursor result cannot masquerade as an effective completed selection", async () => {
    sourceOverride.snapshot = [batch({}, [businessRow({ storeName: "Other" })])];
    const result = await repo.getEffectiveSnapshot(context(), snapshotInput); expect(result.status).toBe("invalid"); expect(result.selectedBatchId).toBeNull();
    expect(queries.filter(query => query.sql.includes("FROM ops_monthly_profit_imports"))).toHaveLength(2);
  });
  it.each([{ status: "previewing" }, { status: "deleted" }, { workspaceId: 8 }, { id: 0 }, { payloadBytes: "7" }])("does not accept a malformed effective-source protocol %j", async patch => {
    sourceOverride.snapshot = [batch(patch)]; expect((await repo.getEffectiveSnapshot(context(), snapshotInput)).status).toBe("invalid");
  });
  it("will not treat duplicate batch ids as a successful bounded get", async () => {
    sourceOverride.batch = [batch(), batch()]; expect((await repo.getBatch(context(), batchInput)).status).toBe("invalid");
  });
  it.each([{ workspaceId: 8 }, { id: 0 }, { userId: null }, { totalRows: 2 }, { unallocatedRows: 1 }, { fileHash: "bad" }, { createdAt: new Date() }, { confirmedAt: null },
    { payload: null }, { payloadBytes: 9 }, { months: null }, { monthsBytes: 2 }, { status: "unknown" }, { sourceRunId: 91 }, { fileReferenceKind: "unexpected" },
    { createdAt: "2026-02-30 00:00:00.000000" }, { createdAt: "2026-10-12 25:00:00.000000" }])("does not return a partial batch when persisted record invalid %j", async patch => {
    sourceOverride.batch = [batch(patch)]; expect((await repo.getBatch(context(), batchInput)).status).toBe("invalid");
  });
  it("invalid payload outside requested page is still detected before a good-looking first page escapes", async () => {
    batches = [batch({}, [businessRow(), businessRow({ asin: "B000000003", sku: "bad", salesAmount: "not a number" })])];
    const result = await repo.getBatch(context(), batchInput); expect(result.status).toBe("invalid"); expect(result.rows).toEqual([]);
  });
  it.each([{ override: [batch(), batch()] }, { override: [batch({ id: 9 }), batch({ id: 11 })] }, { override: [batch({ workspaceId: 8 })] }])("rejects duplicate/out of order/cross-workspace history records", async ({ override }) => {
    sourceOverride.history = override; expect((await repo.listBatches(context(), historyInput)).status).toBe("invalid");
  });
  it("preserves Saihu mapped-json provenance rather than calling its hash an original file hash", async () => {
    batches = [batch({ fileReferenceKind: "saihu_sync_run", sourceRunId: 42 })];
    const result = await repo.listBatches(context(), historyInput); expect(result.batches[0].origin).toEqual({ kind: "saihu_sync", hashBasis: "mapped_json_bytes", sourceRunId: 42 });
  });
  it("accepts bounded mysql2 UNSIGNED decimal-string run IDs without coercing arbitrary text", async () => {
    batches = [batch({ fileReferenceKind: "saihu_sync_run", sourceRunId: "42" })];
    expect((await repo.listBatches(context(), historyInput)).batches[0].origin.sourceRunId).toBe(42);
    for (const sourceRunId of ["042", "42.0", "4e2", " 42", "2147483648", "-1", "0"]) {
      batches = [batch({ fileReferenceKind: "saihu_sync_run", sourceRunId })]; expect((await repo.listBatches(context(), historyInput)).status).toBe("invalid");
    }
  });
  it("does not report success if the transaction fails after building a read result", async () => {
    const failedTransaction = createMonthlyFinancialReadRepository({ database: async () => ({ transaction: async body => { await body({ execute } as never); throw new Error("connection commit acknowledgement secret"); } }) });
    await expect(failedTransaction.listBatches(context(), historyInput)).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR", message: "MONTHLY_FINANCIAL_READ_FAILED" });
  });
  it("unknown reference provenance remains unknown", async () => {
    batches = [batch({ fileReferenceKind: "unknown" })]; const result = await repo.listBatches(context(), historyInput);
    expect(result.batches[0].origin).toEqual({ kind: "unknown", hashBasis: "unknown", sourceRunId: null });
  });
  it("binds hostile store text as a parameter instead of interpolating it", async () => {
    const hostile = "Exact' OR 1=1 --"; const exact = { ...scope, storeName: hostile }; assignments = [assignment({ storeName: hostile })]; batches = [batch({}, [businessRow({ storeName: hostile })])];
    expect((await repo.getBatch(regular(), { ...batchInput, scope: exact })).status).toBe("ready");
    const query = queries.find(query => query.sql.includes("FROM ops_inventory_owner_assignments"))!; expect(query.sql).not.toContain(hostile); expect(query.params).toContain(hostile);
  });
});
