import { bigint, boolean, decimal, int, json, mysqlEnum, mysqlTable, text, timestamp, varchar } from "drizzle-orm/mysql-core";

// ═════════════════════════════════════════════════════════════════
// ─── Module 2 Extension: 视频脚本生成 (Video Script Generation) ──
// ═════════════════════════════════════════════════════════════════

// 视频脚本主表
export const videoScripts = mysqlTable("video_scripts", {
  id: int("id").autoincrement().primaryKey(),
  projectId: int("projectId").notNull(),
  userId: int("userId").notNull(),
  scriptName: varchar("scriptName", { length: 255 }).notNull(),
  productName: varchar("productName", { length: 255 }),
  videoType: mysqlEnum("videoType", ["main_video", "ad_spv", "ad_sbv", "aplus_video", "social_media", "other"]).default("main_video"),
  stylePreset: varchar("style_preset", { length: 50 }).default("minimal_white"),
  targetDuration: decimal("targetDuration", { precision: 5, scale: 1 }),
  currentStage: mysqlEnum("currentStage", [
    "stage_0a", "stage_0b", "stage_1", "stage_2", "stage_3", "stage_4", "completed"
  ]).default("stage_0a").notNull(),
  stageStatus: json("stageStatus"), // JSON: { stage_0a: "completed", stage_0b: "editing", ... }
  version: int("version").default(1),
  versionNote: text("version_note"),
  status: mysqlEnum("status", ["draft", "in_progress", "completed", "archived"]).default("draft").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type VideoScript = typeof videoScripts.$inferSelect;

export type InsertVideoScript = typeof videoScripts.$inferInsert;

// 竞品脚本分析表
export const videoCompetitorScripts = mysqlTable("video_competitor_scripts", {
  id: int("id").autoincrement().primaryKey(),
  videoScriptId: int("videoScriptId").notNull(),
  competitorName: varchar("competitorName", { length: 200 }),
  competitorAsin: varchar("competitorAsin", { length: 20 }),
  inputType: mysqlEnum("inputType", ["excel_upload", "video_url", "knowledge_base", "listing_extract"]).notNull(),
  sourceUrl: text("sourceUrl"),
  sourceFileKey: text("sourceFileKey"),
  sourceKbVideoId: int("sourceKbVideoId"),
  videoType: varchar("videoType", { length: 50 }),
  totalDuration: decimal("totalDuration", { precision: 5, scale: 1 }),
  rawContent: text("rawContent"),
  structureAnalysis: json("structureAnalysis"),
  visualLanguage: json("visualLanguage"),
  copywritingAnalysis: json("copywritingAnalysis"),
  strengths: json("strengths"),
  weaknesses: json("weaknesses"),
  reusablePatterns: json("reusablePatterns"),
  userConfirmed: int("userConfirmed").default(0),
  userEdits: json("userEdits"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type VideoCompetitorScript = typeof videoCompetitorScripts.$inferSelect;

export type InsertVideoCompetitorScript = typeof videoCompetitorScripts.$inferInsert;

// 多竞品汇总分析表
export const videoCompetitorSummary = mysqlTable("video_competitor_summary", {
  id: int("id").autoincrement().primaryKey(),
  videoScriptId: int("videoScriptId").notNull(),
  competitorScriptIds: json("competitorScriptIds"),
  commonStructure: json("commonStructure"),
  optimalDurationAllocation: json("optimalDurationAllocation"),
  differentiableOpportunities: json("differentiableOpportunities"),
  recommendedStructure: json("recommendedStructure"),
  userConfirmed: int("userConfirmed").default(0),
  userEdits: json("userEdits"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type VideoCompetitorSummary = typeof videoCompetitorSummary.$inferSelect;

export type InsertVideoCompetitorSummary = typeof videoCompetitorSummary.$inferInsert;

// 产品信息快照表
export const videoProductSnapshots = mysqlTable("video_product_snapshots", {
  id: int("id").autoincrement().primaryKey(),
  videoScriptId: int("videoScriptId").notNull(),
  basicInfo: json("basicInfo"),
  sellingPointsHierarchy: json("sellingPointsHierarchy"),
  painPoints: json("painPoints"),
  keywords: json("keywords"),
  productSpecs: json("productSpecs"),
  productImageUrls: json("productImageUrls"),
  dataSources: json("dataSources"),
  userConfirmed: int("userConfirmed").default(0),
  userEdits: json("userEdits"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type VideoProductSnapshot = typeof videoProductSnapshots.$inferSelect;

export type InsertVideoProductSnapshot = typeof videoProductSnapshots.$inferInsert;

// 视频脚本段落表
export const videoScriptSections = mysqlTable("video_script_sections", {
  id: int("id").autoincrement().primaryKey(),
  videoScriptId: int("videoScriptId").notNull(),
  sectionCode: varchar("sectionCode", { length: 20 }),
  sectionName: varchar("sectionName", { length: 200 }).notNull(),
  sectionNameEn: varchar("sectionNameEn", { length: 200 }),
  shootingMethod: mysqlEnum("shootingMethod", ["model_narration", "live_action", "ai_generated", "mixed", "screen_recording"]).default("live_action"),
  durationBudget: decimal("durationBudget", { precision: 5, scale: 1 }),
  sellingPointRefs: json("sellingPointRefs"),
  painPointRefs: json("painPointRefs"),
  description: text("description"),
  shotTypeSuggestion: varchar("shotTypeSuggestion", { length: 100 }),
  propsSuggestion: json("propsSuggestion"),
  sortOrder: int("sortOrder").default(0),
  userConfirmed: int("userConfirmed").default(0),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type VideoScriptSection = typeof videoScriptSections.$inferSelect;

export type InsertVideoScriptSection = typeof videoScriptSections.$inferInsert;

// 视频脚本子主题表
export const videoScriptSubtopics = mysqlTable("video_script_subtopics", {
  id: int("id").autoincrement().primaryKey(),
  sectionId: int("sectionId").notNull(),
  subtopicName: varchar("subtopicName", { length: 200 }).notNull(),
  subtopicNameEn: varchar("subtopicNameEn", { length: 200 }),
  durationBudget: decimal("durationBudget", { precision: 5, scale: 1 }),
  shotCount: int("shotCount").default(1),
  sellingPointRef: text("sellingPointRef"),
  sortOrder: int("sortOrder").default(0),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type VideoScriptSubtopic = typeof videoScriptSubtopics.$inferSelect;

export type InsertVideoScriptSubtopic = typeof videoScriptSubtopics.$inferInsert;

// 视频脚本镜头表（14字段完整版）
export const videoScriptShots = mysqlTable("video_script_shots", {
  id: int("id").autoincrement().primaryKey(),
  subtopicId: int("subtopicId").notNull(),
  sectionId: int("sectionId").notNull(),
  shotCode: varchar("shotCode", { length: 20 }),
  duration: decimal("duration", { precision: 4, scale: 1 }),
  shotDescription: text("shotDescription"),
  sceneLocation: varchar("sceneLocation", { length: 100 }),
  cameraAngle: mysqlEnum("cameraAngle", ["extreme_closeup", "closeup", "medium_closeup", "medium", "medium_wide", "wide", "extreme_wide"]),
  cameraMovement: varchar("cameraMovement", { length: 100 }),
  overlayTextEn: text("overlayTextEn"),
  overlayTextCn: text("overlayTextCn"),
  narrationEn: text("narrationEn"),
  narrationCn: text("narrationCn"),
  subtitleEn: text("subtitleEn"),
  subtitleCn: text("subtitleCn"),
  narratorType: mysqlEnum("narratorType", ["voiceover", "model_narration", "text_only", "none"]).default("voiceover"),
  generationStrategy: mysqlEnum("generationStrategy", ["real_shoot", "ai_image", "ai_video", "stock_footage", "screen_record", "mixed"]).default("real_shoot"),
  reuseFromShotCode: varchar("reuseFromShotCode", { length: 20 }),
  designatedAssets: json("designatedAssets"),
  colorScheme: varchar("colorScheme", { length: 200 }),
  props: json("props"),
  notes: text("notes"),
  referenceImageUrl: text("referenceImageUrl"),
  sortOrder: int("sortOrder").default(0),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type VideoScriptShot = typeof videoScriptShots.$inferSelect;

export type InsertVideoScriptShot = typeof videoScriptShots.$inferInsert;

// 剪辑脚本表
export const videoEditScripts = mysqlTable("video_edit_scripts", {
  id: int("id").autoincrement().primaryKey(),
  videoScriptId: int("videoScriptId").notNull(),
  editName: varchar("editName", { length: 200 }).notNull(),
  videoPurpose: mysqlEnum("videoPurpose", ["spv_ad", "sbv_ad", "main_listing", "aplus", "social_media", "other"]).default("main_listing"),
  maxDuration: decimal("maxDuration", { precision: 5, scale: 1 }),
  editStyle: varchar("editStyle", { length: 100 }),
  sectionMapping: json("sectionMapping"),
  description: text("description"),
  sortOrder: int("sortOrder").default(0),
  userConfirmed: int("userConfirmed").default(0),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type VideoEditScript = typeof videoEditScripts.$inferSelect;

export type InsertVideoEditScript = typeof videoEditScripts.$inferInsert;

// 版本快照表
export const videoScriptVersions = mysqlTable("video_script_versions", {
  id: int("id").autoincrement().primaryKey(),
  videoScriptId: int("videoScriptId").notNull(),
  version: int("version").notNull().default(1),
  versionNote: text("versionNote"),
  snapshotData: json("snapshotData").notNull(),
  createdBy: int("createdBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type VideoScriptVersion = typeof videoScriptVersions.$inferSelect;

export type InsertVideoScriptVersion = typeof videoScriptVersions.$inferInsert;

// SPV多段视频管理表
export const videoSpvSegments = mysqlTable("video_spv_segments", {
  id: int("id").autoincrement().primaryKey(),
  videoScriptId: int("videoScriptId").notNull(),
  segmentIndex: int("segmentIndex").notNull().default(1),
  segmentName: varchar("segmentName", { length: 200 }).notNull(),
  focusDimension: varchar("focusDimension", { length: 100 }),
  descriptionText: text("descriptionText"),
  maxDuration: decimal("maxDuration", { precision: 5, scale: 1 }).default("25.0"),
  status: varchar("status", { length: 20 }).default("draft"),
  sortOrder: int("sortOrder").default(0),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type VideoSpvSegment = typeof videoSpvSegments.$inferSelect;

export type InsertVideoSpvSegment = typeof videoSpvSegments.$inferInsert;
