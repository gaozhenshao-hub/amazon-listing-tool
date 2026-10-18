import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { ROLE_MODULE_ACCESS } from "../../../shared/const";
import { normalizeMarketplaceCode } from "../../../shared/marketplaceIdentity";
import { monthlyFinancialImportHash, MonthlyFinancialImportError } from "../../../shared/monthlyFinancialImport";
import { MonthlyFinancialReadError, monthlyFinancialRowMatchesScope, type MonthlyFinancialReadRow } from "../../../shared/monthlyFinancialRead";
import { ProfitAnalysisError, ProfitAnalysisPreviewInputSchema, ProfitAnalysisSourceSchema, priorProfitAnalysisMonth,
  buildProfitAnalysisPreviewResult, buildProfitAnalysisPreviewUnavailable, type ProfitAnalysisPreviewInput, type ProfitAnalysisSource } from "../../../shared/profitAnalysis";
import type { TrpcContext } from "../../_core/context";
import { getDb, type DbExecutor } from "../../repositories/dbClient";
import { assertResourceAction } from "../../services/securityGovernance";
import { splitExternalOperatorNames } from "./operatorNameResolution";
import { selectMonthlyBoardSnapshots } from "./monthlyBoardSnapshotSelection";
import { query, positiveId, SourceTableMissing, InvalidSource, IncompleteScan, MonthlyBoardReadGuardError, type Row, type Session, type Code } from "./monthlyBoardReadCore";

export interface ProfitAnalysisSnapshotDatabase { transaction?<T>(body: (tx: DbExecutor) => Promise<T>): Promise<T> }
/** This session is created only after fresh same-transaction authorization.
 * Future job/save callers must recreate it, never persist or trust a client copy. */
export type ProfitAnalysisSnapshotSession = Session & { authorizationEvidence: unknown };
class Unavailable extends Error { constructor(readonly reasonCode: string) { super(reasonCode); } }
function fail(code: string, type: Code = "PRECONDITION_FAILED"): never { throw new TRPCError({ code: type, message: `PROFIT_ANALYSIS_${code}` }); }
const digest = monthlyFinancialImportHash;
function originalParents(row: MonthlyFinancialReadRow): string[] {
  const api = row.raw.api;
  return api && typeof api === "object" && !Array.isArray(api) && Array.isArray(api.parentAsinList)
    ? [...new Set(api.parentAsinList.filter((parent): parent is string => typeof parent === "string" && parent !== row.asin && parent !== "-" && parent !== ""))] : [];
}
const permissionName = z.string().min(1).max(100).refine(value => value === value.trim());
const operations = z.array(z.enum(["read", "edit", "delete"])).max(3).refine(value => new Set(value).size === value.length);
const detailsSchema = z.array(z.object({ moduleId: permissionName, operations,
  subModules: z.array(z.object({ subModuleId: permissionName, operations }).strict()).max(100).refine(value => new Set(value.map(item => item.subModuleId)).size === value.length).optional(),
}).strict()).max(100).refine(value => new Set(value.map(item => item.moduleId)).size === value.length);
function policyJson(raw: unknown) {
  try {
    if (Buffer.byteLength(typeof raw === "string" ? raw : JSON.stringify(raw) ?? "", "utf8") > 65536) fail("DIRECTORY_INVALID", "FORBIDDEN");
    return typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch { return fail("DIRECTORY_INVALID", "FORBIDDEN"); }
}
async function directory(tx: DbExecutor, role: string, workspaceId: number) {
  if (role === "super_admin") return { role, rule: "super_admin" };
  const found = await query(tx, `SELECT id,workspaceId,role,
    IF(OCTET_LENGTH(modules)<=65536,modules,NULL) AS modules,
    IF(OCTET_LENGTH(detailedPermissions)<=65536,detailedPermissions,NULL) AS detailedPermissions,
    COALESCE(OCTET_LENGTH(detailedPermissions),0) AS detailBytes
    FROM role_permissions WHERE role=? AND (workspaceId=? OR workspaceId IS NULL) ORDER BY workspaceId IS NULL ASC,id DESC LIMIT 3 FOR SHARE`, [role, workspaceId]);
  if (found.length > 2 || new Set(found.map(row => row.workspaceId)).size !== found.length || found.some(row => !positiveId(row.id) || row.role !== role || row.workspaceId !== null && row.workspaceId !== workspaceId
    || typeof row.detailBytes !== "number" || !Number.isSafeInteger(row.detailBytes) || row.detailBytes < 0 || row.detailBytes > 65536)) fail("DIRECTORY_INVALID", "FORBIDDEN");
  const selected = found.find(row => row.workspaceId === workspaceId) ?? found.find(row => row.workspaceId === null);
  if (!selected) { if (!ROLE_MODULE_ACCESS[role]?.includes("ops")) fail("DIRECTORY_DENIED", "FORBIDDEN"); return { role, rule: "role_default", modules: ROLE_MODULE_ACCESS[role] }; }
  const modules = z.array(permissionName).max(100).refine(value => new Set(value).size === value.length).safeParse(policyJson(selected.modules));
  const details = selected.detailedPermissions === null ? null : detailsSchema.safeParse(policyJson(selected.detailedPermissions));
  if (!modules.success || details !== null && !details.success) fail("DIRECTORY_INVALID", "FORBIDDEN");
  if (!modules.data.includes("ops")) fail("DIRECTORY_DENIED", "FORBIDDEN");
  const module = details?.success ? details.data.find(item => item.moduleId === "ops") : undefined;
  for (const key of ["ops_dashboard", "ops_profit"]) if (module && !(module.subModules?.find(item => item.subModuleId === key)?.operations ?? module.operations).includes("read")) fail("DIRECTORY_DENIED", "FORBIDDEN");
  return { selected: { id: selected.id, workspaceId: selected.workspaceId, role, modules: modules.data, detailedPermissions: details?.success ? details.data : null } };
}
async function schema(tx: DbExecutor, manager: boolean) {
  const tables = ["workspaces", "users", "workspace_memberships", "role_permissions", "security_access_policies", "ops_monthly_profit_imports",
    ...(!manager ? ["ops_inventory_owner_assignments", "operator_name_mappings"] : [])];
  const found = await query(tx, `SELECT TABLE_NAME AS tableName,ENGINE AS engine FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (${tables.map(() => "?").join(",")})`, tables);
  if (found.length !== tables.length || new Set(found.map(row => row.tableName)).size !== tables.length || found.some(row => !tables.includes(String(row.tableName)) || row.engine !== "InnoDB")) throw new Unavailable("schema_unavailable");
}
async function policyEvidence(tx: DbExecutor, actor: Row, workspaceId: number) {
  const found = await query(tx, `SELECT id,workspaceId,resourceType,resourceId,action,effect,principalType,principalId,status
    FROM security_access_policies WHERE status='active' AND resourceType='ops_data' AND action='read'
    AND (workspaceId=? OR workspaceId IS NULL) AND resourceId IS NULL
    AND ((principalType='user' AND principalId=?) OR (principalType='role' AND principalId=?) OR principalType='workspace_member')
    ORDER BY id LIMIT 1001 FOR SHARE`, [workspaceId, String(actor.id), actor.role]);
  if (found.length > 1000 || new Set(found.map(row => row.id)).size !== found.length || found.some(row => !positiveId(row.id) || row.workspaceId !== null && row.workspaceId !== workspaceId
    || row.resourceType !== "ops_data" || row.resourceId !== null || row.action !== "read" || row.status !== "active" || !["allow", "deny"].includes(String(row.effect))
    || !(row.principalType === "workspace_member" || row.principalType === "user" && row.principalId === String(actor.id) || row.principalType === "role" && row.principalId === actor.role))) fail("POLICY_INVALID", "FORBIDDEN");
  return found;
}
async function activeMembers(tx: DbExecutor, workspaceId: number, ids: number[]) {
  const found: Row[] = [];
  for (let offset = 0; offset < ids.length; offset += 500) {
    const group = ids.slice(offset, offset + 500);
    const rows = await query(tx, `SELECT m.id,m.workspaceId,m.userId,m.status AS membershipStatus,u.id AS actorId,u.status AS actorStatus
      FROM workspace_memberships m LEFT JOIN users u ON u.id=m.userId
      WHERE m.workspaceId=? AND m.userId IN (${group.map(() => "?").join(",")}) ORDER BY m.userId,m.id LIMIT 1001 FOR SHARE`, [workspaceId, ...group]);
    if (rows.length > 1000 || rows.some(row => !positiveId(row.id) || row.workspaceId !== workspaceId || !positiveId(row.userId) || !positiveId(row.actorId) || !group.includes(row.userId) || row.actorId !== row.userId
      || !["active", "disabled", "invited"].includes(String(row.membershipStatus)) || !["active", "disabled", "pending"].includes(String(row.actorStatus)))) fail("OWNER_MEMBERSHIP_INVALID", "FORBIDDEN");
    found.push(...rows);
  }
  if (new Set(found.map(row => row.userId)).size !== found.length) fail("OWNER_MEMBERSHIP_INVALID", "FORBIDDEN");
  const active = new Set(found.filter(row => row.membershipStatus === "active" && row.actorStatus === "active").map(row => Number(row.userId)));
  if (ids.some(id => !active.has(id))) fail("OWNER_MEMBERSHIP_UNAVAILABLE", "FORBIDDEN");
  return found;
}
async function ownerEvidence(session: Session, input: ProfitAnalysisPreviewInput, periods: { rows: MonthlyFinancialReadRow[]; saihu: boolean }[]) {
  if (session.manager) return { rule: "current_manager" };
  // Read all country aliases for this exact parent/store, then compare their
  // canonical country. No uploader/name/default-workspace ownership shortcuts.
  const rules = await query(session.tx, `SELECT id,workspaceId,parent_asin AS parentAsin,store_name AS storeName,country,assignee_user_id AS assigneeUserId,is_active AS isActive
    FROM ops_inventory_owner_assignments WHERE workspaceId=? AND BINARY parent_asin=BINARY ? AND BINARY store_name=BINARY ? AND is_active=1 ORDER BY id LIMIT 1001 FOR SHARE`, [session.identity.workspaceId, input.scope.parentAsin, input.scope.storeName]);
  if (rules.length > 1000 || rules.some(row => !positiveId(row.id) || row.workspaceId !== session.identity.workspaceId || row.parentAsin !== input.scope.parentAsin || row.storeName !== input.scope.storeName
    || typeof row.country !== "string" || !row.country || row.country.length > 50 || !positiveId(row.assigneeUserId) || row.isActive !== 1)) fail("OWNER_INVALID", "FORBIDDEN");
  const matches = rules.filter(row => normalizeMarketplaceCode(String(row.country)) === input.scope.country);
  if (matches.length > 1) fail("OWNER_AMBIGUOUS", "FORBIDDEN");
  if (matches.length) {
    if (matches[0].assigneeUserId !== session.identity.userId) fail("SCOPE_DENIED", "FORBIDDEN");
    return { rule: "manual", records: matches, members: await activeMembers(session.tx, session.identity.workspaceId, [session.identity.userId]) };
  }
  const kind = (row: MonthlyFinancialReadRow, saihu: boolean) => saihu && row.raw.source === "sellfox_monthly_api" ? "saihu" : "unknown";
  const rows = periods.flatMap(period => period.rows.map(row => ({ row, kind: kind(row, period.saihu) })));
  if (!rows.length) fail("SCOPE_DENIED", "FORBIDDEN");
  const decisions = new Map<string, number>(), mappings: Row[] = [];
  for (const source of ["saihu", "unknown"] as const) {
    const names = [...new Set(rows.filter(row => row.kind === source).flatMap(item => splitExternalOperatorNames(item.row.operator)))].sort();
    for (let offset = 0; offset < names.length; offset += 500) {
      const group = names.slice(offset, offset + 500);
      const found = await query(session.tx, `SELECT id,workspaceId,external_name AS externalName,source_type AS sourceType,system_user_id AS systemUserId,is_confirmed AS isConfirmed
        FROM operator_name_mappings WHERE workspaceId=? AND is_confirmed=1 AND ${source === "saihu" ? "source_type IN ('saihu','all')" : "source_type='all'"}
        AND BINARY external_name IN (${group.map(() => "?").join(",")}) ORDER BY id LIMIT 1001 FOR SHARE`, [session.identity.workspaceId, ...group]);
      if (found.length > 1000 || found.some(row => !positiveId(row.id) || row.workspaceId !== session.identity.workspaceId || row.isConfirmed !== 1 || !positiveId(row.systemUserId)
        || typeof row.externalName !== "string" || !group.includes(row.externalName) || !(source === "saihu" ? ["saihu", "all"] : ["all"]).includes(String(row.sourceType)))) fail("OWNER_MAPPING_INVALID", "FORBIDDEN");
      mappings.push(...found);
      for (const name of group) {
        const mapped = [...new Set(found.filter(row => row.externalName === name).map(row => Number(row.systemUserId)))];
        if (mapped.length !== 1) fail("SCOPE_DENIED", "FORBIDDEN"); decisions.set(JSON.stringify([source, name]), mapped[0]);
      }
    }
  }
  const ids = [...new Set(decisions.values())].sort((a, b) => a - b), members = await activeMembers(session.tx, session.identity.workspaceId, ids);
  for (const period of periods) {
    const memberships = new Set<string>();
    for (const row of period.rows) {
      const names = splitExternalOperatorNames(row.operator), owners = [...new Set(names.map(name => decisions.get(JSON.stringify([kind(row, period.saihu), name]))))].sort((a, b) => Number(a) - Number(b));
      if (!names.length || owners.includes(undefined) || !owners.includes(session.identity.userId)) fail("SCOPE_DENIED", "FORBIDDEN"); memberships.add(owners.join(","));
    }
    if (memberships.size > 1) fail("SCOPE_DENIED", "FORBIDDEN");
  }
  return { rule: "confirmed_numeric_mapping", mappings, members };
}

/** Complete private capture in the caller's already-authorized transaction.
 * Select the whole store/site batch before any parent, owner, currency or basis
 * filtering. Costs are historical report values, never the current cost sheet. */
export async function loadProfitAnalysisSnapshot(session: ProfitAnalysisSnapshotSession, input: ProfitAnalysisPreviewInput): Promise<ProfitAnalysisSource> {
  if (input.expectedWorkspaceId !== session.identity.workspaceId) fail("WORKSPACE_CHANGED", "FORBIDDEN");
  const previousMonth = priorProfitAnalysisMonth(input.month);
  const capture = await selectMonthlyBoardSnapshots(session, { months: [previousMonth, input.month], storeName: input.scope.storeName, country: input.scope.country });
  // The general read helper intentionally removes ambiguous parent rows when
  // passed a parent filter. AI completeness must instead keep potential parent
  // candidates until ambiguity is explicitly rejected, never hide their costs.
  const parentPeriods = capture.selections.map(item => ({ rows: (item.selection.selected?.rows ?? []).filter(row => monthlyFinancialRowMatchesScope(row,
    { yearMonth: item.month, storeName: input.scope.storeName, country: input.scope.country }) && (row.parentAsin === input.scope.parentAsin || originalParents(row).includes(input.scope.parentAsin))),
    saihu: item.selection.selected?.batch.origin.kind === "saihu_sync" }));
  const ownership = await ownerEvidence(session, input, parentPeriods);
  const recordHashes = new Map(capture.proof.records.map(record => [record.id, digest({ ...record,
    payload: typeof record.payload === "string" ? JSON.parse(record.payload) : record.payload, months: typeof record.months === "string" ? JSON.parse(record.months) : record.months })]));
  const periods = capture.selections.map((item, index) => {
    const original = parentPeriods[index].rows;
    if (original.some(row => ["unallocated", "ambiguous"].includes(row.allocation) || row.parentAsin !== input.scope.parentAsin
      || originalParents(row).length > 0 && !originalParents(row).includes(row.parentAsin)
      || row.allocation === "child" && row.asin === row.parentAsin)) throw new Unavailable("ambiguous_financial_basis");
    const basis = original.filter(row => input.scope.basis === "child_rows" ? row.allocation === "child" : row.allocation === "parent_only");
    if (basis.some(row => row.currency === null) && input.scope.currency !== null) throw new Unavailable("unknown_currency");
    const rows = basis.filter(row => row.currency === input.scope.currency);
    if (input.scope.basis === "reported_parent_row" && rows.length > 1) throw new Unavailable("ambiguous_financial_basis");
    const batchId = item.selection.selected?.batch.id ?? null;
    return { month: item.month, rows, selection: { complete: true as const, rule: "latest_completed_batch_per_month_store_site" as const,
      selectedBatchId: batchId, recordHash: batchId === null ? null : recordHashes.get(batchId)!, scopeRowCount: rows.length, authorizedRowCount: rows.length } };
  });
  const selectionProof = { workspaceId: session.identity.workspaceId, scope: input.scope, previousMonth, month: input.month, candidates: capture.proof.candidates.map(({ id, workspaceId, status }) => ({ id, workspaceId, status })),
    records: [...recordHashes].map(([id, hash]) => ({ id, hash })), stopReason: capture.proof.stopReason,
    selections: capture.selections.map(item => ({ month: item.month, selectedBatchId: item.selection.selected?.batch.id ?? null, scannedBatchIds: item.selection.scannedBatchIds })) };
  const selectionHash = digest(selectionProof), authorizationHash = digest({ identity: session.identity, evidence: session.authorizationEvidence, ownership });
  return ProfitAnalysisSourceSchema.parse({ version: 1, identity: session.identity, scope: input.scope, month: input.month, previousMonth, periods,
    selectionHash, authorizationHash, sourceHash: digest({ version: 1, selectionHash, records: [...recordHashes], scope: input.scope, previousMonth, month: input.month }) });
}

export function createProfitAnalysisSnapshotRepository(dependencies: { database?: () => Promise<ProfitAnalysisSnapshotDatabase | null>; permission?: typeof assertResourceAction } = {}) {
  const database = dependencies.database ?? getDb, permission = dependencies.permission ?? assertResourceAction;
  async function get(ctx: TrpcContext, raw: ProfitAnalysisPreviewInput) {
    try {
      if (!ctx.user) fail("LOGIN_REQUIRED", "UNAUTHORIZED");
      const parsed = ProfitAnalysisPreviewInputSchema.safeParse(raw); if (!parsed.success) fail("INPUT_INVALID", "BAD_REQUEST");
      const input = parsed.data, workspaceId = ctx.workspaceId !== undefined ? ctx.workspaceId : ctx.user.defaultWorkspaceId;
      if (!positiveId(ctx.user.id) || !positiveId(workspaceId) || input.expectedWorkspaceId !== workspaceId) fail("WORKSPACE_CHANGED", "FORBIDDEN");
      const identity = { userId: ctx.user.id, workspaceId }, db = await database(); if (!db?.transaction) fail("TRANSACTION_REQUIRED");
      return await db.transaction(async tx => {
        try {
          const workspace = await query(tx, "SELECT id,status FROM workspaces WHERE id=? FOR SHARE", [workspaceId]);
          if (workspace.length !== 1 || workspace[0].id !== workspaceId || workspace[0].status !== "active") fail("WORKSPACE_UNAVAILABLE", "FORBIDDEN");
          const actors = await query(tx, "SELECT id,role,status,defaultWorkspaceId FROM users WHERE id=? FOR SHARE", [identity.userId]), actor = actors[0];
          if (actors.length !== 1 || actor.id !== identity.userId || actor.role !== ctx.user!.role || actor.status !== "active" || actor.defaultWorkspaceId !== workspaceId) fail("ACTOR_CHANGED", "FORBIDDEN");
          const membership = await query(tx, "SELECT id,workspaceId,userId,role,status FROM workspace_memberships WHERE workspaceId=? AND userId=? ORDER BY id LIMIT 2 FOR SHARE", [workspaceId, identity.userId]);
          if (membership.length !== 1 || !positiveId(membership[0].id) || membership[0].workspaceId !== workspaceId || membership[0].userId !== identity.userId || membership[0].status !== "active" || typeof membership[0].role !== "string" || !membership[0].role || membership[0].role.length > 64) fail("MEMBERSHIP_UNAVAILABLE", "FORBIDDEN");
          const manager = ["super_admin", "admin", "ops_manager"].includes(String(actor.role));
          await schema(tx, manager);
          const directoryEvidence = await directory(tx, String(actor.role), workspaceId);
          await permission({ actor: { id: identity.userId, role: String(actor.role), defaultWorkspaceId: workspaceId }, resource: "ops_data", action: "read", workspaceId, authorizationRead: { executor: tx, strict: true, lock: true } });
          const policies = await policyEvidence(tx, actor, workspaceId);
          const session = { tx, identity, manager, authorizationEvidence: { actor, workspace: workspace[0], membership: membership[0], directory: directoryEvidence, policies } };
          const source = await loadProfitAnalysisSnapshot(session, input);
          return buildProfitAnalysisPreviewResult({ identity, input, source });
        } catch (error) {
          if (error instanceof Unavailable) return buildProfitAnalysisPreviewUnavailable({ identity, input, reasonCode: error.reasonCode });
          if (error instanceof SourceTableMissing) return buildProfitAnalysisPreviewUnavailable({ identity, input, reasonCode: "source_missing" });
          if (error instanceof IncompleteScan) return buildProfitAnalysisPreviewUnavailable({ identity, input, reasonCode: "scan_incomplete" });
          if (error instanceof InvalidSource || error instanceof MonthlyFinancialReadError || error instanceof MonthlyFinancialImportError || error instanceof ProfitAnalysisError || error instanceof z.ZodError) return buildProfitAnalysisPreviewUnavailable({ identity, input, reasonCode: "source_invalid" });
          throw error;
        }
      });
    } catch (error) {
      if (error instanceof TRPCError && /^PROFIT_ANALYSIS_[A-Z_]+$/u.test(error.message)) throw error;
      if (error instanceof TRPCError && ["UNAUTHORIZED", "FORBIDDEN"].includes(error.code)) fail("ACCESS_DENIED", "FORBIDDEN");
      if (error instanceof MonthlyBoardReadGuardError) fail("SOURCE_UNVERIFIABLE");
      return fail("READ_UNAVAILABLE");
    }
  }
  return { get };
}
export const profitAnalysisSnapshotRepository = createProfitAnalysisSnapshotRepository();
