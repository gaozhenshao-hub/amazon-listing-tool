import { beforeEach, describe, expect, it, vi } from "vitest";
import { TRPCError } from "@trpc/server";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import type { SQL } from "drizzle-orm";
import type { TrpcContext } from "../../_core/context";
import { createMonthlyFinancialWriteRepository } from "./monthlyFinancialWriteRepository";
import { MonthlyFinancialPreparedUploadSchema, monthlyFinancialOperationKey, type MonthlyFinancialPreparedUpload } from "./monthlyFinancialOperationJournal";
import { parseMonthlyFinancialImport, monthlyFinancialImportBytesHash, monthlyFinancialImportHash } from "../../../shared/monthlyFinancialImport";
import { findMonthlyFinancialSnapshot, type MonthlyFinancialBatchRecord } from "../../../shared/monthlyFinancialRead";
import { createMonthlyOperationsBoardSynchronization, type MonthlyOperationsBoardTransition } from "./monthlyOperationsBoardSynchronization";
import { prepareOperationsBoardHistoryCapture } from "./monthlyBoardHistoryCapture";
import { planOperationsBoardInitialization } from "./operationsBoardLifecycle";

type Row = Record<string, unknown>;
const operationId = "11111111-1111-4111-8111-111111111111", op2 = "22222222-2222-4222-8222-222222222222", op3 = "33333333-3333-4333-8333-333333333333";
const context = (role = "ops_manager", userId = 3) => ({ user: { id: userId, role, status: "active", defaultWorkspaceId: 7 }, workspaceId: 7 }) as TrpcContext;
const headers = ["时间", "ASIN", "父ASIN", "店铺", "站点", "币种", "SKU", "品名", "业务员", "毛利润", "销量", "销售额"];
const source = (patch: Record<string, string> = {}) => ({ 时间: "2026-09", ASIN: "B000000002", 父ASIN: "B000000001", 店铺: "Exact Store", 站点: "美国", 币种: "USD", SKU: "SKU-A", 品名: "原始商品", 业务员: "Alice", 毛利润: "10.25", 销量: "5", 销售额: "100", ...patch });
const csv = (items = [source()]) => Buffer.from([headers, ...items.map(row => headers.map(key => row[key as keyof typeof row]))].map(row => row.map(value => `"${String(value).replaceAll('"', '""')}"`).join(",")).join("\r\n"));
const command = (patch: Row = {}) => ({ expectedWorkspaceId: 7, operationId, fileName: "月报.csv", format: "csv" as const, base64: csv().toString("base64"), ...patch });
const inspectInput = (batchId: number, patch = {}) => ({ expectedWorkspaceId: 7, batchId, rowOffset: 0, cellOffset: 0, warningOffset: 0, pageSize: 50, ...patch });
const column = (columnName: string, dataType: string, patch: Row = {}) => ({ columnName, dataType, columnType: dataType, isNullable: "NO", extra: "", maxLength: null, defaultValue: null, collation: ["char", "varchar", "text"].includes(dataType) ? "utf8mb4_unicode_ci" : null, ...patch });
const date = (name: string, nullable = false) => column(name, "datetime", { columnType: "datetime(3)", isNullable: nullable ? "YES" : "NO", extra: nullable ? "" : "DEFAULT_GENERATED", defaultValue: nullable ? null : "CURRENT_TIMESTAMP(3)" });
const batchColumns = () => [column("id", "int", { extra: "auto_increment" }), ...["workspaceId", "userId", "totalRows", "skippedRows", "unallocatedRows"].map(name => column(name, "int")), column("fileName", "varchar", { maxLength: 512 }), column("fileHash", "char", { maxLength: 64 }), column("fileUrl", "text"), column("status", "varchar", { maxLength: 20 }), column("months", "json"), column("payload", "json"), date("createdAt"), date("confirmedAt", true)];
const artifactColumns = () => [column("batch_id", "int"), column("workspace_id", "int"), column("prepared", "json"), column("payload_hash", "char", { maxLength: 64 }), column("manifest", "json"), date("created_at")];
const auditColumns = () => [column("id", "int", { extra: "auto_increment" }), ...["workspaceId", "actorUserId"].map(name => column(name, "int", { isNullable: "YES" })), ...["auditId", "actorRole", "action", "resourceType", "resourceId", "status", "riskLevel"].map(name => column(name, "varchar", { maxLength: name === "auditId" ? 80 : 128 })), column("metadata", "json", { isNullable: "YES" })];
const index = (tableName: string, indexName: string, columns: string[], nonUnique = 0) => columns.map((columnName, i) => ({ tableName, indexName, columnName, sequence: i + 1, prefixLength: null, nonUnique }));
let batches: Row[], artifacts: Row[], audits: Row[], actors: Row[], memberships: Row[], workspaces: Row[], policies: Row[];
let cols: Record<string, Row[]>, indexes: Row[], engines: Row[], queries: { sql: string; params: unknown[] }[], objects: Map<string, Uint8Array>;
let enabled: boolean, commitLost: number, failAt: Record<string, unknown>, nextBatchId: number, tail: Promise<unknown>, candidateExtraBytes: number;
let boardWrites: { batchId: number; status: string }[];
const synchronizeBoards = vi.fn(async (_transition: MonthlyOperationsBoardTransition): Promise<void> => {});
const permission = vi.fn(async (_request: unknown) => {});
const execute = vi.fn(async (sql: SQL) => {
  const query = new MySqlDialect().sqlToQuery(sql), text = query.sql, values = query.params; queries.push(query);
  if (text.includes("information_schema.COLUMNS")) { if (failAt.catalog) throw failAt.catalog; return [cols[String(values[0])] ?? [], []]; }
  if (text.includes("information_schema.TABLES")) return [engines, []];
  if (text.includes("information_schema.STATISTICS")) return [indexes, []];
  if (text.includes("LIMIT 0")) throw Object.assign(new Error("missing"), { code: "ER_NO_SUCH_TABLE" });
  if (text.includes("FROM workspaces")) return [workspaces.filter(row => row.id === values[0]), []];
  if (text.includes("FROM users")) return [actors.filter(row => row.id === values[0]), []];
  if (text.includes("FROM workspace_memberships")) return [memberships.filter(row => row.workspaceId === values[0] && row.userId === values[1]), []];
  if (text.includes("FROM role_permissions")) { if (failAt.directory) throw failAt.directory; return [policies.filter(row => row.role === values[0]), []]; }
  if (text.includes("FROM security_audit_logs")) return [audits.filter(row => values.includes(row.auditId)), []];
  if (text.startsWith("INSERT INTO security_audit_logs")) {
    if (failAt.journal) throw failAt.journal;
    audits.push({ auditId: values[0], workspaceId: values[1], actorUserId: values[2], action: values[4], resourceType: "ops_monthly_operation", resourceId: values[5], status: "success", metadataText: values[6] }); return [{ affectedRows: 1 }, []];
  }
  if (text.includes("FROM ops_monthly_import_artifacts")) {
    const found = artifacts.filter(row => row.workspaceId === values[0] && row.batchId === values[1]).map(row => ({ ...row, preparedBytes: Buffer.byteLength(String(row.prepared)), manifestBytes: Buffer.byteLength(String(row.manifest)), storageReference: batches.find(batch => batch.id === row.batchId)?.fileUrl }));
    return [structuredClone(found), []];
  }
  if (text.includes("FROM ops_monthly_profit_imports") && !text.includes("LIMIT 0")) {
    if (failAt.read) throw failAt.read;
    let found = batches.filter(row => row.workspaceId === values[0] && (text.includes("status='completed'") ? row.status === "completed" : row.id === values[1])).sort((a, b) => Number(b.id) - Number(a.id));
    if (text.includes("AND id<?")) found = found.filter(row => Number(row.id) < Number(values[1]));
    if (text.includes("LIMIT 128")) found = found.slice(0, 128);
    return [structuredClone(found).map(row => {
      let payload: unknown; try { payload=JSON.parse(String(row.payload)); } catch { payload=null; }
      return { ...row, payloadType: Array.isArray(payload) ? "ARRAY" : "OBJECT", payloadMonths: Array.isArray(payload) ? JSON.stringify(payload.map((item: Row) => item.yearMonth)) : null,
        payloadBytes: Buffer.byteLength(String(row.payload)) + (text.includes("LIMIT 128") ? candidateExtraBytes : 0), monthsBytes: Buffer.byteLength(String(row.months)) };
    }), []];
  }
  if (text.startsWith("INSERT INTO ops_monthly_profit_imports")) {
    if (failAt.insert) throw failAt.insert;
    const record = { id: nextBatchId++, workspaceId: values[0], userId: values[1], fileName: values[2], fileHash: values[3], fileUrl: values[4], status: "previewing", totalRows: values[5], skippedRows: values[6], unallocatedRows: values[7], months: values[8], payload: values[9], createdAt: "2026-10-18 12:00:00.000000", confirmedAt: null, fileReferenceKind: "storage", sourceRunId: null }; batches.push(record); return [{ affectedRows: 1, insertId: record.id }, []];
  }
  if (text.startsWith("INSERT INTO ops_monthly_import_artifacts")) {
    if (failAt.artifact) throw failAt.artifact;
    artifacts.push({ batchId: values[0], workspaceId: values[1], prepared: values[2], payloadHash: values[3], manifest: values[4] }); return [{ affectedRows: 1 }, []];
  }
  if (text.startsWith("UPDATE ops_monthly_profit_imports")) {
    const found = batches.find(row => row.workspaceId === values[0] && row.id === values[1] && row.status === (values[2] ?? "previewing")); if (!found) return [{ affectedRows: 0 }, []];
    Object.assign(found, text.includes("status='completed'") ? { status: "completed", confirmedAt: "2026-10-18 12:01:00.000000" } : { status: "deleted" }); if (typeof failAt.candidateExtraAfterUpdate === "number") candidateExtraBytes = failAt.candidateExtraAfterUpdate; return [{ affectedRows: 1 }, []];
  }
  if (text.includes("LIMIT 0")) { const error = Object.assign(new Error("missing"), { code: "ER_NO_SUCH_TABLE" }); throw error; }
  throw new Error(`Unexpected SQL ${text}`);
});
async function transaction<T>(body: (tx: { execute: typeof execute }) => Promise<T>): Promise<T> {
  const run = tail.then(async () => {
    const snapshot = structuredClone({ batches, artifacts, audits, boardWrites }); let result: T;
    try { result = await body({ execute }); } catch (error) { ({ batches, artifacts, audits, boardWrites } = snapshot); throw error; }
    if (commitLost > 0 && --commitLost === 0) throw new Error("COMMIT acknowledgement lost"); return result;
  }); tail = run.catch(() => {}); return run;
}
const storage = {
  assertAvailable: vi.fn((): "s3" => "s3"), capability: vi.fn(() => ({ status: "available" as const, reasonCode: null })),
  prepare: vi.fn((identity: { workspaceId: number; userId: number }, op: string, metadata: { fileName: string; format: "csv" | "xlsx"; fileHash: string; byteSize: number; requestHash: string }) => { const objectKey = `monthly-financial/${identity.workspaceId}/${monthlyFinancialOperationKey(identity, op)}.${metadata.format}`; return MonthlyFinancialPreparedUploadSchema.parse({ ...metadata, identity, operationId: op, action: "upload", parserVersion: "monthly-financial-import-v1", provider: "s3", objectKey, storageUri: `storage://s3/${objectKey}` }); }),
  putOnce: vi.fn(async (prepared: MonthlyFinancialPreparedUpload, bytes: Uint8Array) => { if (failAt.put) throw failAt.put; objects.set(prepared.objectKey, bytes.slice()); if (failAt.putAck) throw failAt.putAck; }),
  readVerified: vi.fn(async (prepared: MonthlyFinancialPreparedUpload) => { if (failAt.verify) throw failAt.verify; const bytes = objects.get(prepared.objectKey); if (!bytes || bytes.length !== prepared.byteSize || monthlyFinancialImportBytesHash(bytes) !== prepared.fileHash) throw new Error("object not verified"); return bytes; }),
  download: vi.fn(async (_prepared: MonthlyFinancialPreparedUpload) => ({ url: "https://private.example/file?signature=short", expiresSeconds: 60 })),
};
const repository = createMonthlyFinancialWriteRepository({ database: async () => ({ transaction }), permission, storage, enabled: () => enabled, synchronizeBoards });
const policy = (operations: string[] = ["read", "edit", "delete"], workspaceId: number | null = 7) => ({ id: workspaceId === null ? 1 : 2, workspaceId, role: "ops_manager", modules: ["ops"], detailedPermissions: [{ moduleId: "ops", operations: ["read", "edit", "delete"], subModules: [{ subModuleId: "ops_data_import", operations }] }] });
async function uploaded(patch: Row = {}) { const result = await repository.upload(context(), command(patch)); expect(result.status).toBe("committed"); return result.batchId!; }
async function transitionCommand(batchId: number, op = op2) { const state = await repository.inspect(context(), inspectInput(batchId)); return { expectedWorkspaceId: 7, operationId: op, batchId, expectedBatchVersion: state.batchVersion, expectedImpactKey: state.impact.key, fullScopeAcknowledged: true as const }; }
async function oldBatch(idValue: number, items = [source()], patch: Row = {}) {
  const parsed = await parseMonthlyFinancialImport(csv(items), "旧月报.csv"); const record = { id: idValue, workspaceId: 7, userId: 4, fileName: "旧月报.csv", fileHash: parsed.fileHash, fileUrl: "saihu-sync-run:5", fileReferenceKind: "saihu_sync_run", sourceRunId: 5, status: "completed", totalRows: parsed.totalRows, skippedRows: parsed.skippedRows, unallocatedRows: parsed.unallocatedRows, months: JSON.stringify(parsed.months), payload: JSON.stringify(parsed.rows), createdAt: "2026-10-01 00:00:00.000000", confirmedAt: "2026-10-01 00:00:01.000000", ...patch }; batches.push(record); return record;
}
beforeEach(() => {
  vi.clearAllMocks(); batches = []; artifacts = []; audits = []; policies = []; queries = []; objects = new Map(); enabled = true; commitLost = 0; failAt = {}; nextBatchId = 100; tail = Promise.resolve(); candidateExtraBytes = 0; boardWrites = [];
  synchronizeBoards.mockImplementation(async () => {});
  actors = [{ id: 3, role: "ops_manager", status: "active", defaultWorkspaceId: 7 }, { id: 4, role: "ops_manager", status: "active", defaultWorkspaceId: 7 }];
  memberships = [3, 4].map(userId => ({ id: userId + 10, userId, workspaceId: 7, status: "active" })); workspaces = [{ id: 7, status: "active" }];
  cols = { ops_monthly_profit_imports: batchColumns(), ops_monthly_import_artifacts: artifactColumns(), security_audit_logs: auditColumns() };
  engines = ["ops_monthly_profit_imports", "ops_monthly_import_artifacts", "security_audit_logs", "users", "workspaces", "workspace_memberships", "role_permissions", "security_access_policies"].map(tableName => ({ tableName, engine: "InnoDB", collation: "utf8mb4_unicode_ci" }));
  indexes = [...index("ops_monthly_profit_imports", "PRIMARY", ["id"]), ...index("ops_monthly_profit_imports", "scope", ["workspaceId", "status", "id"], 1), ...index("ops_monthly_profit_imports", "owner", ["workspaceId", "userId", "id"], 1), ...index("ops_monthly_import_artifacts", "PRIMARY", ["batch_id"]), ...index("ops_monthly_import_artifacts", "scope", ["workspace_id", "batch_id"], 1), ...index("security_audit_logs", "PRIMARY", ["id"]), ...index("security_audit_logs", "audit", ["auditId"])];
  permission.mockImplementation(async () => {});
});

describe("monthly persistent upload and transactional financial lifecycle", () => {
  it("stores original bytes once, complete manifest and previewing batch atomically", async () => {
    const batchId = await uploaded(); expect(storage.putOnce).toHaveBeenCalledTimes(1); expect(storage.readVerified).toHaveBeenCalledTimes(1);
    expect(batches[0].status).toBe("previewing"); expect(artifacts).toHaveLength(1); expect(audits).toHaveLength(2);
    const state = await repository.inspect(context(), inspectInput(batchId, { pageSize: 2 }));
    expect(state.preview?.rows).toHaveLength(1); expect(state.preview?.cells).toHaveLength(2); expect(state.preview?.cellPage.total).toBe(24); expect(state.capabilities.confirm.status).toBe("available");
    expect(JSON.stringify(state)).not.toMatch(/storage:\/\/|base64|objectKey|private\.example/);
    expect(queries.some(query => query.sql.includes("IF(OCTET_LENGTH(CAST(a.manifest") && query.sql.includes("67108864"))).toBe(true);
  });
  it("confirms whole scopes and revokes to the previous full snapshot, with no parent backfill", async () => {
    await oldBatch(80, [source(), source({ ASIN: "B000000004", 父ASIN: "B000000003", SKU: "SKU-B" })]);
    const batchId = await uploaded(), input = await transitionCommand(batchId);
    const before = await repository.inspect(context(), inspectInput(batchId)); expect(before.impact.scopes[0].removedParentAsins).toEqual(["B000000003"]);
    const confirmed = await repository.confirm(context(), input); expect(confirmed.batchStatus).toBe("completed");
    const effective = findMonthlyFinancialSnapshot([...batches].sort((a, b) => Number(b.id) - Number(a.id)) as unknown as MonthlyFinancialBatchRecord[], { yearMonth: "2026-09", storeName: "Exact Store", country: "US" }, true);
    expect(effective.selected?.batch.id).toBe(batchId); expect(effective.selected?.rows).toHaveLength(1);
    const revoked = await repository.revoke(context(), await transitionCommand(batchId, op3)); expect(revoked.batchStatus).toBe("deleted");
    const after = findMonthlyFinancialSnapshot(batches.filter(row => row.status === "completed").sort((a, b) => Number(b.id) - Number(a.id)) as unknown as MonthlyFinancialBatchRecord[], { yearMonth: "2026-09", storeName: "Exact Store", country: "US" }, true); expect(after.selected?.batch.id).toBe(80); expect(after.selected?.rows).toHaveLength(2);
  });
  it("replay of the same acknowledged upload never repeats storage or insert", async () => { const first = await repository.upload(context(), command()); expect(await repository.upload(context(), command())).toEqual(first); expect(storage.putOnce).toHaveBeenCalledTimes(1); expect(batches).toHaveLength(1); });
  it("binds operation UUID to file bytes, filename and action", async () => { await uploaded(); await expect(repository.upload(context(), command({ fileName: "different.csv" }))).rejects.toMatchObject({ code: "CONFLICT" }); expect(storage.putOnce).toHaveBeenCalledTimes(1); });
  it("lost prepare acknowledgement never PUTs and check cannot assert not-committed", async () => { commitLost = 1; expect((await repository.upload(context(), command())).status).toBe("unknown"); expect(storage.putOnce).not.toHaveBeenCalled(); expect(audits).toHaveLength(1); expect((await repository.recover(context(), { expectedWorkspaceId: 7, operationId, decision: "check" })).status).toBe("unknown"); });
  it("lost PUT acknowledgement can complete with verified GET only", async () => { failAt.putAck = new Error("lost PUT ack"); expect((await repository.upload(context(), command())).status).toBe("unknown"); delete failAt.putAck; expect((await repository.recover(context(), { expectedWorkspaceId: 7, operationId, decision: "complete_upload" })).status).toBe("committed"); expect(storage.putOnce).toHaveBeenCalledTimes(1); expect(batches).toHaveLength(1); });
  it("missing original remains unknown and never retries PUT", async () => { failAt.put = new Error("not sent"); await repository.upload(context(), command()); expect((await repository.recover(context(), { expectedWorkspaceId: 7, operationId, decision: "complete_upload" })).status).toBe("unknown"); expect(storage.putOnce).toHaveBeenCalledTimes(1); expect(batches).toHaveLength(0); });
  it("lost final commit returns unknown and check recovers the durable final receipt", async () => { commitLost = 2; expect((await repository.upload(context(), command())).status).toBe("unknown"); expect(batches).toHaveLength(1); expect((await repository.recover(context(), { expectedWorkspaceId: 7, operationId, decision: "check" })).status).toBe("committed"); expect(storage.putOnce).toHaveBeenCalledTimes(1); });
  it("lost confirm acknowledgement recovers one status transition without replaying it", async () => { const batchId = await uploaded(), input = await transitionCommand(batchId); commitLost = 1; expect((await repository.confirm(context(), input)).status).toBe("unknown"); const count = queries.filter(query => query.sql.startsWith("UPDATE ops_monthly_profit_imports")).length; const recovered = await repository.recover(context(), { expectedWorkspaceId: 7, operationId: op2, decision: "check" }); expect(recovered).toMatchObject({ status: "committed", action: "confirm", batchId }); expect(await repository.confirm(context(), input)).toEqual(recovered); expect(queries.filter(query => query.sql.startsWith("UPDATE ops_monthly_profit_imports"))).toHaveLength(count); });
  it("rolls back batch and artifact when final audit fails", async () => { storage.readVerified.mockImplementationOnce(async prepared => { failAt.journal = new Error("audit unavailable"); return objects.get(prepared.objectKey)!; }); expect((await repository.upload(context(), command())).status).toBe("unknown"); expect(batches).toHaveLength(0); expect(artifacts).toHaveLength(0); expect(audits).toHaveLength(1); });
  it("cancel fences a late upload finalization even after object PUT", async () => { failAt.putAck = new Error("lost"); await repository.upload(context(), command()); enabled = false; const cancelled = await repository.recover(context(), { expectedWorkspaceId: 7, operationId, decision: "cancel" }); expect(cancelled.status).toBe("cancelled"); enabled = true; delete failAt.putAck; expect((await repository.recover(context(), { expectedWorkspaceId: 7, operationId, decision: "complete_upload" })).status).toBe("cancelled"); expect(batches).toHaveLength(0); });
  it("a cancellation committed during the original PUT prevents its late finalize", async () => { storage.readVerified.mockImplementationOnce(async prepared => { const cancelled = await repository.recover(context(), { expectedWorkspaceId: 7, operationId, decision: "cancel" }); expect(cancelled.status).toBe("cancelled"); return objects.get(prepared.objectKey)!; }); const result = await repository.upload(context(), command()); expect(result.status).toBe("cancelled"); expect(batches).toHaveLength(0); expect(artifacts).toHaveLength(0); });
  it("check/cancel remain available when writes are rolled back", async () => { enabled = false; expect((await repository.options(context(), { expectedWorkspaceId: 7 })).capabilities.upload.reasonCode).toBe("not_enabled_before_release"); expect((await repository.recover(context(), { expectedWorkspaceId: 7, operationId, decision: "cancel" })).status).toBe("cancelled"); await expect(repository.upload(context(), command())).rejects.toMatchObject({ code: "PRECONDITION_FAILED" }); });
  it("cancel before delayed confirm creates a permanent fence without changing the batch", async () => { const batchId = await uploaded(), input = await transitionCommand(batchId); await repository.recover(context(), { expectedWorkspaceId: 7, operationId: op2, decision: "cancel" }); expect((await repository.confirm(context(), input)).status).toBe("cancelled"); expect(batches[0].status).toBe("previewing"); });
  it("download uses only the persisted prepared record and exact version", async () => { const batchId = await uploaded(), state = await repository.inspect(context(), inspectInput(batchId)); const value = await repository.download(context(), { expectedWorkspaceId: 7, batchId, expectedBatchVersion: state.batchVersion }); expect(value).toMatchObject({ fileName: "月报.csv", byteSize: csv().length, expiresSeconds: 60 }); expect(storage.download).toHaveBeenCalledTimes(1); await expect(repository.download(context(), { expectedWorkspaceId: 7, batchId, expectedBatchVersion: "f".repeat(64) })).rejects.toMatchObject({ code: "CONFLICT" }); });
  it("legacy batches remain inspectable and revocable but no invented original/download/confirm", async () => { await oldBatch(80); const value = await repository.inspect(context(), inspectInput(80)); expect(value.preview).toBeNull(); expect(value.capabilities.download.status).toBe("unavailable"); expect(value.capabilities.revoke.status).toBe("available"); await repository.revoke(context(), await transitionCommand(80)); expect(batches[0].status).toBe("deleted"); });
});

describe("archive participation in the original monthly transaction", () => {
  it.each(["confirm", "revoke"] as const)("the real disabled-sync guard rolls back %s and its final receipt for an initialized scope (fixture store)", async action => {
    const batchId = await uploaded();
    if (action === "revoke") await repository.confirm(context(), await transitionCommand(batchId));
    const input = await transitionCommand(batchId, action === "confirm" ? op2 : op3), before = structuredClone({ batches, artifacts, audits });
    const unexpected = async (): Promise<never> => { throw new Error("Unexpected archive operation in disabled-sync fixture"); };
    const refreshExisting = vi.fn(unexpected);
    synchronizeBoards.mockImplementation(async transition => {
      const completed = transition.action === "confirm" ? transition.afterBatch : transition.beforeBatch;
      const sync = createMonthlyOperationsBoardSynchronization({ enabled: () => false,
        inspect: async tx => {
          expect(tx.execute).toBe(execute);
          expect(queries.some(query => query.sql.includes("FROM workspaces") && query.sql.includes("FOR UPDATE"))).toBe(true);
          return "ready";
        },
        store: () => ({ get: unexpected, initializeExplicitAdmin: unexpected, publishRevision: unexpected, refreshExisting, load: async scope => {
          expect(scope).toEqual({ workspaceId: 7, storeName: "Exact Store", country: "US" });
          const initial = planOperationsBoardInitialization({ role: "admin", state: { scope, version: 0, currentMonth: null, currentEditionId: null, status: "uninitialized" }, currentEdition: null,
            capture: prepareOperationsBoardHistoryCapture([completed], 7).capture({ ...scope, month: "2026-09" }), now: "2026-10-18 12:10:00.000000", nextEditionId: 9 });
          return { stateId: 1, state: initial.state, currentEdition: initial.currentEdition! };
        } }),
      });
      await sync(transition);
    });
    queries = [];
    await expect(repository[action](context(), input)).rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: "OPERATIONS_BOARD_SYNC_DISABLED_FOR_INITIALIZED_SCOPE" });
    expect({ batches, artifacts, audits }).toEqual(before); expect(refreshExisting).not.toHaveBeenCalled();
    expect((await repository.recover(context(), { expectedWorkspaceId: 7, operationId: input.operationId, decision: "check" })).status).toBe("unknown");
    expect(synchronizeBoards).toHaveBeenCalledTimes(action === "confirm" ? 1 : 2);
  });
  it("passes complete post-state to the same transaction before its final receipt for confirm and revoke", async () => {
    await oldBatch(80, [source({ 时间: "2025-01" }), source({ 店铺: "Other Store" })]);
    const batchId = await uploaded();
    synchronizeBoards.mockImplementation(async input => {
      expect(input.tx.execute).toBe(execute); expect(input.identity).toEqual({ userId: 3, workspaceId: 7 });
      expect(input.actor).toEqual({ id: 3, role: "ops_manager", defaultWorkspaceId: 7 });
      expect(input.completedAfter.map(batch => batch.id)).toEqual(input.action === "confirm" ? [batchId, 80] : [80]);
      expect(input.completedAfter.at(-1)?.payload).toContain("2025-01");
      expect(batches.find(batch => batch.id === batchId)?.status).toBe(input.afterBatch.status);
      expect(audits.filter(row => String(row.metadataText).includes(`\"action\":\"${input.action}\"`))).toHaveLength(0);
      boardWrites.push({ batchId, status: input.afterBatch.status });
    });
    await repository.confirm(context(), await transitionCommand(batchId));
    await repository.revoke(context(), await transitionCommand(batchId, op3));
    expect(synchronizeBoards.mock.calls.map(([value]) => [value.beforeBatch.status, value.afterBatch.status])).toEqual([["previewing", "completed"], ["completed", "deleted"]]);
    expect(boardWrites).toEqual([{ batchId, status: "completed" }, { batchId, status: "deleted" }]);
  });
  it("rolls back prospective status and archive writes when archive reconciliation rejects", async () => {
    const batchId = await uploaded(), input = await transitionCommand(batchId);
    synchronizeBoards.mockImplementation(async () => { boardWrites.push({ batchId, status: "completed" }); throw new TRPCError({ code: "PRECONDITION_FAILED", message: "OPERATIONS_BOARD_SYNC_RECONCILIATION_FAILED" }); });
    await expect(repository.confirm(context(), input)).rejects.toThrow("OPERATIONS_BOARD_SYNC_RECONCILIATION_FAILED");
    expect(batches[0].status).toBe("previewing"); expect(boardWrites).toEqual([]); expect(audits).toHaveLength(2);
    expect((await repository.recover(context(), { expectedWorkspaceId: 7, operationId: op2, decision: "check" })).status).toBe("unknown");
  });
  it("rolls back archive writes and batch status if the final journal fails", async () => {
    const batchId = await uploaded(), input = await transitionCommand(batchId);
    synchronizeBoards.mockImplementation(async () => { boardWrites.push({ batchId, status: "completed" }); failAt.journal = new Error("final journal unavailable"); });
    expect((await repository.confirm(context(), input)).status).toBe("unknown");
    expect(batches[0].status).toBe("previewing"); expect(boardWrites).toEqual([]); expect(audits).toHaveLength(2);
  });
  it("lost commit acknowledgement then check/replay never invokes the archive participant twice", async () => {
    const batchId = await uploaded(), input = await transitionCommand(batchId);
    synchronizeBoards.mockImplementation(async value => { boardWrites.push({ batchId, status: value.afterBatch.status }); });
    commitLost = 1; expect((await repository.confirm(context(), input)).status).toBe("unknown");
    expect(boardWrites).toHaveLength(1); expect(batches[0].status).toBe("completed");
    const recovered = await repository.recover(context(), { expectedWorkspaceId: 7, operationId: op2, decision: "check" });
    expect(recovered.status).toBe("committed"); expect(await repository.confirm(context(), input)).toEqual(recovered);
    expect(synchronizeBoards).toHaveBeenCalledTimes(1); expect(boardWrites).toHaveLength(1);
  });
  it("cancelled operations and upload/inspect/recovery never create archive work", async () => {
    const batchId = await uploaded(), input = await transitionCommand(batchId);
    await repository.recover(context(), { expectedWorkspaceId: 7, operationId: op2, decision: "cancel" });
    expect((await repository.confirm(context(), input)).status).toBe("cancelled"); expect(synchronizeBoards).not.toHaveBeenCalled();
  });
  it("rechecks current permissions before either the batch or archive participant writes", async () => {
    const batchId = await uploaded(), input = await transitionCommand(batchId); policies = [policy(["read"])];
    await expect(repository.confirm(context(), input)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(synchronizeBoards).not.toHaveBeenCalled(); expect(batches[0].status).toBe("previewing");
  });
  it("a failed revoke participant preserves the previously completed source and receipt", async () => {
    const batchId = await uploaded(); await repository.confirm(context(), await transitionCommand(batchId));
    const auditBefore = structuredClone(audits); synchronizeBoards.mockImplementation(async () => { throw new TRPCError({ code: "PRECONDITION_FAILED", message: "OPERATIONS_BOARD_SCHEMA_MIGRATION_REQUIRED" }); });
    await expect(repository.revoke(context(), await transitionCommand(batchId, op3))).rejects.toThrow("OPERATIONS_BOARD_SCHEMA_MIGRATION_REQUIRED");
    expect(batches[0].status).toBe("completed"); expect(audits).toEqual(auditBefore);
  });
});

describe("monthly scope CAS, fixed candidates and freshness", () => {
  it("old preview IDs cannot displace newer completed winners", async () => { const batchId = await uploaded(); await oldBatch(101); const state = await repository.inspect(context(), inspectInput(batchId)); expect(state.impact.blockingReasons).toContain("newer_batch_already_effective"); expect(state.capabilities.confirm.status).toBe("unavailable"); await expect(repository.confirm(context(), await transitionCommand(batchId))).rejects.toMatchObject({ code: "CONFLICT" }); });
  it("concurrent actor confirmation invalidates the other actor impact CAS", async () => { const one = await uploaded(), two = await uploaded({ operationId: op2 }); const first = await transitionCommand(one, op3), second = await transitionCommand(two, "44444444-4444-4444-8444-444444444444"); await repository.confirm(context("ops_manager", 4), second); await expect(repository.confirm(context(), first)).rejects.toMatchObject({ code: "CONFLICT" }); expect(batches.find(row => row.id === one)?.status).toBe("previewing"); expect(queries.find(query => query.sql.includes("FROM workspaces"))?.sql).toContain("FOR UPDATE"); });
  it("old writer payload changes are caught without a version column", async () => { const batchId = await uploaded(), input = await transitionCommand(batchId); const payload = JSON.parse(String(batches[0].payload)); payload[0].financialProfit = 30; batches[0].payload = JSON.stringify(payload); await expect(repository.confirm(context(), input)).rejects.toMatchObject({ code: "CONFLICT" }); expect(batches[0].status).toBe("previewing"); });
  it("supports all scopes in a multi-month/multi-store report without US preference", async () => { const batchId = await uploaded({ base64: csv([source(), source({ 时间: "2026-08", 店铺: "Other Store", 站点: "英国", ASIN: "B000000005" })]).toString("base64") }); const value = await repository.inspect(context(), inspectInput(batchId)); expect(value.impact.scopes.map(scope => [scope.yearMonth, scope.storeName, scope.country])).toEqual([["2026-08", "Other Store", "UK"], ["2026-09", "Exact Store", "US"]]); });
  it("manifest pagination is bound to immutable full batch version", async () => { const batchId = await uploaded(), first = await repository.inspect(context(), inspectInput(batchId, { pageSize: 2 })); const second = await repository.inspect(context(), inspectInput(batchId, { cellOffset: 2, pageSize: 2, expectedBatchVersion: first.batchVersion })); expect(second.preview?.cells[0].address).toBe("C1"); const manifest = JSON.parse(String(artifacts[0].manifest)); manifest.cells[0].value = "changed"; artifacts[0].manifest = JSON.stringify(manifest); await expect(repository.inspect(context(), inspectInput(batchId, { expectedBatchVersion: first.batchVersion }))).rejects.toMatchObject({ code: "CONFLICT" }); });
  it("complete keyset history accepts 201 revisions without truncating provenance", async () => { const example = await oldBatch(1); batches = Array.from({ length: 200 }, (_, i) => ({ ...example, id: i + 1 })); nextBatchId = 201; const batchId = await uploaded(); expect((await repository.confirm(context(), await transitionCommand(batchId))).status).toBe("committed"); expect(batches.find(row => row.id === batchId)?.status).toBe("completed"); expect(synchronizeBoards.mock.calls.at(-1)?.[0].completedAfter).toHaveLength(201); expect(queries.some(q => q.sql.includes("AND id<? ORDER BY id DESC LIMIT 128"))).toBe(true); });
  it("prospective aggregate wire scan overflow rolls back the status and final receipt", async () => { await oldBatch(1); const batchId = await uploaded(), input = await transitionCommand(batchId); failAt.candidateExtraAfterUpdate = 33 * 1024 * 1024; await expect(repository.confirm(context(), input)).rejects.toThrow("CONSUMER_SCAN_BUDGET"); expect(batches.find(row => row.id === batchId)?.status).toBe("previewing"); expect(audits).toHaveLength(2); expect(synchronizeBoards).not.toHaveBeenCalled(); expect((await repository.recover(context(), { expectedWorkspaceId: 7, operationId: op2, decision: "check" })).status).toBe("unknown"); });
  it("aggregate declared wire size over 64 MiB is rejected before loading candidate bodies", async () => { await oldBatch(1); await oldBatch(2); candidateExtraBytes = 33 * 1024 * 1024; await expect(repository.inspect(context(), inspectInput(1))).rejects.toThrow("CONSUMER_SCAN_BUDGET"); expect(queries.some(query => query.sql.includes("FROM ops_monthly_profit_imports") && query.sql.includes("WHERE workspaceId=? AND id=?") && query.params?.[1] === 2)).toBe(false); });
  it("bad latest source blocks history rather than falling back", async () => { await oldBatch(1); await oldBatch(2, undefined, { payload: "not-json" }); await expect(repository.inspect(context(), inspectInput(1))).rejects.toThrow("SOURCE_INVALID"); });
  it("unresolved identity rows remain in original manifest and cannot confirm", async () => { const batchId = await uploaded({ base64: csv([source(), source({ ASIN: "B000000005", 店铺: "" })]).toString("base64") }); const state = await repository.inspect(context(), inspectInput(batchId)); expect(state.preview?.rows).toHaveLength(2); expect(state.preview?.counts.unresolvedRows).toBeGreaterThan(0); expect(state.capabilities.confirm.status).toBe("unavailable"); });
});

describe("current manager, workspace and strict directory authorization", () => {
  it.each(["ops_specialist", "viewer", "developer", "finance"])("does not delegate all report ranges to %s", async role => { actors[0].role = role; await expect(repository.options(context(role), { expectedWorkspaceId: 7 })).rejects.toMatchObject({ code: "FORBIDDEN" }); expect(queries).toHaveLength(0); });
  it.each(["options", "confirm", "revoke", "recover"] as const)("rejects explicit null workspace before database or side effects: %s", async action => {
    const database = vi.fn(async () => ({ transaction })), parseImport = vi.fn(parseMonthlyFinancialImport);
    const isolated = createMonthlyFinancialWriteRepository({ database, parseImport, permission, storage, enabled: () => enabled, synchronizeBoards });
    const ctx = { ...context(), workspaceId: null };
    const transition = { expectedWorkspaceId: 7, operationId, batchId: 100, expectedBatchVersion: "a".repeat(64), expectedImpactKey: "b".repeat(64), fullScopeAcknowledged: true as const };
    const result = action === "options" ? isolated.options(ctx, { expectedWorkspaceId: 7 })
      : action === "recover" ? isolated.recover(ctx, { expectedWorkspaceId: 7, operationId, decision: "cancel" })
        : isolated[action](ctx, transition);
    await expect(result).rejects.toMatchObject({ code: "FORBIDDEN", message: "MONTHLY_FINANCIAL_WRITE_WORKSPACE_OR_ROLE_DENIED" });
    expect(database).not.toHaveBeenCalled(); expect(execute).not.toHaveBeenCalled(); expect(parseImport).not.toHaveBeenCalled();
    expect(permission).not.toHaveBeenCalled(); expect(synchronizeBoards).not.toHaveBeenCalled();
    for (const method of Object.values(storage)) expect(method).not.toHaveBeenCalled();
    expect({ batches, artifacts, audits, boardWrites, objects: objects.size }).toEqual({ batches: [], artifacts: [], audits: [], boardWrites: [], objects: 0 });
  });
  it("null-workspace upload retains existing parse order but cannot acquire database or storage", async () => {
    const database = vi.fn(async () => ({ transaction })), parseImport = vi.fn(parseMonthlyFinancialImport);
    const isolated = createMonthlyFinancialWriteRepository({ database, parseImport, permission, storage, enabled: () => enabled, synchronizeBoards });
    await expect(isolated.upload({ ...context(), workspaceId: null }, command())).rejects.toMatchObject({ code: "FORBIDDEN", message: "MONTHLY_FINANCIAL_WRITE_WORKSPACE_OR_ROLE_DENIED" });
    expect(parseImport).toHaveBeenCalledTimes(1); expect(database).not.toHaveBeenCalled(); expect(execute).not.toHaveBeenCalled();
    expect(permission).not.toHaveBeenCalled(); expect(synchronizeBoards).not.toHaveBeenCalled();
    for (const method of Object.values(storage)) expect(method).not.toHaveBeenCalled();
    expect({ batches, artifacts, audits, boardWrites, objects: objects.size }).toEqual({ batches: [], artifacts: [], audits: [], boardWrites: [], objects: 0 });
  });
  it("preserves omitted-workspace fallback through options, confirmation, revocation and recovery", async () => {
    const ctx = { ...context(), workspaceId: undefined };
    expect((await repository.options(ctx, { expectedWorkspaceId: 7 })).identity).toEqual({ userId: 3, workspaceId: 7 });
    const uploadedResult = await repository.upload(ctx, command()); expect(uploadedResult.status).toBe("committed");
    const batchId = uploadedResult.batchId!;
    expect((await repository.confirm(ctx, await transitionCommand(batchId))).batchStatus).toBe("completed");
    expect((await repository.revoke(ctx, await transitionCommand(batchId, op3))).batchStatus).toBe("deleted");
    expect((await repository.recover(ctx, { expectedWorkspaceId: 7, operationId: op3, decision: "check" })).batchStatus).toBe("deleted");
    expect(queries.filter(query => query.sql.includes("FROM workspaces")).every(query => query.params[0] === 7)).toBe(true);
  });
  it.each([
    { workspaceId: undefined, expectedWorkspaceId: 8 },
    { workspaceId: 8, expectedWorkspaceId: 7 },
    { workspaceId: 7, expectedWorkspaceId: 8 },
  ])("does not use default workspace to repair a mismatched scope: %j", async ({ workspaceId, expectedWorkspaceId }) => {
    const database = vi.fn(async () => ({ transaction }));
    const isolated = createMonthlyFinancialWriteRepository({ database, permission, storage, enabled: () => enabled, synchronizeBoards });
    await expect(isolated.options({ ...context(), workspaceId }, { expectedWorkspaceId })).rejects.toMatchObject({ code: "FORBIDDEN", message: "MONTHLY_FINANCIAL_WRITE_WORKSPACE_OR_ROLE_DENIED" });
    expect(database).not.toHaveBeenCalled(); expect(execute).not.toHaveBeenCalled(); expect(permission).not.toHaveBeenCalled();
    expect(synchronizeBoards).not.toHaveBeenCalled();
    for (const method of Object.values(storage)) expect(method).not.toHaveBeenCalled();
    expect({ batches, artifacts, audits, boardWrites, objects: objects.size }).toEqual({ batches: [], artifacts: [], audits: [], boardWrites: [], objects: 0 });
  });
  it.each(["inactive_actor", "changed_role", "changed_workspace", "inactive_workspace", "missing_membership", "disabled_membership", "duplicate_membership"])("rejects %s", async cause => { if (cause === "inactive_actor") actors[0].status = "disabled"; if (cause === "changed_role") actors[0].role = "admin"; if (cause === "changed_workspace") actors[0].defaultWorkspaceId = 8; if (cause === "inactive_workspace") workspaces[0].status = "disabled"; if (cause === "missing_membership") memberships = []; if (cause === "disabled_membership") memberships[0].status = "disabled"; if (cause === "duplicate_membership") memberships.push({ ...memberships[0], id: 100 }); await expect(repository.options(context(), { expectedWorkspaceId: 7 })).rejects.toMatchObject({ code: "FORBIDDEN" }); });
  it("ops_data policy allow cannot override explicit import directory denial", async () => { policies = [policy([])]; await expect(repository.options(context(), { expectedWorkspaceId: 7 })).rejects.toMatchObject({ code: "FORBIDDEN" }); });
  it("workspace directory overrides permissive global directory", async () => { policies = [policy([], 7), policy(undefined, null)]; await expect(repository.options(context(), { expectedWorkspaceId: 7 })).rejects.toMatchObject({ code: "FORBIDDEN" }); });
  it("read only directory permits history and recovery but not upload or confirm", async () => { policies = [policy(["read"])]; const value = await repository.options(context(), { expectedWorkspaceId: 7 }); expect(value.capabilities.inspect.status).toBe("available"); expect(value.capabilities.upload.reasonCode).toBe("permission_denied"); expect((await repository.recover(context(), { expectedWorkspaceId: 7, operationId, decision: "cancel" })).status).toBe("cancelled"); });
  it.each(["broken", [{ moduleId: "ops", operations: ["read", "read"] }], [{ moduleId: "ops", operations: ["read"], subModules: [{ subModuleId: "ops_data_import", operations: ["read"] }, { subModuleId: "ops_data_import", operations: ["edit"] }] }]])("fails closed on malformed directory %j", async detailedPermissions => { policies = [{ ...policy(), detailedPermissions }]; await expect(repository.options(context(), { expectedWorkspaceId: 7 })).rejects.toMatchObject({ code: "FORBIDDEN" }); });
  it("rechecks role and directory before second page or recovery", async () => { const batchId = await uploaded(); await repository.inspect(context(), inspectInput(batchId, { pageSize: 1 })); policies = [policy([])]; await expect(repository.inspect(context(), inspectInput(batchId, { cellOffset: 1, pageSize: 1 }))).rejects.toMatchObject({ code: "FORBIDDEN" }); await expect(repository.recover(context(), { expectedWorkspaceId: 7, operationId, decision: "check" })).rejects.toMatchObject({ code: "FORBIDDEN" }); });
  it("permission withdrawn during storage I/O prevents final batch insertion", async () => { storage.readVerified.mockImplementationOnce(async prepared => { policies = [policy(["read"])]; return objects.get(prepared.objectKey)!; }); await expect(repository.upload(context(), command())).rejects.toMatchObject({ code: "FORBIDDEN" }); expect(batches).toHaveLength(0); expect(artifacts).toHaveLength(0); expect(audits).toHaveLength(1); });
  it("cross-workspace recovery never reads another workspace operation", async () => { await uploaded(); const before = queries.filter(query => query.sql.includes("FROM security_audit_logs")).length; await expect(repository.recover(context(), { expectedWorkspaceId: 8, operationId, decision: "check" })).rejects.toMatchObject({ code: "FORBIDDEN" }); expect(queries.filter(query => query.sql.includes("FROM security_audit_logs"))).toHaveLength(before); });
  it("a second manager cannot recover another actor's operation UUID", async () => { await uploaded(); const result = await repository.recover(context("ops_manager", 4), { expectedWorkspaceId: 7, operationId, decision: "check" }); expect(result.status).toBe("unknown"); expect(result.batchId).toBeNull(); });
  it("uses current manager ID and strict same-transaction policies, not owner shortcuts", async () => { await repository.options(context(), { expectedWorkspaceId: 7 }); expect(permission.mock.calls.every(([value]) => !Object.hasOwn(value as object, "ownerUserId"))).toBe(true); expect(permission).toHaveBeenCalledWith(expect.objectContaining({ resource: "ops_data", action: "read", authorizationRead: { executor: { execute }, strict: true, lock: true } })); });
});

describe("actual runtime schema and private artifact integrity", () => {
  it("admits the existing Qingdao 0900 report table without altering its text columns", async () => {
    engines.find(row => row.tableName === "ops_monthly_profit_imports")!.collation = "utf8mb4_0900_ai_ci";
    for (const column of cols.ops_monthly_profit_imports) if (column.collation) column.collation = "utf8mb4_0900_ai_ci";
    expect((await repository.options(context(), { expectedWorkspaceId: 7 })).capabilities.upload.status).toBe("available");
    cols.ops_monthly_profit_imports.find(row => row.columnName === "status")!.collation = "utf8mb4_unicode_ci";
    expect((await repository.options(context(), { expectedWorkspaceId: 7 })).capabilities.upload.status).toBe("unavailable");
  });
  it.each(["ops_monthly_profit_imports", "ops_monthly_import_artifacts"])("requires the planned UTF-8 table collation: %s", async tableName => { engines.find(row => row.tableName === tableName)!.collation = "latin1_swedish_ci"; expect((await repository.options(context(), { expectedWorkspaceId: 7 })).capabilities.upload.status).toBe("unavailable"); });
  it.each([["ops_monthly_profit_imports", "fileName"], ["ops_monthly_profit_imports", "fileHash"], ["ops_monthly_profit_imports", "fileUrl"], ["ops_monthly_profit_imports", "status"], ["ops_monthly_import_artifacts", "payload_hash"]])("rejects incompatible text collation %s.%s", async (tableName, name) => { cols[tableName].find(row => row.columnName === name)!.collation = "utf8mb4_bin"; expect((await repository.options(context(), { expectedWorkspaceId: 7 })).capabilities.upload.status).toBe("unavailable"); });
  it.each([undefined, Number.NaN, Number.POSITIVE_INFINITY, {}, false])("rejects incomplete or malformed column default %j", async defaultValue => { cols.ops_monthly_import_artifacts.push(column("mandatory", "int", { defaultValue })); await expect(repository.options(context(), { expectedWorkspaceId: 7 })).rejects.toThrow("SCHEMA_INVALID"); });
  it("accepts a finite default for an additional column without changing nullable audit JSON", async () => { cols.ops_monthly_import_artifacts.push(column("compatible_extra", "int", { defaultValue: 0 })); expect((await repository.options(context(), { expectedWorkspaceId: 7 })).capabilities.upload.status).toBe("available"); expect(cols.security_audit_logs.find(row => row.columnName === "metadata")?.isNullable).toBe("YES"); });
  it("accepts legitimate DEFAULT_GENERATED DATETIME(3) defaults", async () => { expect((await repository.options(context(), { expectedWorkspaceId: 7 })).capabilities.upload.status).toBe("available"); });
  it("accepts the existing audit table nullable metadata column while always writing complete metadata", async () => { expect(cols.security_audit_logs.find(row => row.columnName === "metadata")?.isNullable).toBe("YES"); await uploaded(); expect(audits.every(row => typeof row.metadataText === "string" && row.metadataText.length > 20)).toBe(true); });
  it.each(["missing_artifact", "missing_batch", "missing_audit", "myisam", "unsigned", "generated", "timestamp_on_update", "prefix_unique", "extra_unique", "missing_scope_index", "required_extra"])("does not enable writes with %s", async cause => {
    if (cause === "missing_artifact") cols.ops_monthly_import_artifacts = []; if (cause === "missing_batch") cols.ops_monthly_profit_imports = []; if (cause === "missing_audit") cols.security_audit_logs = [];
    if (cause === "myisam") engines[0].engine = "MyISAM"; if (cause === "unsigned") cols.ops_monthly_profit_imports[0].columnType = "int unsigned";
    if (cause === "generated") cols.ops_monthly_import_artifacts.find(col => col.columnName === "manifest")!.extra = "STORED GENERATED";
    if (cause === "timestamp_on_update") cols.ops_monthly_profit_imports.find(col => col.columnName === "createdAt")!.extra = "DEFAULT_GENERATED on update CURRENT_TIMESTAMP(3)";
    if (cause === "prefix_unique") indexes.find(row => row.columnName === "auditId")!.prefixLength = 20;
    if (cause === "extra_unique") indexes.push(...index("ops_monthly_profit_imports", "unique_hash", ["fileHash"]));
    if (cause === "missing_scope_index") indexes = indexes.filter(row => !(row.tableName === "ops_monthly_profit_imports" && row.indexName === "scope"));
    if (cause === "required_extra") cols.ops_monthly_import_artifacts.push(column("mandatory", "int"));
    expect((await repository.options(context(), { expectedWorkspaceId: 7 })).capabilities.upload.status).toBe("unavailable"); expect(queries.some(query => /^(CREATE|ALTER|DROP)/u.test(query.sql))).toBe(false);
  });
  it("catalog errors are not mislabeled as missing tables", async () => { failAt.catalog = new Error("catalog denied"); await expect(repository.options(context(), { expectedWorkspaceId: 7 })).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" }); });
  it.each(["workspace", "prepared_uri", "payload_hash", "manifest_json"])("rejects corrupt artifact %s", async cause => { const batchId = await uploaded(); if (cause === "workspace") { const value = JSON.parse(String(artifacts[0].prepared)); value.identity.workspaceId = 8; artifacts[0].prepared = JSON.stringify(value); } if (cause === "prepared_uri") batches[0].fileUrl = "https://evil.example/file"; if (cause === "payload_hash") artifacts[0].payloadHash = "0".repeat(64); if (cause === "manifest_json") artifacts[0].manifest = "broken"; await expect(repository.inspect(context(), inspectInput(batchId))).rejects.toThrow(); expect(storage.download).not.toHaveBeenCalled(); });
  it("does not return native private object refs or audit metadata", async () => { const batchId = await uploaded(); const state = await repository.inspect(context(), inspectInput(batchId)); expect(JSON.stringify(state)).not.toContain("storage://"); expect(JSON.stringify(state)).not.toContain(monthlyFinancialImportHash({ secret: true })); });
});
