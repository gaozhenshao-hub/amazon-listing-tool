import { TRPCError } from "@trpc/server";
import { sql, type SQL } from "drizzle-orm";
import {
  MonthlyFinancialHistoryInputSchema, MonthlyFinancialBatchInputSchema, MonthlyFinancialSnapshotInputSchema,
  MonthlyFinancialReadError, parseMonthlyFinancialBatch,
  buildMonthlyFinancialHistoryResult, buildMonthlyFinancialBatchResult, buildMonthlyFinancialSnapshotResult,
  buildMonthlyFinancialHistoryFailure, buildMonthlyFinancialBatchFailure, buildMonthlyFinancialSnapshotFailure, monthlyFinancialRowMatchesScope,
  type MonthlyFinancialHistoryInput, type MonthlyFinancialBatchInput, type MonthlyFinancialSnapshotInput,
  type MonthlyFinancialBatchRecord, type MonthlyFinancialReadRow, type MonthlyFinancialSnapshotSelection,
} from "../../../shared/monthlyFinancialRead";
import { normalizeMarketplaceCode } from "../../../shared/marketplaceIdentity";
import type { TrpcContext } from "../../_core/context";
import { getDb, type DbExecutor } from "../../repositories/dbClient";
import { assertResourceAction } from "../../services/securityGovernance";
import { splitExternalOperatorNames } from "./operatorNameResolution";

type Row = Record<string, unknown>;
type Code = "UNAUTHORIZED" | "FORBIDDEN" | "BAD_REQUEST" | "PRECONDITION_FAILED" | "INTERNAL_SERVER_ERROR";
type Scope = NonNullable<MonthlyFinancialBatchInput["scope"]>;
type Identity = { userId: number; workspaceId: number };
type Session = { tx: DbExecutor; identity: Identity; manager: boolean };
export interface MonthlyFinancialReadDatabase { transaction?<T>(body: (tx: DbExecutor) => Promise<T>): Promise<T> }
const positiveId = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= 2_147_483_647;
function fail(message: string, code: Code = "PRECONDITION_FAILED"): never { throw new TRPCError({ code, message }); }
class MonthlyTableMissing extends Error {}
class InvalidMonthlyRecord extends Error {}
// Native MySQL JSON serialization can include whitespace. This is a transport
// bound, separate from the shared canonical 8 MiB document/10,000-row bound.
const PAYLOAD_WIRE_MAX = 64 * 1024 * 1024;
const MONTHS_WIRE_MAX = 64 * 1024;
const SNAPSHOT_SCAN_BYTES_MAX = 32 * 1024 * 1024;
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
  if (parts.length !== values.length + 1) fail("MONTHLY_FINANCIAL_READ_SQL_INVALID", "INTERNAL_SERVER_ERROR");
  return sql.join(parts.flatMap((part, index) => index < values.length ? [sql.raw(part), sql`${values[index]}`] : [sql.raw(part)]), sql.raw(""));
}
async function rows(tx: DbExecutor, text: string, values: unknown[] = []): Promise<Row[]> {
  const result = await tx.execute(statement(text, values));
  if (!Array.isArray(result) || !Array.isArray(result[0]) || result[0].some(row => !row || typeof row !== "object" || Array.isArray(row))) fail("MONTHLY_FINANCIAL_READ_RESPONSE_INVALID");
  return result[0] as Row[];
}
async function monthlyRows(tx: DbExecutor, text: string, values: unknown[]): Promise<Row[]> {
  try { return await rows(tx, text, values); }
  catch (error) {
    // Only the actual monthly source query may report its table missing. A
    // permission/owner-table failure must never be relabeled as empty history.
    if (noSuchTable(error)) throw new MonthlyTableMissing();
    throw error;
  }
}
const safeRunReference = "fileUrl REGEXP '^saihu-sync-run:[1-9][0-9]{0,9}$' AND CAST(SUBSTRING(fileUrl,16) AS UNSIGNED)<=2147483647 AND BINARY fileUrl=BINARY CONCAT('saihu-sync-run:',CAST(CAST(SUBSTRING(fileUrl,16) AS UNSIGNED) AS CHAR))";
// Recognize only our exact, workspace-bound private monthly object namespace.
// This is an origin label, never permission to download an arbitrary URL.
const safePrivateMonthlyReference = "fileUrl REGEXP CONCAT('^storage://(s3|oss)/monthly-financial/',workspaceId,'/[a-f0-9]{64}[.](xlsx|csv)$') AND BINARY fileUrl=BINARY LOWER(fileUrl)";
function projection(withPayload: boolean, payloadWireMax = PAYLOAD_WIRE_MAX) {
  return `id,workspaceId,userId,fileName,fileHash,status,totalRows,skippedRows,unallocatedRows,
    IF(OCTET_LENGTH(CAST(months AS CHAR CHARACTER SET utf8mb4))<=${MONTHS_WIRE_MAX},CAST(months AS CHAR CHARACTER SET utf8mb4),NULL) AS months,
    OCTET_LENGTH(CAST(months AS CHAR CHARACTER SET utf8mb4)) AS monthsBytes,
    DATE_FORMAT(createdAt,'%Y-%m-%d %H:%i:%s.%f') AS createdAt,
    DATE_FORMAT(confirmedAt,'%Y-%m-%d %H:%i:%s.%f') AS confirmedAt,
    CASE WHEN ${safeRunReference} THEN 'saihu_sync_run' WHEN (${safePrivateMonthlyReference}) OR fileUrl REGEXP '^(https://|s3://|oss://)' THEN 'storage' ELSE 'unknown' END AS fileReferenceKind,
    CASE WHEN ${safeRunReference} THEN CAST(SUBSTRING(fileUrl,16) AS UNSIGNED) ELSE NULL END AS sourceRunId${withPayload ? `,
    IF(OCTET_LENGTH(CAST(payload AS CHAR CHARACTER SET utf8mb4))<=${payloadWireMax},CAST(payload AS CHAR CHARACTER SET utf8mb4),NULL) AS payload,
    OCTET_LENGTH(CAST(payload AS CHAR CHARACTER SET utf8mb4)) AS payloadBytes` : ""}`;
}
function wire(value: unknown, bytes: unknown, limit: number): string {
  if (typeof value !== "string" || typeof bytes !== "number" || !Number.isSafeInteger(bytes) || bytes < 0 || bytes > limit || Buffer.byteLength(value, "utf8") !== bytes) throw new InvalidMonthlyRecord();
  return value;
}
function record(row: Row, workspaceId: number, withPayload: boolean): MonthlyFinancialBatchRecord {
  // CAST AS UNSIGNED may be returned as a decimal string when mysql2's
  // big-number string option is enabled. Do not coerce arbitrary numeric text.
  const sourceRunId = typeof row.sourceRunId === "string" && /^[1-9][0-9]{0,9}$/u.test(row.sourceRunId) ? Number(row.sourceRunId) : row.sourceRunId;
  if (row.workspaceId !== workspaceId || !positiveId(row.id) || !positiveId(row.userId)
    || !["saihu_sync_run", "storage", "unknown"].includes(String(row.fileReferenceKind)) || sourceRunId !== null && !positiveId(sourceRunId)) throw new InvalidMonthlyRecord();
  const months = wire(row.months, row.monthsBytes, MONTHS_WIRE_MAX);
  const payload = withPayload ? wire(row.payload, row.payloadBytes, PAYLOAD_WIRE_MAX) : undefined;
  // Whitelist transport fields. In particular, never fetch/return fileUrl or
  // assume raw DATETIME values are Date instances or UTC instants.
  return {
    id: row.id, workspaceId, userId: row.userId, fileName: row.fileName as string, fileHash: row.fileHash as string,
    status: row.status as MonthlyFinancialBatchRecord["status"], totalRows: row.totalRows as number,
    skippedRows: row.skippedRows as number, unallocatedRows: row.unallocatedRows as number, months,
    createdAt: row.createdAt as string, confirmedAt: row.confirmedAt as string | null,
    fileReferenceKind: row.fileReferenceKind as MonthlyFinancialBatchRecord["fileReferenceKind"], sourceRunId,
    ...(withPayload ? { payload } : {}),
  };
}
const countryAliases: Record<string, string> = {
  "美国": "US", "美国站": "US", "亚马逊美国站": "US", "AMAZON.COM": "US", "加拿大": "CA", "加拿大站": "CA",
  GB: "UK", "英国": "UK", "英国站": "UK", "德国": "DE", "德国站": "DE", "法国": "FR", "法国站": "FR",
  "意大利": "IT", "意大利站": "IT", "西班牙": "ES", "西班牙站": "ES", "日本": "JP", "日本站": "JP",
  "澳大利亚": "AU", "澳洲": "AU", "澳大利亚站": "AU", "墨西哥": "MX", "墨西哥站": "MX",
  "巴西": "BR", "巴西站": "BR", "阿联酋": "AE", "阿联酋站": "AE", "沙特": "SA", "沙特站": "SA", "新加坡": "SG", "新加坡站": "SG",
};
const countrySql = `CASE UPPER(TRIM(country)) ${Object.entries(countryAliases).map(([alias, code]) => `WHEN '${alias}' THEN '${code}'`).join(" ")} ELSE UPPER(TRIM(country)) END`;
async function manualOwner(session: Session, scope: Scope) {
  const { tx, identity } = session;
  const selected = await rows(tx, `SELECT id,workspaceId,parent_asin AS parentAsin,store_name AS storeName,country,assignee_user_id AS assigneeUserId,is_active AS isActive
    FROM ops_inventory_owner_assignments WHERE workspaceId=? AND BINARY parent_asin=BINARY ? AND BINARY store_name=BINARY ? AND ${countrySql}=? AND is_active=1 LIMIT 2 FOR SHARE`,
  [identity.workspaceId, scope.parentAsin, scope.storeName, scope.country]);
  if (selected.length > 1 || selected.some(row => !positiveId(row.id) || row.workspaceId !== identity.workspaceId || row.parentAsin !== scope.parentAsin || row.storeName !== scope.storeName
    || typeof row.country !== "string" || normalizeMarketplaceCode(row.country) !== scope.country || !positiveId(row.assigneeUserId) || row.isActive !== 1)) fail("MONTHLY_FINANCIAL_READ_OWNER_INVALID", "FORBIDDEN");
  if (!selected.length) return false;
  if (selected[0].assigneeUserId !== identity.userId) fail("MONTHLY_FINANCIAL_READ_OWNER_DENIED", "FORBIDDEN");
  return true;
}
function matchesScope(row: MonthlyFinancialReadRow, scope: Scope) {
  return monthlyFinancialRowMatchesScope(row, scope);
}
async function authorizeScope(session: Session, scope: Scope, allRows: MonthlyFinancialReadRow[]) {
  if (session.manager || await manualOwner(session, scope)) return;
  const selected = allRows.filter(row => matchesScope(row, scope));
  if (!selected.length) fail("MONTHLY_FINANCIAL_READ_OWNER_UNVERIFIED", "FORBIDDEN");
  const memberships: string[] = [];
  // No implicit Lingxing/Saihu attribution for spreadsheets lacking a source
  // marker. Such names require an explicitly confirmed all-source mapping.
  for (const kind of ["saihu", "unknown"] as const) {
    const matching = selected.filter(row => (row.raw.source === "sellfox_monthly_api" ? "saihu" : "unknown") === kind);
    if (!matching.length) continue;
    const names = [...new Set(matching.flatMap(row => splitExternalOperatorNames(row.operator)))];
    if (!names.length || names.length > 500 || matching.some(row => !splitExternalOperatorNames(row.operator).length)) fail("MONTHLY_FINANCIAL_READ_OWNER_UNVERIFIED", "FORBIDDEN");
    const found = await rows(session.tx, `SELECT id,workspaceId,external_name AS externalName,source_type AS sourceType,system_user_id AS systemUserId,is_confirmed AS isConfirmed
      FROM operator_name_mappings WHERE workspaceId=? AND is_confirmed=1 AND ${kind === "saihu" ? "source_type IN ('saihu','all')" : "source_type='all'"}
      AND BINARY external_name IN (${names.map(() => "?").join(",")}) LIMIT 1001 FOR SHARE`, [session.identity.workspaceId, ...names]);
    if (found.length > 1000 || found.some(row => !positiveId(row.id) || row.workspaceId !== session.identity.workspaceId || row.isConfirmed !== 1 || !positiveId(row.systemUserId)
      || typeof row.externalName !== "string" || !names.includes(row.externalName) || !(kind === "saihu" ? ["saihu", "all"] : ["all"]).includes(String(row.sourceType)))) fail("MONTHLY_FINANCIAL_READ_OWNER_UNVERIFIED", "FORBIDDEN");
    const owners = new Map<string, number>();
    for (const name of names) {
      const ids = new Set(found.filter(row => row.externalName === name).map(row => row.systemUserId as number));
      if (ids.size !== 1) fail("MONTHLY_FINANCIAL_READ_OWNER_UNVERIFIED", "FORBIDDEN");
      owners.set(name, [...ids][0]);
    }
    for (const source of matching) {
      const ids = [...new Set(splitExternalOperatorNames(source.operator).map(name => owners.get(name)!))].sort((a, b) => a - b);
      if (!ids.includes(session.identity.userId)) fail("MONTHLY_FINANCIAL_READ_OWNER_DENIED", "FORBIDDEN");
      memberships.push(ids.join(","));
    }
  }
  if (!memberships.length || new Set(memberships).size !== 1) fail("MONTHLY_FINANCIAL_READ_OWNER_CONFLICT", "FORBIDDEN");
}
function sanitized(error: unknown): never {
  if (error instanceof TRPCError && /^MONTHLY_FINANCIAL_READ_[A-Z_]+$/u.test(error.message)) throw error;
  if (error instanceof TRPCError && ["FORBIDDEN", "UNAUTHORIZED"].includes(error.code)) fail("MONTHLY_FINANCIAL_READ_ACCESS_DENIED", "FORBIDDEN");
  return fail("MONTHLY_FINANCIAL_READ_FAILED", "INTERNAL_SERVER_ERROR");
}

/** Read-only source adapter. There is no schema initialization, file access,
 * mutation, sync refresh, or upload-owner shortcut for business rows. */
export function createMonthlyFinancialReadRepository(dependencies: { database?: () => Promise<MonthlyFinancialReadDatabase | null>; permission?: typeof assertResourceAction } = {}) {
  const database = dependencies.database ?? getDb, permission = dependencies.permission ?? assertResourceAction;
  async function authorized<T>(ctx: TrpcContext, expectedWorkspaceId: number, body: (session: Session) => Promise<T>): Promise<T> {
    try {
      if (!ctx.user) fail("MONTHLY_FINANCIAL_READ_LOGIN_REQUIRED", "UNAUTHORIZED");
      const workspaceId = ctx.workspaceId !== undefined ? ctx.workspaceId : ctx.user.defaultWorkspaceId;
      if (!positiveId(ctx.user.id) || !positiveId(workspaceId) || typeof ctx.user.role !== "string" || !ctx.user.role.trim()) fail("MONTHLY_FINANCIAL_READ_ACTOR_INVALID", "FORBIDDEN");
      if (expectedWorkspaceId !== workspaceId) fail("MONTHLY_FINANCIAL_READ_WORKSPACE_CHANGED", "FORBIDDEN");
      const db = await database();
      if (!db || typeof db.transaction !== "function") fail("MONTHLY_FINANCIAL_READ_TRANSACTION_REQUIRED");
      return await db.transaction(async tx => {
        const actors = await rows(tx, "SELECT id,role,status,defaultWorkspaceId FROM users WHERE id=? FOR SHARE", [ctx.user!.id]), actor = actors[0];
        if (actors.length !== 1 || actor.id !== ctx.user!.id || actor.role !== ctx.user!.role || actor.status !== "active" || actor.defaultWorkspaceId !== workspaceId) fail("MONTHLY_FINANCIAL_READ_ACTOR_CHANGED", "FORBIDDEN");
        await permission({ actor: { id: actor.id as number, role: actor.role as string, defaultWorkspaceId: workspaceId }, resource: "ops_data", action: "read", workspaceId,
          authorizationRead: { executor: tx, strict: true, lock: true } });
        return body({ tx, identity: { userId: actor.id as number, workspaceId }, manager: ["super_admin", "admin", "ops_manager"].includes(actor.role as string) });
      });
    } catch (error) { return sanitized(error); }
  }
  async function listBatches(ctx: TrpcContext, raw: MonthlyFinancialHistoryInput) {
    if (!ctx.user) fail("MONTHLY_FINANCIAL_READ_LOGIN_REQUIRED", "UNAUTHORIZED");
    const parsed = MonthlyFinancialHistoryInputSchema.safeParse(raw);
    if (!parsed.success) fail("MONTHLY_FINANCIAL_READ_INPUT_INVALID", "BAD_REQUEST");
    const input = parsed.data;
    return authorized(ctx, input.expectedWorkspaceId, async session => {
      const { tx, identity, manager } = session;
      try {
        const selected = await monthlyRows(tx, `SELECT ${projection(false)} FROM ops_monthly_profit_imports WHERE workspaceId=?${manager ? "" : " AND userId=?"}${input.cursor === null ? "" : " AND id<?"} ORDER BY id DESC LIMIT ? FOR SHARE`,
          [identity.workspaceId, ...(manager ? [] : [identity.userId]), ...(input.cursor === null ? [] : [input.cursor]), input.limit + 1]);
        if (!manager && selected.some(row => row.userId !== identity.userId)) fail("MONTHLY_FINANCIAL_READ_HISTORY_OWNER_DENIED", "FORBIDDEN");
        return buildMonthlyFinancialHistoryResult({ identity, input, records: selected.map(row => record(row, identity.workspaceId, false)) });
      } catch (error) {
        if (error instanceof MonthlyTableMissing) return buildMonthlyFinancialHistoryResult({ identity, input, records: [], tableMissing: true });
        if (error instanceof InvalidMonthlyRecord || error instanceof MonthlyFinancialReadError) return buildMonthlyFinancialHistoryFailure({ identity, input, status: "invalid", reasonCode: "invalid_metadata", missingReason: "历史来源元数据无法完整核验；不隐藏坏记录或伪造空历史" });
        throw error;
      }
    });
  }
  async function getBatch(ctx: TrpcContext, raw: MonthlyFinancialBatchInput) {
    if (!ctx.user) fail("MONTHLY_FINANCIAL_READ_LOGIN_REQUIRED", "UNAUTHORIZED");
    const parsed = MonthlyFinancialBatchInputSchema.safeParse(raw);
    if (!parsed.success) fail("MONTHLY_FINANCIAL_READ_INPUT_INVALID", "BAD_REQUEST");
    const input = parsed.data;
    return authorized(ctx, input.expectedWorkspaceId, async session => {
      const { tx, identity, manager } = session;
      if (!manager && !input.scope) fail("MONTHLY_FINANCIAL_READ_EXACT_SCOPE_REQUIRED", "FORBIDDEN");
      try {
        const selected = await monthlyRows(tx, `SELECT ${projection(true)} FROM ops_monthly_profit_imports WHERE workspaceId=? AND id=? LIMIT 2 FOR SHARE`, [identity.workspaceId, input.batchId]);
        if (selected.length > 1 || selected.some(row => row.id !== input.batchId)) throw new InvalidMonthlyRecord();
        const saved = selected.length ? record(selected[0], identity.workspaceId, true) : null;
        const batch = saved ? parseMonthlyFinancialBatch(saved) : null;
        if (!manager) await authorizeScope(session, input.scope!, batch?.rows ?? []);
        return buildMonthlyFinancialBatchResult({ identity, input, record: saved, metadataVisibility: manager || saved?.userId === identity.userId ? "full" : "scoped" });
      } catch (error) {
        if (error instanceof MonthlyTableMissing) return buildMonthlyFinancialBatchResult({ identity, input, record: null, tableMissing: true });
        if (error instanceof InvalidMonthlyRecord || error instanceof MonthlyFinancialReadError) return buildMonthlyFinancialBatchFailure({ identity, input, status: "invalid", reasonCode: "invalid_batch", missingReason: "指定月报批次无法完整核验；不返回部分明细或不可信汇总" });
        throw error;
      }
    });
  }
  async function getEffectiveSnapshot(
    ctx: TrpcContext,
    raw: MonthlyFinancialSnapshotInput
  ) {
    if (!ctx.user)
      fail("MONTHLY_FINANCIAL_READ_LOGIN_REQUIRED", "UNAUTHORIZED");
    const parsed = MonthlyFinancialSnapshotInputSchema.safeParse(raw);
    if (!parsed.success)
      fail("MONTHLY_FINANCIAL_READ_INPUT_INVALID", "BAD_REQUEST");
    const input = parsed.data;
    return authorized(ctx, input.expectedWorkspaceId, async session => {
      const { tx, identity, manager } = session;
      if (!manager && !input.parentAsin)
        fail("MONTHLY_FINANCIAL_READ_EXACT_SCOPE_REQUIRED", "FORBIDDEN");
      const selection: MonthlyFinancialSnapshotSelection = {
        selected: null,
        scannedBatchIds: [],
        complete: false,
      };
      try {
        // Native whole month/store/site selection, never parent/uploader/name.
        // The SQL engine considers the complete range before LIMIT; unrelated
        // historical versions cannot permanently consume a 200-body budget.
        const scopeCountrySql = countrySql.replace(
          /\bcountry\b/gu,
          "scope_rows.site"
        );
        const selected = await monthlyRows(
          tx,
          `SELECT ${projection(true, SNAPSHOT_SCAN_BYTES_MAX)} FROM ops_monthly_profit_imports WHERE workspaceId=? AND status='completed' AND (JSON_TYPE(payload)<>'ARRAY' OR JSON_TYPE(months)<>'ARRAY' OR JSON_LENGTH(payload)<>totalRows OR EXISTS (SELECT 1 FROM JSON_TABLE(IF(JSON_TYPE(payload)='ARRAY',payload,JSON_ARRAY()), '$[*]' COLUMNS (yearMonth VARCHAR(64) PATH '$.yearMonth',storeName VARCHAR(1024) PATH '$.storeName',site VARCHAR(1024) PATH '$.site')) AS scope_rows WHERE scope_rows.yearMonth=? AND BINARY scope_rows.storeName=BINARY ? AND ${scopeCountrySql}=?)) ORDER BY id DESC LIMIT 1 FOR SHARE`,
          [
            identity.workspaceId,
            input.yearMonth,
            input.storeName,
            input.country,
          ]
        );
        if (!selected.length) selection.complete = true;
        else {
          if (
            selected.length !== 1 ||
            selected[0].status !== "completed" ||
            !positiveId(selected[0].id)
          )
            throw new InvalidMonthlyRecord();
          const byteCount = selected[0].payloadBytes;
          if (
            typeof byteCount !== "number" ||
            !Number.isSafeInteger(byteCount) ||
            byteCount < 0
          )
            throw new InvalidMonthlyRecord();
          if (
            byteCount + Number(selected[0].monthsBytes) >
            SNAPSHOT_SCAN_BYTES_MAX
          )
            return buildMonthlyFinancialSnapshotResult({
              identity,
              input,
              selection,
            });
          const saved = record(selected[0], identity.workspaceId, true);
          const batch = parseMonthlyFinancialBatch(saved);
          if (
            !batch.rows.some(row =>
              monthlyFinancialRowMatchesScope(row, {
                yearMonth: input.yearMonth,
                storeName: input.storeName,
                country: input.country,
              })
            )
          )
            throw new InvalidMonthlyRecord();
          selection.scannedBatchIds.push(saved.id);
          selection.selected = batch;
          selection.complete = true;
        }
        if (!selection.complete)
          return buildMonthlyFinancialSnapshotResult({
            identity,
            input,
            selection,
          });
        if (!manager)
          await authorizeScope(
            session,
            {
              yearMonth: input.yearMonth,
              storeName: input.storeName,
              country: input.country,
              parentAsin: input.parentAsin!,
            },
            selection.selected?.rows ?? []
          );
        return buildMonthlyFinancialSnapshotResult({
          identity,
          input,
          selection,
          metadataVisibility:
            manager || selection.selected?.batch.userId === identity.userId
              ? "full"
              : "scoped",
        });
      } catch (error) {
        if (error instanceof MonthlyTableMissing)
          return buildMonthlyFinancialSnapshotResult({
            identity,
            input,
            selection,
            tableMissing: true,
          });
        if (
          error instanceof InvalidMonthlyRecord ||
          error instanceof MonthlyFinancialReadError
        )
          return buildMonthlyFinancialSnapshotFailure({
            identity,
            input,
            status: "invalid",
            reasonCode: "invalid_candidate",
            missingReason:
              "候选批次损坏或完整性无法核验；不回退到更旧的月报快照",
          });
        throw error;
      }
    });
  }
  return { listBatches, getBatch, getEffectiveSnapshot };
}
export const monthlyFinancialReadRepository = createMonthlyFinancialReadRepository();
