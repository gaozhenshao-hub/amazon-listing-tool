import { sql } from "drizzle-orm";
import { bigint, date, datetime, int, json, mysqlTable, uniqueIndex, varchar } from "drizzle-orm/mysql-core";

export const opsWorkJournals = mysqlTable("ops_work_journals", {
  id: bigint("id", { mode: "number", unsigned: true }).autoincrement().primaryKey(),
  workspaceId: int("workspace_id").notNull(),
  ownerId: int("owner_id").notNull(),
  kind: varchar("kind", { length: 12 }).notNull(),
  periodDate: date("period_date", { mode: "string" }).notNull(),
  content: json("content").notNull(),
  revision: int("revision", { unsigned: true }).notNull().default(1),
  lastRequestId: varchar("last_request_id", { length: 36 }).notNull(),
  updatedBy: int("updated_by").notNull(),
  createdAt: datetime("created_at", { fsp: 3 }).notNull().default(sql`CURRENT_TIMESTAMP(3)`),
  updatedAt: datetime("updated_at", { fsp: 3 }).notNull().default(sql`CURRENT_TIMESTAMP(3)`),
}, table => [uniqueIndex("ops_journal_owner_period").on(table.workspaceId, table.ownerId, table.kind, table.periodDate)]);
