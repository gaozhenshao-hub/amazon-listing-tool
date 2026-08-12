import { bigint, boolean, decimal, int, json, mysqlEnum, mysqlTable, text, timestamp, varchar } from "drizzle-orm/mysql-core";

// 智能图片知识库 - 图片集（以ASIN为单位）
export const kbImageSets = mysqlTable("kb_image_sets", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  asin: varchar("asin", { length: 20 }).notNull(),
  productTitle: varchar("productTitle", { length: 512 }),
  category: varchar("category", { length: 128 }),
  brand: varchar("brand", { length: 128 }),
  overallAnalysis: text("overallAnalysis"), // Overall visual analysis JSON
  userEditedOverallAnalysis: text("userEditedOverallAnalysis"),
  overallScore: int("overallScore"), // 1-100
  // Set-level style (v2)
  setStyle: varchar("setStyle", { length: 30 }), // 套图风格（13种之一）
  setStyleParams: text("setStyleParams"), // 风格结构化参数JSON（光线/色温/材质/禁忌/参考品牌/AI关键词）
  setPrimaryColor: varchar("setPrimaryColor", { length: 20 }), // 主颜色（13种之一）
  setAccentColor: varchar("setAccentColor", { length: 20 }), // 提亮色（13种之一）
  setCategory: varchar("setCategory", { length: 30 }), // 套图类目（从单图移到套图级别）
  setTargetAudience: varchar("setTargetAudience", { length: 200 }), // 目标人群
  setCategoryScene: varchar("setCategoryScene", { length: 200 }), // 类目场景
  status: mysqlEnum("status", ["crawling", "analyzing", "pending_review", "confirmed", "archived"]).default("crawling").notNull(),
  reviewStatus: mysqlEnum("reviewStatus", ["draft", "pending_review", "approved", "rejected"]).default("draft").notNull(),
  reviewedBy: int("reviewedBy"),
  reviewNote: text("reviewNote"),
  reviewedAt: timestamp("reviewedAt"),
  submittedAt: timestamp("submittedAt"),
  visibility: mysqlEnum("visibility", ["private", "team", "public"]).default("team").notNull(),
  confirmedAt: timestamp("confirmedAt"),
  // Sync metadata
  originInstanceId: varchar("origin_instance_id", { length: 100 }),
  remoteId: int("remote_id"),
  syncVersion: int("sync_version").default(0),
  lastSyncedAt: timestamp("last_synced_at"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type KbImageSet = typeof kbImageSets.$inferSelect;

export type InsertKbImageSet = typeof kbImageSets.$inferInsert;

// 智能图片知识库 - 单张图片分析
export const kbImages = mysqlTable("kb_images", {
  id: int("id").autoincrement().primaryKey(),
  imageSetId: int("imageSetId").notNull(),
  imageUrl: varchar("imageUrl", { length: 1024 }).notNull(), // S3 URL
  imagePosition: mysqlEnum("imagePosition", ["main", "secondary", "aplus", "brand_story"]).notNull(),
  positionIndex: int("positionIndex"), // e.g. secondary image #2
  // Four-dimension tags (legacy)
  tagCategory: varchar("tagCategory", { length: 64 }),
  tagColorScheme: varchar("tagColorScheme", { length: 64 }),
  tagImageType: varchar("tagImageType", { length: 64 }),
  tagDesignStyle: varchar("tagDesignStyle", { length: 64 }),
  // New 7-dimension tags (v2)
  tagImageBelong: varchar("tagImageBelong", { length: 20 }), // 图片归属：主图/套图/A+/品牌故事
  tagImageBelongSub: varchar("tagImageBelongSub", { length: 30 }), // A+子模块类型（图片轮播/对比表格/全宽图等）
  tagImageTypeMain: varchar("tagImageTypeMain", { length: 20 }), // 图片类型大类：对比/细节/场景/特效/必要/品牌
  tagImageTypeSub: varchar("tagImageTypeSub", { length: 30 }), // 图片类型子类型
  tagSellingPointCategory: varchar("tagSellingPointCategory", { length: 20 }), // 卖点大类：质量/功能/设计/操作/安全/附加值
  tagSellingPointDetail: varchar("tagSellingPointDetail", { length: 200 }), // 卖点标签详情（逗号分隔）
  tagComposition: varchar("tagComposition", { length: 20 }), // 构图类型
  tagColorSchemeV2: varchar("tagColorSchemeV2", { length: 30 }), // 新配色方案（10种）
  tagDesignStyleV2: varchar("tagDesignStyleV2", { length: 30 }), // 新设计风格（13种）
  // AI analysis
  aiDimensionAnalysis: text("aiDimensionAnalysis"), // 12-dimension analysis JSON
  userEditedDimensionAnalysis: text("userEditedDimensionAnalysis"),
  aplusModuleType: varchar("aplusModuleType", { length: 64 }), // e.g. comparison_table, image_carousel
  aplusModuleClass: varchar("aplusModuleClass", { length: 128 }), // raw CSS class
  singleImageScore: int("singleImageScore"), // 1-10
  highlights: text("highlights"),
  tagsConfirmed: int("tagsConfirmed").default(0).notNull(), // 0=no, 1=yes
  analysisConfirmed: int("analysisConfirmed").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type KbImage = typeof kbImages.$inferSelect;

export type InsertKbImage = typeof kbImages.$inferInsert;

// ═══════════════════════════════════════════════════════════════════
// ─── Image Workflow (5-Step Image Suggestion Pipeline) ────────────
// ═══════════════════════════════════════════════════════════════════

export const imageWorkflowSessions = mysqlTable("image_workflow_sessions", {
  id: int("id").autoincrement().primaryKey(),
  projectId: int("projectId").notNull(),
  userId: int("userId").notNull(),
  currentStep: int("currentStep").default(1).notNull(), // 1-6

  // Step 0: 竞品图片分析汇总
  step0AiResult: text("step0AiResult"),       // AI summary of competitor image analyses JSON
  step0UserEdit: text("step0UserEdit"),        // User edited summary JSON
  step0Confirmed: int("step0Confirmed").default(0).notNull(),
  // Step 1: 卖点梳理
  step1AiResult: text("step1AiResult"),       // AI generated selling points JSON
  step1UserEdit: text("step1UserEdit"),        // User edited/confirmed selling points JSON
  step1Confirmed: int("step1Confirmed").default(0).notNull(), // 0=no, 1=yes

  // Step 2: 图片大纲
  step2AiResult: text("step2AiResult"),        // AI generated image outline JSON
  step2UserEdit: text("step2UserEdit"),        // User edited/confirmed outline JSON
  step2Confirmed: int("step2Confirmed").default(0).notNull(),

  // Step 3: 风格确认
  step3AiResult: text("step3AiResult"),        // AI recommended styles JSON
  step3UserEdit: text("step3UserEdit"),        // User selected styles JSON (1-2 styles)
  step3Confirmed: int("step3Confirmed").default(0).notNull(),

  // Step 4: 参考图确认
  step4AiResult: text("step4AiResult"),        // AI recommended reference images JSON
  step4UserEdit: text("step4UserEdit"),        // User confirmed reference images JSON
  step4Confirmed: int("step4Confirmed").default(0).notNull(),

  // Step 5: 图片结构及内容建议
  step5AiResult: text("step5AiResult"),        // AI final image suggestions JSON (English)
  step5AiResultCn: text("step5AiResultCn"),    // AI final image suggestions JSON (Chinese)
  step5UserEdit: text("step5UserEdit"),        // User edited final suggestions JSON
  step5Confirmed: int("step5Confirmed").default(0).notNull(),
  // Agent DAG integration
  agentRunId: varchar("agentRunId", { length: 80 }),  // Emperor Agent Run ID for DAG tracking
  // Step 5 async generation state
  step5RunId: varchar("step5RunId", { length: 80 }),
  step5RunStatus: mysqlEnum("step5RunStatus", ["idle", "queued", "running", "succeeded", "failed", "canceled"]).default("idle").notNull(),
  step5RunProgress: int("step5RunProgress").default(0).notNull(),
  step5RunError: text("step5RunError"),
  step5RunStartedAt: timestamp("step5RunStartedAt"),
  step5RunCompletedAt: timestamp("step5RunCompletedAt"),

  // Step 4: Reference images (per-image composition + effect reference URLs)
  step4CompositionRefs: text("step4CompositionRefs"),  // JSON: { [imageKey]: url } per-image composition reference
  step4EffectRefs: text("step4EffectRefs"),            // JSON: { [imageKey]: url } per-image effect reference
  // Step 5: A+ module selection
  step5SelectedModule: text("step5SelectedModule"),    // JSON: selected A+ module type for re-optimization
  step5OptimizedResult: text("step5OptimizedResult"),  // JSON: re-optimized result after module selection
  step5OptimizedResultCn: text("step5OptimizedResultCn"), // JSON: Chinese version of re-optimized result
  // Step 5: Designer uploads
  step5DesignerUploads: text("step5DesignerUploads"),  // JSON array: [{id, imageUrl, imageNumber, notes, uploadedAt}]
  // Step 6: AI提示词生成
  step6AiResult: text("step6AiResult"),        // AI generated prompts JSON (English)
  step6AiResultCn: text("step6AiResultCn"),    // AI generated prompts JSON (Chinese)
  step6UserEdit: text("step6UserEdit"),        // User edited prompts JSON
  step6Confirmed: int("step6Confirmed").default(0).notNull(),
  // Step 6 Lovart: Lovart ChatCanvas专用提示词
  step6LovartResult: text("step6LovartResult"),      // Lovart prompts JSON (Chinese - primary)
  step6LovartResultEn: text("step6LovartResultEn"),  // Lovart prompts JSON (English translation)
  step6LovartUserEdit: text("step6LovartUserEdit"),  // User edited Lovart prompts JSON
  step6LovartConfirmed: int("step6LovartConfirmed").default(0).notNull(),
  // PDF export
  pdfUrl: text("pdfUrl"),                      // S3 URL for exported PDF

  status: mysqlEnum("status", ["in_progress", "completed"]).default("in_progress").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type ImageWorkflowSession = typeof imageWorkflowSessions.$inferSelect;

export type InsertImageWorkflowSession = typeof imageWorkflowSessions.$inferInsert;

// Step4 单图确认版本：与会话 JSON 和 Agent Artifact 解耦，作为每张图的唯一确认来源。
export const imageWorkflowStep4ImageVersions = mysqlTable("image_workflow_step4_image_versions", {
  id: int("id").autoincrement().primaryKey(),
  sessionId: int("sessionId").notNull(),
  projectId: int("projectId").notNull(),
  userId: int("userId").notNull(),
  imageIndex: int("imageIndex").notNull(),
  imageKey: varchar("imageKey", { length: 80 }).notNull(),
  version: int("version").notNull(),
  status: mysqlEnum("status", ["confirmed", "superseded", "unlocked"]).default("confirmed").notNull(),
  isCurrent: int("isCurrent").default(1).notNull(),
  content: text("content").notNull(),
  confirmedAt: timestamp("confirmedAt").defaultNow().notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type ImageWorkflowStep4ImageVersion = typeof imageWorkflowStep4ImageVersions.$inferSelect;
export type InsertImageWorkflowStep4ImageVersion = typeof imageWorkflowStep4ImageVersions.$inferInsert;

// Competitor image analyses for Step 0 of image workflow
export const competitorImageAnalyses = mysqlTable("competitor_image_analyses", {
  id: int("id").autoincrement().primaryKey(),
  projectId: int("projectId").notNull(),
  userId: int("userId").notNull(),
  competitorName: varchar("competitorName", { length: 255 }).default("").notNull(),
  imageUrl: text("imageUrl").notNull(),
  imageType: varchar("imageType", { length: 100 }),
  aiAnalysis: text("aiAnalysis"),
  userEdit: text("userEdit"),
  confirmed: int("confirmed").default(0).notNull(),
  sortOrder: int("sortOrder").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type CompetitorImageAnalysis = typeof competitorImageAnalyses.$inferSelect;

export type InsertCompetitorImageAnalysis = typeof competitorImageAnalyses.$inferInsert;

// ─── Step 0: Expression Direction Groups ─────────────────────────────────────
// Each group represents one "卖点表达方向" (e.g. 场景使用图, 功能对比图).
// A group holds 1-5 images from DIFFERENT competitors showing the same expression style.
export const expressionGroups = mysqlTable("expression_groups", {
  id: int("id").autoincrement().primaryKey(),
  projectId: int("projectId").notNull(),
  userId: int("userId").notNull(),
  expressionName: varchar("expressionName", { length: 255 }).notNull(), // e.g. "场景使用图"
  // AI + user analysis for the whole group (JSON string)
  aiAnalysis: text("aiAnalysis"),
  userEdit: text("userEdit"),
  confirmed: int("confirmed").default(0).notNull(),
  sortOrder: int("sortOrder").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type ExpressionGroup = typeof expressionGroups.$inferSelect;

export type InsertExpressionGroup = typeof expressionGroups.$inferInsert;

// Each row = one competitor image belonging to an expression group (max 5 per group)
export const expressionGroupImages = mysqlTable("expression_group_images", {
  id: int("id").autoincrement().primaryKey(),
  groupId: int("groupId").notNull(),
  projectId: int("projectId").notNull(),
  userId: int("userId").notNull(),
  competitorName: varchar("competitorName", { length: 255 }).default("").notNull(),
  imageUrl: text("imageUrl").notNull(),
  sortOrder: int("sortOrder").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type ExpressionGroupImage = typeof expressionGroupImages.$inferSelect;

export type InsertExpressionGroupImage = typeof expressionGroupImages.$inferInsert;
