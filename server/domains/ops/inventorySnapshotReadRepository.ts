import { TRPCError } from "@trpc/server";
import { sql, type SQL } from "drizzle-orm";
import type { TrpcContext } from "../../_core/context";
import { getDb, type DbExecutor } from "../../repositories/dbClient";
import { assertResourceAction } from "../../services/securityGovernance";
import { normalizeMarketplaceCode } from "../../../shared/marketplaceIdentity";
import { splitExternalOperatorNames } from "./operatorNameResolution";
import { INVENTORY_READ_LIMITS, InventorySnapshotReadInputSchema, InventorySnapshotReadError,
  parseInventorySnapshot, planInventoryScopeAccess, buildInventorySnapshotReadResult, buildInventorySnapshotReadFailure,
  type InventorySnapshotReadInput, type InventoryReadRow, type ParsedInventorySnapshot } from "../../../shared/inventorySnapshotRead";

type Row = Record<string, unknown>;
type Code = "UNAUTHORIZED" | "FORBIDDEN" | "BAD_REQUEST" | "PRECONDITION_FAILED" | "INTERNAL_SERVER_ERROR";
export interface InventorySnapshotReadDatabase { transaction?<T>(body: (tx: DbExecutor) => Promise<T>): Promise<T> }
const positiveId = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= 2_147_483_647;
function fail(message: string, code: Code = "PRECONDITION_FAILED"): never { throw new TRPCError({ code, message }); }
class SnapshotTableMissing extends Error {}
class SnapshotRecordInvalid extends Error {}
class ScopeUnverifiable extends Error {}
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
  if (parts.length !== values.length + 1) fail("INVENTORY_SNAPSHOT_READ_SQL_INVALID", "INTERNAL_SERVER_ERROR");
  return sql.join(parts.flatMap((part, index) => index < values.length ? [sql.raw(part), sql`${values[index]}`] : [sql.raw(part)]), sql.raw(""));
}
async function rows(tx: DbExecutor, text: string, values: unknown[] = []): Promise<Row[]> {
  const result = await tx.execute(statement(text, values));
  if (!Array.isArray(result) || !Array.isArray(result[0]) || result[0].some(row => !row || typeof row !== "object" || Array.isArray(row))) fail("INVENTORY_SNAPSHOT_READ_RESPONSE_INVALID");
  return result[0] as Row[];
}
function timestamp(value: unknown): number {
  // captured_at is BIGINT, not DATETIME. mysql2 can return a number or exact
  // decimal string. Never use parseInt, local-time parsing, or unsafe Number.
  const number = typeof value === "string" && /^(?:0|[1-9][0-9]{0,15})$/u.test(value) ? Number(value) : value;
  if (typeof number !== "number" || !Number.isSafeInteger(number) || number < 0 || number > 253_402_300_799_999) throw new SnapshotRecordInvalid();
  return number;
}
const countryAliases: Record<string, string> = {
  "美国": "US", "美国站": "US", "亚马逊美国站": "US", "AMAZON.COM": "US", "加拿大": "CA", "加拿大站": "CA",
  GB: "UK", "英国": "UK", "英国站": "UK", "德国": "DE", "德国站": "DE", "法国": "FR", "法国站": "FR",
  "意大利": "IT", "意大利站": "IT", "西班牙": "ES", "西班牙站": "ES", "日本": "JP", "日本站": "JP",
  "澳大利亚": "AU", "澳洲": "AU", "澳大利亚站": "AU", "墨西哥": "MX", "墨西哥站": "MX",
  "巴西": "BR", "巴西站": "BR", "阿联酋": "AE", "阿联酋站": "AE", "沙特": "SA", "沙特站": "SA", "新加坡": "SG", "新加坡站": "SG",
};
const countrySql = `CASE UPPER(TRIM(country)) ${Object.entries(countryAliases).map(([alias, code]) => `WHEN '${alias}' THEN '${code}'`).join(" ")} ELSE UPPER(TRIM(country)) END`;
type ExactScope = { parentAsin: string; storeName: string; country: string; accountId: string };
type Identity = { userId: number; workspaceId: number };
async function manualOwner(tx: DbExecutor, identity: Identity, scope: ExactScope, accountIsUnambiguous: boolean): Promise<boolean> {
  const selected = await rows(tx, `SELECT id,workspaceId,parent_asin AS parentAsin,store_name AS storeName,country,assignee_user_id AS assigneeUserId,is_active AS isActive
    FROM ops_inventory_owner_assignments WHERE workspaceId=? AND BINARY parent_asin=BINARY ? AND BINARY store_name=BINARY ? AND ${countrySql}=? AND is_active=1 LIMIT 2 FOR SHARE`,
  [identity.workspaceId, scope.parentAsin, scope.storeName, scope.country]);
  if (selected.length > 1 || selected.some(row => !positiveId(row.id) || row.workspaceId !== identity.workspaceId || row.parentAsin !== scope.parentAsin || row.storeName !== scope.storeName
    || typeof row.country !== "string" || normalizeMarketplaceCode(row.country) !== scope.country || !positiveId(row.assigneeUserId) || row.isActive !== 1)) throw new ScopeUnverifiable();
  if (!selected.length) return false;
  // This table has no account_id. An input account cannot make an ambiguous
  // live rule account-specific, even when its numeric assignee matches.
  if (!accountIsUnambiguous || selected[0].assigneeUserId !== identity.userId) throw new ScopeUnverifiable();
  return true;
}
async function confirmedOwners(tx: DbExecutor, identity: Identity, externalNames: string[], sourceType: "saihu" | "lingxing") {
  const names = [...new Set(externalNames.flatMap(splitExternalOperatorNames))];
  if (!names.length || names.length > 500 || externalNames.some(name => !splitExternalOperatorNames(name).length)) throw new ScopeUnverifiable();
  const found = await rows(tx, `SELECT id,workspaceId,external_name AS externalName,source_type AS sourceType,system_user_id AS systemUserId,is_confirmed AS isConfirmed
    FROM operator_name_mappings WHERE workspaceId=? AND is_confirmed=1 AND source_type IN (?,'all')
    AND BINARY external_name IN (${names.map(() => "?").join(",")}) LIMIT 1001 FOR SHARE`, [identity.workspaceId, sourceType, ...names]);
  if (found.length > 1000 || found.some(row => !positiveId(row.id) || row.workspaceId !== identity.workspaceId || row.isConfirmed !== 1 || !positiveId(row.systemUserId)
    || typeof row.externalName !== "string" || !names.includes(row.externalName) || ![sourceType, "all"].includes(String(row.sourceType)))) throw new ScopeUnverifiable();
  const ids = names.map(name => {
    const owners = [...new Set(found.filter(row => row.externalName === name).map(row => row.systemUserId as number))];
    if (owners.length !== 1) throw new ScopeUnverifiable();
    return owners[0];
  });
  // All source owner values must resolve to the requester. A partial match to
  // one member of a compound source-owner field does not cover shared stock.
  if (ids.some(id => id !== identity.userId)) throw new ScopeUnverifiable();
}
function sanitized(error: unknown): never {
  if (error instanceof TRPCError && /^INVENTORY_SNAPSHOT_READ_[A-Z_]+$/u.test(error.message)) throw error;
  if (error instanceof TRPCError && ["FORBIDDEN", "UNAUTHORIZED"].includes(error.code)) fail("INVENTORY_SNAPSHOT_READ_ACCESS_DENIED", "FORBIDDEN");
  return fail("INVENTORY_SNAPSHOT_READ_FAILED", "INTERNAL_SERVER_ERROR");
}

async function readLatest(tx: DbExecutor, workspaceId: number) {
  let selected: Row[];
  const columns = await rows(tx, "SELECT COLUMN_NAME AS columnName FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='ops_inventory_snapshots' AND COLUMN_NAME='run_source'", []);
  if (columns.length > 1 || columns.some(row => row.columnName !== "run_source")) throw new SnapshotRecordInvalid();
  const runSource = columns.length ? "run_source" : "'saihu_sync'";
  try {
    selected = await rows(tx, `SELECT id,workspace_id AS workspaceId,run_id AS runId,captured_at AS capturedAt,${runSource} AS runSource,
      IF(OCTET_LENGTH(CAST(payload AS CHAR CHARACTER SET utf8mb4))<=${INVENTORY_READ_LIMITS.wireBytes},CAST(payload AS CHAR CHARACTER SET utf8mb4),NULL) AS payload,
      OCTET_LENGTH(CAST(payload AS CHAR CHARACTER SET utf8mb4)) AS payloadBytes
      FROM ops_inventory_snapshots WHERE workspace_id=? ORDER BY id DESC LIMIT 1 FOR SHARE`, [workspaceId]);
  } catch (error) {
    // Do not apply this classification to policy, user, or ownership queries.
    if (noSuchTable(error)) throw new SnapshotTableMissing();
    throw error;
  }
  if (!selected.length) return null;
  const row = selected[0];
  if (selected.length !== 1 || !positiveId(row.id) || row.workspaceId !== workspaceId || !positiveId(row.runId) || !["saihu_sync", "manual_collection"].includes(String(row.runSource))
    || typeof row.payloadBytes !== "number" || !Number.isSafeInteger(row.payloadBytes) || row.payloadBytes < 0 || row.payloadBytes > INVENTORY_READ_LIMITS.wireBytes) throw new SnapshotRecordInvalid();
  const capturedAt = timestamp(row.capturedAt);
  if (typeof row.payload === "string" && Buffer.byteLength(row.payload, "utf8") !== row.payloadBytes) throw new SnapshotRecordInvalid();
  // The shared parser checks the entire bounded native/string JSON and replays
  // v2 raw sources. Never trust serialized derived rows or slice a bad body.
  const parsed = parseInventorySnapshot(row.payload);
  if (parsed.capturedAt !== capturedAt) throw new SnapshotRecordInvalid();
  return { record: { id: row.id, workspaceId, runId: row.runId, runSource: row.runSource as "saihu_sync" | "manual_collection", capturedAt, payload: row.payload }, parsed };
}
function accountIsUnambiguous(universe: ParsedInventorySnapshot["scopeUniverse"], scope: ExactScope) {
  // This is coverage of the complete saved source arrays, not a live account
  // catalog attestation. Zero-stock/filtered rows and all known source scope
  // bindings still participate; a display filter cannot create uniqueness.
  if (!universe.complete) return false;
  const accounts = new Set(universe.scopes.filter(candidate => candidate.storeName === scope.storeName && candidate.country === scope.country).map(candidate => candidate.accountId));
  return accounts.size === 1 && accounts.has(scope.accountId);
}
async function authorizeRows(tx: DbExecutor, identity: Identity, universe: ParsedInventorySnapshot["scopeUniverse"], requiredRows: InventoryReadRow[]) {
  const manualCache = new Map<string, boolean>();
  const mappingCache = new Set<string>();
  for (const row of requiredRows) {
    if (row.scopeStatus !== "verified" || !row.scopes.length) throw new ScopeUnverifiable();
    for (const scope of row.scopes) {
      const key = JSON.stringify(scope);
      if (!manualCache.has(key)) manualCache.set(key, await manualOwner(tx, identity, scope, accountIsUnambiguous(universe, scope)));
      if (manualCache.get(key)) continue;
      if (row.sourceSystem !== "saihu" || row.ownerEvidence.status !== "complete") throw new ScopeUnverifiable();
      const mappingKey = JSON.stringify([row.sourceSystem, row.ownerEvidence.names]);
      if (!mappingCache.has(mappingKey)) {
        await confirmedOwners(tx, identity, row.ownerEvidence.names, row.sourceSystem);
        mappingCache.add(mappingKey);
      }
    }
  }
}

/** Independent snapshot-only adapter. No synchronization, ownership enrichment,
 * schema initialization, schedule inspection, source downloads, or mutations. */
export function createInventorySnapshotReadRepository(dependencies: { database?: () => Promise<InventorySnapshotReadDatabase | null>; permission?: typeof assertResourceAction } = {}) {
  const database = dependencies.database ?? getDb, permission = dependencies.permission ?? assertResourceAction;
  async function get(ctx: TrpcContext, raw: InventorySnapshotReadInput) {
    try {
      if (!ctx.user) fail("INVENTORY_SNAPSHOT_READ_LOGIN_REQUIRED", "UNAUTHORIZED");
      const parsedInput = InventorySnapshotReadInputSchema.safeParse(raw);
      if (!parsedInput.success) fail("INVENTORY_SNAPSHOT_READ_INPUT_INVALID", "BAD_REQUEST");
      const input = parsedInput.data, workspaceId = ctx.workspaceId !== undefined ? ctx.workspaceId : ctx.user.defaultWorkspaceId;
      if (!positiveId(ctx.user.id) || !positiveId(workspaceId) || typeof ctx.user.role !== "string" || !ctx.user.role.trim()) fail("INVENTORY_SNAPSHOT_READ_ACTOR_INVALID", "FORBIDDEN");
      if (input.expectedWorkspaceId !== workspaceId) fail("INVENTORY_SNAPSHOT_READ_WORKSPACE_CHANGED", "FORBIDDEN");
      const db = await database();
      if (!db || typeof db.transaction !== "function") fail("INVENTORY_SNAPSHOT_READ_TRANSACTION_REQUIRED");
      return await db.transaction(async tx => {
        const actors = await rows(tx, "SELECT id,role,status,defaultWorkspaceId FROM users WHERE id=? FOR SHARE", [ctx.user!.id]), actor = actors[0];
        if (actors.length !== 1 || actor.id !== ctx.user!.id || actor.role !== ctx.user!.role || actor.status !== "active" || actor.defaultWorkspaceId !== workspaceId) fail("INVENTORY_SNAPSHOT_READ_ACTOR_CHANGED", "FORBIDDEN");
        await permission({ actor: { id: actor.id as number, role: actor.role as string, defaultWorkspaceId: workspaceId }, resource: "ops_data", action: "read", workspaceId,
          authorizationRead: { executor: tx, strict: true, lock: true } });
        const identity = { userId: actor.id as number, workspaceId }, manager = ["super_admin", "admin", "ops_manager"].includes(actor.role as string);
        const unavailableScope = () => buildInventorySnapshotReadFailure({ identity, input, status: "scope_unverifiable", reasonCode: "scope_unverifiable", missingReason: "缺少可核验的店铺、站点、账号、父体或完整当前负责人依据；不能按历史姓名或 ASIN 推断权限" });
        if (!manager && !input.exactScope) return unavailableScope();
        try {
          const saved = await readLatest(tx, workspaceId);
          if (!saved) return buildInventorySnapshotReadFailure({ identity, input, status: "not_found", reasonCode: "snapshot_not_found", missingReason: "没有已保存的库存快照；未触发同步，也不代表库存为零" });
          if (!manager && saved.parsed.version === 1) return unavailableScope();
          let rowIds: string[] | undefined;
          if (input.exactScope) {
            const plan = planInventoryScopeAccess(saved.parsed, input.exactScope);
            if (!plan.scopeVerifiable) return unavailableScope();
            if (!manager) {
              if (!plan.rowIds.length || !plan.requiredRows.length) return unavailableScope();
              await authorizeRows(tx, identity, saved.parsed.scopeUniverse, plan.requiredRows);
            }
            rowIds = plan.rowIds;
          }
          return buildInventorySnapshotReadResult({ identity, input, record: saved.record, visibility: manager ? "full" : "scoped", ...(rowIds ? { scopedRows: rowIds } : {}) });
        } catch (error) {
          if (error instanceof SnapshotTableMissing) return buildInventorySnapshotReadFailure({ identity, input, status: "missing", reasonCode: "table_missing", missingReason: "完整库存快照表尚未接通，不表示库存为空" });
          if (error instanceof ScopeUnverifiable) return unavailableScope();
          if (error instanceof SnapshotRecordInvalid || error instanceof InventorySnapshotReadError) return buildInventorySnapshotReadFailure({ identity, input, status: "invalid", reasonCode: "invalid_snapshot", missingReason: "最新保存快照损坏、超限或来源无法核验；不会退回较旧结果" });
          throw error;
        }
      });
    } catch (error) { return sanitized(error); }
  }
  return { get };
}
export const inventorySnapshotReadRepository = createInventorySnapshotReadRepository();
