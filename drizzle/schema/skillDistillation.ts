import { decimal, index, int, json, mysqlEnum, mysqlTable, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/mysql-core";

/** 知识蒸馏项目仅保存受控来源引用与规则生命周期，绝不保存源知识正文或附件。 */
export const knowledgeDistillationProjects = mysqlTable("knowledge_distillation_projects", {
  id: int("id").autoincrement().primaryKey(),
  workspaceId: int("workspaceId").notNull(),
  projectKey: varchar("projectKey", { length: 80 }).notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  status: mysqlEnum("status", ["setup", "ready", "draft_review", "paused", "archived"]).default("setup").notNull(),
  profile: json("profile").notNull(),
  sourcePolicy: json("sourcePolicy").notNull(),
  createdBy: int("createdBy").notNull(),
  updatedBy: int("updatedBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => [
  uniqueIndex("uq_kdistill_project_workspace_key").on(table.workspaceId, table.projectKey),
  index("idx_kdistill_project_workspace_status").on(table.workspaceId, table.status),
]);

export const knowledgeDistillationSources = mysqlTable("knowledge_distillation_sources", {
  id: int("id").autoincrement().primaryKey(),
  sourceKey: varchar("sourceKey", { length: 80 }).notNull().unique(),
  workspaceId: int("workspaceId").notNull(),
  distillationProjectId: int("distillationProjectId").notNull(),
  sourceDomain: mysqlEnum("sourceDomain", ["products", "listings", "images", "skills", "videos"]).notNull(),
  sourceTable: varchar("sourceTable", { length: 128 }).notNull(),
  sourceRowId: varchar("sourceRowId", { length: 128 }).notNull(),
  sourceContentHash: varchar("sourceContentHash", { length: 64 }).notNull(),
  sourceStatus: mysqlEnum("sourceStatus", ["eligible", "invalidated", "excluded"]).default("eligible").notNull(),
  sourceSummary: text("sourceSummary"),
  sourceMetadata: json("sourceMetadata"),
  selectedBy: int("selectedBy").notNull(),
  confirmedBy: int("confirmedBy"),
  confirmedAt: timestamp("confirmedAt"),
  invalidatedAt: timestamp("invalidatedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => [
  uniqueIndex("uq_kdistill_source_identity").on(table.distillationProjectId, table.sourceTable, table.sourceRowId, table.sourceContentHash),
  index("idx_kdistill_source_project_status").on(table.distillationProjectId, table.sourceStatus),
  index("idx_kdistill_source_workspace_domain").on(table.workspaceId, table.sourceDomain),
]);

export const knowledgeDistillationEvidence = mysqlTable("knowledge_distillation_evidence", {
  id: int("id").autoincrement().primaryKey(),
  evidenceKey: varchar("evidenceKey", { length: 80 }).notNull().unique(),
  workspaceId: int("workspaceId").notNull(),
  distillationProjectId: int("distillationProjectId").notNull(),
  sourceKey: varchar("sourceKey", { length: 80 }).notNull(),
  evidenceType: mysqlEnum("evidenceType", ["specification", "benefit", "compatibility", "proof", "objection", "visual_pattern", "compliance", "brand"]).notNull(),
  claim: text("claim").notNull(),
  normalizedAttributes: json("normalizedAttributes").notNull(),
  confidence: decimal("confidence", { precision: 4, scale: 3 }).default("0.000").notNull(),
  status: mysqlEnum("status", ["draft", "approved", "rejected", "invalidated"]).default("draft").notNull(),
  reviewerUserId: int("reviewerUserId"),
  reviewNote: text("reviewNote"),
  createdBy: int("createdBy").notNull(),
  approvedAt: timestamp("approvedAt"),
  invalidatedAt: timestamp("invalidatedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => [
  uniqueIndex("uq_kdistill_evidence_project_source_claim").on(table.distillationProjectId, table.sourceKey, table.claim),
  index("idx_kdistill_evidence_project_status").on(table.distillationProjectId, table.status),
]);

/** 草案独立于 emperor_skills；只有审批发布时才会显式生成新的皇帝Skill版本。 */
export const knowledgeSkillDrafts = mysqlTable("knowledge_skill_drafts", {
  id: int("id").autoincrement().primaryKey(),
  draftKey: varchar("draftKey", { length: 80 }).notNull().unique(),
  workspaceId: int("workspaceId").notNull(),
  distillationProjectId: int("distillationProjectId").notNull(),
  skillTypeKey: varchar("skillTypeKey", { length: 128 }).notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  profile: json("profile").notNull(),
  manifestDraft: json("manifestDraft").notNull(),
  evidenceKeys: json("evidenceKeys").notNull(),
  sourceFingerprint: varchar("sourceFingerprint", { length: 64 }).notNull(),
  parentDraftKey: varchar("parentDraftKey", { length: 80 }),
  proposedSkillSlug: varchar("proposedSkillSlug", { length: 128 }),
  proposedSkillVersion: int("proposedSkillVersion"),
  status: mysqlEnum("status", ["draft", "conflict", "review", "approved", "rejected", "published", "superseded"]).default("draft").notNull(),
  conflictReport: json("conflictReport"),
  reviewSummary: text("reviewSummary"),
  artifactId: varchar("artifactId", { length: 80 }),
  createdBy: int("createdBy").notNull(),
  reviewedBy: int("reviewedBy"),
  reviewedAt: timestamp("reviewedAt"),
  publishedAt: timestamp("publishedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => [
  uniqueIndex("uq_kdistill_draft_project_fingerprint").on(table.distillationProjectId, table.skillTypeKey, table.sourceFingerprint),
  index("idx_kdistill_draft_project_status").on(table.distillationProjectId, table.status),
  index("idx_kdistill_draft_workspace_type").on(table.workspaceId, table.skillTypeKey),
]);

export const knowledgeSkillReviewEvents = mysqlTable("knowledge_skill_review_events", {
  id: int("id").autoincrement().primaryKey(),
  eventKey: varchar("eventKey", { length: 80 }).notNull().unique(),
  workspaceId: int("workspaceId").notNull(),
  distillationProjectId: int("distillationProjectId").notNull(),
  draftKey: varchar("draftKey", { length: 80 }),
  eventType: mysqlEnum("eventType", ["source_selected", "source_invalidated", "evidence_approved", "draft_created", "draft_edited", "conflict_detected", "review_requested", "approved", "rejected", "published", "rolled_back"]).notNull(),
  beforeSnapshot: json("beforeSnapshot"),
  afterSnapshot: json("afterSnapshot"),
  reason: text("reason"),
  actorUserId: int("actorUserId").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("idx_kdistill_review_project_created").on(table.distillationProjectId, table.createdAt),
  index("idx_kdistill_review_draft_created").on(table.draftKey, table.createdAt),
]);

export const knowledgeSkillFeedback = mysqlTable("knowledge_skill_feedback", {
  id: int("id").autoincrement().primaryKey(),
  feedbackKey: varchar("feedbackKey", { length: 80 }).notNull().unique(),
  workspaceId: int("workspaceId").notNull(),
  distillationProjectId: int("distillationProjectId"),
  skillSlug: varchar("skillSlug", { length: 128 }).notNull(),
  skillVersion: int("skillVersion"),
  consumerDomain: mysqlEnum("consumerDomain", ["listing", "image", "other"]).notNull(),
  consumerRef: varchar("consumerRef", { length: 192 }).notNull(),
  outcome: mysqlEnum("outcome", ["accepted", "revised", "rejected", "published", "issue"]).notNull(),
  editDelta: json("editDelta"),
  note: text("note"),
  recordedBy: int("recordedBy").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("idx_kdistill_feedback_skill").on(table.workspaceId, table.skillSlug, table.createdAt),
]);

export const knowledgeClaimLedgers = mysqlTable("knowledge_claim_ledgers", {
  id: int("id").autoincrement().primaryKey(),
  ledgerKey: varchar("ledgerKey", { length: 80 }).notNull().unique(),
  workspaceId: int("workspaceId").notNull(),
  businessProjectId: int("businessProjectId"),
  listingId: int("listingId"),
  imageWorkflowSessionId: int("imageWorkflowSessionId"),
  profile: json("profile").notNull(),
  claims: json("claims").notNull(),
  status: mysqlEnum("status", ["draft", "review", "locked", "superseded", "archived"]).default("draft").notNull(),
  artifactId: varchar("artifactId", { length: 80 }),
  version: int("version").default(1).notNull(),
  isCurrent: int("isCurrent").default(1).notNull(),
  parentLedgerKey: varchar("parentLedgerKey", { length: 80 }),
  lockedBy: int("lockedBy"),
  lockedAt: timestamp("lockedAt"),
  createdBy: int("createdBy").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => [
  uniqueIndex("uq_claim_ledger_scope_version").on(table.workspaceId, table.businessProjectId, table.listingId, table.imageWorkflowSessionId, table.version),
  index("idx_claim_ledger_workspace_project").on(table.workspaceId, table.businessProjectId, table.isCurrent),
]);

export const knowledgeClaimLedgerLinks = mysqlTable("knowledge_claim_ledger_links", {
  id: int("id").autoincrement().primaryKey(),
  linkKey: varchar("linkKey", { length: 80 }).notNull().unique(),
  workspaceId: int("workspaceId").notNull(),
  ledgerKey: varchar("ledgerKey", { length: 80 }).notNull(),
  claimKey: varchar("claimKey", { length: 80 }).notNull(),
  targetDomain: mysqlEnum("targetDomain", ["listing", "image", "brand_story"]).notNull(),
  targetType: varchar("targetType", { length: 64 }).notNull(),
  targetRef: varchar("targetRef", { length: 192 }).notNull(),
  targetPosition: varchar("targetPosition", { length: 128 }),
  status: mysqlEnum("status", ["candidate", "confirmed", "locked", "invalidated"]).default("candidate").notNull(),
  createdBy: int("createdBy").notNull(),
  confirmedBy: int("confirmedBy"),
  confirmedAt: timestamp("confirmedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => [
  uniqueIndex("uq_claim_ledger_link_target").on(table.ledgerKey, table.claimKey, table.targetDomain, table.targetRef),
  index("idx_claim_ledger_link_ledger_status").on(table.ledgerKey, table.status),
]);

/** 一致性矩阵的人工决定只追加审计记录，不会反向修改账本或任何业务内容。 */
export const knowledgeClaimLedgerConsistencyDecisions = mysqlTable("knowledge_claim_ledger_consistency_decisions", {
  decisionKey: varchar("decisionKey", { length: 80 }).primaryKey(),
  workspaceId: int("workspaceId").notNull(),
  ledgerKey: varchar("ledgerKey", { length: 80 }).notNull(),
  matrixFingerprint: varchar("matrixFingerprint", { length: 64 }).notNull(),
  issueKey: varchar("issueKey", { length: 160 }).notNull(),
  decision: mysqlEnum("decision", ["accepted", "ignored", "new_version"]).notNull(),
  note: text("note"),
  createdBy: int("createdBy").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("idx_claim_consistency_workspace_ledger").on(table.workspaceId, table.ledgerKey, table.createdAt),
  index("idx_claim_consistency_issue").on(table.workspaceId, table.ledgerKey, table.issueKey, table.createdAt),
]);

export type KnowledgeDistillationProject = typeof knowledgeDistillationProjects.$inferSelect;
export type KnowledgeSkillDraft = typeof knowledgeSkillDrafts.$inferSelect;
export type KnowledgeClaimLedger = typeof knowledgeClaimLedgers.$inferSelect;
