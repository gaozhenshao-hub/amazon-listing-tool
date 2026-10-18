import { beforeEach, describe, expect, it, vi } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { TRPCError } from "@trpc/server";
import type { SQL } from "drizzle-orm";
import type { DbExecutor } from "../../repositories/dbClient";
import { MONTHLY_FINANCIAL_METRICS, type MonthlyFinancialBatchRecord } from "../../../shared/monthlyFinancialRead";
import { prepareOperationsBoardHistoryCapture } from "./monthlyBoardHistoryCapture";
import { authorizeOperationsBoardAccess as access, authorizeOperationsBoardCapture as authorize, canUpdateOperationsBoard, type OperationsBoardAccessSession } from "./operationsBoardAccess";
import type { assertResourceAction } from "../../services/securityGovernance";
import { SECURITY_PERMISSION_MATRIX, SECURITY_RESOURCE_MODULES } from "../../../shared/const";

type Row = Record<string, unknown>;
const identity = { userId: 3, workspaceId: 7 }, scope = { storeName: "SYNTHETIC Exact Shop", country: "US" };
const stamp = "2026-10-18 12:00:00.000000", parent = "SYN-P1";
const rawRow = (patch: Row = {}) => ({ ...Object.fromEntries(MONTHLY_FINANCIAL_METRICS.map(metric => [metric, 0])), yearMonth: "2026-10", parentAsin: parent, asin: "SYN-C1", sku: "SYN-SKU", title: "完整原始产品",
  storeName: scope.storeName, site: "US", operator: "External A", raw: { currency: "USD" }, ...patch });
function capture(rows: Row[] = [rawRow()], sourcePatch: Partial<MonthlyFinancialBatchRecord> = {}) {
  const months = [...new Set(rows.map(row => row.yearMonth as string))].sort();
  const records: MonthlyFinancialBatchRecord[] = months.map((month, index): MonthlyFinancialBatchRecord => {
    const payload = rows.filter(row => row.yearMonth === month);
    return { id: 41 + index, workspaceId: 7, userId: 3, fileName: "SYNTHETIC.xlsx", fileHash: "a".repeat(64), status: "completed", totalRows: payload.length, skippedRows: 0,
      unallocatedRows: payload.filter(row => !row.parentAsin).length, months: [month], payload, createdAt: stamp, confirmedAt: stamp, fileReferenceKind: "storage", sourceRunId: null, ...sourcePatch };
  }).reverse();
  return prepareOperationsBoardHistoryCapture(records, 7).capture({ ...scope, month: months.at(-1) ?? "2026-10" });
}
const manual = (patch: Row = {}): Row => ({ id: 51, workspaceId: 7, parentAsin: parent, storeName: scope.storeName, country: "US", assigneeUserId: 3, isActive: 1, ...patch });
const mapping = (patch: Row = {}): Row => ({ id: 61, workspaceId: 7, externalName: "External A", sourceType: "all", systemUserId: 3, isConfirmed: 1, ...patch });
const actor = (id: number, role = "ops_specialist"): Row => ({ id, role, status: "active", defaultWorkspaceId: 7 });
const member = (id: number): Row => ({ id: 70 + id, workspaceId: 7, userId: id, status: "active" });
function directory(role: string, patch: Row = {}): Row {
  return { id: role === "ops_manager" ? 12 : 11, workspaceId: 7, role, modules: ["ops"], detailedPermissions: [{ moduleId: "ops", operations: ["read"], subModules: [
    { subModuleId: "ops_dashboard", operations: ["read", "edit"] }, { subModuleId: "ops_data_import", operations: ["read"] },
  ] }], ...patch };
}
let actors: Row[], memberships: Row[], workspaces: Row[], directories: Row[], manualRows: Row[], mappingRows: Row[], calls: { sql: string; params: unknown[] }[];
let override: Partial<Record<"actor" | "membership" | "workspace" | "directory" | "manual" | "mapping" | "ownerMember", Row[]>>;
let failOn: string | null;
const execute = vi.fn(async (statement: SQL) => {
  const call = new MySqlDialect().sqlToQuery(statement); calls.push(call);
  if (failOn && call.sql.includes(failOn)) throw Error("private database diagnostics");
  if (call.sql.includes("FROM workspaces")) return [override.workspace ?? workspaces.filter(row => row.id === call.params[0]), []];
  if (call.sql.includes("FROM users")) return [override.actor ?? actors.filter(row => row.id === call.params[0]), []];
  if (call.sql.includes("FROM role_permissions")) return [override.directory ?? directories.filter(row => row.role === call.params[0] && (row.workspaceId === call.params[1] || row.workspaceId === null)), []];
  if (call.sql.includes("FROM ops_inventory_owner_assignments")) return [override.manual ?? manualRows.filter(row => row.workspaceId === call.params[0] && row.storeName === call.params[1] && row.isActive === 1 && call.params.slice(2).includes(row.parentAsin)), []];
  if (call.sql.includes("FROM operator_name_mappings")) return [override.mapping ?? mappingRows.filter(row => row.workspaceId === call.params[0] && row.isConfirmed === 1 && (call.sql.includes("IN ('saihu','all')") ? ["saihu", "all"] : ["all"]).includes(String(row.sourceType)) && call.params.slice(1).includes(row.externalName)), []];
  if (call.sql.includes("FROM workspace_memberships m")) {
    const found = memberships.filter(row => row.workspaceId === call.params[0] && call.params.slice(1).includes(row.userId)).map(row => {
      const user = actors.find(actor => actor.id === row.userId);
      return { id: row.id, workspaceId: row.workspaceId, userId: row.userId, membershipStatus: row.status, actorId: user?.id ?? null, actorStatus: user?.status ?? null, defaultWorkspaceId: user?.defaultWorkspaceId ?? null };
    }); return [override.ownerMember ?? found, []];
  }
  if (call.sql.includes("FROM workspace_memberships")) return [override.membership ?? memberships.filter(row => row.workspaceId === call.params[0] && row.userId === call.params[1]), []];
  throw Error("Unexpected query");
});
const tx = { execute } as DbExecutor;
const permission = vi.fn(async (input: Parameters<typeof assertResourceAction>[0]) => { void input; });
const session = (userId = 3, operation: "read" | "create" | "update" | "assign" = "read") => access(tx, { identity: { ...identity, userId }, operation }, permission);
beforeEach(() => {
  vi.clearAllMocks(); actors = [actor(3), actor(4, "ops_manager"), actor(5)]; memberships = [member(3), member(4), member(5)];
  workspaces = [{ id: 7, status: "active" }]; directories = [directory("ops_specialist"), directory("ops_manager"), directory("admin")];
  manualRows = []; mappingRows = [mapping(), mapping({ id: 62, externalName: "External B", systemUserId: 4 }), mapping({ id: 63, externalName: "External C", systemUserId: 5 })];
  calls = []; override = {}; failOn = null;
});

describe("fresh actor, workspace and dedicated board authorization", () => {
  it("locks workspace before actor, requires one current membership and exact read grants", async () => {
    const value = await session();
    expect(calls[0].sql).toBe("SELECT id,status FROM workspaces WHERE id=? FOR SHARE");
    expect(calls[1].sql).toBe("SELECT id,role,status,defaultWorkspaceId FROM users WHERE id=? FOR SHARE");
    expect(calls[2].sql).toContain("LIMIT 2 FOR SHARE");
    expect(value).toMatchObject({ tx, identity, role: "ops_specialist", manager: false, operation: "read", write: false });
    expect(value.authorizationHash).toMatch(/^[a-f0-9]{64}$/u); expect(Object.isFrozen(value)).toBe(true); expect(Object.isFrozen(value.identity)).toBe(true);
    expect(permission.mock.calls.map(([input]) => [input.resource, input.action])).toEqual([["ops_data", "read"], ["ops_board", "read"]]);
    expect(permission.mock.calls.every(([input]) => input.authorizationRead?.executor === tx && input.authorizationRead?.strict && input.authorizationRead?.lock && input.authorizationRead?.lockMode === "share")).toBe(true);
    expect(Math.max(...permission.mock.invocationCallOrder)).toBeLessThan(execute.mock.invocationCallOrder[3]);
  });
  it("uses update locks for a board note write without requiring import-edit permission", async () => {
    const value = await session(3, "update"); expect(value.write).toBe(true);
    expect(calls[0].sql.endsWith("FOR UPDATE")).toBe(true); expect(calls[1].sql.endsWith("FOR UPDATE")).toBe(true);
    expect(permission.mock.calls.map(([input]) => [input.resource, input.action])).toEqual([["ops_data", "read"], ["ops_board", "read"], ["ops_board", "update"]]);
    expect(permission.mock.calls.every(([input]) => input.authorizationRead?.lockMode === "update")).toBe(true);
    expect(permission.mock.calls.some(([input]) => input.resource === "ops_monthly_import" || input.resource === "ops_data" && input.action !== "read")).toBe(false);
  });
  it.each(["create", "assign"] as const)("reserves %s for current admin or super_admin", async operation => {
    await expect(session(4, operation)).rejects.toThrow("ADMIN_REQUIRED");
    actors[0].role = "admin"; expect((await session(3, operation)).role).toBe("admin");
  });
  it.each(["no membership", "disabled membership", "duplicate membership", "disabled workspace", "disabled actor", "other workspace"])("super_admin cannot bypass %s", async reason => {
    actors[0].role = "super_admin";
    if (reason === "no membership") memberships = [];
    if (reason === "disabled membership") memberships[0].status = "disabled";
    if (reason === "duplicate membership") memberships.push({ ...member(3), id: 99 });
    if (reason === "disabled workspace") workspaces[0].status = "disabled";
    if (reason === "disabled actor") actors[0].status = "disabled";
    if (reason === "other workspace") actors[0].defaultWorkspaceId = 8;
    await expect(session()).rejects.toThrow(/^OPERATIONS_BOARD_ACCESS_/u);
  });
  it("rejects stale expected role and caller attempt to downgrade a write lock", async () => {
    await expect(access(tx, { identity, operation: "read", expectedRole: "admin" }, permission)).rejects.toThrow("ACTOR_CHANGED");
    await expect(access(tx, { identity, operation: "update", write: false }, permission)).rejects.toThrow("WRITE_LOCK_REQUIRED");
  });
  it.each(["dashboard read", "financial read", "dashboard edit", "bad modules", "bad details", "missing ops details", "duplicate directory"])("does not allow resource approval to bypass %s", async kind => {
    const detail = (directories[0].detailedPermissions as { moduleId: string; operations: string[]; subModules: { subModuleId: string; operations: string[] }[] }[])[0];
    if (kind === "dashboard read") detail.subModules[0].operations = ["edit"];
    if (kind === "financial read") detail.subModules[1].operations = [];
    if (kind === "dashboard edit") detail.subModules[0].operations = ["read"];
    if (kind === "bad modules") directories[0].modules = "not json";
    if (kind === "bad details") directories[0].detailedPermissions = [{ moduleId: "ops", operations: ["read", "read"] }];
    if (kind === "missing ops details") directories[0].detailedPermissions = [{ moduleId: "listing", operations: ["read", "edit"] }];
    if (kind === "duplicate directory") directories.push({ ...directories[0], id: 111 });
    await expect(session(3, "update")).rejects.toThrow(/^OPERATIONS_BOARD_ACCESS_DIRECTORY_/u);
    // Resource approval remains insufficient: the separately verified current
    // directory still rejects the request before a session can be issued.
    expect(calls.some(call => call.sql.includes("FROM role_permissions"))).toBe(true);
  });
  it("honors exact workspace directory over a global grant and role-default fallback", async () => {
    directories.push(directory("ops_specialist", { id: 99, workspaceId: null })); directories[0].modules = [];
    await expect(session()).rejects.toThrow("DIRECTORY_DENIED");
    directories = []; await expect(session()).rejects.toThrow("DIRECTORY_DENIED"); expect((await session(4)).manager).toBe(true);
  });
  it("fails closed and sanitizes a denied policy or failed database read", async () => {
    permission.mockRejectedValueOnce(new TRPCError({ code: "FORBIDDEN", message: "private policy" })); await expect(session()).rejects.toThrow("RESOURCE_DENIED");
    permission.mockRejectedValueOnce(new Error("private database error")); await expect(session()).rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: "OPERATIONS_BOARD_ACCESS_RESOURCE_UNAVAILABLE" });
    failOn = "FROM role_permissions"; await expect(session()).rejects.toThrow("READ_UNAVAILABLE");
  });
  it("binds current membership and directory changes into the authorization hash", async () => {
    const a = await session(); memberships[0].id = 299; const b = await session(); expect(a.authorizationHash).not.toBe(b.authorizationHash);
    directories[0].id = 299; expect((await session()).authorizationHash).not.toBe(b.authorizationHash);
  });
  it("dedicated board resource preserves baseline role boundaries without granting import edits", () => {
    expect(SECURITY_RESOURCE_MODULES.ops_board).toEqual({ moduleId: "ops", subModuleId: "ops_dashboard" });
    for (const role of ["admin", "super_admin"]) expect(SECURITY_PERMISSION_MATRIX[role].ops_board).toEqual(["read", "create", "update", "assign"]);
    for (const role of ["ops_manager", "ops_specialist"]) expect(SECURITY_PERMISSION_MATRIX[role].ops_board).toEqual(["read", "update"]);
    expect(SECURITY_PERMISSION_MATRIX.finance.ops_board).toEqual(["read"]);
    for (const role of ["product_dev", "purchaser", "designer"]) expect(SECURITY_PERMISSION_MATRIX[role].ops_board).toBeUndefined();
    expect(SECURITY_PERMISSION_MATRIX.ops_specialist.ops_data).toEqual(["read"]); expect(SECURITY_PERMISSION_MATRIX.ops_specialist.ops_monthly_import).toBeUndefined();
  });
  it("consults the dedicated resource action so a baseline read-only role cannot write notes", async () => {
    actors[0].role = "finance"; directories.push(directory("finance"));
    const baseline: typeof assertResourceAction = async input => { if (!SECURITY_PERMISSION_MATRIX[input.actor.role]?.[input.resource]?.includes(input.action)) throw new TRPCError({ code: "FORBIDDEN", message: "baseline denied" }); };
    expect((await access(tx, { identity, operation: "read" }, baseline)).role).toBe("finance");
    await expect(access(tx, { identity, operation: "update" }, baseline)).rejects.toThrow("RESOURCE_DENIED");
  });
});

describe("read-only note edit capability checks", () => {
  it("checks current directory and only board:update without upgrading actor/workspace locks", async () => {
    const s = await session(); calls = []; permission.mockClear();
    expect(await canUpdateOperationsBoard(s, permission)).toBe(true);
    expect(calls).toHaveLength(1); expect(calls[0].sql).toContain("FROM role_permissions"); expect(calls[0].sql.endsWith("FOR SHARE")).toBe(true);
    expect(calls.some(call => /FROM (?:users|workspaces) /u.test(call.sql))).toBe(false);
    expect(permission.mock.calls).toHaveLength(1); expect(permission.mock.calls[0][0]).toMatchObject({ resource: "ops_board", action: "update", authorizationRead: { executor: tx, strict: true, lock: true, lockMode: "share" } });
    expect(permission.mock.invocationCallOrder[0]).toBeLessThan(execute.mock.invocationCallOrder.at(-1)!);
    expect(s.operation).toBe("read"); expect(s.write).toBe(false);
  });
  it("returns false for absent dashboard edit rather than claiming owner qualification is enough", async () => {
    const s = await session(); (directories[0].detailedPermissions as { subModules: { operations: string[] }[] }[])[0].subModules[0].operations = ["read"];
    permission.mockClear(); expect(await canUpdateOperationsBoard(s, permission)).toBe(false); expect(permission).toHaveBeenCalledTimes(1);
  });
  it("returns false for resource denial, including a baseline read-only finance role", async () => {
    const s = await session(); permission.mockRejectedValueOnce(new TRPCError({ code: "FORBIDDEN" })); expect(await canUpdateOperationsBoard(s, permission)).toBe(false);
    actors[0].role = "finance"; directories.push(directory("finance")); const finance = await session();
    const baseline: typeof assertResourceAction = async input => { if (!SECURITY_PERMISSION_MATRIX[input.actor.role]?.[input.resource]?.includes(input.action)) throw new TRPCError({ code: "FORBIDDEN" }); };
    expect(await canUpdateOperationsBoard(finance, baseline)).toBe(false);
  });
  it("propagates infrastructure and non-denial policy failures without converting them to grants or denials", async () => {
    const s = await session(); permission.mockRejectedValueOnce(new Error("policy unavailable"));
    await expect(canUpdateOperationsBoard(s, permission)).rejects.toThrow("policy unavailable");
    failOn = "FROM role_permissions"; await expect(canUpdateOperationsBoard(s, permission)).rejects.toThrow("READ_UNAVAILABLE");
  });
  it("rejects a forged session before any capability query", async () => {
    const s = await session(); calls = []; await expect(canUpdateOperationsBoard({ ...s }, permission)).rejects.toThrow("SESSION_INVALID"); expect(calls).toEqual([]);
  });
});

describe("current numeric owner capture visibility", () => {
  it("resolves complete confirmed mappings with current active membership and retains original rows", async () => {
    const s = await session(), source = capture(), before = JSON.stringify(source), result = await authorize(s, source);
    expect(result.authorizedRows).toEqual(source.rows); expect(result.responsibleUserIdsByParent.get(parent)).toEqual([3]); expect(result.canEditParents.has(parent)).toBe(true);
    expect(result.sources).toEqual(source.sources); expect(JSON.stringify(source)).toBe(before);
    expect(calls.map(call => call.sql).join("\n")).not.toMatch(/email|system_user_name|assignee_name|INSERT |DELETE |SET /u);
  });
  it("does not trust uploader identity, display names, or missing source names", async () => {
    mappingRows = []; const result = await authorize(await session(), capture());
    expect(result.authorizedRows).toEqual([]); expect(result.sources).toEqual([]); expect(result.canEditParents.size).toBe(0);
  });
  it.each([0, "3", null, -1, 4])("manual assignment %s blocks mapping fallback", async assigneeUserId => {
    manualRows = [manual({ assigneeUserId })]; const result = await authorize(await session(), capture());
    expect(result.authorizedRows).toEqual([]); expect(calls.some(call => call.sql.includes("FROM operator_name_mappings"))).toBe(false);
  });
  it("manual exact-scope assignment takes precedence even with absent source operator", async () => {
    manualRows = [manual()]; expect((await authorize(await session(), capture([rawRow({ operator: null })]))).authorizedRows).toHaveLength(1);
    expect(calls.some(call => call.sql.includes("FROM operator_name_mappings"))).toBe(false);
  });
  it("detects competing country-alias rules; other shops and countries cannot override", async () => {
    manualRows = [manual(), manual({ id: 52, country: "美国", assigneeUserId: 4 })];
    expect((await authorize(await session(), capture())).authorizedRows).toEqual([]);
    manualRows = [manual({ country: "CA", assigneeUserId: 4 }), manual({ id: 52, storeName: "Other", assigneeUserId: 4 })];
    expect((await authorize(await session(), capture())).authorizedRows).toHaveLength(1);
  });
  it.each(["External A/Missing", "", null])("does not accept partial or missing operator %s", async operator => {
    expect((await authorize(await session(), capture([rawRow({ operator })]))).authorizedRows).toEqual([]);
  });
  it("requires one identical resolved owner set across every row of each parent/month", async () => {
    const source = capture([rawRow({ operator: "External A/External B" }), rawRow({ asin: "SYN-C2", operator: "External A" })]);
    expect((await authorize(await session(), source)).authorizedRows).toEqual([]);
    const consistent = capture([rawRow({ operator: "External A/External B" }), rawRow({ asin: "SYN-C2", operator: "External B/External A" })]);
    expect((await authorize(await session(), consistent)).authorizedRows).toHaveLength(2);
  });
  it("keeps per-month read grants but uses only latest source owner for note eligibility", async () => {
    const source = capture([rawRow({ yearMonth: "2026-09" }), rawRow({ operator: "External B" })]);
    const result = await authorize(await session(), source);
    expect(result.authorizedRows.map(row => row.yearMonth)).toEqual(["2026-09"]); expect(result.sources.map(row => row.month)).toEqual(["2026-09"]);
    expect(result.responsibleUserIdsByParent.get(parent)).toEqual([4]); expect(result.canEditParents.has(parent)).toBe(false);
  });
  it("does not use an older owner if latest source owner is unresolved", async () => {
    const result = await authorize(await session(), capture([rawRow({ yearMonth: "2026-09" }), rawRow({ operator: "Missing" })]));
    expect(result.authorizedRows).toHaveLength(1); expect(result.canEditParents.size).toBe(0); expect(result.responsibleUserIdsByParent.get(parent)).toEqual([]);
  });
  it.each(["disabled membership", "missing actor", "disabled actor", "foreign workspace", "duplicate membership"])("rechecks numeric owner %s", async reason => {
    const s = await session();
    if (reason === "disabled membership") memberships[0].status = "disabled";
    if (reason === "missing actor") actors = actors.filter(actor => actor.id !== 3);
    if (reason === "disabled actor") actors[0].status = "disabled";
    if (reason === "foreign workspace") actors[0].defaultWorkspaceId = 8;
    if (reason === "duplicate membership") memberships.push({ ...member(3), id: 99 });
    if (reason === "duplicate membership") await expect(authorize(s, capture())).rejects.toThrow("MEMBER_INVALID");
    else expect((await authorize(s, capture())).authorizedRows).toEqual([]);
  });
  it("never uses raw API marker alone to authorize saihu-specific mappings", async () => {
    mappingRows = [mapping({ sourceType: "saihu" })];
    expect((await authorize(await session(), capture([rawRow({ raw: { currency: "USD", source: "sellfox_monthly_api" } })]))).authorizedRows).toEqual([]);
  });
  it("requires both captured server origin and the raw API marker for source-specific mapping", async () => {
    mappingRows = [mapping({ sourceType: "saihu" })];
    const trusted = { fileReferenceKind: "saihu_sync_run" as const, sourceRunId: 9 };
    const marked = rawRow({ raw: { currency: "USD", source: "sellfox_monthly_api" } });
    const accepted = await authorize(await session(), capture([marked], trusted)); expect(accepted.authorizedRows).toHaveLength(1);
    expect(accepted.sources[0].origin).toEqual({ kind: "saihu_sync", hashBasis: "mapped_json_bytes", sourceRunId: 9 });
    expect((await authorize(await session(), capture([rawRow()], trusted))).authorizedRows).toEqual([]);
  });
  it("rejects disagreeing saihu/all confirmed mappings instead of choosing the first", async () => {
    mappingRows = [mapping({ sourceType: "saihu" }), mapping({ id: 99, sourceType: "all", systemUserId: 4 })];
    const source = capture([rawRow({ raw: { source: "sellfox_monthly_api", currency: "USD" } })], { fileReferenceKind: "saihu_sync_run", sourceRunId: 9 });
    expect((await authorize(await session(), source)).authorizedRows).toEqual([]);
  });
  it("never authorizes an unconfirmed mapping or a conflicting numeric mapping", async () => {
    mappingRows = [mapping({ isConfirmed: 0 })]; expect((await authorize(await session(), capture())).authorizedRows).toEqual([]);
    mappingRows = [mapping(), mapping({ id: 99, systemUserId: 4 })]; expect((await authorize(await session(), capture())).authorizedRows).toEqual([]);
  });
  it("manager can read all rows but gains no note eligibility from manager-wide access", async () => {
    const source = capture([rawRow(), rawRow({ asin: "UNALLOC", parentAsin: "", operator: null })]), result = await authorize(await session(4), source);
    expect(result.visibility).toBe("full"); expect(result.authorizedRows).toHaveLength(2); expect(result.canEditParents.size).toBe(0);
    manualRows = [manual({ assigneeUserId: 4 })]; expect((await authorize(await session(4), source)).canEditParents.has(parent)).toBe(true);
  });
  it.each(["admin", "super_admin"])("%s can edit visible parents even when owner is unresolved", async role => {
    actors[0].role = role; mappingRows = []; const result = await authorize(await session(), capture());
    expect(result.authorizedRows).toHaveLength(1); expect(result.canEditParents.has(parent)).toBe(true);
  });
  it("unknown/conflicting ownership never grants ambiguous or unallocated rows to ordinary actors", async () => {
    const source = capture([rawRow({ raw: { currency: "USD", api: { parentAsinList: ["P1", "P2"] } } }), rawRow({ parentAsin: "", asin: "UNALLOC" })]);
    const result = await authorize(await session(), source); expect(result.authorizedRows).toEqual([]); expect(result.canEditParents.size).toBe(0);
  });
});

describe("direct partner read union without inherited write or manager-wide authority", () => {
  it("adds only the supplied direct partner's actual owner rows; never transfers edit rights", async () => {
    const owner = await session(), partner = await session(4), source = capture([rawRow({ operator: "External B" }), rawRow({ parentAsin: "P2", asin: "C2", operator: "External C" })]);
    const result = await authorize(owner, source, { partnerSessions: [partner] });
    expect(result.authorizedRows.map(row => row.parentAsin)).toEqual([parent]); expect(result.sources[0].rowCount).toBe(1); expect(result.canEditParents.size).toBe(0);
    expect(result.authorizedRows.some(row => row.parentAsin === "P2")).toBe(false); expect(result.responsibleUserIdsByParent.has("P2")).toBe(false);
  });
  it("revoking a direct partner input immediately removes its rows and changes view hash", async () => {
    const s = await session(), partner = await session(4), source = capture([rawRow({ operator: "External B" })]);
    const before = await authorize(s, source, { partnerSessions: [partner] }), after = await authorize(s, source);
    expect(before.authorizedRows).toHaveLength(1); expect(after.authorizedRows).toEqual([]); expect(after.authorizationHash).not.toBe(before.authorizationHash);
  });
  it("partner administrative role does not convey all products", async () => {
    actors[1].role = "admin"; const s = await session(), partner = await session(4);
    const result = await authorize(s, capture([rawRow({ operator: "External C" })]), { partnerSessions: [partner] });
    expect(result.authorizedRows).toEqual([]); expect(result.canEditParents.size).toBe(0);
  });
  it("does not issue a partner read session after membership or policy is revoked", async () => {
    memberships[1].status = "disabled"; await expect(session(4)).rejects.toThrow("MEMBERSHIP_REQUIRED");
  });
  it("does not misclassify an unverified partner policy read as a revoked partner grant", async () => {
    permission.mockRejectedValueOnce(new Error("private partner policy database error"));
    await expect(session(4)).rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: "OPERATIONS_BOARD_ACCESS_RESOURCE_UNAVAILABLE" });
  });
  it("inactive co-owner cannot remove the actor's own already-resolved rows", async () => {
    const s = await session(); memberships[1].status = "disabled";
    const result = await authorize(s, capture([rawRow({ operator: "External A/External B" })]));
    expect(result.authorizedRows).toHaveLength(1); expect(result.responsibleUserIdsByParent.get(parent)).toEqual([3]); expect(result.canEditParents.has(parent)).toBe(true);
  });
  it("partner policy revocation removes the partner grant without hiding actor-owned rows", async () => {
    const s = await session(), partner = await session(4), source = capture([rawRow(), rawRow({ parentAsin: "P2", asin: "C2", operator: "External B" })]);
    expect((await authorize(s, source, { partnerSessions: [partner] })).authorizedRows).toHaveLength(2);
    permission.mockRejectedValueOnce(new TRPCError({ code: "FORBIDDEN", message: "partner policy revoked" })); await expect(session(4)).rejects.toThrow("RESOURCE_DENIED");
    // The repository excludes a no-longer-authorized partner, rather than
    // treating that partner failure as failure of the actor's own read.
    const narrowed = await authorize(s, source); expect(narrowed.authorizedRows.map(row => row.parentAsin)).toEqual([parent]); expect(narrowed.canEditParents.has(parent)).toBe(true);
  });
  it.each(["forged", "different tx", "duplicate", "self", "write operation"])("rejects %s partner authority", async reason => {
    const s = await session(); let partners = [await session(4)];
    if (reason === "forged") partners = [{ ...partners[0] }];
    if (reason === "different tx") partners = [await access({ execute } as DbExecutor, { identity: { userId: 4, workspaceId: 7 }, operation: "read" }, permission)];
    if (reason === "duplicate") partners.push(partners[0]);
    if (reason === "self") partners = [s];
    if (reason === "write operation") partners = [await session(4, "update")];
    await expect(authorize(s, capture(), { partnerSessions: partners })).rejects.toThrow("PARTNER_SESSION_INVALID");
  });
  it("rejects a fabricated actor session before any owner lookup", async () => {
    const s = await session(), count = calls.length;
    await expect(authorize({ ...s } as OperationsBoardAccessSession, capture())).rejects.toThrow("SESSION_INVALID"); expect(calls).toHaveLength(count);
  });
});

describe("bounded failure and evidence invalidation", () => {
  it.each(["manual", "mapping", "ownerMember"] as const)("rejects oversized %s registry instead of truncating", async kind => {
    const s = await session(); override[kind] = Array.from({ length: 1001 }, (_, index) => ({ ...manual(), id: index + 1 }));
    await expect(authorize(s, capture())).rejects.toThrow("OWNER_LIMIT");
  });
  it("rejects mismatched workspace in the complete capture", async () => {
    const source = capture(); source.scope.workspaceId = 8; await expect(authorize(await session(), source)).rejects.toThrow();
  });
  it("authorization hash changes when live numeric assignment changes despite the same saved data", async () => {
    const s = await session(), source = capture(); manualRows = [manual()]; const first = await authorize(s, source);
    manualRows[0].assigneeUserId = 4; const second = await authorize(s, source);
    expect(first.authorizationHash).not.toBe(second.authorizationHash); expect(second.authorizedRows).toEqual([]);
  });
  it("does not leak database exception details on missing ownership infrastructure", async () => {
    const s = await session(); failOn = "ops_inventory_owner_assignments"; await expect(authorize(s, capture())).rejects.toThrow("OPERATIONS_BOARD_ACCESS_READ_UNAVAILABLE");
  });
});
