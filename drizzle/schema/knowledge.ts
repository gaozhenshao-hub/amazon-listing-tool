import { bigint, boolean, decimal, int, json, mysqlEnum, mysqlTable, text, timestamp, varchar } from "drizzle-orm/mysql-core";

// Knowledge base sync logs (P2P bidirectional sync)
export const kbSyncLogs = mysqlTable("kb_sync_logs", {
  id: int("id").autoincrement().primaryKey(),
  syncDirection: mysqlEnum("syncDirection", ["push", "pull"]).notNull(),
  resourceType: mysqlEnum("resourceType", ["kb_product", "kb_listing", "kb_image_set", "kb_video", "kb_skill"]).notNull(),
  resourceId: int("resourceId").notNull(),
  remoteResourceId: int("remoteResourceId"),
  syncStatus: mysqlEnum("syncStatus", ["pending", "synced", "conflict", "failed"]).default("pending").notNull(),
  conflictDetail: text("conflictDetail"),
  peerInstanceId: varchar("peer_instance_id", { length: 100 }),
  itemCount: int("item_count").default(0),
  errorDetail: text("error_detail"),
  syncedAt: timestamp("syncedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type KbSyncLog = typeof kbSyncLogs.$inferSelect;

export type InsertKbSyncLog = typeof kbSyncLogs.$inferInsert;

// Remote usage snapshots (for viewing peer system usage data)
export const remoteUsageSnapshots = mysqlTable("remote_usage_snapshots", {
  id: int("id").autoincrement().primaryKey(),
  instanceId: varchar("instanceId", { length: 100 }).notNull(),
  instanceName: varchar("instanceName", { length: 255 }),
  snapshotDate: varchar("snapshotDate", { length: 10 }).notNull(),
  totalUsers: int("totalUsers").default(0),
  activeUsers: int("activeUsers").default(0),
  aiCallCount: int("aiCallCount").default(0),
  aiTokensUsed: bigint("aiTokensUsed", { mode: "number" }).default(0),
  scraperCallCount: int("scraperCallCount").default(0),
  storageUsedBytes: bigint("storageUsedBytes", { mode: "number" }).default(0),
  apiCallCount: int("apiCallCount").default(0),
  detailJson: text("detailJson"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type RemoteUsageSnapshot = typeof remoteUsageSnapshots.$inferSelect;

export type InsertRemoteUsageSnapshot = typeof remoteUsageSnapshots.$inferInsert;

// ═══════════════════════════════════════════════════════════════════
// ─── Knowledge Base Module Tables ─────────────────────────────────
// ═══════════════════════════════════════════════════════════════════

// 智能产品创意库
export const kbProductInnovations = mysqlTable("kb_product_innovations", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  workspaceId: int("workspaceId").notNull(),
  asin: varchar("asin", { length: 20 }).notNull(),
  productUrl: varchar("productUrl", { length: 1024 }),
  productTitle: varchar("productTitle", { length: 512 }),
  brand: varchar("brand", { length: 128 }),
  price: varchar("price", { length: 50 }),
  bsr: int("bsr"),
  rating: varchar("rating", { length: 10 }),
  reviewCount: varchar("reviewCount", { length: 20 }),
  category: varchar("category", { length: 128 }),
  bulletPoints: text("bulletPoints"), // JSON array
  imageUrls: text("imageUrls"), // JSON array of S3 URLs
  crawledData: text("crawledData"), // Full crawled data JSON
  aiAnalysis: text("aiAnalysis"), // AI analysis result JSON
  userEditedAnalysis: text("userEditedAnalysis"), // User-edited analysis JSON
  tags: text("tags"), // Tags JSON array
  overallScore: int("overallScore"), // 1-10
  status: mysqlEnum("status", ["crawling", "analyzing", "pending_review", "confirmed", "archived"]).default("crawling").notNull(),
  reviewStatus: mysqlEnum("reviewStatus", ["draft", "pending_review", "approved", "rejected"]).default("draft").notNull(),
  reviewedBy: int("reviewedBy"),
  reviewNote: text("reviewNote"),
  reviewedAt: timestamp("reviewedAt"),
  submittedAt: timestamp("submittedAt"),
  visibility: mysqlEnum("visibility", ["private", "team", "public"]).default("private").notNull(),
  confirmedAt: timestamp("confirmedAt"),
  // Sync metadata
  originInstanceId: varchar("origin_instance_id", { length: 100 }),
  remoteId: int("remote_id"),
  syncVersion: int("sync_version").default(0),
  lastSyncedAt: timestamp("last_synced_at"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type KbProductInnovation = typeof kbProductInnovations.$inferSelect;

export type InsertKbProductInnovation = typeof kbProductInnovations.$inferInsert;

// 智能Listing文案库
export const kbListingCopywriting = mysqlTable("kb_listing_copywriting", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  workspaceId: int("workspaceId").notNull(),
  asin: varchar("asin", { length: 20 }).notNull(),
  productTitle: varchar("productTitle", { length: 512 }),
  category: varchar("category", { length: 128 }),
  brand: varchar("brand", { length: 128 }),
  titleText: text("titleText"),
  bulletPoints: text("bulletPoints"), // JSON array of 5 bullet points
  longDescription: text("longDescription"),
  aPlusContent: text("aPlusContent"),
  qaContent: text("qaContent"), // JSON array of QA
  crawledData: text("crawledData"), // Full crawled data JSON
  aiAnalysis: text("aiAnalysis"), // AI analysis result JSON
  userEditedAnalysis: text("userEditedAnalysis"), // User-edited analysis JSON
  tags: text("tags"), // Tags JSON array
  overallScore: int("overallScore"), // 1-100
  status: mysqlEnum("status", ["crawling", "analyzing", "pending_review", "confirmed", "archived"]).default("crawling").notNull(),
  reviewStatus: mysqlEnum("reviewStatus", ["draft", "pending_review", "approved", "rejected"]).default("draft").notNull(),
  reviewedBy: int("reviewedBy"),
  reviewNote: text("reviewNote"),
  reviewedAt: timestamp("reviewedAt"),
  submittedAt: timestamp("submittedAt"),
  visibility: mysqlEnum("visibility", ["private", "team", "public"]).default("private").notNull(),
  confirmedAt: timestamp("confirmedAt"),
  // Sync metadata
  originInstanceId: varchar("origin_instance_id", { length: 100 }),
  remoteId: int("remote_id"),
  syncVersion: int("sync_version").default(0),
  lastSyncedAt: timestamp("last_synced_at"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type KbListingCopywriting = typeof kbListingCopywriting.$inferSelect;

export type InsertKbListingCopywriting = typeof kbListingCopywriting.$inferInsert;

// 智能运营SOP知识库
export const kbOperationSkills = mysqlTable("kb_operation_skills", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  workspaceId: int("workspaceId").notNull(),
  title: varchar("title", { length: 256 }).notNull(),
  sourceType: mysqlEnum("sourceType", [
    "upload_pdf", "upload_word", "upload_excel", "upload_ppt",
    "upload_md", "upload_image", "upload_mindmap", "url", "manual"
  ]).notNull(),
  sourceUrl: varchar("sourceUrl", { length: 1024 }),
  fileUrl: varchar("fileUrl", { length: 1024 }), // S3 URL for original file
  originalFileName: varchar("originalFileName", { length: 256 }),
  extractedContent: text("extractedContent"), // Extracted text content
  aiSummary: text("aiSummary"), // AI summary JSON
  userEditedSummary: text("userEditedSummary"), // User-edited summary JSON
  categories: text("categories"), // Category tags JSON array
  tags: text("tags"), // Custom tags JSON array
  practicalityScore: int("practicalityScore"), // 1-10
  status: mysqlEnum("status", ["parsing", "analyzing", "pending_review", "confirmed", "archived"]).default("parsing").notNull(),
  reviewStatus: mysqlEnum("reviewStatus", ["draft", "pending_review", "approved", "rejected"]).default("draft").notNull(),
  reviewedBy: int("reviewedBy"),
  reviewNote: text("reviewNote"),
  reviewedAt: timestamp("reviewedAt"),
  submittedAt: timestamp("submittedAt"),
  visibility: mysqlEnum("visibility", ["private", "team", "public"]).default("private").notNull(),
  accessLevel: mysqlEnum("accessLevel", ["public", "team", "restricted"]).default("public").notNull(),
  allowedRoles: text("allowedRoles"), // JSON array of allowed role keys
  confirmedAt: timestamp("confirmedAt"),
  // Sync metadata
  originInstanceId: varchar("origin_instance_id", { length: 100 }),
  remoteId: int("remote_id"),
  syncVersion: int("sync_version").default(0),
  lastSyncedAt: timestamp("last_synced_at"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type KbOperationSkill = typeof kbOperationSkills.$inferSelect;

export type InsertKbOperationSkill = typeof kbOperationSkills.$inferInsert;

// 智能视频知识库
export const kbVideos = mysqlTable("kb_videos", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  workspaceId: int("workspaceId").notNull(),
  asin: varchar("asin", { length: 20 }),
  videoUrl: varchar("videoUrl", { length: 1024 }).notNull(),
  videoTitle: varchar("videoTitle", { length: 512 }),
  category: varchar("category", { length: 128 }),
  duration: int("duration"), // seconds
  thumbnailUrl: varchar("thumbnailUrl", { length: 1024 }),
  transcriptText: text("transcriptText"), // Audio transcription
  keyframeUrls: text("keyframeUrls"), // JSON array of keyframe S3 URLs
  aiAnalysis: text("aiAnalysis"), // AI analysis result JSON
  userEditedAnalysis: text("userEditedAnalysis"), // User-edited analysis JSON
  tags: text("tags"), // Tags JSON array
  overallScore: int("overallScore"), // 1-100
  status: mysqlEnum("status", ["downloading", "transcribing", "analyzing", "pending_review", "confirmed", "archived"]).default("downloading").notNull(),
  reviewStatus: mysqlEnum("reviewStatus", ["draft", "pending_review", "approved", "rejected"]).default("draft").notNull(),
  reviewedBy: int("reviewedBy"),
  reviewNote: text("reviewNote"),
  reviewedAt: timestamp("reviewedAt"),
  submittedAt: timestamp("submittedAt"),
  visibility: mysqlEnum("visibility", ["private", "team", "public"]).default("private").notNull(),
  confirmedAt: timestamp("confirmedAt"),
  // Sync metadata
  originInstanceId: varchar("origin_instance_id", { length: 100 }),
  remoteId: int("remote_id"),
  syncVersion: int("sync_version").default(0),
  lastSyncedAt: timestamp("last_synced_at"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type KbVideo = typeof kbVideos.$inferSelect;

export type InsertKbVideo = typeof kbVideos.$inferInsert;

// ═════════════════════════════════════════════════════════════════
// ─── 知识库优化模块：外部情报采集 + AI机器人 + 调用反馈 ─────────
// ═════════════════════════════════════════════════════════════════

// 外部情报源配置
export const kbIntelSources = mysqlTable("kb_intel_sources", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  name: varchar("name", { length: 200 }).notNull(),
  sourceType: mysqlEnum("sourceType", ["amazon_news", "wearesellers", "media", "custom_url", "rss"]).notNull(),
  url: varchar("url", { length: 1000 }).notNull(),
  crawlFrequency: mysqlEnum("crawlFrequency", ["daily", "weekly", "manual"]).default("manual").notNull(),
  qualityThreshold: decimal("qualityThreshold", { precision: 3, scale: 1 }).default("6.0"),
  isActive: boolean("isActive").default(true).notNull(),
  lastCrawledAt: bigint("lastCrawledAt", { mode: "number" }),
  totalCrawled: int("totalCrawled").default(0),
  totalAdopted: int("totalAdopted").default(0),
  // 定时自动采集字段
  autoCollectEnabled: boolean("autoCollectEnabled").default(false).notNull(),
  autoCollectCron: varchar("autoCollectCron", { length: 100 }), // cron表达式，如 "0 9 * * *"
  autoCollectInterval: mysqlEnum("autoCollectInterval", ["every_6h", "every_12h", "daily", "weekly", "custom"]).default("daily"),
  lastAutoCollectAt: bigint("lastAutoCollectAt", { mode: "number" }),
  nextAutoCollectAt: bigint("nextAutoCollectAt", { mode: "number" }),
  autoEvaluateEnabled: boolean("autoEvaluateEnabled").default(true).notNull(), // 采集后自动AI评估
  autoCollectMaxItems: int("autoCollectMaxItems").default(10), // 每次最多采集条目数
  consecutiveFailures: int("consecutiveFailures").default(0), // 连续失败次数
  createdAt: bigint("createdAt", { mode: "number" }).notNull(),
  updatedAt: bigint("updatedAt", { mode: "number" }).notNull(),
});

export type KbIntelSource = typeof kbIntelSources.$inferSelect;

export type InsertKbIntelSource = typeof kbIntelSources.$inferInsert;

// 采集日志表
export const kbIntelCollectLogs = mysqlTable("kb_intel_collect_logs", {
  id: int("id").autoincrement().primaryKey(),
  sourceId: int("sourceId").notNull(),
  userId: int("userId").notNull(),
  triggerType: mysqlEnum("triggerType", ["manual", "auto", "test"]).notNull(),
  status: mysqlEnum("status", ["running", "success", "partial", "failed"]).default("running").notNull(),
  totalFound: int("totalFound").default(0),
  totalNew: int("totalNew").default(0),
  totalDuplicate: int("totalDuplicate").default(0),
  totalEvaluated: int("totalEvaluated").default(0),
  totalRecommended: int("totalRecommended").default(0),
  errorMessage: text("errorMessage"),
  details: json("details"), // 详细采集结果
  startedAt: bigint("startedAt", { mode: "number" }).notNull(),
  completedAt: bigint("completedAt", { mode: "number" }),
  durationMs: int("durationMs"),
});

export type KbIntelCollectLog = typeof kbIntelCollectLogs.$inferSelect;

export type InsertKbIntelCollectLog = typeof kbIntelCollectLogs.$inferInsert;

// 采集到的情报条目
export const kbIntelItems = mysqlTable("kb_intel_items", {
  id: int("id").autoincrement().primaryKey(),
  sourceId: int("sourceId").notNull(),
  title: varchar("title", { length: 500 }).notNull(),
  author: varchar("author", { length: 200 }),
  originalUrl: varchar("originalUrl", { length: 1000 }).notNull(),
  publishedAt: bigint("publishedAt", { mode: "number" }),
  rawContent: text("rawContent").notNull(),
  aiSummary: text("aiSummary"),
  aiQualityScore: decimal("aiQualityScore", { precision: 3, scale: 1 }),
  aiScoreDetails: json("aiScoreDetails"),
  aiSuggestedType: mysqlEnum("aiSuggestedType", ["sop", "listing", "product", "image", "video"]),
  aiFormattedContent: text("aiFormattedContent"),
  status: mysqlEnum("status", ["pending", "recommended", "adopted", "ignored", "expired", "bookmarked"]).default("pending").notNull(),
  adoptedKbType: varchar("adoptedKbType", { length: 50 }),
  adoptedKbItemId: int("adoptedKbItemId"),
  reviewedBy: int("reviewedBy"),
  reviewedAt: bigint("reviewedAt", { mode: "number" }),
  createdAt: bigint("createdAt", { mode: "number" }).notNull(),
});

export type KbIntelItem = typeof kbIntelItems.$inferSelect;

export type InsertKbIntelItem = typeof kbIntelItems.$inferInsert;

// 知识库调用日志
export const kbCallLogs = mysqlTable("kb_call_logs", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  callerModule: varchar("callerModule", { length: 100 }).notNull(),
  callerAction: varchar("callerAction", { length: 100 }).notNull(),
  kbItemId: int("kbItemId").notNull(),
  kbItemType: varchar("kbItemType", { length: 50 }).notNull(),
  loadLevel: mysqlEnum("loadLevel", ["L1", "L2", "L3"]).notNull(),
  relevanceScore: decimal("relevanceScore", { precision: 3, scale: 2 }),
  createdAt: bigint("createdAt", { mode: "number" }).notNull(),
});

export type KbCallLog = typeof kbCallLogs.$inferSelect;

export type InsertKbCallLog = typeof kbCallLogs.$inferInsert;

// 用户反馈
export const kbFeedback = mysqlTable("kb_feedback", {
  id: int("id").autoincrement().primaryKey(),
  callLogId: int("callLogId"),
  conversationMessageId: int("conversationMessageId"),
  userId: int("userId").notNull(),
  kbItemId: int("kbItemId").notNull(),
  kbItemType: varchar("kbItemType", { length: 50 }).notNull(),
  rating: mysqlEnum("rating", ["helpful", "irrelevant", "wrong"]).notNull(),
  comment: text("comment"),
  createdAt: bigint("createdAt", { mode: "number" }).notNull(),
});

export type KbFeedback = typeof kbFeedback.$inferSelect;

export type InsertKbFeedback = typeof kbFeedback.$inferInsert;

// AI机器人对话
export const kbBotConversations = mysqlTable("kb_bot_conversations", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  title: varchar("title", { length: 255 }),
  lastMessageAt: bigint("lastMessageAt", { mode: "number" }),
  messageCount: int("messageCount").default(0),
  createdAt: bigint("createdAt", { mode: "number" }).notNull(),
  updatedAt: bigint("updatedAt", { mode: "number" }).notNull(),
});

export type KbBotConversation = typeof kbBotConversations.$inferSelect;

export type InsertKbBotConversation = typeof kbBotConversations.$inferInsert;

// 对话消息
export const kbBotMessages = mysqlTable("kb_bot_messages", {
  id: int("id").autoincrement().primaryKey(),
  conversationId: int("conversationId").notNull(),
  role: mysqlEnum("role", ["user", "assistant"]).notNull(),
  content: text("content").notNull(),
  references: json("references"),
  searchPath: json("searchPath"),
  tokensUsed: int("tokensUsed"),
  createdAt: bigint("createdAt", { mode: "number" }).notNull(),
});

export type KbBotMessage = typeof kbBotMessages.$inferSelect;

export type InsertKbBotMessage = typeof kbBotMessages.$inferInsert;

// ============ 图片知识库标签定义表 ============
export const kbTagDefinitions = mysqlTable("kb_tag_definitions", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(), // 创建者
  dimension: varchar("dimension", { length: 50 }).notNull(), // 维度名：category/color/style/imageType/sellingPoint/composition/imageBelong
  parentValue: varchar("parentValue", { length: 100 }), // 父级值（用于二级联动，如图片类型大类→子类）
  value: varchar("value", { length: 200 }).notNull(), // 标签值
  sortOrder: int("sortOrder").default(0).notNull(), // 排序
  isSystem: int("isSystem").default(0).notNull(), // 是否系统内置 (0=用户自定义, 1=系统内置)
  metadata: text("metadata"), // 扩展数据JSON（如风格参数：lightType/colorTemp/materialKeywords等）
  usageCount: int("usageCount").default(0).notNull(), // 使用计数（缓存）
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type KbTagDefinition = typeof kbTagDefinitions.$inferSelect;

export type InsertKbTagDefinition = typeof kbTagDefinitions.$inferInsert;
