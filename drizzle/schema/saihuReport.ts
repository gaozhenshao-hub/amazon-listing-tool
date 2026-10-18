import {
  int,
  json,
  mysqlTable,
  varchar,
  char,
  datetime,
  index,
  uniqueIndex,
} from "drizzle-orm/mysql-core";

/** Candidate schema only. Deliberately not exported by the central schema or
 * migration runner until the physical-table admission has been approved. */
export const opsSaihuDailyReportBatches = mysqlTable(
  "ops_saihu_daily_report_batches",
  {
    id: int("id").autoincrement().primaryKey(),
    workspaceId: int("workspace_id").notNull(),
    userId: int("user_id").notNull(),
    runId: varchar("run_id", { length: 80 }).notNull(),
    operationId: char("operation_id", { length: 36 }).notNull(),
    status: varchar("status", { length: 20 }).notNull(),
    sourceHash: char("source_hash", { length: 64 }).notNull(),
    previewHash: char("preview_hash", { length: 64 }).notNull(),
    scope: json("scope").notNull(),
    coverage: json("coverage").notNull(),
    facts: json("facts").notNull(),
    createdAt: datetime("created_at", { mode: "string", fsp: 3 }).notNull(),
    confirmedAt: datetime("confirmed_at", { mode: "string", fsp: 3 }),
  },
  table => [
    uniqueIndex("ops_saihu_daily_run_uq").on(table.runId),
    index("ops_saihu_daily_scope_idx").on(
      table.workspaceId,
      table.status,
      table.id
    ),
  ]
);
