import {
  index,
  int,
  mysqlEnum,
  mysqlTable,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";

/**
 * This ledger is deliberately separate from image_assets and policy revisions.
 * A row is created only by the controlled server upload path after it has
 * decoded the exact uploaded bytes and stored the resulting object.
 */
export const CONTROLLED_IMAGE_ASSET_KINDS = [
  "step4-ref",
  "designer",
  "expression-group",
] as const;

export const CONTROLLED_IMAGE_UPLOAD_PURPOSES = [
  "step4_reference",
  "designer_attachment",
  "expression_group_research",
] as const;

export const IMAGE_LICENSE_EVIDENCE_STATUSES = [
  "pending_review",
  "verified",
  "rejected",
  "revoked",
] as const;

export const IMAGE_LICENSE_EVIDENCE_ORIGIN_KINDS = [
  "own_product",
  "designer_upload",
] as const;

/**
 * Server-side, byte-bound receipt ledger. receiptKey is the storage key carried
 * by the existing HMAC receipt; its globally unique index makes attempts to
 * overwrite/reuse a controlled storage key a conflict rather than an upsert.
 */
export const imageControlledUploadReceipts = mysqlTable(
  "image_controlled_upload_receipts",
  {
    id: int("id").autoincrement().primaryKey(),
    workspaceId: int("workspaceId").notNull(),
    projectId: int("projectId").notNull(),
    uploadedBy: int("uploadedBy").notNull(),
    receiptKey: varchar("receiptKey", { length: 512 }).notNull(),
    assetKind: mysqlEnum("assetKind", CONTROLLED_IMAGE_ASSET_KINDS).notNull(),
    intendedUse: mysqlEnum(
      "intendedUse",
      CONTROLLED_IMAGE_UPLOAD_PURPOSES
    ).notNull(),
    storageKey: varchar("storageKey", { length: 512 }).notNull(),
    storageUri: varchar("storageUri", { length: 1024 }).notNull(),
    contentHash: varchar("contentHash", { length: 64 }).notNull(),
    contentType: varchar("contentType", { length: 128 }).notNull(),
    sizeBytes: int("sizeBytes").notNull(),
    width: int("width").notNull(),
    height: int("height").notNull(),
    expiresAt: timestamp("expiresAt").notNull(),
    revokedAt: timestamp("revokedAt"),
    revokedBy: int("revokedBy"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    storageKeyUnique: uniqueIndex("uk_controlled_image_upload_storage_key").on(
      table.storageKey
    ),
    scopeReceiptIndex: index("idx_controlled_image_upload_scope_receipt").on(
      table.workspaceId,
      table.projectId,
      table.uploadedBy,
      table.receiptKey,
      table.assetKind
    ),
    scopeHashIndex: index("idx_controlled_image_upload_scope_hash").on(
      table.workspaceId,
      table.projectId,
      table.contentHash
    ),
  })
);

/**
 * Immutable revisions of a server-created evidence family. A client receives
 * only evidenceRecordId; authorization is never inferred from that identifier.
 * The latest revision must be manually verified and bound to the exact upload
 * receipt/content hash/current project before it can support a policy approval.
 */
export const imageAssetLicenseEvidenceRevisions = mysqlTable(
  "image_asset_license_evidence_revisions",
  {
    id: int("id").autoincrement().primaryKey(),
    evidenceRecordId: varchar("evidenceRecordId", { length: 96 }).notNull(),
    version: int("version").notNull(),
    workspaceId: int("workspaceId").notNull(),
    projectId: int("projectId").notNull(),
    controlledUploadReceiptId: int("controlledUploadReceiptId").notNull(),
    assetId: varchar("assetId", { length: 80 }).notNull(),
    assetContentHash: varchar("assetContentHash", { length: 64 }).notNull(),
    assetOriginKind: mysqlEnum(
      "assetOriginKind",
      IMAGE_LICENSE_EVIDENCE_ORIGIN_KINDS
    ).notNull(),
    proofType: varchar("proofType", { length: 64 }).notNull(),
    proofMaterialStorageUri: varchar("proofMaterialStorageUri", {
      length: 1024,
    }).notNull(),
    proofMaterialSha256: varchar("proofMaterialSha256", {
      length: 64,
    }).notNull(),
    authorizationStatement: varchar("authorizationStatement", {
      length: 4096,
    }).notNull(),
    status: mysqlEnum("status", IMAGE_LICENSE_EVIDENCE_STATUSES).notNull(),
    reviewedBy: int("reviewedBy"),
    reviewedAt: timestamp("reviewedAt"),
    reviewNote: varchar("reviewNote", { length: 1024 }),
    expiresAt: timestamp("expiresAt"),
    createdBy: int("createdBy").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    evidenceVersionUnique: uniqueIndex(
      "uk_image_license_evidence_record_version"
    ).on(table.evidenceRecordId, table.version),
    scopeAssetStatusIndex: index(
      "idx_image_license_evidence_scope_asset_status"
    ).on(
      table.workspaceId,
      table.projectId,
      table.controlledUploadReceiptId,
      table.assetId,
      table.status,
      table.version
    ),
    scopeReviewIndex: index("idx_image_license_evidence_scope_review").on(
      table.workspaceId,
      table.projectId,
      table.status,
      table.reviewedAt
    ),
  })
);

export type ControlledImageUploadReceipt =
  typeof imageControlledUploadReceipts.$inferSelect;
export type InsertControlledImageUploadReceipt =
  typeof imageControlledUploadReceipts.$inferInsert;
export type ImageAssetLicenseEvidenceRevision =
  typeof imageAssetLicenseEvidenceRevisions.$inferSelect;
export type InsertImageAssetLicenseEvidenceRevision =
  typeof imageAssetLicenseEvidenceRevisions.$inferInsert;
