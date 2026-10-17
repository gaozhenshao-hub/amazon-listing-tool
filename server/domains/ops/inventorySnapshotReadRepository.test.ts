import { beforeEach, describe, expect, it, vi } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import type { SQL } from "drizzle-orm";
import type { TrpcContext } from "../../_core/context";
import { createInventorySnapshotReadRepository } from "./inventorySnapshotReadRepository";
import { INVENTORY_SOURCE_KEYS, mapInventorySources, type InventoryBusinessScope, type InventoryRaw, type InventoryScopeBinding, type InventorySources } from "../../../shared/inventorySnapshotMapping";

type Row = Record<string, unknown>;
const input = { expectedWorkspaceId: 7, search: "", unpaired: false, ageThreshold: 180 as const, groupOffset: 0, groupLimit: 10, agedGroupOffset: 0, agedGroupLimit: 10 };
const scope = { parentAsin: "B000000001", storeName: "Exact Store", country: "US", accountId: "account-1" };
const context = (role = "ops_manager", patch: Row = {}) => ({ user: { id: 3, role, status: "active", defaultWorkspaceId: 7, name: "" }, workspaceId: 7, ...patch }) as TrpcContext;
const stock = (quantity: number, value: number | null = quantity * 10) => ({ quantity, value });
const legacyRow = (patch: Row = {}): Row => ({ id: "row-1", parentAsin: scope.parentAsin, parentName: "原父产品", asin: "B000000002", msku: "MSKU-original", localSku: "SKU-original", commodityId: "commodity-1", name: "Original 产品名称",
  ownerIds: [3], operator: "Historical Alice", unpaired: false, allocation: "原始分配解释", lastShipment: "2026-10-01 12:30:00", plan: 3,
  domestic: stock(2), purchase: stock(3), shipping: stock(1), fba: stock(4), total: stock(10), aux: [{ id: "aux-1", sku: "AUX-original", name: "辅料原文", stock: stock(2), shared: true, note: "跨产品共享" }],
  notes: ["原始注释<script>alert(1)</script>"], age: { days181To270: 1, days271To365: 1, days365Plus: 1, dates: ["2026-10-15"] }, ...patch });
const legacy = (patch: Row = {}, rows: Row[] = [legacyRow()]): Row => ({ version: 1, currency: "CNY", capturedAt: 1_792_224_000_000, startedAt: 1_792_223_000_000, rows, warnings: ["private-global-warning"], sourceCounts: { ...Object.fromEntries(INVENTORY_SOURCE_KEYS.map(key => [key, 0])), fba: 1, warehouse: 1, privateGlobalSource: 123 }, ...patch });
const record = (patch: Row = {}, payload: unknown = legacy()): Row => { const wire = JSON.stringify(payload); return { id: 11, workspaceId: 7, runId: 21, capturedAt: "1792224000000", payload: wire, payloadBytes: Buffer.byteLength(wire), ...patch }; };
const assignment = (patch: Row = {}): Row => ({ id: 51, workspaceId: 7, parentAsin: scope.parentAsin, storeName: scope.storeName, country: "美国", assigneeUserId: 3, isActive: 1, ...patch });
const mapping = (patch: Row = {}): Row => ({ id: 61, workspaceId: 7, externalName: "Current Owner", sourceType: "saihu", systemUserId: 3, isConfirmed: 1, ...patch });
const fba = (patch: InventoryRaw = {}): InventoryRaw => ({ id: 1, shareKey: "stock-1", marketplaceId: "ATVPDKIKX0DER", currency: "CNY", asin: "B000000002", sku: "MSKU-v2", commodityId: "commodity-1", available: 4, reservedTransfer: 0, reservedProcessing: 0, reservedCustomerorders: 0, unfulfillable: 0, research: 0, inTransit: 0, inboundShipped: 0, inboundReceiving: 0, inboundWorking: 2, totalInventory: 4, purchaseCosts: 40, invAge181To270Days: 1, invAge271To365Days: 0, invAge365PlusDays: 1, devList: [{ devName: "Current Owner" }], parent: scope.parentAsin, store: scope.storeName, country: scope.country, account: scope.accountId, ...patch });
function binding(source: InventoryScopeBinding["ref"]["source"], index: number, id: string, exact: InventoryBusinessScope = scope): InventoryScopeBinding {
  return { ref: { source, index, id }, scope: exact, kind: "explicit_confirmed_field_mapping", mappingId: "fixture-current", fields: { parentAsin: "parent", storeName: "store", country: "country", accountId: "account" } };
}
function snapshotV2(fbaRows = [fba()], scopeBindings: InventoryScopeBinding[] = fbaRows.map((raw, index) => binding("fba", index, String(raw.id), { parentAsin: String(raw.parent), storeName: String(raw.store), country: String(raw.country), accountId: String(raw.account) })), other: Partial<InventorySources> = {}) {
  const sources: InventorySources = { warehouses: [], warehouse: [], fba: fbaRows, commodities: [], aux: [], listings: [], shipping: [], shippingItems: [], details: [], ...other };
  return mapInventorySources({ sources, capturedAt: 1_792_224_000_000, startedAt: 1_792_223_000_000, scopeBindings });
}
let actors: Row[], records: Row[], assignments: Row[], mappings: Row[], policies: Row[], overrides: Row[];
let assignmentResult: ((params: unknown[]) => Row[]) | null;
let failures: Record<string, unknown>, queries: { sql: string; params: unknown[] }[], commits: number, rollbacks: number;
const execute = vi.fn(async (statement: SQL) => {
  const query = new MySqlDialect().sqlToQuery(statement); queries.push(query);
  for (const table of ["users", "ops_inventory_snapshots", "ops_inventory_owner_assignments", "operator_name_mappings", "security_access_policies", "role_permissions"]) if (query.sql.includes(`FROM ${table}`) && failures[table]) throw failures[table];
  if (query.sql.includes("FROM users")) return [actors, []];
  if (query.sql.includes("FROM security_access_policies")) return [policies, []];
  if (query.sql.includes("FROM role_permissions")) return [overrides, []];
  if (query.sql.includes("FROM ops_inventory_snapshots")) return [records, []];
  if (query.sql.includes("FROM ops_inventory_owner_assignments")) return [assignmentResult ? assignmentResult(query.params) : assignments, []];
  if (query.sql.includes("FROM operator_name_mappings")) return [mappings, []];
  throw new Error(`Unexpected query ${query.sql}`);
});
const transaction = vi.fn(async <T>(body: (tx: { execute: typeof execute }) => Promise<T>) => {
  try { const result = await body({ execute }); commits++; return result; } catch (error) { rollbacks++; throw error; }
});
const database = vi.fn(async () => ({ transaction }));
const repo = createInventorySnapshotReadRepository({ database });
function regular() { actors[0].role = "ops_specialist"; return context("ops_specialist"); }
beforeEach(() => {
  vi.clearAllMocks(); queries = []; failures = {}; commits = 0; rollbacks = 0;
  actors = [{ id: 3, role: "ops_manager", status: "active", defaultWorkspaceId: 7 }]; assignments = []; assignmentResult = null; mappings = []; policies = []; overrides = []; records = [record()];
});
describe("inventory snapshot read-only source and live security boundary", () => {
  it("reads latest saved v1 for an authorized manager without treating its owners as authority", async () => {
    const result = await repo.get(context(), input), text = JSON.stringify(result);
    expect(result.status).toBe("ready"); expect(result.identity).toEqual({ userId: 3, workspaceId: 7 });
    expect(text).toContain("SKU-original"); expect(text).toContain("CNY"); expect(text).toContain("原始注释");
    expect(text).toContain("legacy_unverifiable"); expect(Object.keys(repo)).toEqual(["get"]);
    expect(queries.every(query => /^SELECT /u.test(query.sql))).toBe(true); expect(commits).toBe(1); expect(rollbacks).toBe(0);
    expect(queries.map(query => query.sql).join("\n")).not.toMatch(/SELECT \*|CREATE TABLE|ALTER TABLE|INSERT |DELETE |UPDATE .* SET|ops_saihu_sync_runs|schedules|product_profiles|product_weekly/u);
  });
  it("binds workspace, bounds payload in SQL, selects only exact persisted columns and locks newest id", async () => {
    await repo.get(context(), input); const query = queries.find(query => query.sql.includes("FROM ops_inventory_snapshots"))!;
    expect(query.params).toEqual([7]); expect(query.sql).toContain("id,workspace_id AS workspaceId,run_id AS runId,captured_at AS capturedAt");
    expect(query.sql).toContain("OCTET_LENGTH(CAST(payload AS CHAR CHARACTER SET utf8mb4))<=67108864");
    expect(query.sql).toMatch(/WHERE workspace_id=\? ORDER BY id DESC LIMIT 1 FOR SHARE$/u);
    expect(query.sql).not.toMatch(/status=|user_id|owner|UNIX_TIMESTAMP|DATE_FORMAT/u);
  });
  it("locks live user and strict ops_data policy within the same transaction", async () => {
    await repo.get(context(), input); expect(queries[0]).toMatchObject({ sql: "SELECT id,role,status,defaultWorkspaceId FROM users WHERE id=? FOR SHARE", params: [3] });
    const policy = queries.find(query => query.sql.includes("FROM security_access_policies"))!;
    expect(policy.params.slice(0, 3)).toEqual(["ops_data", "read", 7]); expect(policy.sql).toMatch(/FOR UPDATE\s*$/u); expect(transaction).toHaveBeenCalledTimes(1);
  });
  it("accepts genuine driver BIGINT decimal string and number, never local datetime parsing", async () => {
    const first = await repo.get(context(), input); records = [record({ capturedAt: 1_792_224_000_000 })]; const second = await repo.get(context(), input);
    expect(second).toEqual(first);
  });
  it("validates a native JSON body as well as string transport without erasing original fields", async () => {
    const first = await repo.get(context(), input); records = [record({ payload: legacy() })]; expect(await repo.get(context(), input)).toEqual(first);
  });
  it.each([null, [], new Date(), { version: 1 }, { toJSON: () => legacy() }])("rejects non-JSON native body without silent serialization normalization %j", async payload => {
    records = [record({ payload })]; expect((await repo.get(context(), input)).status).toBe("invalid");
  });
  it("keeps a corrupt latest native object from invoking accessor properties", async () => {
    const read = vi.fn(() => 1), payload = legacy(); Object.defineProperty(payload, "unexpected", { get: read, enumerable: true });
    records = [record({ payload })]; expect((await repo.get(context(), input)).status).toBe("invalid"); expect(read).not.toHaveBeenCalled();
  });
  it.each(["01792224000000", "1792224000000.0", "1.792224e12", " 1792224000000", "-1", "9007199254740993", 1.5, NaN, Infinity, null, true, new Date(), "2026-10-17 12:00:00", 253_402_300_800_000])("rejects invalid/unsafe captured_at %j", async capturedAt => {
    records = [record({ capturedAt })]; expect((await repo.get(context(), input)).status).toBe("invalid");
  });
  it("requires database captured_at to equal parsed snapshot capturedAt", async () => {
    records = [record({ capturedAt: "1792224000001" })]; expect((await repo.get(context(), input)).status).toBe("invalid");
  });
  it.each([{ workspaceId: 8 }, { runId: 0 }, { runId: "21" }, { id: 0 }, { id: "11" }, { payloadBytes: "4" }, { payloadBytes: -1 }, { payloadBytes: 3 }, { payloadBytes: 67_108_865, payload: null }, { payload: "bad", payloadBytes: 3 }])("rejects corrupt persisted identity or wire body %j", async patch => {
    records = [record(patch)]; expect((await repo.get(context(), input)).status).toBe("invalid");
  });
  it("does not retry or return an older snapshot when latest is invalid", async () => {
    records = [record({ payload: "bad", payloadBytes: 3 })]; const result = await repo.get(context(), input);
    expect(result.status).toBe("invalid"); expect(queries.filter(query => query.sql.includes("FROM ops_inventory_snapshots"))).toHaveLength(1);
    expect(JSON.stringify(result)).not.toMatch(/private-global-warning|privateGlobalSource|SKU-original/u);
  });
  it("rejects multiple rows from an invalid LIMIT 1 protocol", async () => {
    records = [record(), record({ id: 10 })]; expect((await repo.get(context(), input)).status).toBe("invalid");
  });
  it("distinguishes missing table from no saved snapshot", async () => {
    records = []; expect((await repo.get(context(), input)).status).toBe("not_found");
    failures.ops_inventory_snapshots = { code: "ER_NO_SUCH_TABLE" }; expect((await repo.get(context(), input)).status).toBe("missing");
  });
  it("recognizes wrapped actual missing source table only", async () => {
    failures.ops_inventory_snapshots = { cause: { errno: 1146 } }; const result = await repo.get(context(), input); expect(result).toMatchObject({ status: "missing", reasonCode: "table_missing" });
  });
  it.each([{ code: "ER_BAD_FIELD_ERROR" }, { code: "ER_TABLEACCESS_DENIED_ERROR" }, { errno: 1213 }, new Error("password=secret table missing")])("does not turn other source SQL failure into empty or missing %j", async error => {
    failures.ops_inventory_snapshots = error; await expect(repo.get(context(), input)).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR", message: "INVENTORY_SNAPSHOT_READ_FAILED" });
  });
  it.each(["users", "security_access_policies", "role_permissions"])("does not relabel missing %s as inventory missing", async table => {
    failures[table] = { code: "ER_NO_SUCH_TABLE" }; await expect(repo.get(context(), input)).rejects.toMatchObject({ message: "INVENTORY_SNAPSHOT_READ_FAILED" });
  });
  it("rejects anonymous access before DB", async () => {
    await expect(repo.get(context("ops_manager", { user: null }), input)).rejects.toMatchObject({ code: "UNAUTHORIZED" }); expect(database).not.toHaveBeenCalled();
  });
  it.each([{ expectedWorkspaceId: 8 }, { expectedWorkspaceId: null }, { expectedWorkspaceId: "7" }, { expectedWorkspaceId: 0 }, { ownerIds: [3] }, { operatorId: 3 }, { userId: 3 }, { refresh: true }])("rejects malformed or swapped scope input %j", async patch => {
    await expect(repo.get(context(), { ...input, ...patch } as never)).rejects.toBeInstanceOf(Error); expect(database).not.toHaveBeenCalled();
  });
  it.each([{ id: 99 }, { role: "admin" }, { status: "disabled" }, { defaultWorkspaceId: 8 }])("reloads and rejects stale current actor %j", async patch => {
    Object.assign(actors[0], patch); await expect(repo.get(context(), input)).rejects.toMatchObject({ code: "FORBIDDEN" }); expect(queries).toHaveLength(1); expect(rollbacks).toBe(1);
  });
  it("does not fall back from an explicitly changed active workspace", async () => {
    await expect(repo.get(context("ops_manager", { workspaceId: 8 }), input)).rejects.toMatchObject({ code: "FORBIDDEN" }); expect(database).not.toHaveBeenCalled();
  });
  it("manager status does not bypass a denied policy", async () => {
    policies = [{ effect: "deny" }]; await expect(repo.get(context(), input)).rejects.toMatchObject({ code: "FORBIDDEN" }); expect(queries.some(query => query.sql.includes("ops_inventory_snapshots"))).toBe(false);
  });
  it("requires current role read permission", async () => {
    overrides = [{ modules: "[]", detailedPermissions: "[]" }]; await expect(repo.get(context(), input)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it.each([null, {}])("requires transaction capability %j", async db => {
    const service = createInventorySnapshotReadRepository({ database: async () => db }); await expect(service.get(context(), input)).rejects.toMatchObject({ message: "INVENTORY_SNAPSHOT_READ_TRANSACTION_REQUIRED" });
  });
  it("ordinary caller without exact scope is explicitly blocked before reading snapshots", async () => {
    const result = await repo.get(regular(), input); expect(result.status).toBe("scope_unverifiable"); expect(queries.some(query => query.sql.includes("ops_inventory_snapshots"))).toBe(false);
  });
  it("v1 ownerIds, matching names and manual rules cannot recover missing original scope for ordinary caller", async () => {
    assignments = [assignment()]; const result = await repo.get(regular(), { ...input, exactScope: scope }); expect(result.status).toBe("scope_unverifiable");
    const text = JSON.stringify(result); for (const secret of ["private-global-warning", "privateGlobalSource", "MSKU-original", "Historical Alice", '"runId":21', '"capturedAt":']) expect(text).not.toContain(secret);
    expect(queries.some(query => /owner_assignments|operator_name_mappings/u.test(query.sql))).toBe(false);
  });
  it("manager cannot make legacy v1 exact store/account evidence out of request filters", async () => {
    const result = await repo.get(context(), { ...input, exactScope: scope }); expect(result.status).toBe("scope_unverifiable");
  });
  it("search is only a filter and cannot expand ordinary visibility", async () => {
    const result = await repo.get(regular(), { ...input, exactScope: scope, search: "Historical Alice" }); expect(result.status).toBe("scope_unverifiable");
  });
  it("never reports success if transaction completion fails", async () => {
    const service = createInventorySnapshotReadRepository({ database: async () => ({ transaction: async body => { await body({ execute } as never); throw new Error("commit acknowledgement secret"); } }) });
    await expect(service.get(context(), input)).rejects.toMatchObject({ message: "INVENTORY_SNAPSHOT_READ_FAILED" });
  });
});

describe("inventory v2 complete scope and current numeric ownership", () => {
  it("reads replayed original evidence with full FBA components and no model or owner enrichment", async () => {
    records = [record({}, snapshotV2())]; const result = await repo.get(context(), input);
    expect(result.status).toBe("ready"); expect(result.snapshot).toMatchObject({ version: 2, visibility: "full", provenance: { status: "replayed_v2" } });
    expect(result.groups[0].rows[0]).toMatchObject({ fba: stock(4), shipping: stock(0), ownerIds: [], scopeStatus: "verified", scopes: [scope], ownerEvidence: { status: "complete", names: ["Current Owner"] } });
    expect(result.groups[0].rows[0].fbaComponents[0]).toMatchObject({ available: 4, inboundWorking: 2, totalInventory: 4, refs: [{ source: "fba", index: 0, id: "1" }] });
    expect(queries.some(query => /owner_assignments|operator_name_mappings/u.test(query.sql))).toBe(false);
  });
  it("authorizes exact manual user ID only with a single proven account and canonical country", async () => {
    records = [record({}, snapshotV2())]; assignments = [assignment()];
    const result = await repo.get(regular(), { ...input, exactScope: scope });
    expect(result.status).toBe("ready"); expect(result.snapshot).toMatchObject({ visibility: "scoped", sourceCounts: null });
    const query = queries.find(query => query.sql.includes("FROM ops_inventory_owner_assignments"))!;
    expect(query.params).toEqual([7, scope.parentAsin, scope.storeName, "US"]); expect(query.sql).toMatch(/BINARY parent_asin=BINARY \? AND BINARY store_name=BINARY \?/u);
    expect(query.sql).toMatch(/is_active=1 LIMIT 2 FOR SHARE$/u); expect(query.sql).not.toMatch(/assignee_name|username/u);
    expect(queries.some(query => query.sql.includes("operator_name_mappings"))).toBe(false);
  });
  it.each([{ assigneeUserId: 4 }, { assigneeUserId: "3" }, { assigneeUserId: null }, { workspaceId: 8 }, { parentAsin: "OTHER" }, { storeName: "other" }, { country: "CA" }, { isActive: 0 }, { id: 0 }])("rejects wrong/malformed live manual ownership, with no mapping fallback %j", async patch => {
    records = [record({}, snapshotV2())]; assignments = [assignment(patch)]; mappings = [mapping()];
    const result = await repo.get(regular(), { ...input, exactScope: scope });
    expect(result.status).toBe("scope_unverifiable"); expect(result.snapshot).toBeNull(); expect(result.groups).toEqual([]);
    expect(queries.some(query => query.sql.includes("operator_name_mappings"))).toBe(false);
  });
  it("rejects duplicate live manual assignments rather than selecting an arbitrary rule", async () => {
    records = [record({}, snapshotV2())]; assignments = [assignment(), assignment({ id: 52 })];
    expect((await repo.get(regular(), { ...input, exactScope: scope })).status).toBe("scope_unverifiable");
  });
  it("cannot bind an account-less manual rule when same store/site appears under multiple accounts", async () => {
    records = [record({}, snapshotV2([fba(), fba({ id: 2, shareKey: "stock-2", account: "account-2", asin: "B000000003" })]))]; assignments = [assignment()]; mappings = [mapping()];
    const result = await repo.get(regular(), { ...input, exactScope: scope }); expect(result.status).toBe("scope_unverifiable"); expect(result.snapshot).toBeNull();
  });
  it("does not infer account uniqueness while another persisted inventory row has unknown scope", async () => {
    records = [record({}, snapshotV2([fba(), fba({ id: 2, shareKey: "stock-2", account: "account-2" })], [binding("fba", 0, "1")]))]; assignments = [assignment()];
    expect((await repo.get(regular(), { ...input, exactScope: scope })).status).toBe("scope_unverifiable");
  });
  it("does not infer account uniqueness when another account has zero stock and is absent from display rows", async () => {
    const second = fba({ id: 2, shareKey: "stock-2", account: "account-2", available: 0, totalInventory: 0, inboundWorking: 0, purchaseCosts: 0, invAge181To270Days: 0, invAge271To365Days: 0, invAge365PlusDays: 0 });
    const saved = snapshotV2([fba(), second]); expect(saved.rows).toHaveLength(1);
    records = [record({}, saved)]; assignments = [assignment()];
    expect((await repo.get(regular(), { ...input, exactScope: scope })).status).toBe("scope_unverifiable");
  });
  it("does not infer account uniqueness when a zero-stock raw source lacks a binding", async () => {
    const second = fba({ id: 2, shareKey: "stock-2", account: "account-2", available: 0, totalInventory: 0, inboundWorking: 0, purchaseCosts: 0, invAge181To270Days: 0, invAge271To365Days: 0, invAge365PlusDays: 0 });
    const saved = snapshotV2([fba(), second], [binding("fba", 0, "1")]); expect(saved.rows).toHaveLength(1);
    records = [record({}, saved)]; assignments = [assignment()];
    expect((await repo.get(regular(), { ...input, exactScope: scope })).status).toBe("scope_unverifiable");
  });
  it("applies the same source identity normalization to zero-row universe as mapper collection", async () => {
    const second = fba({ id: 2, shareKey: "stock-2", account: "account-2", marketplaceId: " ATVPDKIKX0DER ", available: 0, totalInventory: 0, inboundWorking: 0, purchaseCosts: 0, invAge181To270Days: 0, invAge271To365Days: 0, invAge365PlusDays: 0 });
    const saved = snapshotV2([fba(), second], [binding("fba", 0, "1")]); expect(saved.rows).toHaveLength(1);
    records = [record({}, saved)]; assignments = [assignment()];
    expect((await repo.get(regular(), { ...input, exactScope: scope })).status).toBe("scope_unverifiable");
  });
  it("retains known account collisions from source listing bindings even with no quantity-bearing row", async () => {
    const otherScope = { ...scope, accountId: "account-2" };
    const saved = snapshotV2([fba()], [binding("fba", 0, "1"), binding("listings", 0, "listing-2", otherScope)], {
      listings: [{ id: "listing-2", commodityId: "other-commodity", asin: "B000000005", sku: "OTHER-MSKU", marketplaceId: "ATVPDKIKX0DER", parent: scope.parentAsin, store: scope.storeName, country: "US", account: "account-2" }],
    });
    expect(saved.rows).toHaveLength(1); records = [record({}, saved)]; assignments = [assignment()];
    expect((await repo.get(regular(), { ...input, exactScope: scope })).status).toBe("scope_unverifiable");
  });
  it.each(["saihu", "all"])("uses exact confirmed %s numeric mapping when no manual rule exists", async sourceType => {
    records = [record({}, snapshotV2())]; mappings = [mapping({ sourceType })];
    const result = await repo.get(regular(), { ...input, exactScope: scope }); expect(result.status).toBe("ready");
    const query = queries.find(query => query.sql.includes("FROM operator_name_mappings"))!;
    expect(query.params).toEqual([7, "saihu", "Current Owner"]); expect(query.sql).toContain("source_type IN (?,'all')");
    expect(query.sql).toContain("BINARY external_name IN (?)"); expect(query.sql).toMatch(/LIMIT 1001 FOR SHARE$/u);
  });
  it.each([{ sourceType: "lingxing" }, { sourceType: "unknown" }, { systemUserId: 4 }, { systemUserId: "3" }, { systemUserId: null }, { isConfirmed: 0 }, { workspaceId: 8 }, { externalName: "" }, { externalName: "current owner" }, { id: 0 }])("does not substitute source kind, name similarity or unconfirmed/malformed mapping %j", async patch => {
    records = [record({}, snapshotV2())]; mappings = [mapping(patch)]; expect((await repo.get(regular(), { ...input, exactScope: scope })).status).toBe("scope_unverifiable");
  });
  it("rejects conflicting all and source-specific mappings", async () => {
    records = [record({}, snapshotV2())]; mappings = [mapping(), mapping({ id: 62, sourceType: "all", systemUserId: 4 })];
    expect((await repo.get(regular(), { ...input, exactScope: scope })).status).toBe("scope_unverifiable");
  });
  it.each([{ devList: [] }, { devList: [{ devName: "" }] }, { devList: [{ name: "Current Owner" }] }])("does not use old operator/name fields for missing raw devName evidence %j", async ({ devList }) => {
    records = [record({}, snapshotV2([fba({ devList, operator: "Current Owner", ownerIds: [3] })]))]; mappings = [mapping()];
    expect((await repo.get(regular(), { ...input, exactScope: scope })).status).toBe("scope_unverifiable");
    expect(queries.some(query => query.sql.includes("operator_name_mappings"))).toBe(false);
  });
  it("requires all compound raw owner values to resolve to the caller", async () => {
    records = [record({}, snapshotV2([fba({ devList: [{ devName: "Current Owner / Other Owner" }] })]))];
    mappings = [mapping(), mapping({ id: 62, externalName: "Other Owner", systemUserId: 4 })];
    expect((await repo.get(regular(), { ...input, exactScope: scope })).status).toBe("scope_unverifiable");
    mappings[1].systemUserId = 3; expect((await repo.get(context("ops_specialist"), { ...input, exactScope: scope })).status).toBe("ready");
  });
  it("requires every scope represented by deduplicated cross-market physical stock", async () => {
    const ca = { ...scope, country: "CA" };
    records = [record({}, snapshotV2([fba(), fba({ id: 2, country: "CA", marketplaceId: "A2EUQ1WTGCTBG2" })]))];
    assignmentResult = params => [assignment({ id: params[3] === "CA" ? 52 : 51, country: params[3], assigneeUserId: params[3] === "CA" ? 4 : 3 })];
    const denied = await repo.get(regular(), { ...input, exactScope: scope }); expect(denied.status).toBe("scope_unverifiable");
    expect(queries.filter(query => query.sql.includes("owner_assignments")).map(query => query.params[3])).toEqual(["US", "CA"]);
    assignmentResult = params => [assignment({ id: params[3] === "CA" ? 52 : 51, country: params[3] })];
    const result = await repo.get(context("ops_specialist"), { ...input, exactScope: scope }); expect(result.status).toBe("ready");
    expect(result.totals?.fba).toEqual(stock(4)); expect(result.groups[0].rows[0].scopes).toEqual([scope, ca]); expect(result.groups[0].rows[0].fbaComponents[0].refs).toHaveLength(2);
  });
  it("rejects inconsistent source owners across copies even if one copy names current user", async () => {
    records = [record({}, snapshotV2([fba(), fba({ id: 2, country: "CA", marketplaceId: "A2EUQ1WTGCTBG2", devList: [{ devName: "Other Owner" }] })]))]; mappings = [mapping()];
    expect((await repo.get(regular(), { ...input, exactScope: scope })).status).toBe("scope_unverifiable");
    expect(queries.some(query => query.sql.includes("operator_name_mappings"))).toBe(false);
  });
  it("exact product view cannot reveal unrelated global rows, sourceCounts, warnings or row totals", async () => {
    records = [record({}, snapshotV2([fba(), fba({ id: 2, shareKey: "secret-stock", asin: "SECRET-ASIN", sku: "SECRET-MSKU", store: "SECRET-STORE", parent: "SECRET-PARENT", account: "secret-account", devList: [{ devName: "SECRET-OWNER" }] })]))]; assignments = [assignment()];
    const result = await repo.get(regular(), { ...input, exactScope: scope }); expect(result.status).toBe("ready");
    expect(result.page.totalRows).toBe(1); expect(result.totals?.total).toEqual(stock(4)); expect(result.snapshot?.sourceCounts).toBeNull();
    expect(JSON.stringify(result)).not.toMatch(/SECRET|secret-stock|secret-account/u);
  });
  it.each([{ parentAsin: "NO-PARENT" }, { storeName: "NO-STORE" }, { country: "CA" }, { accountId: "NO-ACCOUNT" }])("does not use client exact scope to fill or replace original scope %j", async patch => {
    records = [record({}, snapshotV2())]; assignments = [assignment()]; const result = await repo.get(regular(), { ...input, exactScope: { ...scope, ...patch } });
    expect(result.status).toBe("scope_unverifiable"); expect(result.snapshot).toBeNull(); expect(queries.some(query => /owner_assignments|operator_name_mappings/u.test(query.sql))).toBe(false);
  });
  it.each(["ops_inventory_owner_assignments", "operator_name_mappings"])("missing authorization table %s is not missing snapshot or empty success", async table => {
    records = [record({}, snapshotV2())]; failures[table] = { code: "ER_NO_SUCH_TABLE" }; mappings = [mapping()];
    await expect(repo.get(regular(), { ...input, exactScope: scope })).rejects.toMatchObject({ message: "INVENTORY_SNAPSHOT_READ_FAILED" });
  });
  it("shared-source replay rejects altered saved totals, ownership and source references", async () => {
    for (const mutate of [(value: ReturnType<typeof snapshotV2>) => { value.rows[0].ownerIds = [3]; }, (value: ReturnType<typeof snapshotV2>) => { value.rows[0].fba.quantity = 500; }, (value: ReturnType<typeof snapshotV2>) => { value.rows[0].sourceRefs[0].id = "forged"; }]) {
      const saved = snapshotV2(); mutate(saved); records = [record({}, saved)]; expect((await repo.get(context(), input)).status).toBe("invalid");
    }
  });
  it("paginates whole groups with genuine total and continuation after scope authorization", async () => {
    records = [record({}, snapshotV2([fba(), fba({ id: 2, shareKey: "stock-2", parent: "B000000003", asin: "B000000004" })]))];
    const first = await repo.get(context(), { ...input, groupLimit: 1, agedGroupLimit: 1 }); expect(first.status).toBe("ready");
    expect(first.page).toMatchObject({ totalGroups: 2, totalRows: 2, nextOffset: 1, hasMore: true }); expect(first.groups).toHaveLength(1); expect(first.totals?.fba).toEqual(stock(8));
    const second = await repo.get(context(), { ...input, groupLimit: 1, groupOffset: 1, agedGroupLimit: 1, agedGroupOffset: 1 });
    expect(second.page).toMatchObject({ totalGroups: 2, nextOffset: null, hasMore: false }); expect(second.groups[0].id).not.toBe(first.groups[0].id);
  });
  it("keeps all child rows in a matched parent group rather than presenting partial stock as its total", async () => {
    records = [record({}, snapshotV2([fba(), fba({ id: 2, shareKey: "stock-2", asin: "B000000004", sku: "MSKU-SECOND" })]))]; assignments = [assignment()];
    const result = await repo.get(regular(), { ...input, exactScope: scope, search: "MSKU-SECOND", groupLimit: 1 });
    expect(result.status).toBe("ready"); expect(result.groups).toHaveLength(1); expect(result.groups[0].rows).toHaveLength(2); expect(result.totals?.fba).toEqual(stock(8));
  });
  it("authorizes all parent scopes of shared auxiliaries before search and deduplicates their values once", async () => {
    const otherScope = { ...scope, parentAsin: "B000000003" }, rawScope = { parent: scope.parentAsin, store: scope.storeName, country: "US", account: scope.accountId };
    const first = fba(), second = fba({ id: 2, shareKey: "stock-2", commodityId: "commodity-2", parent: otherScope.parentAsin, asin: "B000000004", sku: "MSKU-OTHER" });
    const saved = snapshotV2([first, second], [binding("fba", 0, "1"), binding("fba", 1, "2", otherScope), binding("warehouse", 0, "w1"), binding("details", 0, "commodity-1"), binding("details", 1, "commodity-2", otherScope)], {
      warehouses: [{ id: "warehouse-1", type: 0 }],
      warehouse: [{ id: "w1", warehouseId: "warehouse-1", commodityId: "aux-1", commoditySku: "SHARED-AUX", stockAllNum: 2, stockAvailable: 2, stockDefective: 0, stockOccupy: 0, stockWait: 0, stockPlan: 0, totalPurchase: 20, onWayPurchase: 0, devList: [{ devName: "Current Owner" }], ...rawScope }],
      aux: [{ id: "aux-1", sku: "SHARED-AUX", name: "共享辅料原文" }],
      details: [{ id: "commodity-1", commodityAux: [{ auxId: "aux-1" }], ...rawScope }, { id: "commodity-2", commodityAux: [{ auxId: "aux-1" }], ...rawScope, parent: otherScope.parentAsin }],
    });
    expect(saved.rows).toHaveLength(2); expect(saved.rows.every(row => row.aux.length === 1)).toBe(true);
    records = [record({}, saved)];
    assignmentResult = params => [assignment({ parentAsin: params[1], assigneeUserId: params[1] === otherScope.parentAsin ? 4 : 3 })];
    const denied = await repo.get(regular(), { ...input, exactScope: scope, search: "MSKU-v2" });
    expect(denied.status).toBe("scope_unverifiable"); expect(denied.snapshot).toBeNull(); expect(denied.totals).toBeNull();
    assignmentResult = params => [assignment({ parentAsin: params[1] })];
    const result = await repo.get(context("ops_specialist"), { ...input, exactScope: scope });
    expect(result.status).toBe("ready"); expect(result.totals?.aux).toEqual(stock(2)); expect(result.totals?.fba).toEqual(stock(8));
    expect(result.groups.flatMap(group => group.rows)).toHaveLength(2);
  });
});
