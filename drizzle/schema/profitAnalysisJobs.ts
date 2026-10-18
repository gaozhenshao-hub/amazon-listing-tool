import { char, datetime, index, int, json, mysqlEnum, mysqlTable, uniqueIndex, varchar } from "drizzle-orm/mysql-core";

/** Candidate private persistence only; importing this file never migrates or starts a worker. */
export const profitAnalysisReports = mysqlTable("ops_profit_analysis_reports", {
  id: int("id").autoincrement().primaryKey(), workspaceId: int("workspace_id").notNull(), userId: int("user_id").notNull(),
  scopeHash: char("scope_hash", { length: 64 }).notNull(), target: json("target_snapshot").notNull(), version: int("version").notNull(),
  activeOperationId: char("active_operation_id", { length: 36 }), latestOperationId: char("latest_operation_id", { length: 36 }), savedOperationId: char("saved_operation_id", { length: 36 }),
  createdAt: datetime("created_at", { mode: "string", fsp: 3 }).notNull(), updatedAt: datetime("updated_at", { mode: "string", fsp: 3 }).notNull(), savedAt: datetime("saved_at", { mode: "string", fsp: 3 }),
}, table => [uniqueIndex("uq_profit_report_scope").on(table.workspaceId, table.userId, table.scopeHash)]);
export const profitAnalysisRuns = mysqlTable("ops_profit_analysis_runs", {
  id: int("id").autoincrement().primaryKey(), workspaceId: int("workspace_id").notNull(), userId: int("user_id").notNull(),
  scopeHash: char("scope_hash", { length: 64 }).notNull(), target: json("target_snapshot").notNull(), operationId: char("operation_id", { length: 36 }).notNull(),
  requestHash: char("request_hash", { length: 64 }), snapshotHash: char("snapshot_hash", { length: 64 }), request: json("request_snapshot"), snapshot: json("snapshot"),
  state: mysqlEnum("state", ["queued", "dispatched", "result_ready", "succeeded", "failed", "canceled", "unknown"]).notNull(),
  leaseToken: char("lease_token", { length: 36 }), leaseOwner: varchar("lease_owner", { length: 128 }), attempt: int("attempt").notNull(),
  leaseExpiresAt: datetime("lease_expires_at", { mode: "string", fsp: 3 }), heartbeatAt: datetime("heartbeat_at", { mode: "string", fsp: 3 }),
  dispatchReceipt: json("dispatch_receipt"), result: json("result_snapshot"), resultHash: char("result_hash", { length: 64 }), errorCode: varchar("error_code", { length: 100 }),
  createdAt: datetime("created_at", { mode: "string", fsp: 3 }).notNull(), updatedAt: datetime("updated_at", { mode: "string", fsp: 3 }).notNull(), completedAt: datetime("completed_at", { mode: "string", fsp: 3 }),
}, table => [uniqueIndex("uq_profit_run_operation").on(table.workspaceId, table.userId, table.operationId), index("ix_profit_run_history").on(table.workspaceId, table.userId, table.scopeHash, table.id), index("ix_profit_run_queue").on(table.state, table.leaseExpiresAt, table.id)]);
export const profitAnalysisSaveOperations = mysqlTable("ops_profit_analysis_save_operations", {
  id: int("id").autoincrement().primaryKey(), workspaceId: int("workspace_id").notNull(), userId: int("user_id").notNull(),
  scopeHash: char("scope_hash", { length: 64 }).notNull(), target: json("target_snapshot").notNull(), saveOperationId: char("save_operation_id", { length: 36 }).notNull(),
  runOperationId: char("run_operation_id", { length: 36 }), requestHash: char("request_hash", { length: 64 }), request: json("request_snapshot"),
  status: mysqlEnum("status", ["committed", "canceled"]).notNull(), reportVersion: int("report_version"), resultHash: char("result_hash", { length: 64 }),
  savedAt: datetime("saved_at", { mode: "string", fsp: 3 }),
  createdAt: datetime("created_at", { mode: "string", fsp: 3 }).notNull(),
}, table => [uniqueIndex("uq_profit_save_operation").on(table.workspaceId, table.userId, table.saveOperationId)]);
