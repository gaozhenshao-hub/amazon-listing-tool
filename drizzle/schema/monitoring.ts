import { bigint, decimal, index, int, json, mysqlEnum, mysqlTable, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/mysql-core";
import { currentOpsWorkspaceId } from "../../server/domains/ops/workspaceContext";

export const amazonMonitorSchedules = mysqlTable("amazon_monitor_schedules", {
  id: int("id").autoincrement().primaryKey(),
  workspaceId: int("workspace_id").$defaultFn(currentOpsWorkspaceId).notNull(),
  monitorKind: mysqlEnum("monitor_kind", ["competitor", "keyword"]).notNull(),
  monitorId: int("monitor_id").notNull(),
  ownerUserId: int("owner_user_id").notNull(),
  frequency: mysqlEnum("frequency", ["manual", "daily", "weekly"]).default("manual").notNull(),
  cronExpression: varchar("cron_expression", { length: 64 }),
  heartbeatTaskUid: varchar("heartbeat_task_uid", { length: 128 }),
  status: mysqlEnum("status", ["draft", "active", "paused", "error", "retired"]).default("draft").notNull(),
  nextRunAt: timestamp("next_run_at"),
  lastHeartbeatAt: timestamp("last_heartbeat_at"),
  lastQueuedRunId: int("last_queued_run_id"),
  lastError: text("last_error"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
}, (table) => [
  uniqueIndex("uk_amazon_monitor_schedule_owner").on(table.workspaceId, table.monitorKind, table.monitorId),
  uniqueIndex("uk_amazon_monitor_schedule_task").on(table.heartbeatTaskUid),
  index("idx_amazon_monitor_schedule_status").on(table.workspaceId, table.status, table.nextRunAt),
]);

export const amazonMonitorRuns = mysqlTable("amazon_monitor_runs", {
  id: int("id").autoincrement().primaryKey(),
  workspaceId: int("workspace_id").$defaultFn(currentOpsWorkspaceId).notNull(),
  monitorKind: mysqlEnum("monitor_kind", ["competitor", "keyword"]).notNull(),
  monitorId: int("monitor_id"),
  triggerType: mysqlEnum("trigger_type", ["manual", "schedule", "qualification"]).notNull(),
  providerProfileId: int("provider_profile_id").notNull(),
  requestedBy: int("requested_by").notNull(),
  marketplace: varchar("marketplace", { length: 16 }).notNull(),
  asin: varchar("asin", { length: 20 }).notNull(),
  keyword: varchar("keyword", { length: 500 }),
  postalCode: varchar("postal_code", { length: 20 }),
  depth: int("depth"),
  requestedCapabilities: json("requested_capabilities").notNull(),
  idempotencyKey: varchar("idempotency_key", { length: 128 }).notNull(),
  status: mysqlEnum("status", ["queued", "running", "succeeded", "partial", "failed", "canceled"]).default("queued").notNull(),
  providerRunId: varchar("provider_run_id", { length: 128 }),
  providerRequestHash: varchar("provider_request_hash", { length: 64 }).notNull(),
  estimatedMaxUsd: decimal("estimated_max_usd", { precision: 12, scale: 4 }),
  maxChargeUsd: decimal("max_charge_usd", { precision: 12, scale: 4 }).notNull(),
  chargedUsd: decimal("charged_usd", { precision: 12, scale: 4 }),
  rawStorageKey: varchar("raw_storage_key", { length: 1024 }),
  rawContentHash: varchar("raw_content_hash", { length: 64 }),
  rawContentType: varchar("raw_content_type", { length: 128 }),
  rawSizeBytes: bigint("raw_size_bytes", { mode: "number" }),
  normalizedResult: json("normalized_result"),
  failureCategory: varchar("failure_category", { length: 64 }),
  aiJobRunId: varchar("ai_job_run_id", { length: 64 }),
  agentRunId: varchar("agent_run_id", { length: 64 }),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
}, (table) => [
  uniqueIndex("uk_amazon_monitor_run_idem").on(table.workspaceId, table.idempotencyKey),
  index("idx_amazon_monitor_run_subject").on(table.workspaceId, table.monitorKind, table.monitorId, table.createdAt),
  index("idx_amazon_monitor_run_status").on(table.workspaceId, table.status, table.createdAt),
  index("idx_amazon_monitor_run_provider").on(table.providerProfileId, table.providerRunId),
]);

export type AmazonMonitorSchedule = typeof amazonMonitorSchedules.$inferSelect;
export type AmazonMonitorRun = typeof amazonMonitorRuns.$inferSelect;
