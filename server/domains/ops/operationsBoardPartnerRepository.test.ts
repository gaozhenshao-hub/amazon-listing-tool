import { afterEach, describe, expect, it, vi } from "vitest";
import { TRPCError } from "@trpc/server";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import type { SQL } from "drizzle-orm";
import type { TrpcContext } from "../../_core/context";
import { createOperationsBoardPartnerRepository } from "./operationsBoardPartnerRepository";

type Row = Record<string, unknown>;
const uuid = "a0000000-0000-4000-8000-000000000001", uuid2 = "a0000000-0000-4000-8000-000000000002";
const stamp = "2026-10-18 12:00:00.000000";
const command = { expectedWorkspaceId: 7, operationId: uuid, firstUserId: 3, secondUserId: 4, isActive: true, expectedVersion: 0 };
const recover = { expectedWorkspaceId: 7, operationId: uuid, decision: "check" as const };
const ctx = (patch: { userId?: number; workspaceId?: number; role?: string } = {}) => ({ workspaceId: patch.workspaceId ?? 7,
  user: { id: patch.userId ?? 3, role: patch.role ?? "admin", status: "active", defaultWorkspaceId: patch.workspaceId ?? 7 } }) as TrpcContext;
function auditSchema() {
  const column = (columnName: string, dataType: string, patch: Row = {}) => ({ columnName, dataType, columnType: dataType, isNullable: "YES", extra: "", maxLength: null, defaultValue: null, collation: null, ...patch });
  const text = (name: string, length: number, required = false) => column(name, "varchar", { columnType: `varchar(${length})`, maxLength: length, isNullable: required ? "NO" : "YES", collation: "utf8mb4_unicode_ci" });
  const columns = [column("id", "int", { isNullable: "NO", extra: "auto_increment" }), column("workspaceId", "int"), column("actorUserId", "int"),
    text("auditId", 80, true), text("actorRole", 64), text("action", 80, true), text("resourceType", 64, true), text("resourceId", 128), column("metadata", "json"),
    column("status", "enum", { columnType: "enum('success','denied','failed')", isNullable: "NO", defaultValue: "success", collation: "utf8mb4_unicode_ci" }),
    column("riskLevel", "enum", { columnType: "enum('low','medium','high','critical')", isNullable: "NO", defaultValue: "medium", collation: "utf8mb4_unicode_ci" })];
  return { columns, indexes: [{ indexName: "PRIMARY", nonUnique: 0, sequence: 1, columnName: "id", prefixLength: null }, { indexName: "audit_key", nonUnique: 0, sequence: 1, columnName: "auditId", prefixLength: null }] };
}
function harness(useDefaultFlag = false) {
  const audit = auditSchema(), controls = { enabled: true, deny: false, workspaceActive: true, duplicateMembership: false, missingMembership: false,
    schemaFail: false, auditFail: false, lostAck: false, beforeCommitFail: false, failAuditInsert: false, corruptReadback: false, flipAfterPair: false };
  const users: Row[] = [3, 4, 5].map(id => ({ id, role: "admin", status: "active", defaultWorkspaceId: 7, name: "SYNTHETIC 同名" }));
  let pairs: Row[] = [], saved: Row[] = [], nextId = 101, queue: Promise<unknown> = Promise.resolve();
  const queries: { sql: string; params: unknown[] }[] = [];
  const transactionExecutor = { execute: vi.fn(async (query: SQL) => {
    const { sql, params } = new MySqlDialect().sqlToQuery(query); queries.push({ sql, params });
    if (sql.includes("information_schema.")) {
      if (controls.auditFail) throw new Error("SYNTHETIC private schema error");
      if (sql.includes("TABLES")) return [[{ tableName: "security_audit_logs", engine: "InnoDB" }], []];
      if (sql.includes("COLUMNS")) return [audit.columns, []]; return [audit.indexes, []];
    }
    if (sql.startsWith("SELECT id,status FROM workspaces")) return [[{ id: params[0], status: controls.workspaceActive ? "active" : "disabled" }], []];
    if (sql.startsWith("SELECT id,role,status,defaultWorkspaceId FROM users")) return [users.filter(user => user.id === params[0]).map(({ name: _name, ...row }) => row), []];
    if (sql.startsWith("SELECT id,workspaceId,userId,status FROM workspace_memberships")) {
      const member = { id: 100 + Number(params[1]), workspaceId: params[0], userId: params[1], status: "active" };
      return [controls.missingMembership ? [] : controls.duplicateMembership ? [member, { ...member, id: 999 }] : [member], []];
    }
    if (sql.includes("FROM role_permissions")) return [[], []];
    if (sql.includes("FROM workspace_memberships m")) {
      const rows = users.filter(user => user.defaultWorkspaceId === params[0] && (!sql.includes("m.userId IN") || params.slice(1).includes(user.id))).map(user => ({
        membershipId: 100 + Number(user.id), workspaceId: 7, userId: user.id, membershipStatus: "active", id: user.id, defaultWorkspaceId: user.defaultWorkspaceId, userStatus: user.status,
        ...(sql.includes("nameBytes") ? { name: user.name, nameBytes: Buffer.byteLength(String(user.name)) } : {}),
      })); return [rows, []];
    }
    if (sql.startsWith("SELECT") && sql.includes("FROM ops_board_partner_pairs")) return [structuredClone(pairs.filter(pair => pair.workspaceId === params[0]).sort((a, b) => Number(a.id) - Number(b.id))), []];
    if (sql.includes(" AS now")) return [[{ now: stamp }], []];
    if (sql.startsWith("SELECT") && sql.includes("FROM security_audit_logs")) return [structuredClone(saved.filter(row => row.auditId === params[0])), []];
    if (sql.startsWith("INSERT INTO ops_board_partner_pairs")) {
      const id = nextId++; pairs.push({ id, workspaceId: params[0], firstUserId: params[1], secondUserId: params[2], isActive: params[3], version: params[4], updatedBy: params[5], updatedAt: params[6] });
      if (controls.flipAfterPair) controls.enabled = false; return [{ affectedRows: 1, insertId: id }, []];
    }
    if (sql.startsWith("UPDATE ops_board_partner_pairs")) {
      const pair = pairs.find(pair => pair.workspaceId === params[4] && pair.id === params[5] && pair.firstUserId === params[6] && pair.secondUserId === params[7] && pair.version === params[8] && pair.isActive === params[9] && pair.updatedBy === params[10] && pair.updatedAt === params[11]);
      if (pair) Object.assign(pair, { isActive: params[0], version: params[1], updatedBy: params[2], updatedAt: params[3] }); return [{ affectedRows: pair ? 1 : 0 }, []];
    }
    if (sql.startsWith("INSERT INTO security_audit_logs")) {
      if (controls.failAuditInsert) throw new Error("SYNTHETIC private journal error");
      if (saved.some(row => row.auditId === params[0])) throw new Error("Duplicate fixture operation");
      saved.push({ auditId: params[0], workspaceId: params[1], actorUserId: params[2], action: params[4], resourceType: params[5], resourceId: params[6], status: "success", riskLevel: "medium", metadataText: params[7] });
      if (controls.corruptReadback) { const value = JSON.parse(String(saved.at(-1)!.metadataText)); value.receipt.pair.version++; saved.at(-1)!.metadataText = JSON.stringify(value); }
      return [{ affectedRows: 1 }, []];
    }
    throw new Error("Unexpected fixture SQL");
  }) };
  const transaction = <T>(body: (tx: typeof transactionExecutor) => Promise<T>): Promise<T> => {
    const run = queue.then(async () => {
      const priorPairs = structuredClone(pairs), priorSaved = structuredClone(saved); let value: T;
      try { value = await body(transactionExecutor); if (controls.beforeCommitFail) throw new Error("SYNTHETIC commit failed"); }
      catch (error) { pairs = priorPairs; saved = priorSaved; throw error; }
      if (controls.lostAck) { controls.lostAck = false; throw new Error("SYNTHETIC lost committed acknowledgement"); } return value;
    }); queue = run.catch(() => undefined); return run;
  };
  const database = { transaction: vi.fn(transaction) as typeof transaction };
  const permission = vi.fn(async () => { if (controls.deny) throw new TRPCError({ code: "FORBIDDEN", message: "SYNTHETIC policy deny" }); });
  const schema = vi.fn(async () => { if (controls.schemaFail) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "OPERATIONS_BOARD_SCHEMA_INCOMPATIBLE" }); });
  const repo = createOperationsBoardPartnerRepository({ database: async () => database, permission, schema, ...(useDefaultFlag ? {} : { enabled: () => controls.enabled }) });
  return { repo, database, permission, schema, queries, users, controls, executor: transactionExecutor, audit, pairs: () => pairs, receipts: () => saved };
}
afterEach(() => vi.unstubAllEnvs());

describe("fresh authorized administrative facade", () => {
  it("options exposes numeric members and complete pairs after actual fresh authority, no writes", async () => {
    const h = harness(), value = await h.repo.options(ctx(), { expectedWorkspaceId: 7 });
    expect(value).toMatchObject({ identity: { workspaceId: 7, userId: 3 }, pairs: [], capability: { available: true, reasonCode: null } }); expect(value.members).toHaveLength(3);
    expect(h.permission.mock.calls.map(call => (call as unknown as [{ resource: string; action: string }])[0]).map(value => `${value.resource}:${value.action}`)).toEqual(["ops_data:read", "ops_board:read", "ops_board:assign"]);
    expect(h.queries[0].sql).toContain("workspaces WHERE id=? FOR UPDATE"); expect(h.queries[1].sql).toContain("users WHERE id=? FOR UPDATE");
    expect(h.queries.every(query => query.sql.startsWith("SELECT"))).toBe(true);
  });
  it.each(["ops_manager", "ops_specialist", "finance"])("rejects %s before transaction or private options", async role => {
    const h = harness(); await expect(h.repo.options(ctx({ role }), { expectedWorkspaceId: 7 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(h.repo.execute(ctx({ role }), command)).rejects.toMatchObject({ code: "FORBIDDEN" }); expect(h.database.transaction).not.toHaveBeenCalled();
  });
  it("requires login, exact expected workspace and a real transaction", async () => {
    const h = harness(); await expect(h.repo.options({ user: null } as TrpcContext, { expectedWorkspaceId: 7 })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(h.repo.execute(ctx({ workspaceId: 8 }), command)).rejects.toMatchObject({ code: "FORBIDDEN" }); expect(h.queries).toHaveLength(0);
    const noTransaction = createOperationsBoardPartnerRepository({ database: async () => ({}) as never });
    await expect(noTransaction.execute(ctx(), command)).rejects.toThrow("TRANSACTION_REQUIRED");
  });
  it("explicit null workspace never falls back to the actor default for options, execute or recovery", async () => {
    const h = harness(), ambiguous = { ...ctx(), workspaceId: null };
    await expect(h.repo.options(ambiguous, { expectedWorkspaceId: 7 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(h.repo.execute(ambiguous, command)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(h.repo.recover(ambiguous, recover)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(h.database.transaction).not.toHaveBeenCalled(); expect(h.queries).toHaveLength(0);
  });
  it("only absent workspace context may use the fresh-verified actor default", async () => {
    const h = harness(); expect((await h.repo.options({ ...ctx(), workspaceId: undefined }, { expectedWorkspaceId: 7 })).identity.workspaceId).toBe(7);
    expect(h.queries[0].params).toEqual([7]);
  });
  it.each(["role", "disabled", "default_workspace", "membership_missing", "membership_duplicate", "workspace_disabled", "resource_denied"])("fresh %s change is not bypassed by ctx cache", async kind => {
    const h = harness(); await h.repo.options(ctx(), { expectedWorkspaceId: 7 });
    if (kind === "role") h.users[0].role = "ops_manager";
    if (kind === "disabled") h.users[0].status = "disabled";
    if (kind === "default_workspace") h.users[0].defaultWorkspaceId = 8;
    if (kind === "membership_missing") h.controls.missingMembership = true;
    if (kind === "membership_duplicate") h.controls.duplicateMembership = true;
    if (kind === "workspace_disabled") h.controls.workspaceActive = false;
    if (kind === "resource_denied") h.controls.deny = true;
    await expect(h.repo.execute(ctx(), command)).rejects.toMatchObject({ code: "FORBIDDEN" }); expect(h.pairs()).toEqual([]); expect(h.receipts()).toEqual([]);
  });
  it("default release flag is off; read options is explicit unavailable, not silently enabled", async () => {
    vi.stubEnv("ENABLE_MERGED_OPS_BOARD_EDITIONS", "false"); const h = harness(true);
    expect((await h.repo.options(ctx(), { expectedWorkspaceId: 7 })).capability).toEqual({ available: false, reasonCode: "not_enabled_before_release" });
    await expect(h.repo.execute(ctx(), command)).rejects.toThrow("NOT_ENABLED"); expect(h.pairs()).toEqual([]); expect(h.receipts()).toEqual([]);
  });
  it("a permission-reader failure is unavailable, never a denial shortcut, partial result or empty success", async () => {
    const h = harness(); h.permission.mockRejectedValue(new Error("SYNTHETIC private permission storage failure"));
    for (const work of [() => h.repo.options(ctx(), { expectedWorkspaceId: 7 }), () => h.repo.execute(ctx(), command), () => h.repo.recover(ctx(), recover)])
      await expect(work()).rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: "OPERATIONS_BOARD_ACCESS_RESOURCE_UNAVAILABLE" });
    expect(h.pairs()).toEqual([]); expect(h.receipts()).toEqual([]); expect(h.schema).not.toHaveBeenCalled();
  });
  it("explicit feature true permits only the authorized operation", async () => {
    vi.stubEnv("ENABLE_MERGED_OPS_BOARD_EDITIONS", "true"); const h = harness(true); expect((await h.repo.execute(ctx(), command)).status).toBe("committed");
  });
  it("rejects schema failure and unknown client authority/body before writes", async () => {
    const h = harness(); h.controls.schemaFail = true; await expect(h.repo.execute(ctx(), command)).rejects.toThrow("OPERATIONS_BOARD_SCHEMA_INCOMPATIBLE");
    expect(h.pairs()).toEqual([]); expect(h.receipts()).toEqual([]);
    await expect(h.repo.execute(ctx(), { ...command, owner: "name" } as never)).rejects.toThrow();
  });
});

describe("one transaction, stable UUID and recovery", () => {
  it("pair change and exact final receipt commit in the same transaction", async () => {
    const h = harness(), result = await h.repo.execute(ctx(), command); expect(result).toMatchObject({ status: "committed", pair: { id: 101, version: 1, isActive: true, updatedBy: 3 } });
    expect(h.database.transaction).toHaveBeenCalledTimes(1); expect(h.pairs()).toHaveLength(1); expect(h.receipts()).toHaveLength(1);
    const pairWrite = h.queries.findIndex(query => query.sql.startsWith("INSERT INTO ops_board_partner_pairs"));
    const auditWrite = h.queries.findIndex(query => query.sql.startsWith("INSERT INTO security_audit_logs")); expect(auditWrite).toBeGreaterThan(pairWrite);
    expect(await h.repo.execute(ctx(), command)).toEqual(result); expect(h.pairs()[0].version).toBe(1); expect(h.receipts()).toHaveLength(1);
  });
  it("concurrent same UUID explicit requests converge to one pair write", async () => {
    const h = harness(), [first, second] = await Promise.all([h.repo.execute(ctx(), command), h.repo.execute(ctx(), command)]);
    expect(second).toEqual(first); expect(h.queries.filter(query => query.sql.startsWith("INSERT INTO ops_board_partner_pairs"))).toHaveLength(1);
  });
  it.each([{ isActive: false }, { secondUserId: 5 }, { expectedVersion: 1 }])("same UUID different payload is rejected %j", async patch => {
    const h = harness(); await h.repo.execute(ctx(), command);
    await expect(h.repo.execute(ctx(), { ...command, ...patch })).rejects.toMatchObject({ code: "CONFLICT", message: "OPERATIONS_BOARD_PARTNERS_OPERATION_CONTENT_CONFLICT" }); expect(h.pairs()[0].version).toBe(1);
  });
  it("stale expectedVersion does not mutate or create a final receipt", async () => {
    const h = harness(); await h.repo.execute(ctx(), command);
    await expect(h.repo.execute(ctx(), { ...command, operationId: uuid2 })).rejects.toMatchObject({ code: "CONFLICT" }); expect(h.receipts()).toHaveLength(1);
  });
  it("lost commit ACK returns unknown; check original UUID proves success without re-executing", async () => {
    const h = harness(); h.controls.lostAck = true;
    expect(await h.repo.execute(ctx(), command)).toMatchObject({ operationId: uuid, status: "unknown", pair: null, requestHash: null }); expect(h.pairs()).toHaveLength(1);
    h.controls.enabled = false; const checked = await h.repo.recover(ctx(), recover); expect(checked).toMatchObject({ status: "committed", pair: { version: 1 } });
    expect(h.queries.filter(query => query.sql.startsWith("INSERT INTO ops_board_partner_pairs"))).toHaveLength(1);
  });
  it.each(["failAuditInsert", "corruptReadback", "beforeCommitFail"] as const)("%s rolls back pair and final receipt, leaving unknown recoverable metadata", async kind => {
    const h = harness(); h.controls[kind] = true;
    expect((await h.repo.execute(ctx(), command)).status).toBe("unknown"); expect(h.pairs()).toEqual([]); expect(h.receipts()).toEqual([]);
    h.controls[kind] = false; expect((await h.repo.recover(ctx(), recover)).status).toBe("unknown");
  });
  it("mid-transaction flag disable rolls back the prepared pair change", async () => {
    const h = harness(); h.controls.flipAfterPair = true;
    await expect(h.repo.execute(ctx(), command)).rejects.toThrow("NOT_ENABLED"); expect(h.pairs()).toEqual([]); expect(h.receipts()).toEqual([]);
  });
  it("flagoff check/cancel requires no board tables and permanently fences late execute", async () => {
    const h = harness(); h.controls.enabled = false; h.controls.schemaFail = true;
    expect((await h.repo.recover(ctx(), recover)).status).toBe("unknown");
    const cancelled = await h.repo.recover(ctx(), { ...recover, decision: "cancel" }); expect(cancelled).toMatchObject({ status: "cancelled", pair: null });
    expect(h.schema).not.toHaveBeenCalled(); h.controls.enabled = true;
    expect(await h.repo.execute(ctx(), command)).toEqual(cancelled); expect(h.pairs()).toEqual([]);
  });
  it("cancel after success returns the original commit, never reverses business state", async () => {
    const h = harness(), done = await h.repo.execute(ctx(), command); h.controls.enabled = false;
    expect(await h.repo.recover(ctx(), { ...recover, decision: "cancel" })).toEqual(done); expect(h.pairs()[0].isActive).toBe(1);
  });
  it("cancel lost ACK is recoverable without new UUID or a second fence", async () => {
    const h = harness(); h.controls.enabled = false; h.controls.lostAck = true;
    expect((await h.repo.recover(ctx(), { ...recover, decision: "cancel" })).status).toBe("unknown");
    expect((await h.repo.recover(ctx(), recover)).status).toBe("cancelled"); expect(h.receipts()).toHaveLength(1); expect(h.pairs()).toEqual([]);
  });
  it("permissions are checked again for recovery; revocation cannot expose saved receipt", async () => {
    const h = harness(); await h.repo.execute(ctx(), command); h.controls.deny = true;
    await expect(h.repo.recover(ctx(), recover)).rejects.toMatchObject({ code: "FORBIDDEN" }); expect(h.receipts()).toHaveLength(1);
  });
  it("another current admin cannot discover or cancel this actor's UUID", async () => {
    const h = harness(); await h.repo.execute(ctx(), command);
    expect((await h.repo.recover(ctx({ userId: 4 }), recover)).status).toBe("unknown");
    expect((await h.repo.recover(ctx({ userId: 4 }), { ...recover, decision: "cancel" })).status).toBe("cancelled");
    expect((await h.repo.recover(ctx(), recover)).status).toBe("committed"); expect(h.receipts()).toHaveLength(2);
  });
  it("audit read failure is unknown rather than an invented absent or final result", async () => {
    const h = harness(); h.controls.auditFail = true;
    const value = await h.repo.recover(ctx(), recover); expect(value.status).toBe("unknown"); expect(JSON.stringify(value)).not.toContain("SYNTHETIC private");
  });
  it("subsequent explicit disable and re-enable keep ID and advance versions", async () => {
    const h = harness(); await h.repo.execute(ctx(), command);
    const disabled = await h.repo.execute(ctx(), { ...command, operationId: uuid2, expectedVersion: 1, isActive: false });
    expect(disabled.pair).toMatchObject({ id: 101, version: 2, isActive: false });
    const enabled = await h.repo.execute(ctx(), { ...command, operationId: "a0000000-0000-4000-8000-000000000003", expectedVersion: 2 });
    expect(enabled.pair).toMatchObject({ id: 101, version: 3, isActive: true }); expect(h.pairs()).toHaveLength(1);
  });
});
