import { index, int, json, mysqlEnum, mysqlTable, timestamp, uniqueIndex, varchar } from "drizzle-orm/mysql-core";

/**
 * Stable image-byte identity. Bytes are addressed once per workspace by
 * contentHash; semantic source roles and project-specific policy are modeled in
 * the companion tables below rather than duplicating stored bytes.
 */
export const imageAssets = mysqlTable("image_assets", {
  id: int("id").autoincrement().primaryKey(),
  assetId: varchar("assetId", { length: 80 }).notNull(),
  workspaceId: int("workspaceId").notNull(),
  assetType: mysqlEnum("assetType", ["image"]).default("image").notNull(),
  contentHash: varchar("contentHash", { length: 64 }),
  storageRef: varchar("storageRef", { length: 1024 }).notNull(),
  contentType: varchar("contentType", { length: 128 }),
  sizeBytes: int("sizeBytes"),
  width: int("width"),
  height: int("height"),
  createdBy: int("createdBy").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  workspaceAssetUnique: uniqueIndex("uk_image_asset_workspace_asset").on(table.workspaceId, table.assetId),
  workspaceContentHashUnique: uniqueIndex("uk_image_asset_workspace_hash").on(table.workspaceId, table.contentHash),
  workspaceCreatedIndex: index("idx_image_asset_workspace_created").on(table.workspaceId, table.createdAt),
}));

export const IMAGE_ASSET_ORIGIN_KINDS = [
  "competitor_research",
  "own_product",
  "approved_knowledge_reference",
  "designer_upload",
  "legacy_unclassified",
] as const;

export const IMAGE_ASSET_REVIEW_STATES = [
  "unclassified",
  "pending_review",
  "approved",
  "rejected",
  "revoked",
  "superseded",
] as const;

/**
 * Server-side consumers must require the current approved policy revision and
 * check this closed vocabulary before allowing an asset into a workflow step.
 */
export const IMAGE_ASSET_ALLOWED_USES = [
  "analysis_reference_only",
  "step4_reference",
  "designer_attachment",
  "first_party_listing",
  "first_party_aplus",
  "image_generation_input",
  "approved_deliverable",
] as const;

/**
 * Project-scoped immutable policy and human-review revision. A legacy raw URL
 * is represented only as legacy_unclassified/unclassified until a human creates
 * a newer, approved revision with an explicit allowed-use set.
 */
export const imageAssetPolicyRevisions = mysqlTable("image_asset_policy_revisions", {
  id: int("id").autoincrement().primaryKey(),
  assetId: varchar("assetId", { length: 80 }).notNull(),
  workspaceId: int("workspaceId").notNull(),
  projectId: int("projectId").notNull(),
  sourceReferenceId: int("sourceReferenceId"),
  originKind: mysqlEnum("originKind", IMAGE_ASSET_ORIGIN_KINDS).notNull(),
  originRecordType: varchar("originRecordType", { length: 64 }).notNull(),
  originRecordId: varchar("originRecordId", { length: 128 }).notNull(),
  contentHash: varchar("contentHash", { length: 64 }),
  allowedUsesJson: json("allowedUsesJson").notNull(),
  licenseEvidenceJson: json("licenseEvidenceJson"),
  reviewState: mysqlEnum("reviewState", IMAGE_ASSET_REVIEW_STATES).default("unclassified").notNull(),
  revision: int("revision").default(1).notNull(),
  policyHash: varchar("policyHash", { length: 64 }).notNull(),
  createdBy: int("createdBy").notNull(),
  reviewedBy: int("reviewedBy"),
  reviewedAt: timestamp("reviewedAt"),
  reviewNote: varchar("reviewNote", { length: 1024 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  scopeAssetRevisionUnique: uniqueIndex("uk_image_asset_policy_scope_asset_revision").on(
    table.workspaceId,
    table.projectId,
    table.assetId,
    table.revision,
  ),
  scopeReviewIndex: index("idx_image_asset_policy_scope_review").on(
    table.workspaceId,
    table.projectId,
    table.reviewState,
    table.updatedAt,
  ),
  assetRevisionIndex: index("idx_image_asset_policy_asset_revision").on(
    table.workspaceId,
    table.assetId,
    table.revision,
  ),
}));

/**
 * A semantic source reference never owns image bytes. Several references may
 * point at one assetId when identical bytes appear in distinct snapshot roles,
 * modules, or positions. sourceReferenceKey is the server-generated stable
 * identity of (sourceSnapshot, role, module, position) or its equivalent for a
 * controlled non-acquisition source.
 */
export const imageAssetSourceReferences = mysqlTable("image_asset_source_references", {
  id: int("id").autoincrement().primaryKey(),
  assetId: varchar("assetId", { length: 80 }).notNull(),
  workspaceId: int("workspaceId").notNull(),
  projectId: int("projectId").notNull(),
  sourceSnapshotId: int("sourceSnapshotId"),
  originRecordType: varchar("originRecordType", { length: 64 }).notNull(),
  originRecordId: varchar("originRecordId", { length: 128 }).notNull(),
  sourceRole: mysqlEnum("sourceRole", ["main", "secondary", "aplus", "brand_story", "video", "unknown"]).default("unknown").notNull(),
  sourceModule: varchar("sourceModule", { length: 128 }).default("").notNull(),
  sourcePosition: int("sourcePosition").notNull(),
  sourceReferenceKey: varchar("sourceReferenceKey", { length: 128 }).notNull(),
  createdBy: int("createdBy").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  scopedReferenceUnique: uniqueIndex("uk_image_asset_source_reference_scope_key").on(
    table.workspaceId,
    table.projectId,
    table.sourceReferenceKey,
  ),
  assetScopeIndex: index("idx_image_asset_source_asset_scope").on(
    table.workspaceId,
    table.projectId,
    table.assetId,
    table.createdAt,
  ),
  snapshotRolePositionIndex: index("idx_image_asset_source_snapshot_role_position").on(
    table.workspaceId,
    table.sourceSnapshotId,
    table.sourceRole,
    table.sourceModule,
    table.sourcePosition,
  ),
}));

export const IMAGE_ACQUISITION_COVERAGE_STATES = [
  "not_requested",
  "returned",
  "confirmed_absent",
  "not_returned",
  "provider_unsupported",
  "download_failed",
  "pending_supplement",
  "manually_supplemented",
] as const;

export const IMAGE_ACQUISITION_COVERAGE_CAPABILITIES = [
  "image_gallery",
  "aplus",
  "brand_story",
] as const;

/**
 * Immutable per-capability coverage record for a project consuming a source
 * snapshot. It records partial/failed coverage without rewriting the existing
 * acquisition snapshot or consumer-link tables.
 */
export const imageAcquisitionCapabilityCoverageRevisions = mysqlTable("image_acquisition_capability_coverage_revisions", {
  id: int("id").autoincrement().primaryKey(),
  workspaceId: int("workspaceId").notNull(),
  projectId: int("projectId").notNull(),
  sourceSnapshotId: int("sourceSnapshotId").notNull(),
  confirmedSnapshotId: int("confirmedSnapshotId"),
  consumerLinkId: int("consumerLinkId"),
  capability: mysqlEnum("capability", IMAGE_ACQUISITION_COVERAGE_CAPABILITIES).notNull(),
  coverageState: mysqlEnum("coverageState", IMAGE_ACQUISITION_COVERAGE_STATES).notNull(),
  roleCoverageJson: json("roleCoverageJson").notNull(),
  coverageHash: varchar("coverageHash", { length: 64 }).notNull(),
  revision: int("revision").default(1).notNull(),
  createdBy: int("createdBy").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  snapshotCapabilityRevisionUnique: uniqueIndex("uk_image_acq_coverage_snapshot_cap_revision").on(
    table.workspaceId,
    table.projectId,
    table.sourceSnapshotId,
    table.capability,
    table.revision,
  ),
  scopeStateIndex: index("idx_image_acq_coverage_scope_state").on(
    table.workspaceId,
    table.projectId,
    table.coverageState,
    table.createdAt,
  ),
  consumerIndex: index("idx_image_acq_coverage_consumer").on(
    table.workspaceId,
    table.consumerLinkId,
    table.createdAt,
  ),
}));

export type ImageAsset = typeof imageAssets.$inferSelect;
export type InsertImageAsset = typeof imageAssets.$inferInsert;
export type ImageAssetPolicyRevision = typeof imageAssetPolicyRevisions.$inferSelect;
export type InsertImageAssetPolicyRevision = typeof imageAssetPolicyRevisions.$inferInsert;
export type ImageAssetSourceReference = typeof imageAssetSourceReferences.$inferSelect;
export type InsertImageAssetSourceReference = typeof imageAssetSourceReferences.$inferInsert;
export type ImageAcquisitionCapabilityCoverageRevision = typeof imageAcquisitionCapabilityCoverageRevisions.$inferSelect;
export type InsertImageAcquisitionCapabilityCoverageRevision = typeof imageAcquisitionCapabilityCoverageRevisions.$inferInsert;
