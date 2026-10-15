import { char, int, json, mysqlTable, timestamp, uniqueIndex, varchar } from "drizzle-orm/mysql-core";
import type { AssistantConfiguration } from "../../shared/assistantConfigurations";

/** Explicit feature migration only; importing these definitions never initializes data. */
export const emperorAssistantConfigurations = mysqlTable("emperor_assistant_configurations", {
  id: int("id").autoincrement().primaryKey(),
  workspaceId: int("workspaceId").notNull(),
  agentKey: varchar("agentKey", { length: 32 }).notNull(),
  revision: int("revision").notNull(),
  config: json("config").$type<AssistantConfiguration>().notNull(),
  configHash: char("configHash", { length: 64 }).notNull(),
  updatedBy: int("updatedBy").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, table => [uniqueIndex("uq_assistant_configuration_scope").on(table.workspaceId, table.agentKey)]);

export const emperorAssistantConfigurationVersions = mysqlTable("emperor_assistant_configuration_versions", {
  id: int("id").autoincrement().primaryKey(),
  workspaceId: int("workspaceId").notNull(),
  agentKey: varchar("agentKey", { length: 32 }).notNull(),
  revision: int("revision").notNull(),
  config: json("config").$type<AssistantConfiguration>().notNull(),
  configHash: char("configHash", { length: 64 }).notNull(),
  sourceRevision: int("sourceRevision"),
  createdBy: int("createdBy").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, table => [uniqueIndex("uq_assistant_configuration_version_scope").on(table.workspaceId, table.agentKey, table.revision)]);
