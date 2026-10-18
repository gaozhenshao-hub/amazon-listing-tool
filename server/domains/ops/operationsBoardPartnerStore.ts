import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import {
  OPERATIONS_BOARD_PARTNER_LIMITS, OperationsBoardPartnerMemberSchema, OperationsBoardPartnerSchema,
  OperationsBoardPartnersExecuteInputSchema, type OperationsBoardPartner, type OperationsBoardPartnerMember, type OperationsBoardPartnersExecuteInput,
} from "../../../shared/operationsBoardPartners";

export interface OperationsBoardPartnerExecutor { execute(query: SQL): Promise<unknown> }
export class OperationsBoardPartnerStoreError extends Error {
  constructor(public readonly code: string) { super(`OPERATIONS_BOARD_PARTNER_STORE_${code}`); this.name = "OperationsBoardPartnerStoreError"; }
}
const id = z.number().int().positive().max(2147483647);
const databasePair = z.object({ id, workspaceId: id, firstUserId: id, secondUserId: id, isActive: z.union([z.literal(0), z.literal(1)]),
  version: id, updatedBy: id, updatedAt: z.string() }).strict();
const memberRow = z.object({ membershipId: id, workspaceId: id, userId: id, membershipStatus: z.enum(["active", "disabled", "invited"]),
  id: id.nullable(), defaultWorkspaceId: id.nullable(), userStatus: z.enum(["active", "disabled", "pending"]).nullable(),
  name: z.string().nullable(), nameBytes: z.number().int().min(0).nullable() }).strict();
const eligibilityRow = memberRow.omit({ name: true, nameBytes: true });
const pairColumns = "id,workspace_id AS workspaceId,first_user_id AS firstUserId,second_user_id AS secondUserId,is_active AS isActive,version,updated_by AS updatedBy,DATE_FORMAT(updated_at,'%Y-%m-%d %H:%i:%s.%f') AS updatedAt";
const eligibilityColumns = "m.id AS membershipId,m.workspaceId,m.userId,m.status AS membershipStatus,u.id,u.defaultWorkspaceId,u.status AS userStatus";
function fail(code: string): never { throw new OperationsBoardPartnerStoreError(code); }
function statement(text: string, values: unknown[] = []): SQL {
  const parts = text.split("?"); if (parts.length !== values.length + 1) fail("SQL_INVALID");
  return sql.join(parts.flatMap((part, index) => index < values.length ? [sql.raw(part), sql`${values[index]}`] : [sql.raw(part)]), sql.raw(""));
}
const pairKey = (pair: { firstUserId: number; secondUserId: number }) => `${pair.firstUserId}:${pair.secondUserId}`;
const equal = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);

/** Internal adapter. The caller supplies the existing transaction, admitted
 * schema, workspace lock and fresh actor/resource authority. Never opens a
 * transaction, finalizes a UUID journal, mutates membership, or deletes pairs.
 * Every error must abort the caller's entire transaction. */
export function createOperationsBoardPartnerStore(input: {
  tx: OperationsBoardPartnerExecutor; identity: { workspaceId: number; userId: number }; role: string; readOnly?: boolean;
}) {
  const { tx, identity, role, readOnly = false } = input;
  if (!id.safeParse(identity.workspaceId).success || !id.safeParse(identity.userId).success || typeof role !== "string" || !role || !tx || typeof tx.execute !== "function"
    || typeof readOnly !== "boolean") fail("IDENTITY_INVALID");
  function admin() { if (role !== "admin" && role !== "super_admin") fail("ADMIN_REQUIRED"); }
  async function rows(text: string, values: unknown[], maximum: number): Promise<unknown[]> {
    let result: unknown;
    try { result = await tx.execute(statement(text, values)); } catch { return fail("READ_FAILED"); }
    if (!Array.isArray(result) || result.length !== 2 || !Array.isArray(result[0]) || !Array.isArray(result[1])
      || result[0].length > maximum || result[0].some(row => !row || typeof row !== "object" || Array.isArray(row))) fail("READ_INVALID_OR_LIMIT");
    return result[0];
  }
  async function allPairs(): Promise<OperationsBoardPartner[]> {
    const raw = await rows(`SELECT ${pairColumns} FROM ops_board_partner_pairs WHERE workspace_id=? ORDER BY id LIMIT 1001 ${readOnly ? "FOR SHARE" : "FOR UPDATE"}`, [identity.workspaceId], OPERATIONS_BOARD_PARTNER_LIMITS.pairs);
    const result: OperationsBoardPartner[] = [];
    for (const value of raw) {
      const parsed = databasePair.safeParse(value); if (!parsed.success) fail("PAIR_INVALID");
      const pair = OperationsBoardPartnerSchema.safeParse({ ...parsed.data, isActive: parsed.data.isActive === 1 });
      if (!pair.success || pair.data.workspaceId !== identity.workspaceId || result.length && pair.data.id <= result[result.length - 1].id) fail("PAIR_INVALID");
      result.push(pair.data);
    }
    if (new Set(result.map(pairKey)).size !== result.length) fail("PAIR_DUPLICATE");
    return result;
  }
  function validateMemberships(raw: unknown[], requested?: Set<number>) {
    const parsed = z.array(eligibilityRow).safeParse(raw); if (!parsed.success) fail("MEMBERS_INVALID");
    const seen = new Set<number>(), membershipIds = new Set<number>(), eligible = new Set<number>();
    for (const row of parsed.data) {
      if (row.workspaceId !== identity.workspaceId || requested && !requested.has(row.userId) || seen.has(row.userId) || membershipIds.has(row.membershipId)
        || row.id !== null && row.id !== row.userId || (row.id === null) !== (row.userStatus === null) || row.id === null && row.defaultWorkspaceId !== null) fail("MEMBERS_INVALID");
      seen.add(row.userId); membershipIds.add(row.membershipId);
      if (row.membershipStatus === "active" && row.userStatus === "active" && row.defaultWorkspaceId === identity.workspaceId && row.id === row.userId) eligible.add(row.userId);
    }
    return eligible;
  }
  async function eligibility(userIds: number[]) {
    const unique = [...new Set(userIds)].sort((a, b) => a - b);
    if (!unique.length) return new Set<number>();
    if (unique.length > 2 * OPERATIONS_BOARD_PARTNER_LIMITS.pairs + 1 || unique.some(value => !id.safeParse(value).success)) fail("MEMBERS_INVALID");
    const raw = await rows(`SELECT ${eligibilityColumns} FROM workspace_memberships m LEFT JOIN users u ON u.id=m.userId WHERE m.workspaceId=? AND m.userId IN (${unique.map(() => "?").join(",")}) ORDER BY m.userId,m.id LIMIT 5001 LOCK IN SHARE MODE`, [identity.workspaceId, ...unique], OPERATIONS_BOARD_PARTNER_LIMITS.members);
    return validateMemberships(raw, new Set(unique));
  }
  async function members(): Promise<OperationsBoardPartnerMember[]> {
    admin();
    const raw = await rows(`SELECT ${eligibilityColumns},IF(OCTET_LENGTH(u.name)<=800,u.name,NULL) AS name,OCTET_LENGTH(u.name) AS nameBytes FROM workspace_memberships m LEFT JOIN users u ON u.id=m.userId WHERE m.workspaceId=? ORDER BY m.userId,m.id LIMIT 5001 LOCK IN SHARE MODE`, [identity.workspaceId], OPERATIONS_BOARD_PARTNER_LIMITS.members);
    const parsed = z.array(memberRow).safeParse(raw); if (!parsed.success) fail("MEMBERS_INVALID");
    const eligible = validateMemberships(parsed.data.map(({ name: _name, nameBytes: _bytes, ...row }) => row));
    return parsed.data.filter(row => eligible.has(row.userId)).map(row => {
      if (row.nameBytes !== null && (row.nameBytes > 800 || row.name === null || Buffer.byteLength(row.name, "utf8") !== row.nameBytes) || row.name === null && row.nameBytes !== null || row.name !== null && row.nameBytes === null) fail("MEMBER_NAME_INVALID");
      const member = OperationsBoardPartnerMemberSchema.safeParse({ userId: row.userId, displayName: row.name === null || row.name === "" ? `成员 #${row.userId}` : row.name });
      if (!member.success) fail("MEMBER_NAME_INVALID"); return member.data;
    });
  }
  async function loadAll() { admin(); return allPairs(); }
  async function directForUser(userId: number = identity.userId): Promise<OperationsBoardPartner[]> {
    if (userId !== identity.userId) fail("SELF_READ_REQUIRED");
    const candidates = (await allPairs()).filter(pair => pair.isActive && (pair.firstUserId === userId || pair.secondUserId === userId));
    if (!candidates.length) return [];
    const active = await eligibility([userId, ...candidates.flatMap(pair => [pair.firstUserId, pair.secondUserId])]);
    return candidates.filter(pair => active.has(pair.firstUserId) && active.has(pair.secondUserId));
  }
  async function setPair(raw: OperationsBoardPartnersExecuteInput): Promise<OperationsBoardPartner> {
    if (readOnly) fail("READ_ONLY");
    admin(); const parsed = OperationsBoardPartnersExecuteInputSchema.safeParse(raw); if (!parsed.success) fail("COMMAND_INVALID");
    const command = parsed.data; if (command.expectedWorkspaceId !== identity.workspaceId) fail("WORKSPACE_MISMATCH");
    const before = await allPairs(), previous = before.find(pair => pairKey(pair) === pairKey(command));
    if ((previous?.version ?? 0) !== command.expectedVersion) fail("VERSION_CONFLICT");
    if (!command.isActive && !previous) fail("EXISTING_PAIR_REQUIRED");
    if (!previous && before.length === OPERATIONS_BOARD_PARTNER_LIMITS.pairs) fail("PAIR_LIMIT");
    if (previous?.version === 2147483647) fail("VERSION_OVERFLOW");
    // Removing access must remain possible after an endpoint leaves. Only
    // enabling/re-enabling creates a grant and requires both live members.
    if (command.isActive) {
      const active = await eligibility([command.firstUserId, command.secondUserId]);
      if (!active.has(command.firstUserId) || !active.has(command.secondUserId)) fail("MEMBER_NOT_ACTIVE");
    }
    const clock = await rows("SELECT DATE_FORMAT(CURRENT_TIMESTAMP(3),'%Y-%m-%d %H:%i:%s.%f') AS now", [], 1);
    const time = z.array(z.object({ now: z.string() }).strict()).length(1).safeParse(clock);
    if (!time.success) fail("CLOCK_INVALID");
    const nextVersion = (previous?.version ?? 0) + 1;
    const check = OperationsBoardPartnerSchema.safeParse({ id: previous?.id ?? 1, workspaceId: identity.workspaceId,
      firstUserId: command.firstUserId, secondUserId: command.secondUserId, isActive: command.isActive, version: nextVersion, updatedBy: identity.userId, updatedAt: time.data[0].now });
    if (!check.success || previous && check.data.updatedAt < previous.updatedAt) fail("CLOCK_INVALID");
    const values = previous ? [command.isActive ? 1 : 0, nextVersion, identity.userId, check.data.updatedAt, identity.workspaceId, previous.id, command.firstUserId, command.secondUserId, previous.version, previous.isActive ? 1 : 0, previous.updatedBy, previous.updatedAt]
      : [identity.workspaceId, command.firstUserId, command.secondUserId, command.isActive ? 1 : 0, nextVersion, identity.userId, check.data.updatedAt];
    const text = previous ? "UPDATE ops_board_partner_pairs SET is_active=?,version=?,updated_by=?,updated_at=? WHERE workspace_id=? AND id=? AND first_user_id=? AND second_user_id=? AND version=? AND is_active=? AND updated_by=? AND updated_at=?"
      : "INSERT INTO ops_board_partner_pairs (workspace_id,first_user_id,second_user_id,is_active,version,updated_by,updated_at) VALUES (?,?,?,?,?,?,?)";
    let written: unknown; try { written = await tx.execute(statement(text, values)); } catch { return fail("WRITE_FAILED"); }
    const header = Array.isArray(written) ? written[0] : null;
    if (!header || typeof header !== "object" || !("affectedRows" in header) || header.affectedRows !== 1) fail("WRITE_CONFLICT");
    const insertedId = previous?.id ?? ("insertId" in header ? header.insertId : null);
    if (!id.safeParse(insertedId).success) fail("INSERT_ID_INVALID");
    const expected: OperationsBoardPartner = { ...check.data, id: insertedId as number };
    const after = await allPairs(), saved = after.find(pair => pair.id === expected.id);
    if (!saved || !equal(saved, expected) || after.length !== before.length + (previous ? 0 : 1)
      || !equal(after.filter(pair => pair.id !== expected.id), before.filter(pair => pair.id !== expected.id))) fail("READBACK_MISMATCH");
    return saved;
  }
  return { loadAll, members, directForUser, setPair };
}
