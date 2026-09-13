import { decimal, index, int, json, mysqlEnum, mysqlTable, text, timestamp, uniqueIndex, varchar, bigint } from "drizzle-orm/mysql-core";
import { currentOpsWorkspaceId } from "../../server/domains/ops/workspaceContext";

export const acquisitionProviderProfiles = mysqlTable("acquisition_provider_profiles", {
  id: int("id").autoincrement().primaryKey(),
  workspaceId: int("workspace_id").$defaultFn(currentOpsWorkspaceId).notNull(),
  profileKey: varchar("profile_key", { length: 64 }).notNull(),
  providerCode: varchar("provider_code", { length: 64 }).notNull(),
  displayName: varchar("display_name", { length: 128 }).notNull(),
  status: mysqlEnum("status", ["draft", "qualification_pending", "active", "paused", "rejected"]).default("draft").notNull(),
  secretRef: varchar("secret_ref", { length: 255 }),
  actorName: varchar("actor_name", { length: 255 }),
  capabilities: json("capabilities").notNull(),
  providerSettings: json("provider_settings"),
  perRunMaxUsd: decimal("per_run_max_usd", { precision: 12, scale: 4 }),
  dailyBudgetUsd: decimal("daily_budget_usd", { precision: 12, scale: 4 }),
  monthlyBudgetUsd: decimal("monthly_budget_usd", { precision: 12, scale: 4 }),
  cacheTtlSeconds: int("cache_ttl_seconds").default(86400).notNull(),
  qualificationVersion: varchar("qualification_version", { length: 64 }),
  lastQualifiedAt: timestamp("last_qualified_at"),
  createdBy: int("created_by").notNull(),
  updatedBy: int("updated_by").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
}, (table) => [
  uniqueIndex("uk_acq_profile_ws_key").on(table.workspaceId, table.profileKey),
  index("idx_acq_profile_ws_status").on(table.workspaceId, table.status),
]);

export const acquisitionJobs = mysqlTable("acquisition_jobs", {
  id: int("id").autoincrement().primaryKey(),
  workspaceId: int("workspace_id").$defaultFn(currentOpsWorkspaceId).notNull(),
  requestedBy: int("requested_by").notNull(),
  providerProfileId: int("provider_profile_id"),
  consumerType: varchar("consumer_type", { length: 64 }).notNull(),
  consumerRef: varchar("consumer_ref", { length: 128 }).notNull(),
  marketplace: varchar("marketplace", { length: 16 }).notNull(),
  asin: varchar("asin", { length: 20 }).notNull(),
  requestedCapabilities: json("requested_capabilities").notNull(),
  idempotencyKey: varchar("idempotency_key", { length: 128 }).notNull(),
  status: mysqlEnum("status", ["queued", "running", "review_required", "confirmed", "failed", "canceled"]).default("queued").notNull(),
  priority: int("priority").default(100).notNull(),
  cachePolicy: mysqlEnum("cache_policy", ["prefer_cache", "refresh", "cache_only"]).default("prefer_cache").notNull(),
  maxChargeUsd: decimal("max_charge_usd", { precision: 12, scale: 4 }),
  cacheHitSnapshotId: int("cache_hit_snapshot_id"),
  requestedAt: timestamp("requested_at").defaultNow().notNull(),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
}, (table) => [
  uniqueIndex("uk_acq_job_ws_idem").on(table.workspaceId, table.idempotencyKey),
  index("idx_acq_job_ws_status").on(table.workspaceId, table.status, table.createdAt),
  index("idx_acq_job_subject").on(table.workspaceId, table.marketplace, table.asin, table.createdAt),
]);

export const acquisitionRuns = mysqlTable("acquisition_runs", {
  id: int("id").autoincrement().primaryKey(),
  workspaceId: int("workspace_id").$defaultFn(currentOpsWorkspaceId).notNull(),
  jobId: int("job_id").notNull(),
  providerProfileId: int("provider_profile_id").notNull(),
  attempt: int("attempt").notNull(),
  providerRunId: varchar("provider_run_id", { length: 128 }),
  providerRequestHash: varchar("provider_request_hash", { length: 64 }).notNull(),
  status: mysqlEnum("status", ["queued", "running", "succeeded", "partial", "failed", "canceled"]).default("queued").notNull(),
  failureCategory: varchar("failure_category", { length: 64 }),
  estimatedMaxUsd: decimal("estimated_max_usd", { precision: 12, scale: 4 }),
  chargedUsd: decimal("charged_usd", { precision: 12, scale: 4 }),
  resultCount: int("result_count"),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("uk_acq_run_job_attempt").on(table.jobId, table.attempt),
  index("idx_acq_run_provider_run").on(table.providerProfileId, table.providerRunId),
  index("idx_acq_run_ws_status").on(table.workspaceId, table.status, table.createdAt),
]);

export const acquisitionRawArtifacts = mysqlTable("acquisition_raw_artifacts", {
  id: int("id").autoincrement().primaryKey(),
  workspaceId: int("workspace_id").$defaultFn(currentOpsWorkspaceId).notNull(),
  runId: int("run_id").notNull(),
  artifactKind: varchar("artifact_kind", { length: 64 }).notNull(),
  storageKey: varchar("storage_key", { length: 1024 }).notNull(),
  contentHash: varchar("content_hash", { length: 64 }).notNull(),
  contentType: varchar("content_type", { length: 128 }).notNull(),
  sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
  schemaFingerprint: varchar("schema_fingerprint", { length: 64 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("uk_acq_artifact_run_hash").on(table.runId, table.artifactKind, table.contentHash),
  index("idx_acq_artifact_ws_run").on(table.workspaceId, table.runId),
]);

export const acquisitionSourceSnapshots = mysqlTable("acquisition_source_snapshots", {
  id: int("id").autoincrement().primaryKey(),
  workspaceId: int("workspace_id").$defaultFn(currentOpsWorkspaceId).notNull(),
  jobId: int("job_id").notNull(),
  runId: int("run_id").notNull(),
  rawArtifactId: int("raw_artifact_id").notNull(),
  marketplace: varchar("marketplace", { length: 16 }).notNull(),
  asin: varchar("asin", { length: 20 }).notNull(),
  schemaVersion: varchar("schema_version", { length: 64 }).notNull(),
  sourceHash: varchar("source_hash", { length: 64 }).notNull(),
  normalizedData: json("normalized_data").notNull(),
  fieldStatuses: json("field_statuses").notNull(),
  completeness: json("completeness"),
  status: mysqlEnum("status", ["draft", "pending_review", "confirmed", "rejected", "superseded"]).default("draft").notNull(),
  reviewedBy: int("reviewed_by"),
  reviewedAt: timestamp("reviewed_at"),
  reviewNote: text("review_note"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
}, (table) => [
  uniqueIndex("uk_acq_snapshot_run_source").on(table.runId, table.sourceHash),
  index("idx_acq_snapshot_subject").on(table.workspaceId, table.marketplace, table.asin, table.createdAt),
  index("idx_acq_snapshot_job").on(table.jobId, table.status),
]);

export const acquisitionAssetCandidates = mysqlTable("acquisition_asset_candidates", {
  id: int("id").autoincrement().primaryKey(),
  workspaceId: int("workspace_id").$defaultFn(currentOpsWorkspaceId).notNull(),
  snapshotId: int("snapshot_id").notNull(),
  sourceArtifactId: int("source_artifact_id").notNull(),
  role: mysqlEnum("role", ["main", "secondary", "aplus", "brand_story", "video", "unknown"]).default("unknown").notNull(),
  positionIndex: int("position_index").notNull(),
  sourceJsonPath: varchar("source_json_path", { length: 512 }).notNull(),
  sourceUrlHash: varchar("source_url_hash", { length: 64 }).notNull(),
  providerAssetId: varchar("provider_asset_id", { length: 255 }),
  storageKey: varchar("storage_key", { length: 1024 }),
  contentHash: varchar("content_hash", { length: 64 }),
  contentType: varchar("content_type", { length: 128 }),
  sizeBytes: bigint("size_bytes", { mode: "number" }),
  width: int("width"),
  height: int("height"),
  moduleType: varchar("module_type", { length: 64 }),
  moduleClass: varchar("module_class", { length: 128 }),
  fieldStatus: varchar("field_status", { length: 64 }).notNull(),
  reviewStatus: mysqlEnum("review_status", ["pending", "approved", "rejected"]).default("pending").notNull(),
  reviewedBy: int("reviewed_by"),
  reviewedAt: timestamp("reviewed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
}, (table) => [
  uniqueIndex("uk_acq_asset_snapshot_role_pos").on(table.snapshotId, table.role, table.positionIndex),
  index("idx_acq_asset_snapshot_status").on(table.snapshotId, table.reviewStatus),
  index("idx_acq_asset_content_hash").on(table.workspaceId, table.contentHash),
]);

export const acquisitionSnapshotRevisions = mysqlTable("acquisition_snapshot_revisions", {
  id: int("id").autoincrement().primaryKey(),
  workspaceId: int("workspace_id").$defaultFn(currentOpsWorkspaceId).notNull(),
  snapshotId: int("snapshot_id").notNull(),
  version: int("version").notNull(),
  baseContentHash: varchar("base_content_hash", { length: 64 }).notNull(),
  patch: json("patch").notNull(),
  revisionHash: varchar("revision_hash", { length: 64 }).notNull(),
  reasonCode: varchar("reason_code", { length: 64 }).notNull(),
  note: text("note"),
  createdBy: int("created_by").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("uk_acq_revision_snapshot_ver").on(table.snapshotId, table.version),
  index("idx_acq_revision_ws_created").on(table.workspaceId, table.createdAt),
]);

export const acquisitionConfirmedSnapshots = mysqlTable("acquisition_confirmed_snapshots", {
  id: int("id").autoincrement().primaryKey(),
  workspaceId: int("workspace_id").$defaultFn(currentOpsWorkspaceId).notNull(),
  snapshotId: int("snapshot_id").notNull(),
  revisionId: int("revision_id"),
  marketplace: varchar("marketplace", { length: 16 }).notNull(),
  asin: varchar("asin", { length: 20 }).notNull(),
  confirmationVersion: int("confirmation_version").notNull(),
  contentHash: varchar("content_hash", { length: 64 }).notNull(),
  confirmedData: json("confirmed_data").notNull(),
  fieldStatuses: json("field_statuses").notNull(),
  confirmedAssetIds: json("confirmed_asset_ids").notNull(),
  isCurrent: int("is_current").default(1).notNull(),
  confirmedBy: int("confirmed_by").notNull(),
  confirmedAt: timestamp("confirmed_at").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("uk_acq_confirmed_snapshot_ver").on(table.snapshotId, table.confirmationVersion),
  index("idx_acq_confirmed_subject").on(table.workspaceId, table.marketplace, table.asin, table.isCurrent),
]);

export const acquisitionConsumerLinks = mysqlTable("acquisition_consumer_links", {
  id: int("id").autoincrement().primaryKey(),
  workspaceId: int("workspace_id").$defaultFn(currentOpsWorkspaceId).notNull(),
  confirmedSnapshotId: int("confirmed_snapshot_id").notNull(),
  consumerType: varchar("consumer_type", { length: 64 }).notNull(),
  consumerRef: varchar("consumer_ref", { length: 128 }).notNull(),
  capabilityScope: varchar("capability_scope", { length: 64 }).notNull(),
  projectionVersion: varchar("projection_version", { length: 64 }).notNull(),
  status: mysqlEnum("status", ["active", "superseded", "detached"]).default("active").notNull(),
  createdBy: int("created_by").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
}, (table) => [
  uniqueIndex("uk_acq_consumer_link").on(
    table.workspaceId,
    table.consumerType,
    table.consumerRef,
    table.capabilityScope,
    table.confirmedSnapshotId,
  ),
  index("idx_acq_consumer_snapshot").on(table.confirmedSnapshotId, table.status),
]);

export type AcquisitionProviderProfile = typeof acquisitionProviderProfiles.$inferSelect;
export type AcquisitionJob = typeof acquisitionJobs.$inferSelect;
export type AcquisitionRun = typeof acquisitionRuns.$inferSelect;
export type AcquisitionRawArtifact = typeof acquisitionRawArtifacts.$inferSelect;
export type AcquisitionSourceSnapshot = typeof acquisitionSourceSnapshots.$inferSelect;
export type AcquisitionAssetCandidate = typeof acquisitionAssetCandidates.$inferSelect;
export type AcquisitionSnapshotRevision = typeof acquisitionSnapshotRevisions.$inferSelect;
export type AcquisitionConfirmedSnapshot = typeof acquisitionConfirmedSnapshots.$inferSelect;
export type AcquisitionConsumerLink = typeof acquisitionConsumerLinks.$inferSelect;
