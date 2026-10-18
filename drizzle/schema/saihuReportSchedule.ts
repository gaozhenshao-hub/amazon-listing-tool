import {
  mysqlTable,
  char,
  int,
  varchar,
  bigint,
  json,
  datetime,
  index,
} from "drizzle-orm/mysql-core";
/** Candidate only: not central exported, registered, or executed. */
export const opsSaihuReportSchedules = mysqlTable(
  "ops_saihu_report_schedules",
  {
    planId: char("plan_id", { length: 36 }).primaryKey(),
    workspaceId: int("workspace_id").notNull(),
    userId: int("user_id").notNull(),
    revision: int("revision").notNull(),
    status: varchar("status", { length: 20 }).notNull(),
    nextRunAt: bigint("next_run_at", { mode: "number" }),
    body: json("body").notNull(),
    bodyHash: char("body_hash", { length: 64 }).notNull(),
    createdAt: datetime("created_at", { mode: "string", fsp: 3 }).notNull(),
    updatedAt: datetime("updated_at", { mode: "string", fsp: 3 }).notNull(),
  },
  table => [
    index("ops_saihu_report_plan_owner_idx").on(
      table.workspaceId,
      table.userId,
      table.planId
    ),
    index("ops_saihu_report_plan_due_idx").on(
      table.status,
      table.nextRunAt,
      table.workspaceId,
      table.planId
    ),
  ]
);
