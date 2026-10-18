import { TRPCError } from "@trpc/server";
import { sql, type SQL } from "drizzle-orm";
import type { DbExecutor } from "../../repositories/dbClient";
import { normalizeMarketplaceCode } from "../../../shared/marketplaceIdentity";
import { splitExternalOperatorNames } from "./operatorNameResolution";
import { monthlyFinancialRowMatchesScope, type MonthlyFinancialBatchRecord, type MonthlyFinancialReadRow, type MonthlyFinancialSnapshotSelection } from "../../../shared/monthlyFinancialRead";

/** Shared source protocol and exact current-user authorization only.
 * No query routes, calendar/window selection, writes or model calls. */
export type MonthlyBoardScope = { storeName: string; country: string; parentAsin?: string };
export type MonthlyBoardMonthSelection = { month: string; selection: MonthlyFinancialSnapshotSelection; metadataVisibility: "full" | "scoped"; authorizedRowRefs?: { batchId: number; rowIndex: number }[] };
export class MonthlyBoardReadGuardError extends TRPCError {
  constructor(message: string, code: Code = "PRECONDITION_FAILED") { super({ message, code }); }
}

export type Row = Record<string, unknown>;
export type Code = "UNAUTHORIZED" | "FORBIDDEN" | "BAD_REQUEST" | "PRECONDITION_FAILED" | "INTERNAL_SERVER_ERROR";
export type Identity = { userId: number; workspaceId: number };
export type Session = { tx: DbExecutor; identity: Identity; manager: boolean };
export const positiveId = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= 2_147_483_647;
export const PAYLOAD_WIRE_MAX = 64 * 1024 * 1024, MONTHS_WIRE_MAX = 64 * 1024, SCAN_BYTES_MAX = 32 * 1024 * 1024, SCAN_BATCHES_MAX = 200, OWNER_CHUNK = 500;
function fail(message: string, code: Code = "PRECONDITION_FAILED"): never { throw new MonthlyBoardReadGuardError(message, code); }
export class SourceTableMissing extends Error {}
export class InvalidSource extends Error {}
export class IncompleteScan extends Error {}
export function noSuchTable(error: unknown) {
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
  if (parts.length !== values.length + 1) fail("SQL_INVALID", "INTERNAL_SERVER_ERROR");
  return sql.join(parts.flatMap((part, index) => index < values.length ? [sql.raw(part), sql`${values[index]}`] : [sql.raw(part)]), sql.raw(""));
}
export async function query(tx: DbExecutor, text: string, values: unknown[]): Promise<Row[]> {
  const result = await tx.execute(statement(text, values));
  if (!Array.isArray(result) || !Array.isArray(result[0]) || result[0].some(row => !row || typeof row !== "object" || Array.isArray(row))) fail("RESPONSE_INVALID");
  return result[0] as Row[];
}
const safeRunReference = "fileUrl REGEXP '^saihu-sync-run:[1-9][0-9]{0,9}$' AND CAST(SUBSTRING(fileUrl,16) AS UNSIGNED)<=2147483647 AND BINARY fileUrl=BINARY CONCAT('saihu-sync-run:',CAST(CAST(SUBSTRING(fileUrl,16) AS UNSIGNED) AS CHAR))";
export function projection(payloadLimit: number) {
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
export function sourceRecord(row: Row, workspaceId: number): MonthlyFinancialBatchRecord {
  const sourceRunId = typeof row.sourceRunId === "string" && /^[1-9][0-9]{0,9}$/u.test(row.sourceRunId) ? Number(row.sourceRunId) : row.sourceRunId;
  if (row.workspaceId !== workspaceId || !positiveId(row.id) || !positiveId(row.userId) || row.status !== "completed"
    || !["saihu_sync_run", "storage", "unknown"].includes(String(row.fileReferenceKind)) || sourceRunId !== null && !positiveId(sourceRunId)) throw new InvalidSource();
  return { id: row.id, workspaceId, userId: row.userId, fileName: row.fileName as string, fileHash: row.fileHash as string,
    status: "completed", totalRows: row.totalRows as number, skippedRows: row.skippedRows as number, unallocatedRows: row.unallocatedRows as number,
    months: wire(row.months, row.monthsBytes, MONTHS_WIRE_MAX), payload: wire(row.payload, row.payloadBytes, PAYLOAD_WIRE_MAX),
    createdAt: row.createdAt as string, confirmedAt: row.confirmedAt as string | null,
    fileReferenceKind: row.fileReferenceKind as MonthlyFinancialBatchRecord["fileReferenceKind"], sourceRunId };
}
const countryAliases: Record<string, string> = { "美国": "US", "美国站": "US", "亚马逊美国站": "US", "AMAZON.COM": "US", "加拿大": "CA", "加拿大站": "CA", GB: "UK", "英国": "UK", "英国站": "UK", "德国": "DE", "德国站": "DE", "法国": "FR", "法国站": "FR", "意大利": "IT", "意大利站": "IT", "西班牙": "ES", "西班牙站": "ES", "日本": "JP", "日本站": "JP", "澳大利亚": "AU", "澳洲": "AU", "澳大利亚站": "AU", "墨西哥": "MX", "墨西哥站": "MX", "巴西": "BR", "巴西站": "BR", "阿联酋": "AE", "阿联酋站": "AE", "沙特": "SA", "沙特站": "SA", "新加坡": "SG", "新加坡站": "SG" };
const countrySql = `CASE UPPER(TRIM(country)) ${Object.entries(countryAliases).map(([alias, code]) => `WHEN '${alias}' THEN '${code}'`).join(" ")} ELSE UPPER(TRIM(country)) END`;
function chunks<T>(items: T[]): T[][] { const result: T[][] = []; for (let i = 0; i < items.length; i += OWNER_CHUNK) result.push(items.slice(i, i + OWNER_CHUNK)); return result; }
async function manualOwners(session: Session, input: MonthlyBoardScope, parents: string[]) {
  const decisions = new Map<string, boolean>();
  for (const group of chunks(parents)) {
    const found = await query(session.tx, `SELECT id,workspaceId,parent_asin AS parentAsin,store_name AS storeName,country,assignee_user_id AS assigneeUserId,is_active AS isActive
      FROM ops_inventory_owner_assignments WHERE workspaceId=? AND BINARY store_name=BINARY ? AND ${countrySql}=? AND is_active=1
      AND BINARY parent_asin IN (${group.map(() => "?").join(",")}) LIMIT 1001 FOR SHARE`, [session.identity.workspaceId, input.storeName, input.country, ...group]);
    if (found.length > 1000 || found.some(row => !positiveId(row.id) || row.workspaceId !== session.identity.workspaceId || typeof row.parentAsin !== "string" || !group.includes(row.parentAsin)
      || row.storeName !== input.storeName || typeof row.country !== "string" || normalizeMarketplaceCode(row.country) !== input.country || !positiveId(row.assigneeUserId) || row.isActive !== 1)) fail("OWNER_STRUCTURE_INVALID");
    const byParent = new Map<string, Row>();
    for (const row of found) {
      if (byParent.has(row.parentAsin as string)) fail("OWNER_STRUCTURE_INVALID");
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
        || typeof row.externalName !== "string" || !group.includes(row.externalName) || !(kind === "saihu" ? ["saihu", "all"] : ["all"]).includes(String(row.sourceType)))) fail("OWNER_STRUCTURE_INVALID");
      for (const name of group) {
        const ids = [...new Set(found.filter(row => row.externalName === name).map(row => row.systemUserId as number))];
        owners.set(JSON.stringify([kind, name]), ids.length === 1 ? ids : null);
      }
    }
  }
  return owners;
}
export async function authorizeMonths(session: Session, input: MonthlyBoardScope, selections: MonthlyBoardMonthSelection[]) {
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
