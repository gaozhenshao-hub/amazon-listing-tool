import { beforeEach, describe, expect, it } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { type SQL } from "drizzle-orm";
import { createOperationsBoardPartnerStore, type OperationsBoardPartnerExecutor } from "./operationsBoardPartnerStore";

type Row = Record<string, unknown>;
const identity = { workspaceId: 7, userId: 1 }, stamp = "2026-10-18 01:02:03.123000";
const command = { expectedWorkspaceId: 7, operationId: "11111111-1111-4111-a111-111111111111", firstUserId: 2, secondUserId: 3, isActive: true, expectedVersion: 0 };
const pair = (patch: Row = {}): Row => ({ id: 91, workspaceId: 7, firstUserId: 2, secondUserId: 3, isActive: 1, version: 1, updatedBy: 1, updatedAt: stamp, ...patch });
const member = (userId: number, patch: Row = {}): Row => ({ membershipId: userId + 100, workspaceId: 7, userId, membershipStatus: "active", id: userId, defaultWorkspaceId: 7, userStatus: "active", name: "SYNTHETIC 同名", nameBytes: Buffer.byteLength("SYNTHETIC 同名"), ...patch });
let pairs: Row[], members: Row[], queries: { sql: string; params: unknown[] }[], clock: string;
let forceRows: ((text: string, rows: Row[]) => Row[]) | null, beforeWrite: (() => void) | null, afterWrite: (() => void) | null;
let failSql: string | null, affected: number | null, insertId: unknown;
const clone = <T>(value: T): T => structuredClone(value);
const executor: OperationsBoardPartnerExecutor = { async execute(statement: SQL) {
  const query = new MySqlDialect().sqlToQuery(statement); queries.push(query); const text = query.sql, values = query.params;
  if (failSql && text.includes(failSql)) throw new Error("SYNTHETIC database password=must-not-leak");
  if (text.startsWith("SELECT")) {
    let rows: Row[];
    if (text.includes(" AS now")) rows = [{ now: clock }];
    else if (text.includes("FROM ops_board_partner_pairs")) rows = pairs.filter(pair => pair.workspaceId === values[0]).sort((a, b) => Number(a.id) - Number(b.id)).slice(0, 1001);
    else if (text.includes("FROM workspace_memberships")) {
      rows = members.filter(row => row.workspaceId === values[0] && (!text.includes("m.userId IN") || values.slice(1).includes(row.userId)))
        .sort((a, b) => Number(a.userId) - Number(b.userId) || Number(a.membershipId) - Number(b.membershipId)).slice(0, 5001)
        .map(row => text.includes("nameBytes") ? row : Object.fromEntries(Object.entries(row).filter(([key]) => !["name", "nameBytes"].includes(key))));
    } else throw new Error("Unexpected synthetic read");
    return [clone(forceRows ? forceRows(text, rows) : rows), []];
  }
  beforeWrite?.(); let count = 0, newId = 0;
  if (text.startsWith("INSERT INTO ops_board_partner_pairs")) {
    newId = 101; pairs.push({ id: newId, workspaceId: values[0], firstUserId: values[1], secondUserId: values[2], isActive: values[3], version: values[4], updatedBy: values[5], updatedAt: values[6] }); count = 1;
  } else if (text.startsWith("UPDATE ops_board_partner_pairs")) {
    const found = pairs.find(pair => pair.workspaceId === values[4] && pair.id === values[5] && pair.firstUserId === values[6] && pair.secondUserId === values[7]
      && pair.version === values[8] && pair.isActive === values[9] && pair.updatedBy === values[10] && pair.updatedAt === values[11]);
    if (found) { Object.assign(found, { isActive: values[0], version: values[1], updatedBy: values[2], updatedAt: values[3] }); count = 1; }
  } else throw new Error("Unexpected synthetic write");
  afterWrite?.(); return [{ affectedRows: affected ?? count, insertId: insertId === undefined ? newId : insertId }, []];
} };
const store = (role = "admin", userId = 1) => createOperationsBoardPartnerStore({ tx: executor, identity: { ...identity, userId }, role });
async function transaction<T>(body: () => Promise<T>) {
  const before = clone(pairs); try { return await body(); } catch (error) { pairs = before; throw error; }
}
beforeEach(() => { pairs = []; members = [member(1), member(2), member(3), member(4)]; queries = []; clock = stamp; forceRows = null; beforeWrite = null; afterWrite = null; failSql = null; affected = null; insertId = undefined; });

describe("admin-managed exact numeric pairs", () => {
  it.each(["ops_manager", "ops_specialist", "finance", "designer", "viewer"])("%s cannot manage or list the whole directory", async role => {
    await expect(store(role).loadAll()).rejects.toThrow("ADMIN_REQUIRED"); await expect(store(role).members()).rejects.toThrow("ADMIN_REQUIRED");
    await expect(store(role).setPair(command)).rejects.toThrow("ADMIN_REQUIRED"); expect(queries).toHaveLength(0);
  });
  it.each(["admin", "super_admin"])("%s inserts with real ID, explicit version/actor/time and readback", async role => {
    const saved = await transaction(() => store(role).setPair(command));
    expect(saved).toEqual({ id: 101, workspaceId: 7, firstUserId: 2, secondUserId: 3, isActive: true, version: 1, updatedBy: 1, updatedAt: stamp });
    expect(queries.filter(query => query.sql.startsWith("INSERT"))).toHaveLength(1);
  });
  it("disables and reactivates the same persistent pair ID", async () => {
    pairs = [pair()]; const off = await transaction(() => store().setPair({ ...command, expectedVersion: 1, isActive: false }));
    expect(off).toMatchObject({ id: 91, isActive: false, version: 2 });
    const on = await transaction(() => store().setPair({ ...command, expectedVersion: 2 }));
    expect(on).toMatchObject({ id: 91, isActive: true, version: 3 }); expect(pairs).toHaveLength(1);
    expect(queries.some(query => query.sql.startsWith("DELETE") || query.sql.startsWith("INSERT"))).toBe(false);
  });
  it("all history is retained, including inactive pairs with inactive members", async () => {
    pairs = [pair({ isActive: 0 })]; members[1].userStatus = "disabled";
    expect(await store().loadAll()).toHaveLength(1); expect(await store().members()).toHaveLength(3);
  });
  it("admin can disable an exact old pair after a member leaves, but cannot reactivate it", async () => {
    pairs = [pair()]; members[1].userStatus = "disabled";
    expect(await store().setPair({ ...command, expectedVersion: 1, isActive: false })).toMatchObject({ id: 91, version: 2, isActive: false });
    expect(queries.some(query => query.sql.includes("workspace_memberships"))).toBe(false);
    await expect(store().setPair({ ...command, expectedVersion: 2 })).rejects.toThrow("MEMBER_NOT_ACTIVE");
  });
  it("cannot manufacture a new inactive pair without an existing exact pair", async () => {
    await expect(store().setPair({ ...command, isActive: false })).rejects.toThrow("EXISTING_PAIR_REQUIRED");
    expect(queries.every(query => query.sql.startsWith("SELECT"))).toBe(true);
  });
  it.each([{ expectedWorkspaceId: 8 }, { firstUserId: 3, secondUserId: 2 }, { firstUserId: 2, secondUserId: 2 }, { expectedVersion: -1 }, { operationId: command.operationId.toUpperCase() }])("refuses wrong scope/identity/command %j", async patch => {
    await expect(store().setPair({ ...command, ...patch })).rejects.toThrow(); expect(queries).toHaveLength(0);
  });
  it("expected zero means absence, not permission to reactivate or replace", async () => {
    pairs = [pair({ isActive: 0 })]; await expect(store().setPair(command)).rejects.toThrow("VERSION_CONFLICT");
    pairs = []; await expect(store().setPair({ ...command, expectedVersion: 1 })).rejects.toThrow("VERSION_CONFLICT");
    expect(queries.every(query => query.sql.startsWith("SELECT"))).toBe(true);
  });
  it.each(["disabled", "pending"])("refuses %s user", async status => {
    members[1].userStatus = status; await expect(store().setPair(command)).rejects.toThrow("MEMBER_NOT_ACTIVE");
  });
  it.each(["disabled", "invited"])("refuses %s membership", async status => {
    members[2].membershipStatus = status; await expect(store().setPair(command)).rejects.toThrow("MEMBER_NOT_ACTIVE");
  });
  it.each([8, null])("refuses another/absent default workspace %j", async defaultWorkspaceId => {
    members[1].defaultWorkspaceId = defaultWorkspaceId; await expect(store().setPair(command)).rejects.toThrow("MEMBER_NOT_ACTIVE");
  });
  it("refuses missing current-workspace membership, even if user exists elsewhere", async () => {
    members[1].workspaceId = 8; await expect(store().setPair(command)).rejects.toThrow("MEMBER_NOT_ACTIVE");
  });
  it("refuses missing user row and duplicate memberships instead of inferring from names", async () => {
    Object.assign(members[1], { id: null, defaultWorkspaceId: null, userStatus: null });
    await expect(store().setPair(command)).rejects.toThrow("MEMBER_NOT_ACTIVE");
    members = [member(2), member(2, { membershipId: 999 }), member(3)]; await expect(store().setPair(command)).rejects.toThrow("MEMBERS_INVALID");
  });
});

describe("direct read only, never transitive or elevated", () => {
  it("explicit readOnly uses shared pair locks while preserving full direct eligibility checks", async () => {
    pairs = [pair()];
    const readonly = createOperationsBoardPartnerStore({ tx: executor, identity: { ...identity, userId: 2 }, role: "ops_specialist", readOnly: true });
    expect(await readonly.directForUser()).toEqual([{ ...pair(), isActive: true }]);
    expect(queries.find(query => query.sql.includes("FROM ops_board_partner_pairs"))?.sql).toMatch(/FOR SHARE$/u);
    expect(queries.some(query => query.sql.includes("FOR UPDATE"))).toBe(false);
    expect(queries.some(query => query.sql.includes("workspace_memberships"))).toBe(true);
  });
  it.each([undefined, false])("default/explicit write mode %j retains update pair locks", async readOnly => {
    await createOperationsBoardPartnerStore({ tx: executor, identity, role: "admin", readOnly }).loadAll();
    expect(queries[0].sql).toMatch(/FOR UPDATE$/u);
  });
  it("readOnly admin may list pairs and members but cannot call setPair", async () => {
    const readonly = createOperationsBoardPartnerStore({ tx: executor, identity, role: "admin", readOnly: true });
    await expect(readonly.setPair(command)).rejects.toThrow("READ_ONLY"); expect(queries).toHaveLength(0);
    expect(await readonly.loadAll()).toEqual([]); expect(await readonly.members()).toHaveLength(4);
    expect(queries.every(query => query.sql.startsWith("SELECT") && !query.sql.includes("FOR UPDATE"))).toBe(true);
  });
  it.each([null, "true", 1])("refuses invalid readOnly mode %j instead of accidentally enabling writes", readOnly => {
    expect(() => createOperationsBoardPartnerStore({ tx: executor, identity, role: "admin", readOnly: readOnly as never })).toThrow("IDENTITY_INVALID");
    expect(queries).toHaveLength(0);
  });
  it("A-B and B-C only grants A its direct A-B proof, not C", async () => {
    pairs = [pair(), pair({ id: 92, firstUserId: 3, secondUserId: 4 })];
    const result = await store("ops_specialist", 2).directForUser(); expect(result).toEqual([{ ...pair(), isActive: true }]);
    expect(result[0].version).toBe(1); expect(queries.every(query => query.sql.startsWith("SELECT"))).toBe(true);
    expect(queries.some(query => query.sql.includes("u.role") || query.sql.includes("permissions"))).toBe(false);
  });
  it("revoked pair is absent immediately with no cached proof", async () => {
    pairs = [pair()]; expect(await store("ops_specialist", 2).directForUser()).toHaveLength(1);
    pairs[0].isActive = 0; expect(await store("ops_specialist", 2).directForUser()).toEqual([]);
  });
  it.each([{ userStatus: "disabled" }, { membershipStatus: "disabled" }, { defaultWorkspaceId: 8 }, { id: null, userStatus: null, defaultWorkspaceId: null }])("invalid endpoint does not grant access %j", async patch => {
    pairs = [pair()]; Object.assign(members[2], patch); expect(await store("ops_specialist", 2).directForUser()).toEqual([]);
  });
  it("does not grant access when the current actor itself is inactive", async () => {
    pairs = [pair()]; members[1].userStatus = "disabled"; expect(await store("ops_specialist", 2).directForUser()).toEqual([]);
  });
  it("does not expose another actor's directory even to an admin via self-read", async () => {
    await expect(store().directForUser(2)).rejects.toThrow("SELF_READ_REQUIRED"); expect(queries).toHaveLength(0);
  });
  it("keeps another workspace out of queries and returned proof", async () => {
    pairs = [pair({ workspaceId: 8 })]; expect(await store("ops_specialist", 2).directForUser()).toEqual([]);
    expect(queries[0].params).toEqual([7]);
  });
});

describe("complete bounded membership and pair reads", () => {
  it("returns same-name members as distinct IDs, with no email or private fields", async () => {
    expect(await store().members()).toEqual([1, 2, 3, 4].map(userId => ({ userId, displayName: "SYNTHETIC 同名" })));
    expect(queries[0].sql).not.toMatch(/email|password|permissions|u\.role/u);
  });
  it("uses numeric fallback labels for genuinely absent/empty name", async () => {
    members = [member(2, { name: null, nameBytes: null }), member(3, { name: "", nameBytes: 0 })];
    expect(await store().members()).toEqual([{ userId: 2, displayName: "成员 #2" }, { userId: 3, displayName: "成员 #3" }]);
  });
  it.each([{ name: null, nameBytes: 801 }, { name: "SYNTHETIC", nameBytes: 1 }, { name: " bad ", nameBytes: 5 }, { name: "a".repeat(201), nameBytes: 201 }])("does not truncate or silently fabricate unavailable names %j", async patch => {
    Object.assign(members[1], patch); await expect(store().members()).rejects.toThrow("MEMBER_NAME_INVALID");
  });
  it("rejects 1001 pairs as a whole, not the first page", async () => {
    pairs = Array.from({ length: 1001 }, (_, index) => pair({ id: index + 1, firstUserId: 1, secondUserId: index + 2 }));
    await expect(store().loadAll()).rejects.toThrow("READ_INVALID_OR_LIMIT");
    await expect(store("ops_specialist", 2).directForUser()).rejects.toThrow("READ_INVALID_OR_LIMIT");
  });
  it("rejects an insertion which would exceed the complete 1000-pair budget", async () => {
    pairs = Array.from({ length: 1000 }, (_, index) => pair({ id: index + 1, firstUserId: 1, secondUserId: index + 2 }));
    expect(await store().loadAll()).toHaveLength(1000); await expect(store().setPair(command)).rejects.toThrow("PAIR_LIMIT");
    expect(queries.every(query => query.sql.startsWith("SELECT"))).toBe(true);
  });
  it("rejects incomplete 5001-member directory", async () => {
    members = Array.from({ length: 5001 }, (_, index) => member(index + 1)); await expect(store().members()).rejects.toThrow("READ_INVALID_OR_LIMIT");
  });
  it.each([{ id: "91" }, { firstUserId: 3, secondUserId: 2 }, { isActive: true }, { isActive: 2 }, { version: 0 }, { updatedAt: "2026-02-30 01:02:03.123000" }])("rejects malformed pair rows %j", async patch => {
    pairs = [pair(patch)]; await expect(store().loadAll()).rejects.toThrow("PAIR_INVALID");
  });
  it("rejects duplicate numeric pair and duplicate IDs", async () => {
    pairs = [pair(), pair({ id: 92 })]; await expect(store().loadAll()).rejects.toThrow("PAIR_DUPLICATE");
    pairs = [pair(), pair({ secondUserId: 4 })]; await expect(store().loadAll()).rejects.toThrow("PAIR_INVALID");
  });
  it("rejects overbroad adapter responses rather than accepting another workspace/member", async () => {
    forceRows = text => text.includes("ops_board_partner_pairs") ? [pair({ workspaceId: 8 })] : [];
    await expect(store().loadAll()).rejects.toThrow("PAIR_INVALID");
    forceRows = text => text.includes("workspace_memberships") ? [{ ...member(99), name: undefined }] : [];
    await expect(store().setPair(command)).rejects.toThrow("MEMBERS_INVALID");
  });
});

describe("CAS, exact readback and caller-owned atomicity", () => {
  it("version or actor changes between read and write reject and rollback", async () => {
    pairs = [pair()]; beforeWrite = () => { pairs[0].updatedBy = 8; };
    await expect(transaction(() => store().setPair({ ...command, expectedVersion: 1, isActive: false }))).rejects.toThrow("WRITE_CONFLICT");
    expect(pairs).toEqual([pair()]);
  });
  it.each([0, 2])("rejects affected row count %s", async count => {
    affected = count; await expect(transaction(() => store().setPair(command))).rejects.toThrow("WRITE_CONFLICT"); expect(pairs).toEqual([]);
  });
  it.each([0, "101", null, 2147483648])("rejects unsafe insert ID %j", async value => {
    insertId = value; await expect(transaction(() => store().setPair(command))).rejects.toThrow("INSERT_ID_INVALID"); expect(pairs).toEqual([]);
  });
  it.each([{ updatedBy: 4 }, { version: 2 }, { firstUserId: 1 }, { isActive: 0 }, { updatedAt: "2026-10-18 01:02:03.124000" }])("readback mismatch aborts the transaction %j", async patch => {
    afterWrite = () => { Object.assign(pairs[0], patch); }; await expect(transaction(() => store().setPair(command))).rejects.toThrow("READBACK_MISMATCH"); expect(pairs).toEqual([]);
  });
  it("verifies unrelated existing pairs were not altered or removed", async () => {
    pairs = [pair({ firstUserId: 1, secondUserId: 4 })]; afterWrite = () => { pairs[0].isActive = 0; };
    await expect(transaction(() => store().setPair(command))).rejects.toThrow("READBACK_MISMATCH"); expect(pairs).toEqual([pair({ firstUserId: 1, secondUserId: 4 })]);
  });
  it.each(["2026-02-30 01:02:03.123000", "2026-10-18 01:02:03.123456", "2026-10-17 00:00:00.000000"])("invalid/backwards clock rejects before SQL write %s", async value => {
    pairs = [pair()]; clock = value; await expect(store().setPair({ ...command, expectedVersion: 1 })).rejects.toThrow("CLOCK_INVALID");
    expect(queries.every(query => query.sql.startsWith("SELECT"))).toBe(true);
  });
  it("rejects version overflow before writing", async () => {
    pairs = [pair({ version: 2147483647 })]; await expect(store().setPair({ ...command, expectedVersion: 2147483647 })).rejects.toThrow("VERSION_OVERFLOW");
  });
  it("sanitizes driver errors and never opens its own transaction or writes a journal", async () => {
    failSql = "INSERT"; await expect(transaction(() => store().setPair(command))).rejects.toThrow("OPERATIONS_BOARD_PARTNER_STORE_WRITE_FAILED");
    failSql = "SELECT"; await expect(store().loadAll()).rejects.toThrow("OPERATIONS_BOARD_PARTNER_STORE_READ_FAILED");
    expect(queries.some(query => /\b(?:BEGIN|COMMIT|ROLLBACK|DELETE)\b|journal/u.test(query.sql))).toBe(false);
  });
  it("parameterizes all actual SQL values and uses exact pair identity in CAS", async () => {
    pairs = [pair()]; await store().setPair({ ...command, expectedVersion: 1, isActive: false });
    const update = queries.find(query => query.sql.startsWith("UPDATE"))!;
    expect(update.params).toEqual([0, 2, 1, stamp, 7, 91, 2, 3, 1, 1, 1, stamp]);
    expect(update.sql).not.toContain(stamp);
  });
});
