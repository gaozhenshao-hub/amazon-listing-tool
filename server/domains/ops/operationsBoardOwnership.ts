import { normalizeMarketplaceCode } from "../../../shared/marketplaceIdentity";
import { MonthlyFinancialReadRowSchema, monthlyFinancialRowMatchesScope, type MonthlyFinancialReadRow } from "../../../shared/monthlyFinancialRead";
import { OPERATIONS_BOARD_OWNERSHIP_LIMITS, OperationsBoardOwnershipSchema, buildUnavailableOperationsBoardOwnership, validateOperationsBoardOwnershipForRows, type OperationsBoardOwnership } from "../../../shared/operationsBoardOwnership";
import { MonthlyBoardReadGuardError, positiveId, query, type MonthlyBoardMonthSelection, type MonthlyBoardScope, type Row, type Session } from "./monthlyBoardReadCore";
import { splitExternalOperatorNames } from "./operatorNameResolution";

type Parent = OperationsBoardOwnership["parents"][number];
type Kind = "saihu" | "unknown";
const CHUNK = 500, QUERY_LIMIT = 1000;
function fail(code: string): never { throw new MonthlyBoardReadGuardError(`OWNER_${code}`); }
const reference = (row: { batchId: number; rowIndex: number }) => `${row.batchId}:${row.rowIndex}`;
const plainText = (value: unknown, limit: number): value is string => typeof value === "string" && !!value && value === value.trim() && value.length <= limit;
function chunks<T>(values: T[]): T[][] { const result: T[][] = []; for (let offset = 0; offset < values.length; offset += CHUNK) result.push(values.slice(offset, offset + CHUNK)); return result; }
function registryMissing(error: unknown): boolean {
  let current = error;
  for (let depth = 0; depth < 5 && current && typeof current === "object"; depth++) {
    const item = current as { code?: unknown; errno?: unknown; cause?: unknown };
    if (item.code === "ER_NO_SUCH_TABLE" || item.errno === 1146 || item.code === "ER_BAD_FIELD_ERROR" || item.errno === 1054) return true;
    current = item.cause;
  }
  return false;
}
async function registry(session: Session, text: string, parameters: unknown[]): Promise<Row[]> {
  try { return await query(session.tx, text, parameters); }
  catch (error) { if (registryMissing(error)) fail("REGISTRY_UNAVAILABLE"); throw error; }
}

/** The caller has already selected whole-scope winners and run authorizeMonths.
 * This validates that closure again but NEVER grants extra financial row access. */
function visibleRows(session: Session, scope: MonthlyBoardScope, selections: MonthlyBoardMonthSelection[]) {
  if (!positiveId(session.identity.userId) || !positiveId(session.identity.workspaceId) || typeof session.manager !== "boolean"
    || !plainText(scope.storeName, 200) || !plainText(scope.country, 50) || normalizeMarketplaceCode(scope.country) !== scope.country
    || scope.parentAsin !== undefined && !plainText(scope.parentAsin, 500)
    || selections.length > 1200 || new Set(selections.map(item => item.month)).size !== selections.length) fail("SOURCE_INVALID");
  const result: MonthlyFinancialReadRow[] = [], saihu = new Set<number>(), seen = new Set<string>();
  for (const item of selections) {
    if (!/^[1-9]\d{3}-(?:0[1-9]|1[0-2])$/u.test(item.month) || !item.selection.complete
      || item.metadataVisibility !== (session.manager ? "full" : "scoped")) fail("SOURCE_INVALID");
    const selected = item.selection.selected;
    if (!selected) { if (item.authorizedRowRefs?.length) fail("AUTHORIZATION_INVALID"); continue; }
    if (selected.batch.workspaceId !== session.identity.workspaceId || !positiveId(selected.batch.id) || selected.batch.status !== "completed"
      || selected.batch.confirmedAt === null || selected.rows.length !== selected.batch.totalRows || item.selection.scannedBatchIds.at(-1) !== selected.batch.id) fail("SOURCE_INVALID");
    const rows = selected.rows.filter(row => monthlyFinancialRowMatchesScope(row, { yearMonth: item.month, storeName: scope.storeName, country: scope.country }));
    const refs = new Set(rows.map(reference)), authorized = item.authorizedRowRefs;
    if (!rows.length || refs.size !== rows.length || rows.some(row => row.batchId !== selected.batch.id)
      || !session.manager && authorized === undefined || authorized && (new Set(authorized.map(reference)).size !== authorized.length
        || authorized.some(ref => !positiveId(ref.batchId) || !Number.isInteger(ref.rowIndex) || ref.rowIndex < 0 || !refs.has(reference(ref))))) fail("AUTHORIZATION_INVALID");
    const allowed = authorized ? new Set(authorized.map(reference)) : null;
    for (const row of rows) {
      if (allowed && !allowed.has(reference(row)) || scope.parentAsin !== undefined && (row.parentAsin !== scope.parentAsin || ["ambiguous", "unallocated"].includes(row.allocation))) continue;
      if (!MonthlyFinancialReadRowSchema.safeParse(row).success || seen.has(reference(row))) fail("SOURCE_INVALID");
      seen.add(reference(row)); result.push(row);
      if (result.length > OPERATIONS_BOARD_OWNERSHIP_LIMITS.rows) fail("SOURCE_LIMIT");
    }
    if (selected.batch.origin.kind === "saihu_sync") saihu.add(selected.batch.id);
  }
  return { rows: result, saihu };
}
async function manualRules(session: Session, scope: MonthlyBoardScope, parents: string[]) {
  const result = new Map<string, Row[]>(), seen = new Set<number>();
  for (const group of chunks(parents)) {
    // Inspect all country spellings for exact parent/store, then canonicalize
    // only for collision detection. Names and stored labels are not authority.
    const found = await registry(session, `SELECT id,workspaceId,parent_asin AS parentAsin,store_name AS storeName,country,assignee_user_id AS assigneeUserId,is_active AS isActive
      FROM ops_inventory_owner_assignments WHERE workspaceId=? AND BINARY store_name=BINARY ? AND is_active=1
      AND BINARY parent_asin IN (${group.map(() => "?").join(",")}) ORDER BY id LIMIT 1001 FOR SHARE`, [session.identity.workspaceId, scope.storeName, ...group]);
    if (found.length > QUERY_LIMIT) fail("REGISTRY_LIMIT");
    for (const row of found) {
      if (!positiveId(row.id) || seen.has(row.id) || row.workspaceId !== session.identity.workspaceId || typeof row.parentAsin !== "string" || !group.includes(row.parentAsin)
        || row.storeName !== scope.storeName || !plainText(row.country, 50) || row.isActive !== 1) fail("REGISTRY_INVALID");
      seen.add(row.id);
      if (normalizeMarketplaceCode(row.country) !== scope.country) continue;
      const values = result.get(row.parentAsin) ?? []; values.push(row); result.set(row.parentAsin, values);
    }
  }
  return result;
}
const sourceKind = (row: MonthlyFinancialReadRow, saihu: Set<number>): Kind => saihu.has(row.batchId) && row.raw.source === "sellfox_monthly_api" ? "saihu" : "unknown";
const mappingKey = (kind: Kind, name: string) => JSON.stringify([kind, name]);
type Mapping = { ids: number[]; conflict: boolean; invalid: boolean };
async function mappings(session: Session, rows: MonthlyFinancialReadRow[], saihu: Set<number>) {
  const result = new Map<string, Mapping>();
  for (const kind of ["saihu", "unknown"] as const) {
    const names = [...new Set(rows.filter(row => sourceKind(row, saihu) === kind).flatMap(row => splitExternalOperatorNames(row.operator)))].sort();
    if (names.length > OPERATIONS_BOARD_OWNERSHIP_LIMITS.rows) fail("REGISTRY_LIMIT");
    for (const group of chunks(names)) {
      const found = await registry(session, `SELECT id,workspaceId,external_name AS externalName,source_type AS sourceType,system_user_id AS systemUserId,is_confirmed AS isConfirmed
        FROM operator_name_mappings WHERE workspaceId=? AND is_confirmed=1 AND ${kind === "saihu" ? "source_type IN ('saihu','all')" : "source_type='all'"}
        AND BINARY external_name IN (${group.map(() => "?").join(",")}) ORDER BY id LIMIT 1001 FOR SHARE`, [session.identity.workspaceId, ...group]);
      if (found.length > QUERY_LIMIT) fail("REGISTRY_LIMIT");
      if (new Set(found.map(row => row.id)).size !== found.length || found.some(row => !positiveId(row.id) || row.workspaceId !== session.identity.workspaceId || row.isConfirmed !== 1
        || !plainText(row.externalName, 200) || !group.includes(row.externalName) || !(kind === "saihu" ? ["saihu", "all"] : ["all"]).includes(String(row.sourceType)))) fail("REGISTRY_INVALID");
      for (const name of group) {
        const matches = found.filter(row => row.externalName === name), ids = [...new Set(matches.flatMap(row => positiveId(row.systemUserId) ? [row.systemUserId] : []))].sort((a, b) => a - b);
        result.set(mappingKey(kind, name), { ids, invalid: matches.some(row => !positiveId(row.systemUserId)), conflict: ids.length > 1 });
      }
    }
  }
  return result;
}
async function members(session: Session, ids: number[]) {
  if (ids.length > OPERATIONS_BOARD_OWNERSHIP_LIMITS.operators) fail("REGISTRY_LIMIT");
  const active = new Map<number, string>(), seen = new Set<number>();
  for (const group of chunks(ids)) {
    const found = await registry(session, `SELECT m.id,m.workspaceId,m.userId,m.status AS membershipStatus,u.id AS actorId,u.status AS actorStatus,u.defaultWorkspaceId,
      IF(CHAR_LENGTH(u.name)<=200 AND OCTET_LENGTH(u.name)<=800,u.name,NULL) AS displayName,OCTET_LENGTH(u.name) AS nameBytes,CHAR_LENGTH(u.name) AS nameCharacters
      FROM workspace_memberships m LEFT JOIN users u ON u.id=m.userId
      WHERE m.workspaceId=? AND m.userId IN (${group.map(() => "?").join(",")}) ORDER BY m.userId,m.id LIMIT 1001 FOR SHARE`, [session.identity.workspaceId, ...group]);
    if (found.length > QUERY_LIMIT) fail("REGISTRY_LIMIT");
    for (const row of found) {
      if (!positiveId(row.id) || row.workspaceId !== session.identity.workspaceId || !positiveId(row.userId) || !group.includes(row.userId) || seen.has(row.userId)
        || !["active", "disabled", "invited"].includes(String(row.membershipStatus)) || row.actorId !== null && (!positiveId(row.actorId) || row.actorId !== row.userId)
        || row.actorId === null && (row.actorStatus !== null || row.defaultWorkspaceId !== null || row.displayName !== null || row.nameBytes !== null || row.nameCharacters !== null)
        || row.actorId !== null && (!["active", "disabled", "pending"].includes(String(row.actorStatus)) || row.defaultWorkspaceId !== null && !positiveId(row.defaultWorkspaceId))
        || row.nameBytes !== null && (typeof row.nameBytes !== "number" || !Number.isSafeInteger(row.nameBytes) || row.nameBytes < 0)
        || row.nameCharacters !== null && (typeof row.nameCharacters !== "number" || !Number.isSafeInteger(row.nameCharacters) || row.nameCharacters < 0)
        || (row.nameBytes === null) !== (row.nameCharacters === null)
        || row.displayName === null && row.nameBytes !== null && Number(row.nameBytes) <= 800 && Number(row.nameCharacters) <= 200
        || row.displayName !== null && (typeof row.displayName !== "string" || row.displayName.length > 400 || Buffer.byteLength(row.displayName, "utf8") !== row.nameBytes || [...row.displayName].length !== row.nameCharacters)) fail("MEMBER_INVALID");
      seen.add(row.userId);
      if (row.actorId === null || row.membershipStatus !== "active" || row.actorStatus !== "active" || row.defaultWorkspaceId !== session.identity.workspaceId) continue;
      // A missing/oversized display label may use the numeric identity. It is
      // never truncated into another name and never replaced with an email.
      const name = typeof row.displayName === "string" && row.displayName.length <= 200 ? row.displayName.trim() : "";
      active.set(row.userId, name || `成员 #${row.userId}`);
    }
  }
  return active;
}

/** Server-only current-owner filtering metadata. No writes, owner grant,
 * archived ownership, name-based partner relationship or new row visibility. */
export async function resolveOperationsBoardOwnership(session: Session, scope: MonthlyBoardScope, selections: MonthlyBoardMonthSelection[]): Promise<OperationsBoardOwnership> {
  const { rows, saihu } = visibleRows(session, scope, selections), latest = new Map<string, MonthlyFinancialReadRow[]>();
  for (const row of rows) {
    if (!row.parentAsin || !["child", "parent_only"].includes(row.allocation)) continue;
    if (!plainText(row.parentAsin, 500)) fail("SOURCE_INVALID");
    const current = latest.get(row.parentAsin);
    if (!current || row.yearMonth > current[0].yearMonth) latest.set(row.parentAsin, [row]);
    else if (row.yearMonth === current[0].yearMonth) current.push(row);
  }
  const parents = [...latest.keys()].sort(), manual = await manualRules(session, scope, parents);
  const mapped = await mappings(session, parents.flatMap(parent => manual.has(parent) ? [] : latest.get(parent)!), saihu);
  const ids = [...new Set([...manual.values()].flatMap(values => values.flatMap(row => positiveId(row.assigneeUserId) ? [row.assigneeUserId] : []))
    .concat([...mapped.values()].flatMap(value => value.ids)))].sort((a, b) => a - b);
  const active = await members(session, ids), decisions: Parent[] = [];
  for (const parent of parents) {
    const candidates = latest.get(parent)!, rules = manual.get(parent), sourceMonth = rules ? null : candidates[0].yearMonth;
    const basis = rules ? "manual" as const : "confirmed_source_mapping" as const;
    let owners: number[] = [], reason: string | null = null, conflict = false;
    if (rules) {
      if (rules.length !== 1) { reason = "manual_assignment_conflict"; conflict = true; }
      else if (!positiveId(rules[0].assigneeUserId)) reason = "manual_assignment_invalid";
      else owners = [rules[0].assigneeUserId];
    } else {
      const sets = new Set<string>();
      for (const row of candidates) {
        const names = splitExternalOperatorNames(row.operator);
        if (!names.length) { reason = "source_operator_missing"; break; }
        const values = names.map(name => mapped.get(mappingKey(sourceKind(row, saihu), name)));
        if (values.some(value => value?.conflict)) { reason = "mapping_conflict"; conflict = true; break; }
        if (values.some(value => !value || value.invalid || value.ids.length !== 1)) { reason = "mapping_missing"; break; }
        const rowOwners = [...new Set(values.flatMap(value => value!.ids))].sort((a, b) => a - b);
        sets.add(rowOwners.join(",")); owners = rowOwners;
      }
      if (!reason && sets.size !== 1) { reason = "row_owners_conflict"; conflict = true; }
    }
    if (!reason && owners.some(owner => !active.has(owner))) reason = "owner_inactive";
    if (!reason && !session.manager && !owners.includes(session.identity.userId)) reason = "owner_not_visible";
    decisions.push({ parentAsin: parent, operatorIds: reason ? [] : session.manager ? owners : [session.identity.userId], status: reason ? conflict ? "conflict" : "unresolved" : "resolved", basis, sourceMonth, reasonCode: reason });
  }
  const visibleIds = [...new Set(decisions.flatMap(parent => parent.operatorIds))].sort((a, b) => a - b);
  const value = OperationsBoardOwnershipSchema.parse({ version: 1, status: "ready", reasonCode: null,
    meaning: "current_manual_else_latest_visible_financial_mapping_not_archive", visibility: session.manager ? "full" : "scoped",
    operators: visibleIds.map(userId => ({ userId, displayName: active.get(userId)! })), parents: decisions,
    partners: { status: "not_configured", reasonCode: "trusted_partner_relationship_not_configured" } });
  return validateOperationsBoardOwnershipForRows(value, rows, session.identity.userId);
}

/** Only the caller's explicit missing-registry, manager/unfiltered fallback.
 * Source/scope/row checks are identical; this cannot authorize ordinary users. */
export function unavailableOperationsBoardOwnership(session: Session, scope: MonthlyBoardScope, selections: MonthlyBoardMonthSelection[]): OperationsBoardOwnership {
  if (!session.manager) fail("FALLBACK_DENIED");
  const { rows } = visibleRows(session, scope, selections);
  return validateOperationsBoardOwnershipForRows(buildUnavailableOperationsBoardOwnership(rows, "full"), rows, session.identity.userId);
}
