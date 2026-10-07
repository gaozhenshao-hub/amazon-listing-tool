import { index, int, json, mysqlEnum, mysqlTable, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/mysql-core";

/**
 * Complete listing payload contract. Snapshot writers must include every current
 * listings-table field in fullPayloadJson; adding a listings column requires
 * extending this array and its contract test in the same change.
 */
export const listingCompleteSnapshotPayloadFieldNames = [
  "id",
  "projectId",
  "title",
  "itemHighlights",
  "bulletPoints",
  "description",
  "searchTerms",
  "imageAdvice",
  "imageAdviceCn",
  "titleCn",
  "itemHighlightsCn",
  "bulletPointsCn",
  "descriptionCn",
  "searchTermsCn",
  "qaContent",
  "qaContentCn",
  "lockedSteps",
  "checklistScores",
  "agentRunId",
  "version",
  "isActive",
  "createdAt",
  "updatedAt",
] as const;

/** Immutable, source-grounded facts awaiting or carrying human review. */
export const listingFactRevisions = mysqlTable("listing_fact_revisions", {
  id: int("id").autoincrement().primaryKey(),
  workspaceId: int("workspaceId").notNull(),
  projectId: int("projectId").notNull(),
  attributeKey: varchar("attributeKey", { length: 160 }).notNull(),
  value: text("value").notNull(),
  valueJson: json("valueJson"),
  sourceFileId: int("sourceFileId"),
  proofFileId: int("proofFileId"),
  proofSourceRef: varchar("proofSourceRef", { length: 512 }),
  rawHash: varchar("rawHash", { length: 64 }),
  sourceLine: int("sourceLine"),
  sourceLineHash: varchar("sourceLineHash", { length: 64 }),
  sourceLocator: varchar("sourceLocator", { length: 512 }),
  provenance: mysqlEnum("provenance", ["manual", "upload", "ai", "legacy"]).default("manual").notNull(),
  status: mysqlEnum("status", ["draft", "confirmed", "rejected", "stale", "legacy_unverified"]).default("draft").notNull(),
  revision: int("revision").default(1).notNull(),
  contentHash: varchar("contentHash", { length: 64 }).notNull(),
  createdBy: int("createdBy").notNull(),
  confirmedBy: int("confirmedBy"),
  confirmedAt: timestamp("confirmedAt"),
  reviewNote: text("reviewNote"),
  staleAt: timestamp("staleAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  projectAttributeRevisionUnique: uniqueIndex("uk_listing_fact_project_attribute_revision").on(
    table.projectId,
    table.attributeKey,
    table.revision,
  ),
  scopeStatusIndex: index("idx_listing_fact_scope_status").on(
    table.workspaceId,
    table.projectId,
    table.status,
    table.updatedAt,
  ),
  sourceIndex: index("idx_listing_fact_source").on(
    table.workspaceId,
    table.projectId,
    table.sourceFileId,
    table.sourceLine,
  ),
}));

/** Immutable revisions of one selling-point core; revision is the service CAS token. */
export const listingCoreRevisions = mysqlTable("listing_core_revisions", {
  id: int("id").autoincrement().primaryKey(),
  coreId: varchar("coreId", { length: 80 }).notNull(),
  workspaceId: int("workspaceId").notNull(),
  projectId: int("projectId").notNull(),
  sellingPointIndex: int("sellingPointIndex").notNull(),
  buyerReason: text("buyerReason").notNull(),
  factRevisionIdsJson: json("factRevisionIdsJson").notNull(),
  keywordIdsJson: json("keywordIdsJson").notNull(),
  status: mysqlEnum("status", ["draft", "confirmed", "rejected", "stale", "superseded"]).default("draft").notNull(),
  revision: int("revision").default(1).notNull(),
  inputHash: varchar("inputHash", { length: 64 }).notNull(),
  contentHash: varchar("contentHash", { length: 64 }).notNull(),
  createdBy: int("createdBy").notNull(),
  confirmedBy: int("confirmedBy"),
  confirmedAt: timestamp("confirmedAt"),
  staleAt: timestamp("staleAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  projectCoreRevisionUnique: uniqueIndex("uk_listing_core_project_core_revision").on(
    table.projectId,
    table.coreId,
    table.revision,
  ),
  currentIndex: index("idx_listing_core_current").on(
    table.workspaceId,
    table.projectId,
    table.sellingPointIndex,
    table.status,
    table.revision,
  ),
}));

/** Immutable AI or human-edited bullet candidate revision linked to its governed core. */
export const listingBulletCandidates = mysqlTable("listing_bullet_candidates", {
  id: int("id").autoincrement().primaryKey(),
  candidateKey: varchar("candidateKey", { length: 80 }).notNull(),
  candidateRevision: int("candidateRevision").default(1).notNull(),
  parentCandidateId: int("parentCandidateId"),
  workspaceId: int("workspaceId").notNull(),
  projectId: int("projectId").notNull(),
  coreRevisionId: int("coreRevisionId").notNull(),
  jobId: int("jobId"),
  skillRunId: int("skillRunId"),
  promptVersion: varchar("promptVersion", { length: 64 }),
  actualModel: varchar("actualModel", { length: 128 }),
  inputHash: varchar("inputHash", { length: 64 }).notNull(),
  subtitle: varchar("subtitle", { length: 500 }),
  fullText: text("fullText"),
  evidenceFactIdsJson: json("evidenceFactIdsJson").notNull(),
  gateResultJson: json("gateResultJson").notNull(),
  status: mysqlEnum("status", ["draft", "generated", "gate_failed", "review_required", "confirmed", "rejected", "stale", "failed"]).default("draft").notNull(),
  contentHash: varchar("contentHash", { length: 64 }).notNull(),
  createdBy: int("createdBy").notNull(),
  staleAt: timestamp("staleAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  lineageRevisionUnique: uniqueIndex("uk_listing_bullet_lineage_revision").on(
    table.coreRevisionId,
    table.candidateKey,
    table.candidateRevision,
  ),
  currentIndex: index("idx_listing_bullet_current").on(
    table.workspaceId,
    table.projectId,
    table.coreRevisionId,
    table.status,
    table.updatedAt,
  ),
  jobIndex: index("idx_listing_bullet_job").on(table.workspaceId, table.jobId, table.createdAt),
}));

/** Immutable human decision record. expectedRevision is retained for CAS audit replay. */
export const listingReviewRevisions = mysqlTable("listing_review_revisions", {
  id: int("id").autoincrement().primaryKey(),
  workspaceId: int("workspaceId").notNull(),
  projectId: int("projectId").notNull(),
  listingId: int("listingId"),
  candidateId: int("candidateId").notNull(),
  reviewRevision: int("reviewRevision").default(1).notNull(),
  decision: mysqlEnum("decision", ["accepted", "edited", "rejected", "revoked"]).notNull(),
  status: mysqlEnum("status", ["recorded", "superseded"]).default("recorded").notNull(),
  beforeHash: varchar("beforeHash", { length: 64 }),
  afterHash: varchar("afterHash", { length: 64 }),
  expectedRevision: int("expectedRevision").notNull(),
  resultingCandidateId: int("resultingCandidateId"),
  reason: text("reason"),
  actorId: int("actorId").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  candidateReviewRevisionUnique: uniqueIndex("uk_listing_review_candidate_revision").on(
    table.candidateId,
    table.reviewRevision,
  ),
  listingAuditIndex: index("idx_listing_review_listing_audit").on(
    table.workspaceId,
    table.projectId,
    table.listingId,
    table.createdAt,
  ),
}));

/**
 * Immutable full mirror written in the same transaction as a confirmed listing
 * change. expectedListingVersion is the listing-row CAS precondition and
 * listingVersion is the resulting listings.version value.
 */
export const listingCompleteSnapshots = mysqlTable("listing_complete_snapshots", {
  id: int("id").autoincrement().primaryKey(),
  workspaceId: int("workspaceId").notNull(),
  projectId: int("projectId").notNull(),
  listingId: int("listingId").notNull(),
  contentVersion: int("contentVersion").notNull(),
  fullPayloadJson: json("fullPayloadJson").notNull(),
  fullHash: varchar("fullHash", { length: 64 }).notNull(),
  humanApprovalRef: varchar("humanApprovalRef", { length: 128 }),
  changeType: mysqlEnum("changeType", ["generate", "manual_edit", "candidate_apply", "optimize", "translate", "rollback"]).notNull(),
  status: mysqlEnum("status", ["draft", "approved", "stale", "superseded", "legacy_unverified"]).default("draft").notNull(),
  expectedListingVersion: int("expectedListingVersion").notNull(),
  listingVersion: int("listingVersion").notNull(),
  createdBy: int("createdBy").notNull(),
  approvedBy: int("approvedBy"),
  approvedAt: timestamp("approvedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  listingContentVersionUnique: uniqueIndex("uk_listing_complete_listing_version").on(
    table.listingId,
    table.contentVersion,
  ),
  listingTimelineIndex: index("idx_listing_complete_timeline").on(
    table.workspaceId,
    table.projectId,
    table.listingId,
    table.createdAt,
  ),
  approvalIndex: index("idx_listing_complete_approval").on(
    table.workspaceId,
    table.projectId,
    table.status,
    table.approvedAt,
  ),
}));

export type ListingFactRevision = typeof listingFactRevisions.$inferSelect;
export type InsertListingFactRevision = typeof listingFactRevisions.$inferInsert;
export type ListingCoreRevision = typeof listingCoreRevisions.$inferSelect;
export type InsertListingCoreRevision = typeof listingCoreRevisions.$inferInsert;
export type ListingBulletCandidate = typeof listingBulletCandidates.$inferSelect;
export type InsertListingBulletCandidate = typeof listingBulletCandidates.$inferInsert;
export type ListingReviewRevision = typeof listingReviewRevisions.$inferSelect;
export type InsertListingReviewRevision = typeof listingReviewRevisions.$inferInsert;
export type ListingCompleteSnapshot = typeof listingCompleteSnapshots.$inferSelect;
export type InsertListingCompleteSnapshot = typeof listingCompleteSnapshots.$inferInsert;
