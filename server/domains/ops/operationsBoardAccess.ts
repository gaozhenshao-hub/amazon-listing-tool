import { TRPCError } from "@trpc/server";
import { z } from "zod";
import type { DbExecutor } from "../../repositories/dbClient";
import { assertResourceAction } from "../../services/securityGovernance";
import { ROLE_MODULE_ACCESS } from "../../../shared/const";
import { normalizeMarketplaceCode } from "../../../shared/marketplaceIdentity";
import { OperationsBoardEditionCaptureSchema, operationsBoardEditionHash, type OperationsBoardEditionCapture } from "../../../shared/operationsBoardEdition";
import type { MonthlyFinancialReadRow } from "../../../shared/monthlyFinancialRead";
import { OperationsBoardEditionOwnershipSchema, type OperationsBoardEditionOwnership } from "../../../shared/operationsBoardEditionOwnership";
import { positiveId, query, type Row } from "./monthlyBoardReadCore";
import { splitExternalOperatorNames } from "./operatorNameResolution";

type Operation = "read" | "create" | "update" | "assign";
type Identity = { userId: number; workspaceId: number };
export type OperationsBoardAccessSession = Readonly<{
  tx: DbExecutor; identity: Readonly<Identity>;
  actor: Readonly<{ id: number; role: string; defaultWorkspaceId: number }>;
  role: string; manager: boolean; operation: Operation; write: boolean;
  authorizationEvidence: Readonly<{ workspaceId: number; membershipId: number; directoryHash: string; grants: readonly string[] }>;
  authorizationHash: string;
}>;
// The helper consumes only sessions freshly issued on this module's current
// transaction path, not caller-constructed manager/partner authority objects.
const issued = new WeakSet<object>();
const CHUNK = 500, QUERY_LIMIT = 1000, MAX_OWNERS = 5000, MAX_PARTNERS = 1000;
const isAdmin = (role: string) => role === "admin" || role === "super_admin";
function fail(reason: string, code: "FORBIDDEN" | "BAD_REQUEST" | "PRECONDITION_FAILED" = "FORBIDDEN"): never {
  throw new TRPCError({ code, message: `OPERATIONS_BOARD_ACCESS_${reason}` });
}
function plain(value: unknown, limit: number): value is string { return typeof value === "string" && !!value && value === value.trim() && value.length <= limit; }
function chunks<T>(values: T[]): T[][] { const result: T[][] = []; for (let index = 0; index < values.length; index += CHUNK) result.push(values.slice(index, index + CHUNK)); return result; }
async function read(tx: DbExecutor, text: string, parameters: unknown[]) {
  try { return await query(tx, text, parameters); } catch { return fail("READ_UNAVAILABLE", "PRECONDITION_FAILED"); }
}
const permissionName = z.string().min(1).max(100).refine(value => value === value.trim());
const operations = z.array(z.enum(["read", "edit", "delete"])).max(3).refine(values => new Set(values).size === values.length);
const permissionDetails = z.array(z.object({ moduleId: permissionName, operations,
  subModules: z.array(z.object({ subModuleId: permissionName, operations }).strict()).max(100).refine(values => new Set(values.map(value => value.subModuleId)).size === values.length).optional(),
}).strict()).max(100).refine(values => new Set(values.map(value => value.moduleId)).size === values.length);
function permissionJson(value: unknown): unknown {
  try {
    if (Buffer.byteLength(typeof value === "string" ? value : JSON.stringify(value) ?? "", "utf8") > 65536) fail("DIRECTORY_INVALID");
    return typeof value === "string" ? JSON.parse(value) : value;
  } catch { return fail("DIRECTORY_INVALID"); }
}
async function directory(tx: DbExecutor, role: string, workspaceId: number, operation: Operation) {
  if (role === "super_admin") return operationsBoardEditionHash({ basis: "super_admin_directory", role, workspaceId });
  const found = await read(tx, "SELECT id,workspaceId,role,modules,detailedPermissions FROM role_permissions WHERE role=? AND (workspaceId=? OR workspaceId IS NULL) ORDER BY workspaceId IS NULL ASC,id DESC LIMIT 3 FOR SHARE", [role, workspaceId]);
  if (found.length > 2 || new Set(found.map(row => row.workspaceId)).size !== found.length || found.some(row => !positiveId(row.id) || row.role !== role || row.workspaceId !== null && row.workspaceId !== workspaceId)) fail("DIRECTORY_INVALID");
  const record = found.find(row => row.workspaceId === workspaceId) ?? found.find(row => row.workspaceId === null);
  if (!record) {
    if (!ROLE_MODULE_ACCESS[role]?.includes("ops")) fail("DIRECTORY_DENIED");
    return operationsBoardEditionHash({ basis: "configured_role_default", role, workspaceId, modules: ROLE_MODULE_ACCESS[role] });
  }
  const modules = z.array(permissionName).max(100).refine(values => new Set(values).size === values.length).safeParse(permissionJson(record.modules));
  const details = record.detailedPermissions === null ? null : permissionDetails.safeParse(permissionJson(record.detailedPermissions));
  if (!modules.success || details !== null && !details.success) fail("DIRECTORY_INVALID");
  if (!modules.data.includes("ops")) fail("DIRECTORY_DENIED");
  const module = details?.success ? details.data.find(value => value.moduleId === "ops") : undefined;
  if (details?.success && details.data.length > 0 && !module) fail("DIRECTORY_DENIED");
  if (module) for (const subModuleId of ["ops_dashboard", "ops_data_import"]) {
    const grants = module.subModules?.find(value => value.subModuleId === subModuleId)?.operations ?? module.operations;
    // Both displays need financial read. Board writes need dashboard edit only;
    // this neither requires nor confers monthly import edit/delete authority.
    if (!grants.includes("read") || operation !== "read" && subModuleId === "ops_dashboard" && !grants.includes("edit")) fail("DIRECTORY_DENIED");
  }
  return operationsBoardEditionHash({ basis: "current_role_directory", id: record.id, workspaceId: record.workspaceId, role,
    modules: modules.data, detailedPermissions: details?.success ? details.data : null });
}

/** Requires the caller's existing transaction. No connection, implicit init,
 * background grant, role cache or default-workspace membership shortcut. */
export async function authorizeOperationsBoardAccess(tx: DbExecutor, input: {
  identity: Identity; expectedRole?: string; operation: Operation; write?: boolean;
}, permission: typeof assertResourceAction = assertResourceAction): Promise<OperationsBoardAccessSession> {
  if (!tx || typeof tx.execute !== "function" || !positiveId(input.identity?.userId) || !positiveId(input.identity?.workspaceId)
    || !["read", "create", "update", "assign"].includes(input.operation) || input.expectedRole !== undefined && !plain(input.expectedRole, 100)
    || input.write !== undefined && typeof input.write !== "boolean") fail("INPUT_INVALID", "BAD_REQUEST");
  const write = input.write ?? input.operation !== "read";
  if (input.operation !== "read" && !write) fail("WRITE_LOCK_REQUIRED", "BAD_REQUEST");
  const identity = Object.freeze({ ...input.identity }), lock = write ? "FOR UPDATE" : "FOR SHARE";
  const workspaces = await read(tx, `SELECT id,status FROM workspaces WHERE id=? ${lock}`, [identity.workspaceId]);
  if (workspaces.length !== 1 || workspaces[0].id !== identity.workspaceId || workspaces[0].status !== "active") fail("WORKSPACE_INACTIVE");
  const actors = await read(tx, `SELECT id,role,status,defaultWorkspaceId FROM users WHERE id=? ${lock}`, [identity.userId]), actorRow = actors[0];
  if (actors.length !== 1 || actorRow.id !== identity.userId || !plain(actorRow.role, 100) || input.expectedRole !== undefined && actorRow.role !== input.expectedRole
    || actorRow.status !== "active" || actorRow.defaultWorkspaceId !== identity.workspaceId) fail("ACTOR_CHANGED");
  const memberships = await read(tx, "SELECT id,workspaceId,userId,status FROM workspace_memberships WHERE workspaceId=? AND userId=? LIMIT 2 FOR SHARE", [identity.workspaceId, identity.userId]);
  if (memberships.length !== 1 || !positiveId(memberships[0].id) || memberships[0].workspaceId !== identity.workspaceId || memberships[0].userId !== identity.userId || memberships[0].status !== "active") fail("MEMBERSHIP_REQUIRED");
  const role = actorRow.role;
  if ((input.operation === "create" || input.operation === "assign") && !isAdmin(role)) fail("ADMIN_REQUIRED");
  const actor = Object.freeze({ id: identity.userId, role, defaultWorkspaceId: identity.workspaceId });
  // Reads must retain SHARE locks across actor and partner authorization:
  // acquiring UPDATE on each actor's own role first can deadlock reciprocal
  // partners. Writers keep UPDATE and check resources before the directory.
  const authorizationRead = { executor: tx, strict: true as const, lock: true as const, lockMode: write ? "update" as const : "share" as const };
  try {
    await permission({ actor, workspaceId: identity.workspaceId, resource: "ops_data", action: "read", authorizationRead });
    await permission({ actor, workspaceId: identity.workspaceId, resource: "ops_board", action: "read", authorizationRead });
    if (input.operation !== "read") await permission({ actor, workspaceId: identity.workspaceId, resource: "ops_board", action: input.operation, authorizationRead });
  } catch (error) {
    if (error instanceof TRPCError && error.code === "FORBIDDEN") return fail("RESOURCE_DENIED");
    return fail("RESOURCE_UNAVAILABLE", "PRECONDITION_FAILED");
  }
  const directoryHash = await directory(tx, role, identity.workspaceId, input.operation);
  const grants = Object.freeze(["ops_data:read", "ops_board:read", ...(input.operation !== "read" ? [`ops_board:${input.operation}`] : [])]);
  const authorizationEvidence = Object.freeze({ workspaceId: identity.workspaceId, membershipId: memberships[0].id as number, directoryHash, grants });
  const authorizationHash = operationsBoardEditionHash({ schema: "operations-board-access/v1", identity, actor, operation: input.operation, write, authorizationEvidence });
  const session = Object.freeze({ tx, identity, actor, role, manager: ["admin", "super_admin", "ops_manager"].includes(role), operation: input.operation, write, authorizationEvidence, authorizationHash });
  issued.add(session); return session;
}

/** Optional read-UI capability check in the already authorized transaction.
 * It does not reacquire/upgrade workspace or actor locks, confer a write grant,
 * or replace authorizeOperationsBoardAccess(operation:update) on mutation. */
export async function canUpdateOperationsBoard(session: OperationsBoardAccessSession,
  permission: typeof assertResourceAction = assertResourceAction): Promise<boolean> {
  if (!issued.has(session)) fail("SESSION_INVALID");
  try {
    await permission({ actor: session.actor, workspaceId: session.identity.workspaceId, resource: "ops_board", action: "update",
      authorizationRead: { executor: session.tx, strict: true, lock: true, lockMode: "share" } });
    await directory(session.tx, session.role, session.identity.workspaceId, "update");
    return true;
  } catch (error) {
    if (error instanceof TRPCError && error.code === "FORBIDDEN") return false;
    throw error;
  }
}

type Kind = "saihu" | "unknown";
const key = (kind: Kind, name: string) => JSON.stringify([kind, name]);
type OwnerResolution = { month: string; parent: string; rows: MonthlyFinancialReadRow[]; owners: number[] };
async function manualRules(session: OperationsBoardAccessSession, capture: OperationsBoardEditionCapture, parents: string[]) {
  const records: Row[] = [], byParent = new Map<string, Row[]>(), seen = new Set<number>();
  for (const group of chunks(parents)) {
    const found = await read(session.tx, `SELECT id,workspaceId,parent_asin AS parentAsin,store_name AS storeName,country,assignee_user_id AS assigneeUserId,is_active AS isActive
      FROM ops_inventory_owner_assignments WHERE workspaceId=? AND BINARY store_name=BINARY ? AND is_active=1
      AND BINARY parent_asin IN (${group.map(() => "?").join(",")}) ORDER BY id LIMIT 1001 FOR SHARE`, [session.identity.workspaceId, capture.scope.storeName, ...group]);
    if (found.length > QUERY_LIMIT) fail("OWNER_LIMIT", "PRECONDITION_FAILED");
    for (const row of found) {
      if (!positiveId(row.id) || seen.has(row.id) || row.workspaceId !== session.identity.workspaceId || !plain(row.parentAsin, 500) || !group.includes(row.parentAsin)
        || row.storeName !== capture.scope.storeName || !plain(row.country, 50) || row.isActive !== 1) fail("OWNER_INVALID", "PRECONDITION_FAILED");
      seen.add(row.id); records.push(row);
      if (normalizeMarketplaceCode(row.country) !== capture.scope.country) continue;
      const previous = byParent.get(row.parentAsin) ?? []; previous.push(row); byParent.set(row.parentAsin, previous);
    }
  }
  return { records, byParent };
}
function saihuSourceIds(capture: OperationsBoardEditionCapture): Set<number> {
  // Origin is captured by the server from the real saved source, not rebuilt
  // from raw.source, a filename, uploader identity or a fictitious batch DTO.
  return new Set(capture.sources.filter(source => source.origin.kind === "saihu_sync" && source.origin.hashBasis === "mapped_json_bytes"
    && positiveId(source.origin.sourceRunId)).map(source => source.batchId));
}
const sourceKind = (row: MonthlyFinancialReadRow, saihu: Set<number>): Kind => saihu.has(row.batchId) && row.raw.source === "sellfox_monthly_api" ? "saihu" : "unknown";
async function mappedRules(session: OperationsBoardAccessSession, rows: MonthlyFinancialReadRow[], saihu: Set<number>) {
  const records: Row[] = [], owners = new Map<string, number[] | null>();
  for (const kind of ["saihu", "unknown"] as const) {
    const names = [...new Set(rows.filter(row => sourceKind(row, saihu) === kind).flatMap(row => splitExternalOperatorNames(row.operator)))].sort();
    if (names.length > 60_000) fail("OWNER_LIMIT", "PRECONDITION_FAILED");
    for (const group of chunks(names)) {
      const found = await read(session.tx, `SELECT id,workspaceId,external_name AS externalName,source_type AS sourceType,system_user_id AS systemUserId,is_confirmed AS isConfirmed
        FROM operator_name_mappings WHERE workspaceId=? AND is_confirmed=1 AND ${kind === "saihu" ? "source_type IN ('saihu','all')" : "source_type='all'"}
        AND BINARY external_name IN (${group.map(() => "?").join(",")}) ORDER BY id LIMIT 1001 FOR SHARE`, [session.identity.workspaceId, ...group]);
      if (found.length > QUERY_LIMIT) fail("OWNER_LIMIT", "PRECONDITION_FAILED");
      if (new Set(found.map(row => row.id)).size !== found.length || found.some(row => !positiveId(row.id) || row.workspaceId !== session.identity.workspaceId || !plain(row.externalName, 200)
        || !group.includes(row.externalName) || row.isConfirmed !== 1 || !(kind === "saihu" ? ["saihu", "all"] : ["all"]).includes(String(row.sourceType)))) fail("MAPPING_INVALID", "PRECONDITION_FAILED");
      records.push(...found);
      for (const name of group) {
        const matches = found.filter(row => row.externalName === name), ids = [...new Set(matches.filter(row => positiveId(row.systemUserId)).map(row => row.systemUserId as number))].sort((a, b) => a - b);
        owners.set(key(kind, name), ids.length === 1 && matches.every(row => positiveId(row.systemUserId)) ? ids : null);
      }
    }
  }
  return { records, owners };
}
async function activeOwners(session: OperationsBoardAccessSession, ids: number[]) {
  if (ids.length > MAX_OWNERS) fail("OWNER_LIMIT", "PRECONDITION_FAILED");
  const records: Row[] = [], active = new Set<number>(), seen = new Set<number>();
  for (const group of chunks(ids)) {
    const found = await read(session.tx, `SELECT m.id,m.workspaceId,m.userId,m.status AS membershipStatus,u.id AS actorId,u.status AS actorStatus,u.defaultWorkspaceId
      FROM workspace_memberships m LEFT JOIN users u ON u.id=m.userId
      WHERE m.workspaceId=? AND m.userId IN (${group.map(() => "?").join(",")}) ORDER BY m.userId,m.id LIMIT 1001 FOR SHARE`, [session.identity.workspaceId, ...group]);
    if (found.length > QUERY_LIMIT) fail("OWNER_LIMIT", "PRECONDITION_FAILED");
    for (const row of found) {
      if (!positiveId(row.id) || row.workspaceId !== session.identity.workspaceId || !positiveId(row.userId) || !group.includes(row.userId) || seen.has(row.userId)
        || !["active", "disabled", "invited"].includes(String(row.membershipStatus)) || row.actorId !== null && (!positiveId(row.actorId) || row.actorId !== row.userId)
        || row.actorId === null && (row.actorStatus !== null || row.defaultWorkspaceId !== null)
        || row.actorId !== null && (!["active", "disabled", "pending"].includes(String(row.actorStatus)) || row.defaultWorkspaceId !== null && !positiveId(row.defaultWorkspaceId))) fail("MEMBER_INVALID", "PRECONDITION_FAILED");
      seen.add(row.userId); records.push(row);
      if (row.membershipStatus === "active" && row.actorStatus === "active" && row.defaultWorkspaceId === session.identity.workspaceId) active.add(row.userId);
    }
  }
  return { records, active };
}

async function visibleOwnerNames(session: OperationsBoardAccessSession, ids: number[]) {
  const names = new Map<number, string>();
  for (const group of chunks(ids)) {
    const rows = await read(session.tx, `SELECT id,status,defaultWorkspaceId,IF(OCTET_LENGTH(name)<=800,name,NULL) AS displayName,OCTET_LENGTH(name) AS nameBytes
      FROM users WHERE id IN (${group.map(() => "?").join(",")}) ORDER BY id LIMIT 501 FOR SHARE`, group);
    if (rows.length !== group.length) fail("OWNER_DIRECTORY_INVALID", "PRECONDITION_FAILED");
    for (const row of rows) {
      if (!positiveId(row.id) || !group.includes(row.id) || names.has(row.id) || row.status !== "active" || row.defaultWorkspaceId !== session.identity.workspaceId
        || (row.displayName === null ? row.nameBytes !== null : typeof row.displayName !== "string" || !Number.isSafeInteger(row.nameBytes) || row.nameBytes !== Buffer.byteLength(row.displayName, "utf8") || row.nameBytes > 800)
        || typeof row.displayName === "string" && row.displayName.trim().length > 200) fail("OWNER_DIRECTORY_INVALID", "PRECONDITION_FAILED");
      // A current account without a name is explicitly identified by its ID;
      // neither an old spreadsheet name nor a historical identity is invented.
      names.set(row.id, typeof row.displayName === "string" && row.displayName.trim() ? row.displayName.trim() : `用户 #${row.id}`);
    }
  }
  return names;
}

/** Only direct, freshly authorized partner sessions supplied after the caller's
 * current pairing lookup may extend READ visibility. This does not discover
 * pairs, recurse, grant import/task/model access or lend any editing capability. */
export async function authorizeOperationsBoardCapture(session: OperationsBoardAccessSession, raw: OperationsBoardEditionCapture,
  options: { partnerSessions?: OperationsBoardAccessSession[]; includeOwnership?: boolean } = {}) {
  if (!issued.has(session)) fail("SESSION_INVALID");
  const capture = OperationsBoardEditionCaptureSchema.parse(raw), partners = options.partnerSessions ?? [];
  if (capture.scope.workspaceId !== session.identity.workspaceId || !Array.isArray(partners) || partners.length > MAX_PARTNERS
    || partners.some(partner => !partner || !issued.has(partner) || partner.tx !== session.tx || partner.identity.workspaceId !== session.identity.workspaceId
      || partner.identity.userId === session.identity.userId || partner.operation !== "read")
    || new Set(partners.map(partner => partner.identity.userId)).size !== partners.length) fail("PARTNER_SESSION_INVALID");
  const grouped = new Map<string, OwnerResolution>();
  for (const row of capture.rows) {
    if (!row.parentAsin || !["child", "parent_only"].includes(row.allocation)) continue;
    if (!plain(row.parentAsin, 500)) fail("PARENT_INVALID", "PRECONDITION_FAILED");
    const groupKey = JSON.stringify([row.yearMonth, row.parentAsin]), group = grouped.get(groupKey) ?? { month: row.yearMonth, parent: row.parentAsin, rows: [], owners: [] };
    group.rows.push(row); grouped.set(groupKey, group);
  }
  const groups = [...grouped.values()], parents = [...new Set(groups.map(group => group.parent))].sort();
  const manual = await manualRules(session, capture, parents), saihu = saihuSourceIds(capture);
  const mapped = await mappedRules(session, groups.flatMap(group => manual.byParent.has(group.parent) ? [] : group.rows), saihu);
  for (const group of groups) {
    const assigned = manual.byParent.get(group.parent);
    if (assigned) {
      // Even an invalid, conflicting or other-owner manual rule blocks mapping
      // fallback. Never convert absence of a valid numeric grant into a name grant.
      group.owners = assigned.length === 1 && positiveId(assigned[0].assigneeUserId) ? [assigned[0].assigneeUserId] : [];
      continue;
    }
    const sets = new Set<string>(); let candidates: number[] = [], valid = true;
    for (const row of group.rows) {
      const names = splitExternalOperatorNames(row.operator), resolved = names.map(name => mapped.owners.get(key(sourceKind(row, saihu), name)));
      if (!names.length || resolved.some(ids => !ids)) { valid = false; break; }
      candidates = [...new Set(resolved.flatMap(ids => ids!))].sort((a, b) => a - b); sets.add(candidates.join(","));
    }
    group.owners = valid && sets.size === 1 ? candidates : [];
  }
  const allIds = [...new Set(groups.flatMap(group => group.owners))].sort((a, b) => a - b), members = await activeOwners(session, allIds);
  // Full owner-set consistency was established above, before this membership
  // narrowing. Revoking one co-owner/partner cannot revoke another active
  // actor's own grant, and it never introduces an unresolved name fallback.
  for (const group of groups) group.owners = group.owners.filter(id => members.active.has(id));
  const readIds = new Set([session.identity.userId, ...partners.map(partner => partner.identity.userId)]);
  const refs = new Set(groups.filter(group => group.owners.some(id => readIds.has(id))).flatMap(group => group.rows.map(row => `${row.batchId}:${row.rowIndex}`)));
  const authorizedRows = session.manager ? capture.rows : capture.rows.filter(row => refs.has(`${row.batchId}:${row.rowIndex}`));
  const latest = new Map<string, OwnerResolution>();
  for (const group of groups) if (!latest.has(group.parent) || group.month > latest.get(group.parent)!.month) latest.set(group.parent, group);
  const visibleParents = new Set(authorizedRows.filter(row => row.parentAsin && ["child", "parent_only"].includes(row.allocation)).map(row => row.parentAsin));
  const responsibleUserIdsByParent = new Map([...latest].filter(([parent]) => visibleParents.has(parent)).map(([parent, group]) => [parent, [...group.owners]]));
  const canEditParents = new Set([...visibleParents].filter(parent => isAdmin(session.role) || responsibleUserIdsByParent.get(parent)?.includes(session.identity.userId)));
  const sources = capture.sources.flatMap(source => { const rowCount = authorizedRows.filter(row => row.yearMonth === source.month).length; return rowCount ? [{ ...source, rowCount }] : []; });
  let ownership: OperationsBoardEditionOwnership | null = null;
  if (options.includeOwnership) {
    // Display/filter evidence is the latest VISIBLE original row per parent,
    // evaluated with today's mapping/membership. Note-edit authority above is
    // deliberately independent and cannot be inherited from a partner.
    const visibleRefs = new Set(authorizedRows.map(row => `${row.batchId}:${row.rowIndex}`)), visibleLatest = new Map<string, OwnerResolution>();
    for (const group of groups) if (group.rows.some(row => visibleRefs.has(`${row.batchId}:${row.rowIndex}`))
      && (!visibleLatest.has(group.parent) || group.month > visibleLatest.get(group.parent)!.month)) visibleLatest.set(group.parent, group);
    const parentOwners = [...visibleLatest].sort(([a], [b]) => a.localeCompare(b)).map(([parentAsin, group]) => {
      const operatorIds = group.owners.filter(owner => session.manager || readIds.has(owner));
      return { parentAsin, operatorIds, status: operatorIds.length ? "resolved" as const : "unresolved" as const,
        basis: manual.byParent.has(parentAsin) ? "manual" as const : "confirmed_source_mapping" as const,
        sourceMonth: manual.byParent.has(parentAsin) ? null : group.month };
    });
    const visibleIds = [...new Set(parentOwners.flatMap(parent => parent.operatorIds))].sort((a, b) => a - b), names = await visibleOwnerNames(session, visibleIds);
    const partnerIds = new Set(partners.map(partner => partner.identity.userId));
    ownership = OperationsBoardEditionOwnershipSchema.parse({ version: 1, meaning: "current_authorization_not_historical_membership", visibility: session.manager ? "full" : "scoped",
      operators: visibleIds.map(userId => ({ userId, displayName: names.get(userId), relation: userId === session.identity.userId ? "self" : partnerIds.has(userId) ? "direct_partner" : "workspace_owner" })),
      parents: parentOwners, selectedOperatorId: null });
  }
  const authorizationHash = operationsBoardEditionHash({ schema: "operations-board-capture-access/v1", sourceHash: capture.sourceHash, actor: session.authorizationHash,
    partners: partners.map(partner => ({ userId: partner.identity.userId, authorizationHash: partner.authorizationHash })).sort((a, b) => a.userId - b.userId),
    ownerRules: manual.records, mappings: mapped.records, members: members.records,
    grantedRows: authorizedRows.map(row => [row.batchId, row.rowIndex]), editableParents: [...canEditParents].sort() });
  return { authorizedRows, sources, responsibleUserIdsByParent, canEditParents, authorizationHash, ownership, visibility: session.manager ? "full" as const : "scoped" as const };
}
