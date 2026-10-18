import { beforeEach, describe, expect, it, vi } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import type { SQL } from "drizzle-orm";
import type { TrpcContext } from "../../_core/context";
import type { DbExecutor } from "../../repositories/dbClient";
import { MONTHLY_FINANCIAL_METRICS } from "../../../shared/monthlyFinancialRead";
import { ProfitAnalysisPreviewResultSchema, type ProfitAnalysisPreviewInput } from "../../../shared/profitAnalysis";
import { createProfitAnalysisSnapshotRepository, authorizeProfitAnalysisSnapshot } from "./profitAnalysisSnapshotRepository";

type Row = Record<string, unknown>;
const input: ProfitAnalysisPreviewInput = { expectedWorkspaceId: 7, month: "2026-09", scope: { storeName: "Exact Store", country: "US", parentAsin: "PARENT", currency: "USD", basis: "child_rows" } };
const context = (role = "ops_manager", patch: Row = {}) => ({ user: { id: 3, role, status: "active", defaultWorkspaceId: 7 }, workspaceId: 7, ...patch }) as TrpcContext;
const business = (patch: Row = {}): Row => ({ ...Object.fromEntries(MONTHLY_FINANCIAL_METRICS.map(key => [key, 0])), yearMonth: input.month,
  parentAsin: "PARENT", asin: "CHILD", sku: "SKU", title: "PRODUCT", storeName: input.scope.storeName, site: "美国站", operator: "external-A",
  financialProfit: 12, salesAmount: 40, salesQty: 2, raw: { currency: "USD", confidentialRaw: "RAW_BODY_PRIVATE" }, ...patch });
function batch(id = 11, rows = [business()], patch: Row = {}): Row {
  const payload = JSON.stringify(rows), months = JSON.stringify([...new Set(rows.map(row => row.yearMonth))]);
  return { id, workspaceId: 7, userId: 99, fileName: "PRIVATE_UPLOADER_FILE.xlsx", fileHash: "a".repeat(64), status: "completed", totalRows: rows.length, skippedRows: 0,
    unallocatedRows: rows.filter(row => !row.parentAsin).length, months, monthsBytes: Buffer.byteLength(months), payload, payloadBytes: Buffer.byteLength(payload),
    createdAt: "2026-10-12 09:08:07.123000", confirmedAt: "2026-10-12 10:08:07.456000", fileReferenceKind: "storage", sourceRunId: null, ...patch };
}
const manual = (patch: Row = {}): Row => ({ id: 51, workspaceId: 7, parentAsin: "PARENT", storeName: "Exact Store", country: "美国", assigneeUserId: 3, isActive: 1, ...patch });
const mapping = (patch: Row = {}): Row => ({ id: 61, workspaceId: 7, externalName: "external-A", sourceType: "all", systemUserId: 3, isConfirmed: 1, ...patch });
const member = (patch: Row = {}): Row => ({ id: 21, workspaceId: 7, userId: 3, membershipStatus: "active", actorId: 3, actorStatus: "active", ...patch });
const override = (patch: Row = {}): Row => ({ id: 1, workspaceId: 7, role: "ops_specialist", modules: '["ops"]', detailedPermissions: null, detailBytes: 0, ...patch });
const policy = (patch: Row = {}): Row => ({ id: 70, workspaceId: 7, resourceType: "ops_data", resourceId: null, action: "read", effect: "allow", principalType: "user", principalId: "3", status: "active", ...patch });
let actor: Row[], workspaces: Row[], memberships: Row[], members: Row[], batches: Row[], manuals: Row[], mappings: Row[], policies: Row[], overrides: Row[];
let failures: Record<string, unknown>, engines: Row[] | null, candidates: Row[] | null, afterCandidates: (() => void) | null;
let queries: { sql: string; params: unknown[] }[];
const execute = vi.fn(async (statement: SQL) => {
  const q = new MySqlDialect().sqlToQuery(statement); queries.push(q);
  for (const [part, error] of Object.entries(failures)) if (q.sql.includes(part)) throw error;
  if (q.sql.includes("information_schema.TABLES")) return [engines ?? q.params.map(tableName => ({ tableName, engine: "InnoDB" })), []];
  if (q.sql.includes("FROM workspaces")) return [workspaces, []];
  if (q.sql.includes("FROM users")) return [actor, []];
  if (q.sql.includes("FROM workspace_memberships m")) return [members.filter(row => q.params.slice(1).includes(Number(row.userId))), []];
  if (q.sql.includes("FROM workspace_memberships")) return [memberships, []];
  if (q.sql.includes("FROM role_permissions")) return [overrides, []];
  if (q.sql.includes("FROM security_access_policies")) return [policies, []];
  if (q.sql.includes("FROM ops_inventory_owner_assignments")) return [manuals, []];
  if (q.sql.includes("FROM operator_name_mappings")) return [mappings.filter(row => q.params.slice(1).includes(row.externalName) && (q.sql.includes("IN ('saihu','all')") ? ["saihu", "all"] : ["all"]).includes(String(row.sourceType))), []];
  if (q.sql.includes("FROM ops_monthly_profit_imports")) {
    if (q.sql.includes("LIMIT 201")) { const found = candidates ?? batches.filter(row => row.workspaceId === q.params[0] && row.status === "completed").sort((a, b) => Number(b.id) - Number(a.id)).slice(0, 201).map(({ id, workspaceId, status, payloadBytes, monthsBytes }) => ({ id, workspaceId, status, payloadBytes, monthsBytes })); afterCandidates?.(); return [found, []]; }
    return [batches.filter(row => row.workspaceId === q.params[0] && row.id === q.params[1]), []];
  }
  throw new Error(`Unexpected SQL ${q.sql}`);
});
const transaction = vi.fn(async <T>(body: (tx: { execute: typeof execute }) => Promise<T>) => body({ execute }));
// vi.fn erases a generic function's return type to unknown. Preserve the
// actual callback result without weakening the production transaction API.
async function transactionAdapter<T>(body: (tx: DbExecutor) => Promise<T>): Promise<T> {
  let result: Promise<T> | undefined;
  await transaction(tx => { result = body(tx); return result; });
  if (!result) throw new Error("Transaction mock did not execute its callback");
  return result;
}
const permission = vi.fn(async () => undefined);
const repo = createProfitAnalysisSnapshotRepository({ database: async () => ({ transaction: transactionAdapter }), permission });
function regular() { actor[0].role = "ops_specialist"; memberships[0].role = "ops_specialist"; overrides = [override()]; return context("ops_specialist"); }
beforeEach(() => {
  vi.clearAllMocks(); actor = [{ id: 3, role: "ops_manager", status: "active", defaultWorkspaceId: 7 }]; workspaces = [{ id: 7, status: "active" }];
  memberships = [{ id: 21, workspaceId: 7, userId: 3, role: "ops_manager", status: "active" }]; members = [member()];
  batches = [batch(11), batch(10, [business({ yearMonth: "2026-08", financialProfit: 6 })])]; manuals = []; mappings = []; policies = []; overrides = [];
  failures = {}; engines = null; candidates = null; afterCandidates = null; queries = [];
});
describe("authorized complete profit analysis snapshots", () => {
  it("reuses a fresh same-transaction identity for worker/save without trusting an old HTTP role", async () => {
    actor[0].role = "admin";
    const session = await authorizeProfitAnalysisSnapshot({ execute }, { identity: { userId: 3, workspaceId: 7 } }, permission);
    expect(session.actor).toEqual({ id: 3, role: "admin", defaultWorkspaceId: 7 });
    expect(session.tx.execute).toBe(execute); expect(session.manager).toBe(true);
    expect(queries.every(query => /^SELECT /u.test(query.sql))).toBe(true);
    await expect(authorizeProfitAnalysisSnapshot({ execute }, { identity: { userId: 3, workspaceId: 7 }, expectedRole: "ops_manager" }, permission))
      .rejects.toMatchObject({ code: "FORBIDDEN", message: "PROFIT_ANALYSIS_ACTOR_CHANGED" });
  });
  it("the reusable worker authority rejects stale workspace membership and nonnumeric owner IDs", async () => {
    memberships[0].status = "disabled";
    await expect(authorizeProfitAnalysisSnapshot({ execute }, { identity: { userId: 3, workspaceId: 7 } }, permission)).rejects.toMatchObject({ code: "FORBIDDEN" });
    queries = [];
    await expect(authorizeProfitAnalysisSnapshot({ execute }, { identity: { userId: "3" as never, workspaceId: 7 } }, permission)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(queries).toHaveLength(0);
  });
  it("builds dual-month evidence in one read-only transaction with private source proof", async () => {
    const result = await repo.get(context(), input); expect(ProfitAnalysisPreviewResultSchema.parse(result)).toEqual(result);
    expect(result).toMatchObject({ status: "ready", canGenerate: false, evidence: { parentBefore: 6, parentAfter: 12, delta: 6 } });
    expect(result.source?.periods.map(period => period.month)).toEqual(["2026-08", "2026-09"]);
    expect(transaction).toHaveBeenCalledTimes(1); expect(permission).toHaveBeenCalledWith(expect.objectContaining({ resource: "ops_data", action: "read", workspaceId: 7, authorizationRead: { executor: expect.anything(), strict: true, lock: true } }));
    expect(queries.every(query => /^SELECT /u.test(query.sql))).toBe(true);
    expect(queries[0].sql).toContain("FROM workspaces"); expect(queries[1].sql).toContain("FROM users");
    const text = JSON.stringify(result); expect(text).not.toMatch(/RAW_BODY_PRIVATE|PRIVATE_UPLOADER_FILE|external-A|"userId":99|"payload"|"raw"/u);
    expect(Object.keys(repo)).toEqual(["get"]);
  });
  it("captures the seventh calendar month for the earliest visible six-month point", async () => {
    batches = [batch(11, [business({ yearMonth: "2026-04" }), business({ yearMonth: "2026-03", financialProfit: 4 })])];
    const result = await repo.get(context(), { ...input, month: "2026-04" }); expect(result.evidence).toMatchObject({ previousMonth: "2026-03", parentBefore: 4 });
  });
  it("uses whole-scope winner before parent filtering; never repairs a missing parent from old batches", async () => {
    batches.unshift(batch(12, [business({ parentAsin: "OTHER", title: "PRIVATE_OTHER" })]));
    const result = await repo.get(context(), input); expect(result).toMatchObject({ status: "blocked", reasonCode: "current_month_missing" });
    expect(result.source?.periods[1].selection.selectedBatchId).toBe(12); expect(JSON.stringify(result)).not.toContain("PRIVATE_OTHER");
    expect(queries.filter(query => query.sql.includes("FROM ops_monthly_profit_imports")).every(query => !/AND userId=|parentAsin|parent_asin|storeName=/u.test(query.sql))).toBe(true);
  });
  it("does not silently cap incomplete candidate sets", async () => {
    batches = Array.from({ length: 201 }, (_, index) => batch(index + 1, [business({ yearMonth: "2020-01" })]));
    expect(await repo.get(context(), input)).toMatchObject({ status: "unavailable", reasonCode: "scan_incomplete", evidence: null, source: null });
  });
  it("exactly 200 candidates proves absent source rather than zero profit", async () => {
    batches = Array.from({ length: 200 }, (_, index) => batch(index + 1, [business({ yearMonth: "2020-01" })]));
    expect(await repo.get(context(), input)).toMatchObject({ status: "blocked", evidence: { parentBefore: null, parentAfter: null } });
  });
  it("explicitly binds empty source hashes to workspace identity", async () => {
    batches = []; const a = await repo.get(context(), input);
    actor[0].defaultWorkspaceId = 8; workspaces[0].id = 8; memberships[0].workspaceId = 8;
    const b = await repo.get(context("ops_manager", { workspaceId: 8 }), { ...input, expectedWorkspaceId: 8 });
    expect(a.status).toBe("blocked"); expect(b.status).toBe("blocked"); expect(a.source?.selectionHash).not.toBe(b.source?.selectionHash); expect(a.source?.sourceHash).not.toBe(b.source?.sourceHash);
  });
  it("will not accept inserted candidates after fixing identities", async () => {
    afterCandidates = () => batches.push(batch(12, [business({ financialProfit: 999 })]));
    expect((await repo.get(context(), input)).evidence?.parentAfter).toBe(12);
  });
  it("newer corrupt unrelated data rejects complete preview rather than skipping it", async () => {
    batches.unshift(batch(12, [business({ storeName: "OTHER" })], { payload: "bad", payloadBytes: 3 }));
    expect(await repo.get(context(), input)).toMatchObject({ status: "unavailable", reasonCode: "source_invalid", source: null });
  });
  it("captures all original source fields including unrelated rows in the hash but not public response", async () => {
    batches[0] = batch(11, [business(), business({ parentAsin: "OTHER", asin: "OTHER_CHILD", title: "PRIVATE_TITLE" })]);
    const a = await repo.get(context(), input);
    batches[0] = batch(11, [business(), business({ parentAsin: "OTHER", asin: "OTHER_CHILD", title: "CHANGED_PRIVATE_TITLE" })]);
    const b = await repo.get(context(), input); expect(a.source?.sourceHash).not.toBe(b.source?.sourceHash);
    expect(JSON.stringify(b)).not.toContain("CHANGED_PRIVATE_TITLE"); expect(a.evidence?.parentAfter).toBe(b.evidence?.parentAfter);
  });
  it("native JSON key order/whitespace is semantically stable while content edits invalidate", async () => {
    const a = await repo.get(context(), input);
    const parsed = JSON.parse(String(batches[0].payload)) as Row[]; const payload = JSON.stringify(parsed.map(row => Object.fromEntries(Object.entries(row).reverse())), null, 2);
    batches[0] = { ...batches[0], payload, payloadBytes: Buffer.byteLength(payload), months: '[ "2026-09" ]', monthsBytes: 13 };
    const b = await repo.get(context(), input); expect(b.status).toBe("ready"); expect(b.source?.sourceHash).toBe(a.source?.sourceHash);
  });
  it("does not combine currencies; unknown currency is not dropped from an explicit USD scope", async () => {
    batches[0] = batch(11, [business(), business({ asin: "CHILD2", raw: {} })]);
    expect(await repo.get(context(), input)).toMatchObject({ status: "unavailable", reasonCode: "unknown_currency" });
  });
  it("unknown-currency partition is explicitly blocked, never inferred from US", async () => {
    batches = [batch(11, [business({ raw: {} }), business({ raw: {}, yearMonth: "2026-08" })])];
    expect(await repo.get(context(), { ...input, scope: { ...input.scope, currency: null } })).toMatchObject({ status: "blocked", reasonCode: "currency_unknown" });
  });
  it("keeps reported parent totals separate from child rows", async () => {
    batches[0] = batch(11, [business(), business({ asin: "", sku: "PARENT_SKU", financialProfit: 100 })]);
    expect((await repo.get(context(), input)).evidence?.parentAfter).toBe(12);
    expect((await repo.get(context(), { ...input, scope: { ...input.scope, basis: "reported_parent_row" } })).evidence?.parentAfter).toBe(100);
  });
  it("rejects multiple reported parent totals and asin-equals-parent ambiguous grains", async () => {
    batches[0] = batch(11, [business({ asin: "", sku: "A" }), business({ asin: "", sku: "B" })]);
    expect(await repo.get(context(), { ...input, scope: { ...input.scope, basis: "reported_parent_row" } })).toMatchObject({ reasonCode: "ambiguous_financial_basis" });
    batches[0] = batch(11, [business({ asin: "PARENT" })]); expect(await repo.get(context(), input)).toMatchObject({ reasonCode: "ambiguous_financial_basis" });
  });
  it.each(["PARENT", "OTHER", ""])("does not discard ambiguous parent candidates before completeness checks (stored parent %s)", async parentAsin => {
    batches[0] = batch(11, [business(), business({ asin: "AMBIGUOUS_CHILD", parentAsin, raw: { currency: "USD", api: { parentAsinList: ["PARENT", "OTHER"] } } })]);
    expect(await repo.get(context(), input)).toMatchObject({ status: "unavailable", reasonCode: "ambiguous_financial_basis", source: null, evidence: null });
  });
  it("rejects a stored parent that contradicts the only original parent candidate", async () => {
    batches[0] = batch(11, [business({ raw: { currency: "USD", api: { parentAsinList: ["OTHER"] } } })]);
    expect(await repo.get(context(), input)).toMatchObject({ status: "unavailable", reasonCode: "ambiguous_financial_basis" });
  });
  it("missing profit remains blocked, never zero-filled", async () => {
    batches[0] = batch(11, [business({ financialProfit: null })]);
    expect(await repo.get(context(), input)).toMatchObject({ status: "blocked", reasonCode: "current_profit_unknown" });
  });
  it.each(["workspaces", "users", "workspace_memberships", "role_permissions", "security_access_policies", "ops_monthly_profit_imports"])("rejects nontransactional/missing %s schema", async table => {
    const tables = ["workspaces", "users", "workspace_memberships", "role_permissions", "security_access_policies", "ops_monthly_profit_imports"];
    engines = tables.map(tableName => ({ tableName, engine: tableName === table ? "MyISAM" : "InnoDB" }));
    expect(await repo.get(context(), input)).toMatchObject({ status: "unavailable", reasonCode: "schema_unavailable" }); expect(permission).not.toHaveBeenCalled();
  });
  it.each(["workspace", "actor", "membership", "duplicate_membership"])("fresh %s revoke denies even a cached manager", async kind => {
    if (kind === "workspace") workspaces[0].status = "disabled";
    if (kind === "actor") actor[0].status = "disabled";
    if (kind === "membership") memberships[0].status = "disabled";
    if (kind === "duplicate_membership") memberships.push({ ...memberships[0], id: 22 });
    await expect(repo.get(context(), input)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("workspace identity cannot be substituted", async () => { await expect(repo.get(context(), { ...input, expectedWorkspaceId: 8 })).rejects.toMatchObject({ code: "FORBIDDEN" }); expect(transaction).not.toHaveBeenCalled(); });
  it("explicit directory deny blocks a resource allow, including admin", async () => {
    actor[0].role = "admin"; overrides = [override({ role: "admin", detailedPermissions: JSON.stringify([{ moduleId: "ops", operations: ["read"], subModules: [{ subModuleId: "ops_profit", operations: [] }] }]), detailBytes: 150 })];
    await expect(repo.get(context("admin"), input)).rejects.toMatchObject({ code: "FORBIDDEN", message: "PROFIT_ANALYSIS_DIRECTORY_DENIED" }); expect(permission).not.toHaveBeenCalled();
  });
  it("workspace directory override wins over a global deny", async () => {
    const ctx = regular(); overrides.push(override({ id: 2, workspaceId: null, modules: "[]" })); manuals = [manual()];
    expect((await repo.get(ctx, input)).status).toBe("ready");
  });
  it.each(["bad-json", "duplicate", "oversized", "native-invalid"])("malformed directory %s fails closed", async kind => {
    const ctx = regular(); manuals = [manual()];
    if (kind === "bad-json") overrides[0].modules = "bad";
    if (kind === "duplicate") overrides.push({ ...overrides[0], id: 2 });
    if (kind === "oversized") { overrides[0].detailedPermissions = null; overrides[0].detailBytes = 65537; }
    if (kind === "native-invalid") overrides[0].modules = ["ops", "ops"];
    await expect(repo.get(ctx, input)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("manual numeric ownership overrides mappings and active country alias duplicates are denied", async () => {
    const ctx = regular(); manuals = [manual()]; expect((await repo.get(ctx, input)).status).toBe("ready"); expect(queries.some(query => query.sql.includes("FROM operator_name_mappings"))).toBe(false);
    manuals = [manual({ assigneeUserId: 4 })]; mappings = [mapping()]; await expect(repo.get(ctx, input)).rejects.toMatchObject({ code: "FORBIDDEN" });
    manuals = [manual(), manual({ id: 52, country: "US" })]; await expect(repo.get(ctx, input)).rejects.toMatchObject({ code: "FORBIDDEN", message: "PROFIT_ANALYSIS_OWNER_AMBIGUOUS" });
  });
  it("preserves raw manual country alias but never uses display names as authority", async () => {
    const ctx = regular(); mappings = [mapping()]; expect((await repo.get(ctx, input)).status).toBe("ready");
    mappings = []; await expect(repo.get(ctx, input)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("all compound operator names must map uniquely to active same-workspace numeric members", async () => {
    const ctx = regular(); batches = [batch(11, [business({ operator: "external-A/other" }), business({ operator: "external-A/other", yearMonth: "2026-08" })])];
    mappings = [mapping(), mapping({ id: 62, externalName: "other", systemUserId: 4 })]; members.push(member({ id: 22, userId: 4, actorId: 4 }));
    expect((await repo.get(ctx, input)).status).toBe("ready");
    members[1].membershipStatus = "disabled"; await expect(repo.get(ctx, input)).rejects.toMatchObject({ code: "FORBIDDEN" });
    members = [member()]; await expect(repo.get(ctx, input)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("duplicate or foreign memberships cannot prove mapping authorization", async () => {
    const ctx = regular(); mappings = [mapping()]; members.push(member({ id: 22 })); await expect(repo.get(ctx, input)).rejects.toMatchObject({ code: "FORBIDDEN" });
    members = [member({ workspaceId: 8 })]; await expect(repo.get(ctx, input)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("driver string IDs cannot masquerade as active numeric members", async () => {
    const ctx = regular(); manuals = [manual()]; members = [member({ userId: "3", actorId: "3" })];
    await expect(repo.get(ctx, input)).rejects.toMatchObject({ code: "FORBIDDEN", message: "PROFIT_ANALYSIS_OWNER_MEMBERSHIP_INVALID" });
  });
  it("all original parent rows are authorized before currency filtering", async () => {
    const ctx = regular(); mappings = [mapping()]; batches[0] = batch(11, [business(), business({ asin: "OTHER", operator: "unmapped", raw: { currency: "CAD" } })]);
    await expect(repo.get(ctx, input)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("native source-specific mappings are used only with verified saihu batch origin", async () => {
    const ctx = regular(); mappings = [mapping({ sourceType: "saihu" })];
    batches = [batch(11, [business({ raw: { currency: "USD", source: "sellfox_monthly_api" } }), business({ yearMonth: "2026-08", raw: { currency: "USD", source: "sellfox_monthly_api" } })], { fileReferenceKind: "saihu_sync_run", sourceRunId: 42 })];
    expect((await repo.get(ctx, input)).status).toBe("ready");
    batches[0].fileReferenceKind = "storage"; batches[0].sourceRunId = null; await expect(repo.get(ctx, input)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("authority changes alter authorizationHash without fabricating source changes", async () => {
    policies = [policy()]; const a = await repo.get(context(), input); policies[0].id = 71; const b = await repo.get(context(), input);
    expect(a.source?.authorizationHash).not.toBe(b.source?.authorizationHash); expect(a.source?.sourceHash).toBe(b.source?.sourceHash);
  });
  it("fresh permissions are rechecked on every preview, including after revocation", async () => {
    expect((await repo.get(context(), input)).status).toBe("ready"); memberships[0].status = "disabled";
    await expect(repo.get(context(), input)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("source-table disappearance is unavailable and DB errors never leak raw metadata", async () => {
    failures["FROM ops_monthly_profit_imports"] = Object.assign(new Error("secret payload/SQL"), { code: "ER_NO_SUCH_TABLE" });
    expect(await repo.get(context(), input)).toMatchObject({ status: "unavailable", reasonCode: "source_missing" });
    failures = { "FROM role_permissions": new Error("secret database password") };
    await expect(repo.get(context(), input)).rejects.toMatchObject({ message: "PROFIT_ANALYSIS_READ_UNAVAILABLE" });
  });
  it("never consults current cost sheets, weekly manual profit, generic AI jobs or providers", async () => {
    await repo.get(context(), input); expect(queries.map(query => query.sql).join("\n")).not.toMatch(/cost_sheet|product_weekly|ai_jobs|emperor_|refresh|UPDATE .* SET|INSERT /u);
  });
});
