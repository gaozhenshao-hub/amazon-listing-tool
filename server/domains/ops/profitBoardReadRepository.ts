import { TRPCError } from "@trpc/server";
import { sql, type SQL } from "drizzle-orm";
import type { TrpcContext } from "../../_core/context";
import { getDb, type DbExecutor } from "../../repositories/dbClient";
import { assertResourceAction } from "../../services/securityGovernance";
import { normalizeMarketplaceCode } from "../../../shared/marketplaceIdentity";
import { splitExternalOperatorNames } from "./operatorNameResolution";
import { MonthlyFinancialReadError, parseMonthlyFinancialBatch, monthlyFinancialRowMatchesScope,
  type MonthlyFinancialBatchRecord, type MonthlyFinancialReadRow } from "../../../shared/monthlyFinancialRead";
import { ProfitBoardReadInputSchema, ProfitBoardReadError, profitBoardMonths, buildProfitBoardReadResult, buildProfitBoardReadFailure,
  type ProfitBoardReadInput, type ProfitBoardMonthSelection } from "../../../shared/profitBoardRead";

type Row = Record<string, unknown>;
type Code = "UNAUTHORIZED" | "FORBIDDEN" | "BAD_REQUEST" | "PRECONDITION_FAILED" | "INTERNAL_SERVER_ERROR";
type Identity = { userId: number; workspaceId: number };
type Session = { tx: DbExecutor; identity: Identity; manager: boolean };
export interface ProfitBoardReadDatabase { transaction?<T>(body: (tx: DbExecutor) => Promise<T>): Promise<T> }
const positiveId = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= 2_147_483_647;
const PAYLOAD_WIRE_MAX = 64 * 1024 * 1024, MONTHS_WIRE_MAX = 64 * 1024, SCAN_BYTES_MAX = 32 * 1024 * 1024, SCAN_BATCHES_MAX = 200, OWNER_CHUNK = 500;
function fail(message: string, code: Code = "PRECONDITION_FAILED"): never { throw new TRPCError({ code, message }); }
class SourceTableMissing extends Error {}
class InvalidSource extends Error {}
class IncompleteScan extends Error {}
function noSuchTable(error: unknown) {
  let current = error;
  for (let depth = 0; depth < 5 && current && typeof current === "object"; depth++) {
    const item = current as { code?: unknown; errno?: unknown; cause?: unknown };
    if (item.code === "ER_NO_SUCH_TABLE" || item.errno === 1146) return true;
    current = item.cause;
  }
  return false;
}
function statement(text: string, values: unknown[]): SQL {
  const parts = text.split("?");
  if (parts.length !== values.length + 1) fail("PROFIT_BOARD_READ_SQL_INVALID", "INTERNAL_SERVER_ERROR");
  return sql.join(parts.flatMap((part, index) => index < values.length ? [sql.raw(part), sql`${values[index]}`] : [sql.raw(part)]), sql.raw(""));
}
async function query(tx: DbExecutor, text: string, values: unknown[]): Promise<Row[]> {
  const result = await tx.execute(statement(text, values));
  if (!Array.isArray(result) || !Array.isArray(result[0]) || result[0].some(row => !row || typeof row !== "object" || Array.isArray(row))) fail("PROFIT_BOARD_READ_RESPONSE_INVALID");
  return result[0] as Row[];
}
const safeRunReference = "fileUrl REGEXP '^saihu-sync-run:[1-9][0-9]{0,9}$' AND CAST(SUBSTRING(fileUrl,16) AS UNSIGNED)<=2147483647 AND BINARY fileUrl=BINARY CONCAT('saihu-sync-run:',CAST(CAST(SUBSTRING(fileUrl,16) AS UNSIGNED) AS CHAR))";
function projection(payloadLimit: number) {
  return `id,workspaceId,userId,fileName,fileHash,status,totalRows,skippedRows,unallocatedRows,
    IF(OCTET_LENGTH(CAST(months AS CHAR CHARACTER SET utf8mb4))<=${MONTHS_WIRE_MAX},CAST(months AS CHAR CHARACTER SET utf8mb4),NULL) AS months,
    OCTET_LENGTH(CAST(months AS CHAR CHARACTER SET utf8mb4)) AS monthsBytes,
    DATE_FORMAT(createdAt,'%Y-%m-%d %H:%i:%s.%f') AS createdAt,
    DATE_FORMAT(confirmedAt,'%Y-%m-%d %H:%i:%s.%f') AS confirmedAt,
    CASE WHEN ${safeRunReference} THEN 'saihu_sync_run' WHEN fileUrl REGEXP '^(https://|s3://|oss://)' THEN 'storage' ELSE 'unknown' END AS fileReferenceKind,
    CASE WHEN ${safeRunReference} THEN CAST(SUBSTRING(fileUrl,16) AS UNSIGNED) ELSE NULL END AS sourceRunId,
    IF(OCTET_LENGTH(CAST(payload AS CHAR CHARACTER SET utf8mb4))<=${payloadLimit},CAST(payload AS CHAR CHARACTER SET utf8mb4),NULL) AS payload,
    OCTET_LENGTH(CAST(payload AS CHAR CHARACTER SET utf8mb4)) AS payloadBytes`;
}
function wire(value: unknown, bytes: unknown, limit: number): string {
  if (typeof value !== "string" || typeof bytes !== "number" || !Number.isSafeInteger(bytes) || bytes < 0 || bytes > limit || Buffer.byteLength(value, "utf8") !== bytes) throw new InvalidSource();
  return value;
}
function sourceRecord(row: Row, workspaceId: number): MonthlyFinancialBatchRecord {
  const sourceRunId = typeof row.sourceRunId === "string" && /^[1-9][0-9]{0,9}$/u.test(row.sourceRunId) ? Number(row.sourceRunId) : row.sourceRunId;
  if (row.workspaceId !== workspaceId || !positiveId(row.id) || !positiveId(row.userId) || row.status !== "completed"
    || !["saihu_sync_run", "storage", "unknown"].includes(String(row.fileReferenceKind)) || sourceRunId !== null && !positiveId(sourceRunId)) throw new InvalidSource();
  return { id: row.id, workspaceId, userId: row.userId, fileName: row.fileName as string, fileHash: row.fileHash as string,
    status: "completed", totalRows: row.totalRows as number, skippedRows: row.skippedRows as number, unallocatedRows: row.unallocatedRows as number,
    months: wire(row.months, row.monthsBytes, MONTHS_WIRE_MAX), payload: wire(row.payload, row.payloadBytes, PAYLOAD_WIRE_MAX),
    createdAt: row.createdAt as string, confirmedAt: row.confirmedAt as string | null,
    fileReferenceKind: row.fileReferenceKind as MonthlyFinancialBatchRecord["fileReferenceKind"], sourceRunId };
}
async function selectMonths(session: Session, input: ProfitBoardReadInput): Promise<ProfitBoardMonthSelection[]> {
  const selections: ProfitBoardMonthSelection[] = profitBoardMonths(input.month).map(month => ({ month, selection: { selected: null, scannedBatchIds: [], complete: false }, metadataVisibility: session.manager ? "full" : "scoped" }));
  let candidates: Row[];
  try {
    // Fix and lock the candidate identities in one statement. Repeating
    // locking keyset reads could otherwise admit a newly completed old import
    // between months, even inside one transaction at READ COMMITTED.
    candidates = await query(session.tx, `SELECT id,workspaceId,status,
      OCTET_LENGTH(CAST(payload AS CHAR CHARACTER SET utf8mb4)) AS payloadBytes,
      OCTET_LENGTH(CAST(months AS CHAR CHARACTER SET utf8mb4)) AS monthsBytes
      FROM ops_monthly_profit_imports WHERE workspaceId=? AND status='completed' ORDER BY id DESC LIMIT 201 FOR SHARE`, [session.identity.workspaceId]);
  } catch (error) { if (noSuchTable(error)) throw new SourceTableMissing(); throw error; }
  if (candidates.length > SCAN_BATCHES_MAX + 1 || candidates.some((row, index) => !positiveId(row.id) || row.workspaceId !== session.identity.workspaceId || row.status !== "completed"
    || index > 0 && Number(row.id) >= Number(candidates[index - 1].id) || typeof row.payloadBytes !== "number" || !Number.isSafeInteger(row.payloadBytes) || row.payloadBytes < 0
    || typeof row.monthsBytes !== "number" || !Number.isSafeInteger(row.monthsBytes) || row.monthsBytes < 0)) throw new InvalidSource();
  let scannedBytes = 0;
  for (let count = 0; count < Math.min(candidates.length, SCAN_BATCHES_MAX); count++) {
    const candidate = candidates[count];
    const remaining = SCAN_BYTES_MAX - scannedBytes;
    if (remaining <= 0 || Number(candidate.payloadBytes) + Number(candidate.monthsBytes) > remaining) throw new IncompleteScan();
    let selected: Row[];
    try {
      // Never add newly inserted/completed candidates, nor use uploader,
      // parent or ownership predicates to change a whole-scope winner.
      selected = await query(session.tx, `SELECT ${projection(remaining)} FROM ops_monthly_profit_imports WHERE workspaceId=? AND id=? LIMIT 2 FOR SHARE`, [session.identity.workspaceId, candidate.id]);
    } catch (error) { if (noSuchTable(error)) throw new SourceTableMissing(); throw error; }
    const row = selected[0];
    if (selected.length !== 1 || row.id !== candidate.id || row.payloadBytes !== candidate.payloadBytes || row.monthsBytes !== candidate.monthsBytes) throw new InvalidSource();
    const saved = sourceRecord(row, session.identity.workspaceId), parsed = parseMonthlyFinancialBatch(saved);
    scannedBytes += Number(row.payloadBytes) + Number(row.monthsBytes);
    for (const item of selections) {
      if (item.selection.complete) continue;
      item.selection.scannedBatchIds.push(saved.id);
      if (parsed.rows.some(source => monthlyFinancialRowMatchesScope(source, { yearMonth: item.month, storeName: input.storeName, country: input.country }))) {
        item.selection.selected = parsed; item.selection.complete = true;
      }
    }
    if (selections.every(item => item.selection.complete)) return selections;
  }
  if (candidates.length <= SCAN_BATCHES_MAX) { for (const item of selections) item.selection.complete = true; return selections; }
  throw new IncompleteScan();
}
const countryAliases: Record<string, string> = { "美国": "US", "美国站": "US", "亚马逊美国站": "US", "AMAZON.COM": "US", "加拿大": "CA", "加拿大站": "CA", GB: "UK", "英国": "UK", "英国站": "UK", "德国": "DE", "德国站": "DE", "法国": "FR", "法国站": "FR", "意大利": "IT", "意大利站": "IT", "西班牙": "ES", "西班牙站": "ES", "日本": "JP", "日本站": "JP", "澳大利亚": "AU", "澳洲": "AU", "澳大利亚站": "AU", "墨西哥": "MX", "墨西哥站": "MX", "巴西": "BR", "巴西站": "BR", "阿联酋": "AE", "阿联酋站": "AE", "沙特": "SA", "沙特站": "SA", "新加坡": "SG", "新加坡站": "SG" };
const countrySql = `CASE UPPER(TRIM(country)) ${Object.entries(countryAliases).map(([alias, code]) => `WHEN '${alias}' THEN '${code}'`).join(" ")} ELSE UPPER(TRIM(country)) END`;
function chunks<T>(items: T[]): T[][] { const result: T[][] = []; for (let i = 0; i < items.length; i += OWNER_CHUNK) result.push(items.slice(i, i + OWNER_CHUNK)); return result; }
async function manualOwners(session: Session, input: ProfitBoardReadInput, parents: string[]) {
  const decisions = new Map<string, boolean>();
  for (const group of chunks(parents)) {
    const found = await query(session.tx, `SELECT id,workspaceId,parent_asin AS parentAsin,store_name AS storeName,country,assignee_user_id AS assigneeUserId,is_active AS isActive
      FROM ops_inventory_owner_assignments WHERE workspaceId=? AND BINARY store_name=BINARY ? AND ${countrySql}=? AND is_active=1
      AND BINARY parent_asin IN (${group.map(() => "?").join(",")}) LIMIT 1001 FOR SHARE`, [session.identity.workspaceId, input.storeName, input.country, ...group]);
    if (found.length > 1000 || found.some(row => !positiveId(row.id) || row.workspaceId !== session.identity.workspaceId || typeof row.parentAsin !== "string" || !group.includes(row.parentAsin)
      || row.storeName !== input.storeName || typeof row.country !== "string" || normalizeMarketplaceCode(row.country) !== input.country || !positiveId(row.assigneeUserId) || row.isActive !== 1)) fail("PROFIT_BOARD_READ_OWNER_STRUCTURE_INVALID");
    const byParent = new Map<string, Row>();
    for (const row of found) {
      if (byParent.has(row.parentAsin as string)) fail("PROFIT_BOARD_READ_OWNER_STRUCTURE_INVALID");
      byParent.set(row.parentAsin as string, row);
    }
    for (const parent of group) {
      const match = byParent.get(parent);
      // Existing other-owner rule blocks mapping fallback; absence alone may
      // use confirmed source mappings. Never use assignee names or usernames.
      if (match) decisions.set(parent, match.assigneeUserId === session.identity.userId);
    }
  }
  return decisions;
}
type SourceKind = "saihu" | "unknown";
const sourceKind = (row: MonthlyFinancialReadRow, saihuBatches: Set<number>): SourceKind => saihuBatches.has(row.batchId) && row.raw.source === "sellfox_monthly_api" ? "saihu" : "unknown";
async function mappedOwners(session: Session, candidates: MonthlyFinancialReadRow[], saihuBatches: Set<number>) {
  const owners = new Map<string, number[] | null>();
  for (const kind of ["saihu", "unknown"] as const) {
    const names = [...new Set(candidates.filter(row => sourceKind(row, saihuBatches) === kind).flatMap(row => splitExternalOperatorNames(row.operator)))];
    for (const group of chunks(names)) {
      const found = await query(session.tx, `SELECT id,workspaceId,external_name AS externalName,source_type AS sourceType,system_user_id AS systemUserId,is_confirmed AS isConfirmed
        FROM operator_name_mappings WHERE workspaceId=? AND is_confirmed=1 AND ${kind === "saihu" ? "source_type IN ('saihu','all')" : "source_type='all'"}
        AND BINARY external_name IN (${group.map(() => "?").join(",")}) LIMIT 1001 FOR SHARE`, [session.identity.workspaceId, ...group]);
      if (found.length > 1000 || found.some(row => !positiveId(row.id) || row.workspaceId !== session.identity.workspaceId || row.isConfirmed !== 1 || !positiveId(row.systemUserId)
        || typeof row.externalName !== "string" || !group.includes(row.externalName) || !(kind === "saihu" ? ["saihu", "all"] : ["all"]).includes(String(row.sourceType)))) fail("PROFIT_BOARD_READ_OWNER_STRUCTURE_INVALID");
      for (const name of group) {
        const ids = [...new Set(found.filter(row => row.externalName === name).map(row => row.systemUserId as number))];
        owners.set(JSON.stringify([kind, name]), ids.length === 1 ? ids : null);
      }
    }
  }
  return owners;
}
async function authorizeMonths(session: Session, input: ProfitBoardReadInput, selections: ProfitBoardMonthSelection[]) {
  if (session.manager) return;
  const saihuBatches = new Set(selections.flatMap(item => item.selection.selected?.batch.origin.kind === "saihu_sync" ? [item.selection.selected.batch.id] : []));
  const groups = selections.map(item => {
    const rows = (item.selection.selected?.rows ?? []).filter(row => !!row.parentAsin && !["unallocated", "ambiguous"].includes(row.allocation) && monthlyFinancialRowMatchesScope(row, { yearMonth: item.month, storeName: input.storeName, country: input.country, ...(input.parentAsin ? { parentAsin: input.parentAsin } : {}) }));
    const byParent = new Map<string, MonthlyFinancialReadRow[]>();
    for (const row of rows) { const group = byParent.get(row.parentAsin) ?? []; group.push(row); byParent.set(row.parentAsin, group); }
    return { item, rows, byParent };
  });
  const manual = await manualOwners(session, input, [...new Set(groups.flatMap(group => [...group.byParent.keys()]))]);
  const mappings = await mappedOwners(session, groups.flatMap(group => group.rows).filter(row => !manual.has(row.parentAsin)), saihuBatches);
  for (const group of groups) {
    const refs: { batchId: number; rowIndex: number }[] = [];
    for (const [parent, rows] of group.byParent) {
      let allowed = manual.get(parent) === true;
      if (!manual.has(parent)) {
        const memberships: string[] = [];
        allowed = rows.every(row => {
          const names = splitExternalOperatorNames(row.operator);
          if (!names.length) return false;
          const resolved = names.map(name => mappings.get(JSON.stringify([sourceKind(row, saihuBatches), name])));
          if (resolved.some(ids => !ids)) return false;
          const ids = [...new Set(resolved.flatMap(ids => ids!))].sort((a, b) => a - b);
          memberships.push(ids.join(",")); return ids.includes(session.identity.userId);
        }) && new Set(memberships).size === 1;
      }
      if (allowed) refs.push(...rows.map(row => ({ batchId: row.batchId, rowIndex: row.rowIndex })));
    }
    group.item.authorizedRowRefs = refs;
  }
}
function sanitized(error: unknown): never {
  if (error instanceof TRPCError && /^PROFIT_BOARD_READ_[A-Z_]+$/u.test(error.message)) throw error;
  if (error instanceof TRPCError && ["FORBIDDEN", "UNAUTHORIZED"].includes(error.code)) fail("PROFIT_BOARD_READ_ACCESS_DENIED", "FORBIDDEN");
  return fail("PROFIT_BOARD_READ_FAILED", "INTERNAL_SERVER_ERROR");
}
/** A fresh, bounded, source-only projection. No edition refresh/initialization,
 * notes, schedules, uploader shortcut, name-based member list or model call. */
export function createProfitBoardReadRepository(dependencies: { database?: () => Promise<ProfitBoardReadDatabase | null>; permission?: typeof assertResourceAction } = {}) {
  const database = dependencies.database ?? getDb, permission = dependencies.permission ?? assertResourceAction;
  async function get(ctx: TrpcContext, raw: ProfitBoardReadInput) {
    try {
      if (!ctx.user) fail("PROFIT_BOARD_READ_LOGIN_REQUIRED", "UNAUTHORIZED");
      const parsed = ProfitBoardReadInputSchema.safeParse(raw);
      if (!parsed.success) fail("PROFIT_BOARD_READ_INPUT_INVALID", "BAD_REQUEST");
      const input = parsed.data, workspaceId = ctx.workspaceId !== undefined ? ctx.workspaceId : ctx.user.defaultWorkspaceId;
      if (!positiveId(ctx.user.id) || !positiveId(workspaceId) || typeof ctx.user.role !== "string" || !ctx.user.role.trim()) fail("PROFIT_BOARD_READ_ACTOR_INVALID", "FORBIDDEN");
      if (input.expectedWorkspaceId !== workspaceId) fail("PROFIT_BOARD_READ_WORKSPACE_CHANGED", "FORBIDDEN");
      const db = await database(); if (!db || typeof db.transaction !== "function") fail("PROFIT_BOARD_READ_TRANSACTION_REQUIRED");
      return await db.transaction(async tx => {
        const actors = await query(tx, "SELECT id,role,status,defaultWorkspaceId FROM users WHERE id=? FOR SHARE", [ctx.user!.id]), actor = actors[0];
        if (actors.length !== 1 || actor.id !== ctx.user!.id || actor.role !== ctx.user!.role || actor.status !== "active" || actor.defaultWorkspaceId !== workspaceId) fail("PROFIT_BOARD_READ_ACTOR_CHANGED", "FORBIDDEN");
        await permission({ actor: { id: actor.id as number, role: actor.role as string, defaultWorkspaceId: workspaceId }, resource: "ops_data", action: "read", workspaceId, authorizationRead: { executor: tx, strict: true, lock: true } });
        const session: Session = { tx, identity: { userId: actor.id as number, workspaceId }, manager: ["super_admin", "admin", "ops_manager"].includes(actor.role as string) };
        try {
          const selections = await selectMonths(session, input);
          await authorizeMonths(session, input, selections);
          return buildProfitBoardReadResult({ identity: session.identity, input, selections });
        } catch (error) {
          if (error instanceof SourceTableMissing) return buildProfitBoardReadFailure({ identity: session.identity, input, status: "missing", reasonCode: "table_missing", missingReason: "月度财务来源表尚未接通，不代表利润为零" });
          if (error instanceof IncompleteScan) return buildProfitBoardReadFailure({ identity: session.identity, input, status: "invalid", reasonCode: "scan_incomplete", missingReason: "有界扫描未能完整确定六个月来源；不返回部分看板或回退旧批次" });
          if (error instanceof InvalidSource || error instanceof MonthlyFinancialReadError || error instanceof ProfitBoardReadError) return buildProfitBoardReadFailure({ identity: session.identity, input, status: "invalid", reasonCode: "invalid_source", missingReason: "候选财务批次或看板完整性无法核验；不截断、补零或回退旧来源" });
          throw error;
        }
      });
    } catch (error) { return sanitized(error); }
  }
  return { get };
}
export const profitBoardReadRepository = createProfitBoardReadRepository();
