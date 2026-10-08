import {
  bigint,
  index,
  int,
  json,
  mysqlEnum,
  mysqlTable,
  timestamp,
  tinyint,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";

/** 0206: project/session-scoped optimistic revision for image-workflow changes. */
export const imageWorkflowVersionScopes = mysqlTable("image_workflow_version_scopes", {
  id: int("id").autoincrement().primaryKey(),
  workspaceId: int("workspaceId").notNull(),
  projectId: int("projectId").notNull(),
  sessionId: int("sessionId").notNull(),
  revision: int("revision").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, table => ({
  scopeUnique: uniqueIndex("uk_image_workflow_version_scope").on(table.workspaceId, table.projectId, table.sessionId),
  workspaceProjectIndex: index("idx_image_workflow_version_scope_workspace_project").on(table.workspaceId, table.projectId, table.updatedAt),
}));

/** 0206: append-only, human-confirmed content and dependency snapshots. */
export const imageWorkflowStageSnapshots = mysqlTable("image_workflow_stage_snapshots", {
  id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
  workspaceId: int("workspaceId").notNull(),
  projectId: int("projectId").notNull(),
  sessionId: int("sessionId").notNull(),
  step: tinyint("step").notNull(),
  version: int("version").notNull(),
  contentOrigin: mysqlEnum("contentOrigin", ["human_confirmed", "legacy_human_confirmed"]).notNull(),
  contentRevision: int("contentRevision").notNull(),
  contentJson: json("contentJson").notNull(),
  contentDigest: varchar("contentDigest", { length: 64 }).notNull(),
  assetDependenciesJson: json("assetDependenciesJson").notNull(),
  assetDependencyDigest: varchar("assetDependencyDigest", { length: 64 }).notNull(),
  dependenciesJson: json("dependenciesJson").notNull(),
  dependencyDigest: varchar("dependencyDigest", { length: 64 }).notNull(),
  snapshotDigest: varchar("snapshotDigest", { length: 64 }).notNull(),
  confirmedBy: int("confirmedBy").notNull(),
  confirmedAt: timestamp("confirmedAt").defaultNow().notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, table => ({
  versionUnique: uniqueIndex("uk_image_workflow_stage_snapshot_version").on(table.workspaceId, table.projectId, table.sessionId, table.step, table.version),
  digestUnique: uniqueIndex("uk_image_workflow_stage_snapshot_digest").on(table.workspaceId, table.projectId, table.sessionId, table.snapshotDigest),
  scopeStepIndex: index("idx_image_workflow_stage_snapshot_scope_step").on(table.workspaceId, table.projectId, table.sessionId, table.step, table.version),
}));

/** 0206: append-only state transitions; never rewrite an approved snapshot. */
export const imageWorkflowSnapshotStateEvents = mysqlTable("image_workflow_snapshot_state_events", {
  id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
  workspaceId: int("workspaceId").notNull(),
  projectId: int("projectId").notNull(),
  sessionId: int("sessionId").notNull(),
  snapshotDigest: varchar("snapshotDigest", { length: 64 }).notNull(),
  state: mysqlEnum("state", ["confirmed", "superseded", "invalidated"]).notNull(),
  reason: mysqlEnum("reason", ["content_version_changed", "upstream_content_version_changed", "image_purpose_version_changed", "snapshot_replaced"]).notNull(),
  actorId: int("actorId").notNull(),
  occurredAt: timestamp("occurredAt").defaultNow().notNull(),
}, table => ({
  scopeDigestIndex: index("idx_image_workflow_snapshot_event_scope_digest").on(table.workspaceId, table.projectId, table.sessionId, table.snapshotDigest, table.id),
  scopeStateIndex: index("idx_image_workflow_snapshot_event_scope_state").on(table.workspaceId, table.projectId, table.sessionId, table.state, table.occurredAt),
}));

export type ImageWorkflowVersionScopeRow = typeof imageWorkflowVersionScopes.$inferSelect;
export type ImageWorkflowStageSnapshotRow = typeof imageWorkflowStageSnapshots.$inferSelect;
export type ImageWorkflowSnapshotStateEventRow = typeof imageWorkflowSnapshotStateEvents.$inferSelect;
