import { bigint, boolean, decimal, int, json, mysqlEnum, mysqlTable, text, timestamp, varchar } from "drizzle-orm/mysql-core";

export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  phone: varchar("phone", { length: 20 }),
  password: varchar("password", { length: 256 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", [
    "super_admin", "admin", "ops_manager", "ops_specialist",
    "product_dev", "finance", "purchaser", "designer"
  ]).default("ops_specialist").notNull(),
  department: varchar("department", { length: 100 }),
  jobTitle: varchar("jobTitle", { length: 100 }),
  status: mysqlEnum("status", ["active", "disabled", "pending"]).default("active").notNull(),
  mustChangePassword: int("mustChangePassword").default(1),
  failedLoginAttempts: int("failedLoginAttempts").default(0),
  lockedUntil: timestamp("lockedUntil"),
  invitedBy: int("invitedBy"),
  lastPasswordChangedAt: timestamp("lastPasswordChangedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

// User role type for type-safe role checks
export type UserRole = "super_admin" | "admin" | "ops_manager" | "ops_specialist" | "product_dev" | "finance" | "purchaser" | "designer";

// Login logs table
export const loginLogs = mysqlTable("login_logs", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId"),
  loginMethod: mysqlEnum("loginMethod", ["password", "oauth"]).notNull(),
  loginIdentifier: varchar("loginIdentifier", { length: 320 }),
  ipAddress: varchar("ipAddress", { length: 45 }),
  userAgent: varchar("userAgent", { length: 512 }),
  success: int("success").notNull(),
  failReason: varchar("failReason", { length: 100 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type LoginLog = typeof loginLogs.$inferSelect;
export type InsertLoginLog = typeof loginLogs.$inferInsert;

// Usage statistics table (daily per-user aggregation)
export const usageStats = mysqlTable("usage_stats", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId"),
  statDate: varchar("statDate", { length: 10 }).notNull(),
  aiCallCount: int("aiCallCount").default(0),
  aiTokensUsed: bigint("aiTokensUsed", { mode: "number" }).default(0),
  scraperCallCount: int("scraperCallCount").default(0),
  storageUsedBytes: bigint("storageUsedBytes", { mode: "number" }).default(0),
  apiCallCount: int("apiCallCount").default(0),
  loginCount: int("loginCount").default(0),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type UsageStat = typeof usageStats.$inferSelect;
export type InsertUsageStat = typeof usageStats.$inferInsert;

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

// Role permissions configuration (dynamic, stored in DB)
export const rolePermissions = mysqlTable("role_permissions", {
  id: int("id").autoincrement().primaryKey(),
  role: varchar("role", { length: 50 }).notNull().unique(),
  modules: text("modules").notNull(), // JSON array of module IDs
  detailedPermissions: text("detailedPermissions"), // JSON: ModulePermission[] with operations & sub-modules
  description: varchar("description", { length: 200 }),
  updatedBy: int("updatedBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type RolePermission = typeof rolePermissions.$inferSelect;
export type InsertRolePermission = typeof rolePermissions.$inferInsert;

// Project assignments (admin assigns projects to team members)
export const projectAssignments = mysqlTable("project_assignments", {
  id: int("id").autoincrement().primaryKey(),
  projectId: int("projectId").notNull(),
  projectType: mysqlEnum("projectType", ["dev_project", "listing_project"]).default("dev_project").notNull(),
  assignedUserId: int("assignedUserId").notNull(),
  assignedBy: int("assignedBy").notNull(),
  permission: mysqlEnum("permission", ["read", "write"]).default("read").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type ProjectAssignment = typeof projectAssignments.$inferSelect;
export type InsertProjectAssignment = typeof projectAssignments.$inferInsert;

// SOP access grants
export const sopAccessGrants = mysqlTable("sop_access_grants", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  skillLevel: mysqlEnum("skillLevel", ["intermediate", "advanced"]).notNull(),
  grantedBy: int("grantedBy").notNull(),
  expiresAt: timestamp("expiresAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type SopAccessGrant = typeof sopAccessGrants.$inferSelect;
export type InsertSopAccessGrant = typeof sopAccessGrants.$inferInsert;

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

// Projects table - each project represents one product listing task
export const projects = mysqlTable("projects", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  brand: varchar("brand", { length: 255 }),
  productName: varchar("productName", { length: 500 }),
  category: varchar("category", { length: 255 }),
  targetMarket: varchar("targetMarket", { length: 100 }).default("US"),
  productFeatures: text("productFeatures"), // JSON array of features
  productSpecs: text("productSpecs"), // JSON object of specifications
  status: mysqlEnum("status", ["draft", "analyzing", "generating", "completed"]).default("draft").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Project = typeof projects.$inferSelect;
export type InsertProject = typeof projects.$inferInsert;

// Competitor analysis results
export const competitorAnalyses = mysqlTable("competitorAnalyses", {
  id: int("id").autoincrement().primaryKey(),
  projectId: int("projectId").notNull(),
  asin: varchar("asin", { length: 20 }).notNull(),
  title: text("title"),
  bulletPoints: text("bulletPoints"), // JSON array
  imageUrls: text("imageUrls"), // JSON array
  price: varchar("price", { length: 50 }),
  rating: varchar("rating", { length: 10 }),
  reviewCount: varchar("reviewCount", { length: 20 }),
  reviewAnalysis: text("reviewAnalysis"), // JSON: pain points, itch points, delight points
  keywords: text("keywords"), // JSON: core, long-tail, traffic
  rawData: text("rawData"), // Full raw data for reference
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type CompetitorAnalysis = typeof competitorAnalyses.$inferSelect;
export type InsertCompetitorAnalysis = typeof competitorAnalyses.$inferInsert;

// Generated listings
export const listings = mysqlTable("listings", {
  id: int("id").autoincrement().primaryKey(),
  projectId: int("projectId").notNull(),
  title: text("title"),
  bulletPoints: text("bulletPoints"), // JSON array of 5 bullet points
  description: text("description"),
  searchTerms: text("searchTerms"), // Backend keywords
  imageAdvice: text("imageAdvice"), // JSON: main image, sub images, A+ suggestions
  imageAdviceCn: text("imageAdviceCn"), // JSON: Chinese translation of image advice
  // Chinese translation fields
  titleCn: text("titleCn"),
  bulletPointsCn: text("bulletPointsCn"), // JSON array of 5 bullet points in Chinese
  descriptionCn: text("descriptionCn"),
  searchTermsCn: text("searchTermsCn"),
  // QA content fields
  qaContent: text("qaContent"), // JSON array of QA items
  qaContentCn: text("qaContentCn"), // JSON array of QA items in Chinese
  // Lock & checklist state
  lockedSteps: text("lockedSteps"), // JSON array of locked step numbers e.g. [1,2,3]
  checklistScores: text("checklistScores"), // JSON: { [bulletIndex]: { checkListScores, aiSemanticRelations } }
  version: int("version").default(1).notNull(),
  isActive: int("isActive").default(1).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Listing = typeof listings.$inferSelect;
export type InsertListing = typeof listings.$inferInsert;

// Review import history
export const reviewImports = mysqlTable("reviewImports", {
  id: int("id").autoincrement().primaryKey(),
  projectId: int("projectId").notNull(),
  userId: int("userId").notNull(),
  asin: varchar("asin", { length: 20 }).notNull(),
  filename: varchar("filename", { length: 500 }).notNull(),
  fileSize: int("fileSize"), // bytes
  totalRows: int("totalRows"),
  parsedRows: int("parsedRows"),
  skippedRows: int("skippedRows"),
  detectedFormat: varchar("detectedFormat", { length: 100 }),
  columns: text("columns"), // JSON array of column names
  analysisId: int("analysisId"), // linked competitor analysis ID
  status: mysqlEnum("status", ["pending", "analyzing", "completed", "failed"]).default("pending").notNull(),
  errorMessage: text("errorMessage"),
  metadata: text("metadata"), // JSON: additional info like brand, title, etc.
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type ReviewImport = typeof reviewImports.$inferSelect;
export type InsertReviewImport = typeof reviewImports.$inferInsert;

// Project analysis files (属性表, 竞品Listing, 出单词报告, ABA关键词)
export const projectFiles = mysqlTable("projectFiles", {
  id: int("id").autoincrement().primaryKey(),
  projectId: int("projectId").notNull(),
  userId: int("userId").notNull(),
  fileType: mysqlEnum("fileType", [
    "product_attributes",    // 本品属性表.txt (Rufus)
    "competitor_listings",   // 竞品Listing文本.txt
    "search_term_report",    // 竞品出单词报告.csv (COSMO)
    "aba_keywords",          // ABA关键词数据.csv (A9)
  ]).notNull(),
  filename: varchar("filename", { length: 500 }).notNull(),
  fileUrl: text("fileUrl"),           // S3 URL
  fileSize: int("fileSize"),           // bytes
  rawContent: text("rawContent"),      // parsed raw text/csv content
  parsedData: text("parsedData"),      // JSON: structured parsed result
  analysisResult: text("analysisResult"), // JSON: AI analysis result
  status: mysqlEnum("status", ["uploaded", "parsing", "parsed", "analyzing", "completed", "failed"]).default("uploaded").notNull(),
  errorMessage: text("errorMessage"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type ProjectFile = typeof projectFiles.$inferSelect;
export type InsertProjectFile = typeof projectFiles.$inferInsert;

// Analysis result version history
export const analysisVersions = mysqlTable("analysisVersions", {
  id: int("id").autoincrement().primaryKey(),
  projectFileId: int("projectFileId").notNull(),
  userId: int("userId").notNull(),
  version: int("version").default(1).notNull(),
  analysisResult: text("analysisResult").notNull(), // JSON snapshot of analysis result
  changeType: mysqlEnum("changeType", ["auto_analysis", "manual_edit", "re_analysis"]).default("auto_analysis").notNull(),
  changeNote: text("changeNote"), // Optional user note about what changed
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type AnalysisVersion = typeof analysisVersions.$inferSelect;
export type InsertAnalysisVersion = typeof analysisVersions.$inferInsert;

// Keywords table - stores all keywords for a project with multi-dimensional scoring
export const keywords = mysqlTable("keywords", {
  id: int("id").autoincrement().primaryKey(),
  projectId: int("projectId").notNull(),
  userId: int("userId").notNull(),
  keyword: varchar("keyword", { length: 500 }).notNull(),
  // Source tracking
  source: mysqlEnum("source", ["manual", "csv_import", "asin_reverse", "search_suggest", "review_extract", "ai_expand"]).default("manual").notNull(),
  sourceDetail: text("sourceDetail"), // e.g., which ASIN or tool
  // Three-dimensional scoring
  relevance: mysqlEnum("relevance", ["high", "medium", "low", "none"]).default("medium").notNull(),
  trafficLevel: mysqlEnum("trafficLevel", ["high", "medium", "low"]).default("medium").notNull(),
  competition: mysqlEnum("competition", ["high", "medium", "low"]).default("medium").notNull(),
  // Metrics from tools (卖家精灵/西柚找词)
  monthlySearchVolume: int("monthlySearchVolume"),
  spr: int("spr"), // SellerSprite Product Rank
  ppcBid: varchar("ppcBid", { length: 20 }), // PPC bid price
  naturalRank: int("naturalRank"), // organic rank from 西柚找词
  trafficScore: int("trafficScore"), // traffic score from 西柚找词
  // AI scene tagging (COSMO)
  sceneTags: text("sceneTags"), // JSON array: ["送礼", "户外旅行", "办公桌面"]
  intentTag: varchar("intentTag", { length: 100 }), // purchase intent tag
  // Word root classification (7 types)
  rootCategory: mysqlEnum("rootCategory", [
    "core",            // 核心词根
    "function",        // 功能词根
    "scene",           // 场景词根 (COSMO)
    "audience",        // 人群词根
    "spec",            // 规格词根
    "painpoint",       // 痛点词根
    "gift_holiday",    // 节日/礼品词根
    "brand_competitor" // 品牌词根（竞对品牌）
  ]),
  rootWord: varchar("rootWord", { length: 200 }), // extracted root word
  rootImpact: mysqlEnum("rootImpact", ["high", "medium", "low"]),
  // 3D Strategy Matrix category
  strategyCategory: mysqlEnum("strategyCategory", [
    "core_main",          // 核心主词
    "sub_core",           // 次核心词
    "precise_longtail",   // 精准长尾词
    "scene_intent",       // 场景意图词
    "longtail_main",      // 长尾主词
    "observe_test",       // 观察测试词
    "negative",           // 可删除/否定词
    "brand_offensive"     // 品牌进攻词（竞对品牌词）
  ]),
  // Listing placement suggestion
  listingPlacement: mysqlEnum("listingPlacement", [
    "title_front",      // 标题前段
    "title_mid",        // 标题中后段
    "title_end",        // 标题末尾
    "bullet_first",     // 五点描述首句
    "bullet_body",      // 五点描述自然融入
    "aplus",            // A+ 核心文案
    "search_term",      // 后台 Search Term
    "not_use"           // 绝对不使用
  ]),
  // Chinese translation
  translationCn: varchar("translation_cn", { length: 500 }),
  // AC recommended keyword flag
  isAcRecommended: int("is_ac_recommended").default(0).notNull(), // 0=no, 1=yes (AC推荐词)
  // Skip semantic filter flag (for keywords restored from negative library)
  skipSemanticFilter: int("skip_semantic_filter").default(0).notNull(), // 0=normal, 1=skip semantic filter
  // Status
  status: mysqlEnum("status", ["raw", "cleaned", "scored", "tagged", "finalized", "negative"]).default("raw").notNull(),
  isNegative: int("isNegative").default(0).notNull(), // 0=normal, 1=negative keyword
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Keyword = typeof keywords.$inferSelect;
export type InsertKeyword = typeof keywords.$inferInsert;

// Ad structure recommendations
export const adStructures = mysqlTable("adStructures", {
  id: int("id").autoincrement().primaryKey(),
  projectId: int("projectId").notNull(),
  userId: int("userId").notNull(),
  structureData: text("structureData"), // JSON: full ad structure recommendation
  structureDataCn: text("structureDataCn"), // JSON: Chinese version
  keywordCount: int("keywordCount").default(0),
  campaignCount: int("campaignCount").default(0),
  status: mysqlEnum("status", ["generating", "completed", "failed"]).default("generating").notNull(),
  errorMessage: text("errorMessage"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type AdStructure = typeof adStructures.$inferSelect;
export type InsertAdStructure = typeof adStructures.$inferInsert;

// Negative keywords library
export const negativeKeywords = mysqlTable("negativeKeywords", {
  id: int("id").autoincrement().primaryKey(),
  projectId: int("projectId").notNull(),
  userId: int("userId").notNull(),
  keyword: varchar("keyword", { length: 500 }).notNull(),
  isRoot: int("isRoot").default(0).notNull(), // 1=word root, 0=exact keyword
  reason: text("reason"), // why it's negative (English)
  reasonCn: text("reason_cn"), // Chinese translation of reason
  source: mysqlEnum("source", ["auto_filter", "manual", "ai_suggest", "word_freq"]).default("manual").notNull(),
  matchType: mysqlEnum("matchType", ["exact", "phrase", "broad"]).default("exact").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type NegativeKeyword = typeof negativeKeywords.$inferSelect;
export type InsertNegativeKeyword = typeof negativeKeywords.$inferInsert;

// Listing version history - snapshots of listing content for each change
export const listingVersions = mysqlTable("listingVersions", {
  id: int("id").autoincrement().primaryKey(),
  listingId: int("listingId").notNull(),
  projectId: int("projectId").notNull(),
  userId: int("userId").notNull(),
  versionNumber: int("versionNumber").default(1).notNull(),
  changeType: mysqlEnum("changeType", [
    "generate",       // Initial full generation
    "ab_apply",       // A/B test variant applied
    "optimize",       // AI optimization applied
    "manual_edit",    // Manual user edit
    "translate",      // Chinese translation added
  ]).notNull(),
  changeDescription: text("changeDescription"),
  // Snapshot of listing content at this version
  title: text("title"),
  bulletPoints: text("bulletPoints"),
  description: text("description"),
  searchTerms: text("searchTerms"),
  titleCn: text("titleCn"),
  bulletPointsCn: text("bulletPointsCn"),
  descriptionCn: text("descriptionCn"),
  searchTermsCn: text("searchTermsCn"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type ListingVersion = typeof listingVersions.$inferSelect;
export type InsertListingVersion = typeof listingVersions.$inferInsert;

// Review aggregation analysis - Kano model (pain/itch/delight points) across all competitors
export const reviewAggregations = mysqlTable("reviewAggregations", {
  id: int("id").autoincrement().primaryKey(),
  projectId: int("projectId").notNull(),
  userId: int("userId").notNull(),
  // Kano model analysis results (JSON arrays, each item: { point, frequency, severity/importance/impact, quotes, source })
  painPoints: text("painPoints"),     // JSON: [{ point, frequency, severity, quotes, sourceAsins }]
  itchPoints: text("itchPoints"),     // JSON: [{ point, frequency, importance, quotes, sourceAsins }]
  delightPoints: text("delightPoints"), // JSON: [{ point, frequency, impact, quotes, sourceAsins }]
  // Summary
  overallSentiment: text("overallSentiment"),
  keyThemes: text("keyThemes"),       // JSON array of key themes
  analysisCount: int("analysisCount").default(0), // number of competitor analyses included
  // Status
  status: mysqlEnum("status", ["pending", "analyzing", "completed", "failed"]).default("pending").notNull(),
  errorMessage: text("errorMessage"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type ReviewAggregation = typeof reviewAggregations.$inferSelect;
export type InsertReviewAggregation = typeof reviewAggregations.$inferInsert;

// ─── Selling Point Drafts (Step-by-step bullet generation) ──────
export const sellingPointDrafts = mysqlTable("sellingPointDrafts", {
  id: int("id").autoincrement().primaryKey(),
  projectId: int("projectId").notNull(),
  userId: int("userId").notNull(),
  // Selling point cores (JSON array of { theme, fabeDirection, keywords, confirmed })
  sellingPointCores: text("sellingPointCores"),
  // Generated bullets (JSON map of { index: { subtitle, fullText } })
  generatedBullets: text("generatedBullets"),
  // Confirmed bullets (JSON map of { index: boolean })
  confirmedBullets: text("confirmedBullets"),
  // Emphasis text used during generation
  emphasis: text("emphasis"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type SellingPointDraft = typeof sellingPointDrafts.$inferSelect;
export type InsertSellingPointDraft = typeof sellingPointDrafts.$inferInsert;

// ═══════════════════════════════════════════════════════════════════
// ─── Knowledge Base Module Tables ─────────────────────────────────
// ═══════════════════════════════════════════════════════════════════

// 智能产品创意库
export const kbProductInnovations = mysqlTable("kb_product_innovations", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
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

export type KbImageSet = typeof kbImageSets.$inferSelect;
export type InsertKbImageSet = typeof kbImageSets.$inferInsert;

// 智能图片知识库 - 单张图片分析
export const kbImages = mysqlTable("kb_images", {
  id: int("id").autoincrement().primaryKey(),
  imageSetId: int("imageSetId").notNull(),
  imageUrl: varchar("imageUrl", { length: 1024 }).notNull(), // S3 URL
  imagePosition: mysqlEnum("imagePosition", ["main", "secondary", "aplus", "brand_story"]).notNull(),
  positionIndex: int("positionIndex"), // e.g. secondary image #2
  // Four-dimension tags
  tagCategory: varchar("tagCategory", { length: 64 }),
  tagColorScheme: varchar("tagColorScheme", { length: 64 }),
  tagImageType: varchar("tagImageType", { length: 64 }),
  tagDesignStyle: varchar("tagDesignStyle", { length: 64 }),
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

// 智能运营SOP知识库
export const kbOperationSkills = mysqlTable("kb_operation_skills", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
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

// ═════════════════════════════════════════════════════════════════
// ─── Module 1: 智能产品开发分析 (Product Development AI Analysis) ──
// ════════════════════════════════════════════════════════════════════

// 产品开发项目
export const devProjects = mysqlTable("dev_projects", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  targetMarket: varchar("targetMarket", { length: 100 }).default("US"),
  platform: varchar("platform", { length: 50 }).default("amazon"),
  keywords: text("keywords"), // JSON array of search keywords
  status: mysqlEnum("status", ["draft", "data_collection", "analyzing", "scoring", "completed", "archived"]).default("draft").notNull(),
  phase: mysqlEnum("phase", ["market_analysis", "project_execution"]).default("market_analysis").notNull(),
  approvedAt: timestamp("approvedAt"),
  approvedScore: int("approvedScore"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type DevProject = typeof devProjects.$inferSelect;
export type InsertDevProject = typeof devProjects.$inferInsert;

// 上传文件记录
export const devUploadedFiles = mysqlTable("dev_uploaded_files", {
  id: int("id").autoincrement().primaryKey(),
  projectId: int("projectId").notNull(),
  userId: int("userId").notNull(),
  fileType: mysqlEnum("fileType", ["sales", "bullet_points", "reviews", "history_sales"]).notNull(),
  filename: varchar("filename", { length: 500 }).notNull(),
  fileUrl: text("fileUrl"), // S3 URL
  fileSize: int("fileSize"),
  parsedData: text("parsedData"), // JSON: structured parsed result
  totalRows: int("totalRows"),
  status: mysqlEnum("status", ["uploaded", "parsing", "parsed", "failed"]).default("uploaded").notNull(),
  confirmed: int("confirmed").default(0).notNull(), // 0=未确认, 1=已确认保存
  confirmedAt: timestamp("confirmedAt"), // 确认保存时间
  errorMessage: text("errorMessage"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type DevUploadedFile = typeof devUploadedFiles.$inferSelect;
export type InsertDevUploadedFile = typeof devUploadedFiles.$inferInsert;

// 产品数据
export const devProducts = mysqlTable("dev_products", {
  id: int("id").autoincrement().primaryKey(),
  projectId: int("projectId").notNull(),
  asin: varchar("asin", { length: 20 }),
  title: text("title"),
  brand: varchar("brand", { length: 255 }),
  price: varchar("price", { length: 50 }),
  rating: varchar("rating", { length: 10 }),
  reviewCount: varchar("reviewCount", { length: 20 }),
  monthlySales: int("monthlySales"),
  bsr: int("bsr"),
  bulletPoints: text("bulletPoints"), // JSON array
  monthlySalesHistory: text("monthlySalesHistory"), // JSON: monthly sales data
  tags: text("tags"), // JSON: AI-generated tags (14 dimensions)
  tagStatus: mysqlEnum("tagStatus", ["pending", "tagged", "confirmed"]).default("pending").notNull(),
  // --- 扩展字段 (Phase 1 优化) ---
  monthlyRevenue: decimal("monthlyRevenue", { precision: 12, scale: 2 }), // 月销售额
  listingDate: varchar("listingDate", { length: 50 }), // 上架时间
  fulfillment: varchar("fulfillment", { length: 20 }), // FBA/FBM
  sellerName: varchar("sellerName", { length: 255 }), // 卖家名称
  sellerLocation: varchar("sellerLocation", { length: 100 }), // 卖家所在地
  variantCount: int("variantCount"), // 变体数量
  category: varchar("category", { length: 255 }), // 类目
  subcategory: varchar("subcategory", { length: 255 }), // 子类目
  monthlyRevenueHistory: text("monthlyRevenueHistory"), // JSON: 月度销售额历史
  specifications: text("specifications"), // JSON: 详细参数键值对
  description: text("description"), // 产品描述
  imageUrl: text("imageUrl"), // 产品图片URL
  searchRank: int("searchRank"), // 搜索排名
  // --- 全景分析表扩展字段 ---
  parentAsin: varchar("parentAsin", { length: 20 }), // 父ASIN
  sku: varchar("sku", { length: 100 }), // SKU
  productLink: text("productLink"), // 商品链接
  categoryPath: text("categoryPath"), // 完整类目路径
  bsrLarge: int("bsrLarge"), // 大类BSR
  bsrSmall: int("bsrSmall"), // 小类BSR
  bsrGrowthRate: varchar("bsrGrowthRate", { length: 50 }), // 大类BSR增长率
  fbaFee: varchar("fbaFee", { length: 50 }), // FBA费用
  grossMargin: varchar("grossMargin", { length: 50 }), // 毛利率
  monthlySalesGrowth: varchar("monthlySalesGrowth", { length: 50 }), // 月销量增长率
  childSales: int("childSales"), // 子体销量
  childRevenue: decimal("childRevenue", { precision: 12, scale: 2 }), // 子体销售额
  monthlyNewReviews: int("monthlyNewReviews"), // 月新增评分数
  reviewRate: varchar("reviewRate", { length: 50 }), // 留评率
  lqs: int("lqs"), // Listing质量分
  sellerCount: int("sellerCount"), // 卖家数
  listingDays: int("listingDays"), // 上架天数
  buyboxSeller: varchar("buyboxSeller", { length: 255 }), // Buybox卖家
  buyboxType: varchar("buyboxType", { length: 50 }), // BuyBox类型
  hasAPlus: int("hasAPlus").default(0), // A+页面
  hasVideo: int("hasVideo").default(0), // 视频介绍
  hasBrandStory: int("hasBrandStory").default(0), // 品牌故事
  hasAmazonChoice: int("hasAmazonChoice").default(0), // Amazon's Choice
  productWeight: varchar("productWeight", { length: 100 }), // 商品重量
  productSize: varchar("productSize", { length: 200 }), // 商品尺寸
  packageWeight: varchar("packageWeight", { length: 100 }), // 包装重量
  packageSize: varchar("packageSize", { length: 200 }), // 包装尺寸
  packageSizeTier: varchar("packageSizeTier", { length: 100 }), // 包装尺寸分段
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type DevProduct = typeof devProducts.$inferSelect;
export type InsertDevProduct = typeof devProducts.$inferInsert;

// 评论数据
export const devReviews = mysqlTable("dev_reviews", {
  id: int("id").autoincrement().primaryKey(),
  projectId: int("projectId").notNull(),
  asin: varchar("asin", { length: 20 }),
  title: text("title"),
  content: text("content"),
  rating: int("rating"),
  reviewDate: varchar("reviewDate", { length: 50 }),
  isVP: int("isVP").default(0), // verified purchase
  variant: varchar("variant", { length: 255 }),
  helpfulCount: int("helpfulCount").default(0),
  // --- 扩展字段 (Phase 1 优化) ---
  isVine: int("isVine").default(0), // Vine评论
  hasImage: int("hasImage").default(0), // 含图片
  hasVideo: int("hasVideo").default(0), // 含视频
  reviewerName: varchar("reviewerName", { length: 255 }), // 评论人
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type DevReview = typeof devReviews.$inferSelect;
export type InsertDevReview = typeof devReviews.$inferInsert;

// 自定义标签维度
export const devTagDimensions = mysqlTable("dev_tag_dimensions", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  name: varchar("name", { length: 100 }).notNull(),
  category: varchar("category", { length: 100 }),
  description: text("description"),
  isDefault: int("isDefault").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type DevTagDimension = typeof devTagDimensions.$inferSelect;
export type InsertDevTagDimension = typeof devTagDimensions.$inferInsert;

// 分析阶段状态表 (Phase 1 优化)
export const devAnalysisStages = mysqlTable("dev_analysis_stages", {
  id: int("id").autoincrement().primaryKey(),
  projectId: int("projectId").notNull(),
  userId: int("userId").notNull(),
  stageType: mysqlEnum("stageType", [
    "data_parsing", "tag_annotation", "market_overview",
    "product_attributes", "price_analysis", "brand_competition",
    "review_analysis", "decision_dashboard",
    "attribute_tagging", "attribute_cross", "review_kano"
  ]).notNull(),
  status: mysqlEnum("status", ["pending", "generating", "generated", "editing", "confirmed", "running", "completed"]).default("pending"),
  rawResult: text("rawResult"), // AI生成的原始结果(JSON)
  editedResult: text("editedResult"), // 用户编辑后的结果(JSON)
  chartConfig: text("chartConfig"), // 图表配置(JSON)
  confirmedAt: timestamp("confirmedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type DevAnalysisStage = typeof devAnalysisStages.$inferSelect;
export type InsertDevAnalysisStage = typeof devAnalysisStages.$inferInsert;

// 产品属性标签表 (Phase 1 优化)
export const devProductTags = mysqlTable("dev_product_tags", {
  id: int("id").autoincrement().primaryKey(),
  projectId: int("projectId").notNull(),
  asin: varchar("asin", { length: 20 }).notNull(),
  dimensionName: varchar("dimensionName", { length: 100 }).notNull(), // 属性维度名称
  dimensionValue: varchar("dimensionValue", { length: 255 }).notNull(), // 属性值
  source: mysqlEnum("source", ["ai", "manual", "specification"]).default("ai"), // 标签来源
  confirmed: int("confirmed").default(0), // 是否已确认
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type DevProductTag = typeof devProductTags.$inferSelect;
export type InsertDevProductTag = typeof devProductTags.$inferInsert;

// 站外数据记录
export const devExternalData = mysqlTable("dev_external_data", {
  id: int("id").autoincrement().primaryKey(),
  projectId: int("projectId").notNull(),
  userId: int("userId").notNull(),
  dataType: mysqlEnum("dataType", [
    "google_trends", "youtube_kol", "tiktok_kol",
    "facebook_ads", "competitor_site", "crowdfunding"
  ]).notNull(),
  query: varchar("query", { length: 500 }),
  rawData: text("rawData"), // JSON: raw API response
  aiSummary: text("aiSummary"), // AI-generated summary
  status: mysqlEnum("status", ["fetching", "analyzing", "completed", "failed"]).default("fetching").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type DevExternalData = typeof devExternalData.$inferSelect;
export type InsertDevExternalData = typeof devExternalData.$inferInsert;

// 分析报告
export const devAnalysisReports = mysqlTable("dev_analysis_reports", {
  id: int("id").autoincrement().primaryKey(),
  projectId: int("projectId").notNull(),
  userId: int("userId").notNull(),
  reportType: mysqlEnum("reportType", [
    "market_overview", "product_analysis", "price_analysis",
    "brand_analysis", "competitor_analysis", "review_analysis",
    "review_analysis_recent_2y", "external_analysis", "ai_summary"
  ]).notNull(),
  title: varchar("title", { length: 255 }),
  content: text("content"), // JSON: { summary, chartData, confirmed }
  status: mysqlEnum("status", ["generating", "completed", "failed"]).default("generating").notNull(),
  errorMessage: text("errorMessage"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type DevAnalysisReport = typeof devAnalysisReports.$inferSelect;
export type InsertDevAnalysisReport = typeof devAnalysisReports.$inferInsert;

// 立项评分
export const devProjectScores = mysqlTable("dev_project_scores", {
  id: int("id").autoincrement().primaryKey(),
  projectId: int("projectId").notNull(),
  userId: int("userId").notNull(),
  marketCapacity: int("marketCapacity").default(0), // 0-20
  differentiation: int("differentiation").default(0),
  competitiveness: int("competitiveness").default(0),
  entryOpportunity: int("entryOpportunity").default(0),
  profit: int("profit").default(0),
  risk: int("risk").default(0),
  totalScore: int("totalScore").default(0), // sum of above
  aiReasoning: text("aiReasoning"), // JSON: reasoning for each dimension
  recommendation: mysqlEnum("recommendation", ["approve", "review", "reject"]).default("review").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type DevProjectScore = typeof devProjectScores.$inferSelect;
export type InsertDevProjectScore = typeof devProjectScores.$inferInsert;

// 产品画像
export const devProductProfiles = mysqlTable("dev_product_profiles", {
  id: int("id").autoincrement().primaryKey(),
  projectId: int("projectId").notNull(),
  userId: int("userId").notNull(),
  // 8 sub-modules: each has aiSuggestion + userEdit + confirmed flag
  appearanceColors: text("appearanceColors"), // JSON: user-edited data for 外观设计
  appearanceAiSuggestion: text("appearanceAiSuggestion"), // JSON: AI suggestion
  appearanceConfirmed: int("appearanceConfirmed").default(0).notNull(),
  mainFunctions: text("mainFunctions"), // JSON: user-edited data for 功能提升
  functionsAiSuggestion: text("functionsAiSuggestion"),
  functionsConfirmed: int("functionsConfirmed").default(0).notNull(),
  costBreakdown: text("costBreakdown"), // JSON: user-edited data for 产品成本
  costAiSuggestion: text("costAiSuggestion"),
  costConfirmed: int("costConfirmed").default(0).notNull(),
  packageDimensions: text("packageDimensions"), // JSON: user-edited data for 包装设计
  packageAiSuggestion: text("packageAiSuggestion"),
  packageConfirmed: int("packageConfirmed").default(0).notNull(),
  packageDesign: text("packageDesign"), // JSON: user-edited data for 包装外观
  packageDesignAiSuggestion: text("packageDesignAiSuggestion"),
  packageDesignConfirmed: int("packageDesignConfirmed").default(0).notNull(),
  userPersona: text("userPersona"), // JSON: user-edited data for 用户画像
  userPersonaAiSuggestion: text("userPersonaAiSuggestion"),
  userPersonaConfirmed: int("userPersonaConfirmed").default(0).notNull(),
  usageScenarios: text("usageScenarios"), // JSON: user-edited data for 使用场景
  usageScenariosAiSuggestion: text("usageScenariosAiSuggestion"),
  usageScenariosConfirmed: int("usageScenariosConfirmed").default(0).notNull(),
  productMap: text("productMap"), // JSON: user-edited data for 产品地图
  productMapAiSuggestion: text("productMapAiSuggestion"),
  productMapConfirmed: int("productMapConfirmed").default(0).notNull(),
  status: mysqlEnum("status", ["draft", "confirmed"]).default("draft").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type DevProductProfile = typeof devProductProfiles.$inferSelect;
export type InsertDevProductProfile = typeof devProductProfiles.$inferInsert;

// 产品说明书 - 三步流程: AI生成9章节 → 编辑确认+上传素材 → 双语HTML+PDF
export const devProductManuals = mysqlTable("dev_product_manuals", {
  id: int("id").autoincrement().primaryKey(),
  projectId: int("projectId").notNull(),
  userId: int("userId").notNull(),
  brandName: varchar("brandName", { length: 255 }),
  logoUrl: text("logoUrl"),
  coverImageUrl: text("coverImageUrl"),
  qrCodeUrl: text("qrCodeUrl"),
  contentSections: text("contentSections"), // JSON: array of 9 chapters { key, titleEn, titleEs, contentEn, contentEs, confirmed }
  spanishContent: text("spanishContent"), // JSON: Spanish version content
  brandAssets: text("brandAssets"), // JSON: { logo, cover, qrCode, otherAssets[] }
  htmlEnUrl: text("htmlEnUrl"), // S3 URL for English HTML manual
  htmlEsUrl: text("htmlEsUrl"), // S3 URL for Spanish HTML manual
  pdfEnUrl: text("pdfEnUrl"), // S3 URL for English PDF
  pdfEsUrl: text("pdfEsUrl"), // S3 URL for Spanish PDF
  contentStatus: mysqlEnum("contentStatus", ["draft", "editing", "confirmed"]).default("draft").notNull(),
  finalManualUrl: text("finalManualUrl"), // S3 URL for final combined PDF
  // Theme & style configuration
  themeStyle: varchar("themeStyle", { length: 50 }).default("classic"), // classic|modern|minimal|business|creative
  themeColor: varchar("themeColor", { length: 50 }).default("#1a1a2e"), // Primary color hex
  fontScheme: varchar("fontScheme", { length: 50 }).default("default"), // default|serif|sans|elegant|tech
  // Reference manual
  referenceManualUrl: text("referenceManualUrl"), // Uploaded reference manual PDF/image URL
  referenceManualNotes: text("referenceManualNotes"), // AI analysis notes from reference
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type DevProductManual = typeof devProductManuals.$inferSelect;
export type InsertDevProductManual = typeof devProductManuals.$inferInsert;

// 测试报告 - 8类测试(安装/使用/跌落/运输/功能/耐久性/安全/包装) + 状态追踪 + Excel导出
export const devTestReports = mysqlTable("dev_test_reports", {
  id: int("id").autoincrement().primaryKey(),
  projectId: int("projectId").notNull(),
  userId: int("userId").notNull(),
  // JSON: array of { category, nameEn, nameCn, descEn, descCn, requirement, passStandard, testMethod, testStatus: 'pass'|'fail'|'pending', actualResult, notes }
  testItems: text("testItems"),
  reportContent: text("reportContent"), // JSON: summary and additional notes
  excelUrl: text("excelUrl"), // S3 URL for exported Excel
  status: mysqlEnum("status", ["draft", "editing", "confirmed"]).default("draft").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type DevTestReport = typeof devTestReports.$inferSelect;
export type InsertDevTestReport = typeof devTestReports.$inferInsert;

// BOM物料清单
export const devBomItems = mysqlTable("dev_bom_items", {
  id: int("id").autoincrement().primaryKey(),
  projectId: int("projectId").notNull(),
  userId: int("userId").notNull(),
  parentId: int("parentId"), // null = top-level, otherwise references parent BOM item
  level: int("level").default(0), // 0=main, 1=sub, 2=raw material
  partName: varchar("partName", { length: 255 }).notNull(),
  material: varchar("material", { length: 255 }),
  process: varchar("process", { length: 255 }),
  specification: text("specification"),
  quantity: int("quantity").default(1),
  unitPrice: varchar("unitPrice", { length: 50 }),
  subtotal: varchar("subtotal", { length: 50 }),
  remark: text("remark"),
  supplierGlobalId: int("supplierGlobalId"),
  supplierName: varchar("supplierName", { length: 255 }),
  sortOrder: int("sortOrder").default(0),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type DevBomItem = typeof devBomItems.$inferSelect;
export type InsertDevBomItem = typeof devBomItems.$inferInsert;

// 模具费用
export const devMoldCosts = mysqlTable("dev_mold_costs", {
  id: int("id").autoincrement().primaryKey(),
  projectId: int("projectId").notNull(),
  userId: int("userId").notNull(),
  partName: varchar("partName", { length: 255 }).notNull(),
  moldType: varchar("moldType", { length: 100 }),
  moldMaterial: varchar("moldMaterial", { length: 100 }),
  cavities: int("cavities"),
  estimatedCost: varchar("estimatedCost", { length: 50 }),
  leadTimeDays: int("leadTimeDays"),
  remark: text("remark"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type DevMoldCost = typeof devMoldCosts.$inferSelect;
export type InsertDevMoldCost = typeof devMoldCosts.$inferInsert;

// 时间规划
export const devTimePlans = mysqlTable("dev_time_plans", {
  id: int("id").autoincrement().primaryKey(),
  projectId: int("projectId").notNull(),
  userId: int("userId").notNull(),
  phaseName: varchar("phaseName", { length: 255 }).notNull(),
  estimatedDays: int("estimatedDays"),
  startOffset: int("startOffset"), // days from project start
  description: text("description"),
  status: varchar("status", { length: 50 }).default("pending"), // pending, in_progress, completed
  color: varchar("color", { length: 20 }), // hex color for Gantt chart
  dependsOn: int("dependsOn"), // id of the phase this depends on
  sortOrder: int("sortOrder").default(0),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type DevTimePlan = typeof devTimePlans.$inferSelect;
export type InsertDevTimePlan = typeof devTimePlans.$inferInsert;

// 项目供应商
export const devSuppliers = mysqlTable("dev_suppliers", {
  id: int("id").autoincrement().primaryKey(),
  projectId: int("projectId").notNull(),
  userId: int("userId").notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  factoryScale: varchar("factoryScale", { length: 100 }),
  employeeCount: varchar("employeeCount", { length: 50 }),
  rdStaffCount: varchar("rdStaffCount", { length: 50 }),
  qualityCerts: text("qualityCerts"),
  productQuality: int("productQuality"), // 1-10
  yieldRate: varchar("yieldRate", { length: 20 }),
  deliveryScore: int("deliveryScore"), // 1-10
  priceScore: int("priceScore"), // 1-10
  overallScore: int("overallScore"), // 1-10
  specialties: text("specialties"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type DevSupplier = typeof devSuppliers.$inferSelect;
export type InsertDevSupplier = typeof devSuppliers.$inferInsert;

// BOM成本汇总
export const devBomSummary = mysqlTable("dev_bom_summary", {
  id: int("id").autoincrement().primaryKey(),
  projectId: int("projectId").notNull(),
  userId: int("userId").notNull(),
  materialCost: varchar("materialCost", { length: 50 }),
  moldAmortizationQty: int("moldAmortizationQty"),
  moldAmortizationCost: varchar("moldAmortizationCost", { length: 50 }),
  packagingCost: varchar("packagingCost", { length: 50 }),
  laborCost: varchar("laborCost", { length: 50 }),
  shippingCost: varchar("shippingCost", { length: 50 }),
  otherCost: varchar("otherCost", { length: 50 }),
  totalUnitCost: varchar("totalUnitCost", { length: 50 }),
  targetPrice: varchar("targetPrice", { length: 50 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type DevBomSummary = typeof devBomSummary.$inferSelect;
export type InsertDevBomSummary = typeof devBomSummary.$inferInsert;

// 利润计算记录
export const devProfitCalculations = mysqlTable("dev_profit_calculations", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  projectId: int("projectId"), // optional, can be standalone
  name: varchar("name", { length: 255 }),
  sellingPrice: varchar("sellingPrice", { length: 50 }),
  productCost: varchar("productCost", { length: 50 }),
  fbaFee: varchar("fbaFee", { length: 50 }),
  referralFeeRate: varchar("referralFeeRate", { length: 20 }),
  adSpend: varchar("adSpend", { length: 50 }),
  otherCost: varchar("otherCost", { length: 50 }),
  profit: varchar("profit", { length: 50 }),
  profitMargin: varchar("profitMargin", { length: 20 }),
  roi: varchar("roi", { length: 20 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type DevProfitCalculation = typeof devProfitCalculations.$inferSelect;
export type InsertDevProfitCalculation = typeof devProfitCalculations.$inferInsert;

// 全局供应商库
export const devGlobalSuppliers = mysqlTable("dev_global_suppliers", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  contactPerson: varchar("contactPerson", { length: 100 }),
  phone: varchar("phone", { length: 50 }),
  email: varchar("email", { length: 320 }),
  address: text("address"),
  categories: text("categories"), // JSON array
  website: varchar("website", { length: 500 }),
  qualityCerts: text("qualityCerts"),
  overallScore: int("overallScore"), // 1-10
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type DevGlobalSupplier = typeof devGlobalSuppliers.$inferSelect;
export type InsertDevGlobalSupplier = typeof devGlobalSuppliers.$inferInsert;

// ═══════════════════════════════════════════════════════════════════
// ─── Image Workflow (5-Step Image Suggestion Pipeline) ────────────
// ═══════════════════════════════════════════════════════════════════

export const imageWorkflowSessions = mysqlTable("image_workflow_sessions", {
  id: int("id").autoincrement().primaryKey(),
  projectId: int("projectId").notNull(),
  userId: int("userId").notNull(),
  currentStep: int("currentStep").default(1).notNull(), // 1-6

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

  // Step 4: Reference images (per-image composition + effect reference URLs)
  step4CompositionRefs: text("step4CompositionRefs"),  // JSON: { [imageKey]: url } per-image composition reference
  step4EffectRefs: text("step4EffectRefs"),            // JSON: { [imageKey]: url } per-image effect reference
  // Step 5: A+ module selection
  step5SelectedModule: text("step5SelectedModule"),    // JSON: selected A+ module type for re-optimization
  step5OptimizedResult: text("step5OptimizedResult"),  // JSON: re-optimized result after module selection
  step5OptimizedResultCn: text("step5OptimizedResultCn"), // JSON: Chinese version of re-optimized result
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


// Off-site analysis table - stores analysis tasks for external platforms
export const devOffsiteAnalyses = mysqlTable("dev_offsite_analyses", {
  id: int("id").autoincrement().primaryKey(),
  projectId: int("project_id").notNull(),
  userId: varchar("user_id", { length: 255 }).notNull(),
  sourceType: mysqlEnum("source_type", [
    "google_trends", "youtube", "tiktok", "facebook",
    "independent_site", "reddit", "crowdfunding"
  ]).notNull(),
  keyword: varchar("keyword", { length: 500 }).notNull(),
  status: mysqlEnum("status", ["pending", "running", "completed", "failed"]).notNull().default("pending"),
  rawData: json("raw_data"),
  aiAnalysis: text("ai_analysis"),
  aiAnalysisConfirmed: int("ai_analysis_confirmed").default(0).notNull(),
  editedAnalysis: text("edited_analysis"),
  errorMessage: text("error_message"),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
  updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
});
export type DevOffsiteAnalysis = typeof devOffsiteAnalyses.$inferSelect;
export type InsertDevOffsiteAnalysis = typeof devOffsiteAnalyses.$inferInsert;

// ═══════════════════════════════════════════════════════════════════
// ─── Project-Level Tag Management (7 Categories) ─────────────────
// ═══════════════════════════════════════════════════════════════════

// 全景分析表确认状态
export const devPanoramaStatus = mysqlTable("dev_panorama_status", {
  id: int("id").autoincrement().primaryKey(),
  projectId: int("projectId").notNull(),
  userId: int("userId").notNull(),
  confirmed: int("confirmed").default(0).notNull(), // 0=未确认, 1=已确认
  confirmedAt: timestamp("confirmedAt"),
  lastMergedAt: timestamp("lastMergedAt"),
  totalProducts: int("totalProducts").default(0),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type DevPanoramaStatus = typeof devPanoramaStatus.$inferSelect;
export type InsertDevPanoramaStatus = typeof devPanoramaStatus.$inferInsert;

// 项目级标签分类表（每个项目独立的7类标签分类）
export const devProjectTagCategories = mysqlTable("dev_project_tag_categories", {
  id: int("id").autoincrement().primaryKey(),
  projectId: int("projectId").notNull(),
  userId: int("userId").notNull(),
  categoryKey: varchar("categoryKey", { length: 50 }).notNull(), // e.g. "basic", "material", "function", "parameter", "installation", "certification", "special"
  categoryName: varchar("categoryName", { length: 100 }).notNull(), // 用户可编辑的分类名称
  description: text("description"), // 分类说明
  sortOrder: int("sortOrder").default(0).notNull(),
  confirmed: int("confirmed").default(0).notNull(), // 0=未确认, 1=已确认
  confirmedAt: timestamp("confirmedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type DevProjectTagCategory = typeof devProjectTagCategories.$inferSelect;
export type InsertDevProjectTagCategory = typeof devProjectTagCategories.$inferInsert;

// 项目级标签项表（每个分类下的具体标签）
export const devProjectTagItems = mysqlTable("dev_project_tag_items", {
  id: int("id").autoincrement().primaryKey(),
  categoryId: int("categoryId").notNull(), // 关联 devProjectTagCategories.id
  projectId: int("projectId").notNull(),
  tagName: varchar("tagName", { length: 255 }).notNull(), // 标签名称
  tagValue: text("tagValue"), // 标签值/描述（可选，用于参数属性等需要值的场景）
  source: mysqlEnum("source", ["ai", "manual"]).default("ai").notNull(), // 来源
  sourceEvidence: text("sourceEvidence"), // 原文依据：标签来源的原文片段，用于验证标签真实性
  sortOrder: int("sortOrder").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type DevProjectTagItem = typeof devProjectTagItems.$inferSelect;
export type InsertDevProjectTagItem = typeof devProjectTagItems.$inferInsert;


// 子模块锁定状态 - 每个项目的每个子模块独立锁定
export const devModuleLocks = mysqlTable("dev_module_locks", {
  id: int("id").autoincrement().primaryKey(),
  projectId: int("projectId").notNull(),
  userId: int("userId").notNull(),
  moduleName: mysqlEnum("moduleName", ["profile", "bom", "manual", "test", "profit"]).notNull(),
  isLocked: boolean("isLocked").default(false).notNull(),
  lockedAt: timestamp("lockedAt"),
  unlockedAt: timestamp("unlockedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type DevModuleLock = typeof devModuleLocks.$inferSelect;
export type InsertDevModuleLock = typeof devModuleLocks.$inferInsert;

// 说明书素材 - 独立存储各类素材
export const devManualAssets = mysqlTable("dev_manual_assets", {
  id: int("id").autoincrement().primaryKey(),
  projectId: int("projectId").notNull(),
  userId: int("userId").notNull(),
  assetType: mysqlEnum("assetType", ["logo", "cover", "content_bg", "qrcode", "chapter_image", "reference", "other"]).notNull(),
  chapterKey: varchar("chapterKey", { length: 100 }), // for chapter-specific assets
  fileName: varchar("fileName", { length: 255 }),
  fileUrl: text("fileUrl").notNull(), // S3 URL
  sortOrder: int("sortOrder").default(0),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type DevManualAsset = typeof devManualAssets.$inferSelect;
export type InsertDevManualAsset = typeof devManualAssets.$inferInsert;


// ═══════════════════════════════════════════════════════════════════════
// System Settings - global configuration (proxy, API keys, etc.)
// ═══════════════════════════════════════════════════════════════════════

export const systemSettings = mysqlTable("system_settings", {
  id: int("id").autoincrement().primaryKey(),
  settingKey: varchar("settingKey", { length: 100 }).notNull().unique(),
  settingValue: text("settingValue"), // JSON or plain text
  description: varchar("description", { length: 500 }),
  category: varchar("category", { length: 50 }).default("general"), // proxy, api, general
  isEncrypted: boolean("isEncrypted").default(false),
  updatedBy: int("updatedBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type SystemSetting = typeof systemSettings.$inferSelect;
export type InsertSystemSetting = typeof systemSettings.$inferInsert;


// In-app notifications for review workflow
export const notifications = mysqlTable("notifications", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(), // recipient
  type: mysqlEnum("type", [
    "review_submitted", "review_approved", "review_rejected",
    "project_assigned", "system_alert", "todo_due_soon", "todo_overdue"
  ]).notNull(),
  title: varchar("title", { length: 200 }).notNull(),
  content: text("content"),
  relatedType: varchar("relatedType", { length: 50 }), // e.g., "kb_product", "kb_listing"
  relatedId: int("relatedId"), // ID of the related item
  isRead: int("isRead").default(0).notNull(), // 0=unread, 1=read
  createdBy: int("createdBy"), // who triggered the notification
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type Notification = typeof notifications.$inferSelect;
export type InsertNotification = typeof notifications.$inferInsert;

// ============== Module 3: Operations (领星ERP Data) ==============

// Lingxing API config & token cache
export const lingxingConfig = mysqlTable("lingxing_config", {
  id: int("id").autoincrement().primaryKey(),
  configKey: varchar("config_key", { length: 100 }).notNull().unique(),
  configValue: text("config_value"),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

// Lingxing API call logs
export const lingxingApiLogs = mysqlTable("lingxing_api_logs", {
  id: int("id").autoincrement().primaryKey(),
  endpoint: varchar("endpoint", { length: 200 }).notNull(),
  method: varchar("method", { length: 10 }).notNull(),
  statusCode: varchar("status_code", { length: 20 }),
  duration: int("duration"), // ms
  isMock: int("is_mock").default(0),
  errorMsg: text("error_msg"),
  userId: int("user_id"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

// Inventory configuration (per-SKU replenishment params)
export const inventoryConfig = mysqlTable("inventory_config", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("user_id").notNull(),
  sellerSku: varchar("seller_sku", { length: 100 }).notNull(),
  marketplace: varchar("marketplace", { length: 10 }).default("US"),
  // Replenishment params
  leadTimeDays: int("lead_time_days").default(30),
  safetyStockDays: int("safety_stock_days").default(14),
  reviewCycleDays: int("review_cycle_days").default(7),
  moq: int("moq").default(100), // Minimum order quantity
  packSize: int("pack_size").default(1),
  // Alert thresholds
  alertDaysLow: int("alert_days_low").default(14),
  alertDaysCritical: int("alert_days_critical").default(7),
  alertDaysOverstock: int("alert_days_overstock").default(90),
  // Custom settings
  isActive: int("is_active").default(1),
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

// Inventory snapshots (daily FBA inventory snapshots for trend analysis)
export const inventorySnapshots = mysqlTable("inventory_snapshots", {
  id: int("id").autoincrement().primaryKey(),
  sellerSku: varchar("seller_sku", { length: 100 }).notNull(),
  marketplace: varchar("marketplace", { length: 10 }).default("US"),
  snapshotDate: varchar("snapshot_date", { length: 10 }).notNull(), // YYYY-MM-DD
  fulfillableQty: int("fulfillable_qty").default(0),
  inboundQty: int("inbound_qty").default(0),
  reservedQty: int("reserved_qty").default(0),
  unsellableQty: int("unsellable_qty").default(0),
  avgDailySales: decimal("avg_daily_sales", { precision: 10, scale: 2 }),
  daysOfSupply: int("days_of_supply"),
  storageFee: decimal("storage_fee", { precision: 10, scale: 2 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

// Profit snapshots (daily profit data)
export const profitSnapshots = mysqlTable("profit_snapshots", {
  id: int("id").autoincrement().primaryKey(),
  sellerSku: varchar("seller_sku", { length: 100 }),
  marketplace: varchar("marketplace", { length: 10 }).default("US"),
  snapshotDate: varchar("snapshot_date", { length: 10 }).notNull(),
  revenue: decimal("revenue", { precision: 12, scale: 2 }),
  productCost: decimal("product_cost", { precision: 12, scale: 2 }),
  adSpend: decimal("ad_spend", { precision: 12, scale: 2 }),
  fbaFee: decimal("fba_fee", { precision: 12, scale: 2 }),
  referralFee: decimal("referral_fee", { precision: 12, scale: 2 }),
  otherFee: decimal("other_fee", { precision: 12, scale: 2 }),
  profit: decimal("profit", { precision: 12, scale: 2 }),
  profitMargin: decimal("profit_margin", { precision: 5, scale: 1 }),
  orderCount: int("order_count"),
  unitCount: int("unit_count"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

// Profit alert rules
export const profitAlertRules = mysqlTable("profit_alert_rules", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("user_id").notNull(),
  ruleName: varchar("rule_name", { length: 200 }).notNull(),
  ruleType: mysqlEnum("rule_type", ["margin_drop", "cost_spike", "revenue_drop", "ad_spend_high", "custom"]).notNull(),
  condition: json("condition_json"), // { metric, operator, threshold, period }
  isActive: int("is_active").default(1),
  lastTriggeredAt: timestamp("last_triggered_at"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

// Ad analysis tasks (AI-powered ad analysis)
export const adAnalysisTasks = mysqlTable("ad_analysis_tasks", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("user_id").notNull(),
  taskName: varchar("task_name", { length: 200 }).notNull(),
  taskType: mysqlEnum("task_type", ["search_term_analysis", "keyword_optimization", "campaign_review", "budget_optimization"]).notNull(),
  status: mysqlEnum("status", ["pending", "running", "completed", "failed"]).default("pending").notNull(),
  inputParams: json("input_params"), // { campaign_ids, date_range, etc. }
  aiResult: json("ai_result"), // structured AI analysis result
  userEdits: json("user_edits"), // user modifications to AI result
  confirmedAt: timestamp("confirmed_at"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

// Ad automation rules
export const adAutomationRules = mysqlTable("ad_automation_rules", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("user_id").notNull(),
  ruleName: varchar("rule_name", { length: 200 }).notNull(),
  ruleType: mysqlEnum("rule_type", [
    "negate_keyword", "add_keyword", "adjust_bid", "pause_campaign",
    "enable_campaign", "adjust_budget", "custom"
  ]).notNull(),
  condition: json("condition_json"), // { metric, operator, threshold, lookback_days }
  action: json("action_json"), // { action_type, params }
  scope: json("scope_json"), // { campaign_ids, ad_group_ids }
  isActive: int("is_active").default(1),
  lastRunAt: timestamp("last_run_at"),
  runCount: int("run_count").default(0),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

// Search term actions (AI-suggested actions for search terms)
export const searchTermActions = mysqlTable("search_term_actions", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("user_id").notNull(),
  analysisTaskId: int("analysis_task_id"),
  searchTerm: varchar("search_term", { length: 500 }).notNull(),
  keywordText: varchar("keyword_text", { length: 500 }),
  matchType: varchar("match_type", { length: 20 }),
  suggestedAction: mysqlEnum("suggested_action", [
    "add_exact", "add_phrase", "negate_exact", "negate_phrase",
    "increase_bid", "decrease_bid", "keep", "monitor"
  ]).notNull(),
  aiReason: text("ai_reason"),
  metrics: json("metrics_json"), // { impressions, clicks, spend, sales, acos, cvr }
  userDecision: mysqlEnum("user_decision", ["accepted", "rejected", "modified", "pending"]).default("pending"),
  userNotes: text("user_notes"),
  executedAt: timestamp("executed_at"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

// Competitor monitors
export const competitorMonitors = mysqlTable("competitor_monitors", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("user_id").notNull(),
  competitorAsin: varchar("competitor_asin", { length: 20 }).notNull(),
  ownAsin: varchar("own_asin", { length: 20 }),
  marketplace: varchar("marketplace", { length: 10 }).default("US"),
  competitorTitle: varchar("competitor_title", { length: 500 }),
  competitorBrand: varchar("competitor_brand", { length: 200 }),
  category: varchar("category", { length: 200 }),
  monitorFrequency: mysqlEnum("monitor_frequency", ["daily", "weekly", "manual"]).default("daily"),
  isActive: int("is_active").default(1),
  lastCheckedAt: timestamp("last_checked_at"),
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

// Competitor snapshots (price, rank, review changes)
export const competitorSnapshots = mysqlTable("competitor_snapshots", {
  id: int("id").autoincrement().primaryKey(),
  monitorId: int("monitor_id").notNull(),
  snapshotDate: varchar("snapshot_date", { length: 10 }).notNull(),
  price: decimal("price", { precision: 10, scale: 2 }),
  bsrRank: int("bsr_rank"),
  bsrCategory: varchar("bsr_category", { length: 200 }),
  reviewCount: int("review_count"),
  rating: decimal("rating", { precision: 3, scale: 1 }),
  mainImageUrl: text("main_image_url"),
  bulletPoints: json("bullet_points"),
  isInStock: int("is_in_stock").default(1),
  couponInfo: varchar("coupon_info", { length: 200 }),
  dealInfo: varchar("deal_info", { length: 200 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

// Competitor AI reports
export const competitorReports = mysqlTable("competitor_reports", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("user_id").notNull(),
  reportName: varchar("report_name", { length: 200 }).notNull(),
  monitorIds: json("monitor_ids"), // array of monitor IDs included
  reportType: mysqlEnum("report_type", ["comparison", "trend", "opportunity", "threat"]).default("comparison"),
  aiAnalysis: json("ai_analysis"), // structured AI report
  userEdits: json("user_edits"),
  status: mysqlEnum("status", ["draft", "confirmed", "archived"]).default("draft"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});


// ─── Product Operations Overview ───

// Product profiles (parent ASIN level)
export const productProfiles = mysqlTable("product_profiles", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("user_id").notNull(),
  parentAsin: varchar("parent_asin", { length: 20 }).notNull(),
  title: varchar("title", { length: 500 }).notNull(),
  brand: varchar("brand", { length: 200 }),
  category: varchar("category", { length: 300 }),
  marketplace: varchar("marketplace", { length: 10 }).default("US"),
  imageUrl: text("image_url"),
  status: mysqlEnum("status", ["active", "inactive", "discontinued"]).default("active").notNull(),
  budgetRevenue: decimal("budget_revenue", { precision: 12, scale: 2 }),
  budgetProfit: decimal("budget_profit", { precision: 12, scale: 2 }),
  budgetAcos: decimal("budget_acos", { precision: 5, scale: 1 }),
   notes: text("notes"),
  operator: varchar("operator", { length: 200 }),
  storeName: varchar("store_name", { length: 255 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type ProductProfile = typeof productProfiles.$inferSelect;
export type InsertProductProfile = typeof productProfiles.$inferInsert;

// Product variants (child ASIN level)
export const productVariants = mysqlTable("product_variants", {
  id: int("id").autoincrement().primaryKey(),
  productId: int("product_id").notNull(),
  childAsin: varchar("child_asin", { length: 20 }).notNull(),
  sku: varchar("sku", { length: 100 }),
  title: varchar("title", { length: 500 }),
  price: decimal("price", { precision: 10, scale: 2 }),
  variationAttributes: json("variation_attributes"),
  status: mysqlEnum("status", ["active", "inactive"]).default("active").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type ProductVariant = typeof productVariants.$inferSelect;
export type InsertProductVariant = typeof productVariants.$inferInsert;

// Product todos (task management per product)
export const productTodos = mysqlTable("product_todos", {
  id: int("id").autoincrement().primaryKey(),
  productId: int("product_id").notNull(),
  userId: int("user_id").notNull(),
  title: varchar("title", { length: 500 }).notNull(),
  description: text("description"),
  priority: mysqlEnum("priority", ["high", "medium", "low"]).default("medium").notNull(),
  status: mysqlEnum("status", ["pending", "in_progress", "completed"]).default("pending").notNull(),
  dueDate: varchar("due_date", { length: 10 }),
  assignee: varchar("assignee", { length: 100 }),
  sortOrder: int("sort_order").default(0),
  completedAt: timestamp("completed_at"),
  reminderDays: varchar("reminder_days", { length: 100 }), // JSON array e.g. [1,3,7] = remind 1,3,7 days before due
  reminderEnabled: int("reminder_enabled").default(1), // 1=enabled, 0=disabled
  lastReminderSentAt: timestamp("last_reminder_sent_at"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type ProductTodo = typeof productTodos.$inferSelect;
export type InsertProductTodo = typeof productTodos.$inferInsert;

// Product logs (follow-up journal per product)
export const productLogs = mysqlTable("product_logs", {
  id: int("id").autoincrement().primaryKey(),
  productId: int("product_id").notNull(),
  userId: int("user_id").notNull(),
  content: text("content").notNull(),
  logType: mysqlEnum("log_type", ["operation", "note", "issue", "decision", "milestone"]).default("note").notNull(),
  createdBy: varchar("created_by", { length: 100 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type ProductLog = typeof productLogs.$inferSelect;
export type InsertProductLog = typeof productLogs.$inferInsert;

// Keyword monitors (track keyword rankings for a product)
export const keywordMonitors = mysqlTable("keyword_monitors", {
  id: int("id").autoincrement().primaryKey(),
  productId: int("product_id").notNull(),
  userId: int("user_id").notNull(),
  keyword: varchar("keyword", { length: 500 }).notNull(),
  keywordCn: varchar("keyword_cn", { length: 500 }),
  targetAsin: varchar("target_asin", { length: 20 }),
  marketplace: varchar("marketplace", { length: 10 }).default("US"),
  matchType: mysqlEnum("match_type", ["exact", "phrase", "broad"]).default("exact"),
  monitorFrequency: mysqlEnum("monitor_frequency", ["daily", "weekly", "manual"]).default("daily"),
  isActive: int("is_active").default(1),
  lastCheckedAt: timestamp("last_checked_at"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type KeywordMonitor = typeof keywordMonitors.$inferSelect;
export type InsertKeywordMonitor = typeof keywordMonitors.$inferInsert;

// Keyword ranking snapshots (historical ranking data from crawler)
export const keywordSnapshots = mysqlTable("keyword_snapshots", {
  id: int("id").autoincrement().primaryKey(),
  keywordMonitorId: int("keyword_monitor_id").notNull(),
  snapshotDate: varchar("snapshot_date", { length: 10 }).notNull(),
  organicRank: int("organic_rank"),
  adRank: int("ad_rank"),
  searchVolume: int("search_volume"),
  pageNumber: int("page_number"),
  totalResults: int("total_results"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type KeywordSnapshot = typeof keywordSnapshots.$inferSelect;
export type InsertKeywordSnapshot = typeof keywordSnapshots.$inferInsert;


// ==================== 运营计划模块 ====================

// Operations plans (per product profile, per quarter/period)
export const opsPlans = mysqlTable("ops_plans", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("user_id").notNull(),
  productProfileId: int("product_profile_id").notNull(),
  planName: varchar("plan_name", { length: 200 }).notNull(),
  planPeriod: varchar("plan_period", { length: 50 }), // e.g. "2026Q1"
  projectManager: varchar("project_manager", { length: 100 }),
  projectMembers: text("project_members"), // JSON array of member names
  gamePlanner: varchar("game_planner", { length: 100 }), // 游戏策划师 (formerly 项目教练)
  // 基期现状数据
  baselineDailySales: decimal("baseline_daily_sales", { precision: 12, scale: 2 }),
  baselineDailyOrders: decimal("baseline_daily_orders", { precision: 10, scale: 2 }),
  baselineAdConvRate: decimal("baseline_ad_conv_rate", { precision: 6, scale: 2 }),
  baselineIndustrySearchConvRate: decimal("baseline_industry_search_conv_rate", { precision: 6, scale: 2 }),
  baselineSearchConvRate: decimal("baseline_search_conv_rate", { precision: 6, scale: 2 }),
  baselineCategorySearchConvRate: decimal("baseline_category_search_conv_rate", { precision: 6, scale: 2 }),
  baselineAvgPrice: decimal("baseline_avg_price", { precision: 10, scale: 2 }),
  baselineRatingCount: int("baseline_rating_count"),
  baselineRatingScore: decimal("baseline_rating_score", { precision: 3, scale: 1 }),
  // 当期现状数据
  currentDailySales: decimal("current_daily_sales", { precision: 12, scale: 2 }),
  currentDailyOrders: decimal("current_daily_orders", { precision: 10, scale: 2 }),
  currentAdConvRate: decimal("current_ad_conv_rate", { precision: 6, scale: 2 }),
  currentIndustrySearchConvRate: decimal("current_industry_search_conv_rate", { precision: 6, scale: 2 }),
  currentSearchConvRate: decimal("current_search_conv_rate", { precision: 6, scale: 2 }),
  currentCategorySearchConvRate: decimal("current_category_search_conv_rate", { precision: 6, scale: 2 }),
  currentAvgPrice: decimal("current_avg_price", { precision: 10, scale: 2 }),
  currentRatingCount: int("current_rating_count"),
  currentRatingScore: decimal("current_rating_score", { precision: 3, scale: 1 }),
  // 季度目标
  targetSearchConvRate: decimal("target_search_conv_rate", { precision: 6, scale: 2 }),
  targetOrderConvRate: decimal("target_order_conv_rate", { precision: 6, scale: 2 }),
  targetAdConvRate: decimal("target_ad_conv_rate", { precision: 6, scale: 2 }),
  targetKeywordAdvantage: decimal("target_keyword_advantage", { precision: 6, scale: 2 }),
  // 状态
  status: mysqlEnum("plan_status", ["draft", "active", "completed", "archived"]).default("draft").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type OpsPlan = typeof opsPlans.$inferSelect;
export type InsertOpsPlan = typeof opsPlans.$inferInsert;

// Plan improvement actions (each row = one improvement action, linked to todos)
export const opsPlanActions = mysqlTable("ops_plan_actions", {
  id: int("id").autoincrement().primaryKey(),
  planId: int("plan_id").notNull(),
  userId: int("user_id").notNull(),
  dimension: varchar("dimension", { length: 200 }).notNull(), // 提升维度
  currentStatus: text("current_status"), // 父体现状
  targetAction: text("target_action"), // 提升目标/动作
  priority: mysqlEnum("action_priority", ["high", "medium", "low"]).default("medium").notNull(),
  plannedDate: varchar("planned_date", { length: 10 }), // YYYY-MM-DD
  assignee: varchar("assignee", { length: 100 }),
  status: mysqlEnum("action_status", ["not_started", "in_progress", "completed", "delayed"]).default("not_started").notNull(),
  linkedTodoId: int("linked_todo_id"), // Links to product_todos
  sortOrder: int("sort_order").default(0),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type OpsPlanAction = typeof opsPlanActions.$inferSelect;
export type InsertOpsPlanAction = typeof opsPlanActions.$inferInsert;

// Plan execution summaries (periodic reviews)
export const opsPlanSummaries = mysqlTable("ops_plan_summaries", {
  id: int("id").autoincrement().primaryKey(),
  planId: int("plan_id").notNull(),
  userId: int("user_id").notNull(),
  period: varchar("period", { length: 50 }), // e.g. "2026-01 W2"
  achievementSummary: text("achievement_summary"), // 达成情况总结 (项目经理)
  plannerFeedback: text("planner_feedback"), // 游戏策划师反馈
  rating: mysqlEnum("summary_rating", ["excellent", "good", "needs_improvement"]),
  // 实际达成数据
  actualIndustryConvRate: decimal("actual_industry_conv_rate", { precision: 6, scale: 2 }),
  actualSearchConvRate: decimal("actual_search_conv_rate", { precision: 6, scale: 2 }),
  actualOrderConvRate: decimal("actual_order_conv_rate", { precision: 6, scale: 2 }),
  actualAdConvRate: decimal("actual_ad_conv_rate", { precision: 6, scale: 2 }),
  actualSales: decimal("actual_sales", { precision: 12, scale: 2 }),
  actualProfit: decimal("actual_profit", { precision: 12, scale: 2 }),
  actualProfitRate: decimal("actual_profit_rate", { precision: 6, scale: 2 }),
  actualRanking: int("actual_ranking"),
  actualRating: decimal("actual_rating", { precision: 3, scale: 1 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type OpsPlanSummary = typeof opsPlanSummaries.$inferSelect;
export type InsertOpsPlanSummary = typeof opsPlanSummaries.$inferInsert;

// ==================== 转化率对比模块 ====================

// Conversion comparison tasks (one per comparison session)
export const conversionComparisons = mysqlTable("conversion_comparisons", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("user_id").notNull(),
  productProfileId: int("product_profile_id").notNull(),
  comparisonName: varchar("comparison_name", { length: 200 }).notNull(),
  ownAsin: varchar("own_asin", { length: 20 }).notNull(),
  competitorAsins: text("competitor_asins"), // JSON array of competitor ASINs
  status: mysqlEnum("comparison_status", ["draft", "crawling", "scoring", "completed"]).default("draft").notNull(),
  overallOwnScore: decimal("overall_own_score", { precision: 5, scale: 2 }),
  crawlData: json("crawl_data"), // Raw crawled data per ASIN
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type ConversionComparison = typeof conversionComparisons.$inferSelect;
export type InsertConversionComparison = typeof conversionComparisons.$inferInsert;

// Conversion check items (fixed 132 items + user custom items)
export const conversionCheckItems = mysqlTable("conversion_check_items", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("user_id"), // NULL = system default, non-null = user custom
  categoryIndex: int("category_index").notNull(), // 1-20 大维度序号
  categoryName: varchar("category_name", { length: 100 }).notNull(), // e.g. "标题", "五点"
  subDimension: varchar("sub_dimension", { length: 200 }), // 细分维度
  standard: text("standard"), // 标准/说明
  sortOrder: int("sort_order").default(0),
  isCustom: int("is_custom").default(0), // 0=固定模板, 1=用户自定义
  isActive: int("is_active").default(1),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type ConversionCheckItem = typeof conversionCheckItems.$inferSelect;
export type InsertConversionCheckItem = typeof conversionCheckItems.$inferInsert;

// User-level overrides for check items (hide, rename, change standard)
export const checkItemOverrides = mysqlTable("check_item_overrides", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("user_id").notNull(),
  checkItemId: int("check_item_id").notNull(), // references conversion_check_items.id
  isHidden: int("is_hidden").default(0), // 0=visible, 1=hidden
  customSubDimension: varchar("custom_sub_dimension", { length: 200 }), // NULL=use original
  customStandard: text("custom_standard"), // NULL=use original
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});
export type CheckItemOverride = typeof checkItemOverrides.$inferSelect;
export type InsertCheckItemOverride = typeof checkItemOverrides.$inferInsert;

// Conversion scores (per comparison × per ASIN × per check item)
export const conversionScores = mysqlTable("conversion_scores", {
  id: int("id").autoincrement().primaryKey(),
  comparisonId: int("comparison_id").notNull(),
  checkItemId: int("check_item_id").notNull(),
  asin: varchar("asin", { length: 20 }).notNull(),
  score: int("score"), // 1-5
  aiScore: int("ai_score"), // AI original score before manual edit
  reason: text("reason"), // 评分理由
  aiReason: text("ai_reason"), // AI original reason
  rawData: text("raw_data"), // 爬虫抓取的原始数据
  source: varchar("source", { length: 20 }).default("ai"), // programmatic | ai | manual
  isLocked: int("is_locked").default(0), // 0=unlocked, 1=locked by user
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type ConversionScore = typeof conversionScores.$inferSelect;
export type InsertConversionScore = typeof conversionScores.$inferInsert;

// Conversion optimization suggestions (AI-generated, editable & lockable)
export const conversionSuggestions = mysqlTable("conversion_suggestions", {
  id: int("id").autoincrement().primaryKey(),
  comparisonId: int("comparison_id").notNull(),
  userId: int("user_id").notNull(),
  categoryName: varchar("category_name", { length: 100 }).notNull(),
  ownScore: decimal("own_score", { precision: 5, scale: 2 }),
  bestCompetitorScore: decimal("best_competitor_score", { precision: 5, scale: 2 }),
  gapAnalysis: text("gap_analysis"), // 差距分析
  suggestion: text("suggestion"), // 优化建议
  priority: mysqlEnum("suggestion_priority", ["high", "medium", "low"]).default("medium").notNull(),
  expectedEffect: text("expected_effect"), // 预期效果
  isLocked: int("is_locked").default(0),
  linkedPlanActionId: int("linked_plan_action_id"), // Links to ops_plan_actions
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type ConversionSuggestion = typeof conversionSuggestions.$inferSelect;
export type InsertConversionSuggestion = typeof conversionSuggestions.$inferInsert;


// ─── Execution Reviews (执行复盘) ───
export const executionReviews = mysqlTable("execution_reviews", {
  id: int("id").autoincrement().primaryKey(),
  productProfileId: int("product_profile_id").notNull(),
  userId: int("user_id").notNull(),
  planId: int("plan_id"), // linked ops_plan
  period: varchar("period", { length: 50 }).notNull(), // e.g. "2026-Q1-W4"
  periodType: mysqlEnum("period_type", ["weekly", "monthly", "quarterly"]).default("monthly").notNull(),
  // Baseline metrics
  baselineSales: decimal("baseline_sales", { precision: 12, scale: 2 }),
  baselineProfit: decimal("baseline_profit", { precision: 12, scale: 2 }),
  baselineProfitRate: decimal("baseline_profit_rate", { precision: 5, scale: 2 }),
  baselineOrderConvRate: decimal("baseline_order_conv_rate", { precision: 5, scale: 2 }),
  baselineSearchConvRate: decimal("baseline_search_conv_rate", { precision: 5, scale: 2 }),
  baselineAdConvRate: decimal("baseline_ad_conv_rate", { precision: 5, scale: 2 }),
  baselineRanking: int("baseline_ranking"),
  baselineRating: decimal("baseline_rating", { precision: 3, scale: 2 }),
  // Actual metrics
  actualSales: decimal("actual_sales", { precision: 12, scale: 2 }),
  actualProfit: decimal("actual_profit", { precision: 12, scale: 2 }),
  actualProfitRate: decimal("actual_profit_rate", { precision: 5, scale: 2 }),
  actualOrderConvRate: decimal("actual_order_conv_rate", { precision: 5, scale: 2 }),
  actualSearchConvRate: decimal("actual_search_conv_rate", { precision: 5, scale: 2 }),
  actualAdConvRate: decimal("actual_ad_conv_rate", { precision: 5, scale: 2 }),
  actualRanking: int("actual_ranking"),
  actualRating: decimal("actual_rating", { precision: 3, scale: 2 }),
  // Target metrics
  targetSales: decimal("target_sales", { precision: 12, scale: 2 }),
  targetProfit: decimal("target_profit", { precision: 12, scale: 2 }),
  targetOrderConvRate: decimal("target_order_conv_rate", { precision: 5, scale: 2 }),
  targetSearchConvRate: decimal("target_search_conv_rate", { precision: 5, scale: 2 }),
  targetAdConvRate: decimal("target_ad_conv_rate", { precision: 5, scale: 2 }),
  // Review content
  achievementSummary: text("achievement_summary"), // 达成情况总结
  keyActions: text("key_actions"), // 关键执行动作
  lessonsLearned: text("lessons_learned"), // 经验教训
  nextPeriodPlan: text("next_period_plan"), // 下期计划
  // Game strategist feedback (游戏策划师)
  strategistFeedback: text("strategist_feedback"), // 游戏策划师反馈
  strategistRating: mysqlEnum("strategist_rating", ["S", "A", "B", "C", "D"]),
  // AI analysis
  aiAnalysis: text("ai_analysis"), // AI复盘分析
  aiAnalysisLocked: int("ai_analysis_locked").default(0),
  status: mysqlEnum("review_status", ["draft", "submitted", "reviewed"]).default("draft").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type ExecutionReview = typeof executionReviews.$inferSelect;
export type InsertExecutionReview = typeof executionReviews.$inferInsert;

// ─── Team Tasks (团队协作看板) ───
export const teamTasks = mysqlTable("team_tasks", {
  id: int("id").autoincrement().primaryKey(),
  productProfileId: int("product_profile_id").notNull(),
  userId: int("user_id").notNull(), // creator
  title: varchar("title", { length: 200 }).notNull(),
  description: text("description"),
  status: mysqlEnum("task_status", ["backlog", "todo", "in_progress", "review", "done"]).default("todo").notNull(),
  priority: mysqlEnum("task_priority_team", ["urgent", "high", "medium", "low"]).default("medium").notNull(),
  category: varchar("category", { length: 100 }), // e.g. Listing优化, 广告调整, 图片更新
  assigneeId: int("assignee_id"), // assigned team member
  assigneeName: varchar("assignee_name", { length: 100 }),
  startDate: varchar("start_date", { length: 20 }),
  dueDate: varchar("due_date", { length: 20 }),
  completedAt: timestamp("completed_at"),
  estimatedHours: decimal("estimated_hours", { precision: 5, scale: 1 }),
  actualHours: decimal("actual_hours", { precision: 5, scale: 1 }),
  linkedTodoId: int("linked_todo_id"), // links to product_todos
  linkedPlanActionId: int("linked_plan_action_id"), // links to ops_plan_actions
  tags: text("tags"), // JSON array of tags
  sortOrder: int("sort_order").default(0),
  reminderDays: varchar("reminder_days", { length: 100 }), // JSON array e.g. [1,3,7]
  reminderEnabled: int("reminder_enabled").default(1),
  lastReminderSentAt: timestamp("last_reminder_sent_at"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type TeamTask = typeof teamTasks.$inferSelect;
export type InsertTeamTask = typeof teamTasks.$inferInsert;


// ─── Shipping Batches (物流批次管理) ───
export const shippingBatches = mysqlTable("shipping_batches", {
  id: int("id").autoincrement().primaryKey(),
  userId: varchar("user_id", { length: 255 }).notNull(),
  batchName: varchar("batch_name", { length: 500 }).notNull(),
  batchNumber: int("batch_number").notNull(),

  // 店铺和仓库
  storeName: varchar("store_name", { length: 255 }),
  sourceWarehouse: varchar("source_warehouse", { length: 255 }),
  transitWarehouse: varchar("transit_warehouse", { length: 255 }),
  destinationWarehouse: varchar("destination_warehouse", { length: 255 }),
  shippingMethod: varchar("shipping_method", { length: 100 }),

  // 流程状态（1-9）
  currentStep: int("current_step").default(1).notNull(),
  status: mysqlEnum("batch_status", ["active", "completed", "cancelled", "paused"]).default("active").notNull(),

  // 物流信息
  trackingNumber: varchar("tracking_number", { length: 255 }),
  vehiclePlate: varchar("vehicle_plate", { length: 100 }),
  carrierName: varchar("carrier_name", { length: 255 }),
  internationalTrackingNumber: varchar("international_tracking_number", { length: 255 }),
  internationalCarrier: varchar("international_carrier", { length: 255 }),

  // 库存追踪（每步实时更新）
  plannedQuantity: int("planned_quantity").default(0).notNull(),
  orderedQuantity: int("ordered_quantity").default(0).notNull(),
  shippedQuantity: int("shipped_quantity").default(0).notNull(),
  warehouseReceivedQuantity: int("warehouse_received_quantity").default(0).notNull(),
  internationalShippedQuantity: int("international_shipped_quantity").default(0).notNull(),
  amazonReceivedQuantity: int("amazon_received_quantity").default(0).notNull(),
  amazonStockedQuantity: int("amazon_stocked_quantity").default(0).notNull(),

  // 亚马逊库存（步骤9实时同步）
  amazonTotalInventory: int("amazon_total_inventory").default(0).notNull(),
  amazonAvailableInventory: int("amazon_available_inventory").default(0).notNull(),
  amazonReservedInventory: int("amazon_reserved_inventory").default(0).notNull(),
  amazonInboundInventory: int("amazon_inbound_inventory").default(0).notNull(),
  amazonUnfulfillableInventory: int("amazon_unfulfillable_inventory").default(0).notNull(),

  // 财务数据
  currency: varchar("currency", { length: 10 }).default("USD").notNull(),
  totalProductCost: decimal("total_product_cost", { precision: 12, scale: 2 }).default("0"),
  totalShippingCost: decimal("total_shipping_cost", { precision: 12, scale: 2 }).default("0"),
  totalOtherCost: decimal("total_other_cost", { precision: 12, scale: 2 }).default("0"),
  amazonCommissionRate: decimal("amazon_commission_rate", { precision: 5, scale: 2 }),

  // 负责人
  batchOwner: varchar("batch_owner", { length: 255 }),
  logisticsOwner: varchar("logistics_owner", { length: 255 }),

  // 领星ERP关联
  fbaShipmentId: varchar("fba_shipment_id", { length: 255 }),
  lingxingDeliveryOrderId: varchar("lingxing_delivery_order_id", { length: 255 }),
  lingxingPurchaseOrderId: varchar("lingxing_purchase_order_id", { length: 255 }),
  lingxingPurchasePlanId: varchar("lingxing_purchase_plan_id", { length: 255 }),

  // 时间
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
  updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
});
export type ShippingBatch = typeof shippingBatches.$inferSelect;
export type InsertShippingBatch = typeof shippingBatches.$inferInsert;

// ─── Batch Step Configs (批次步骤配置/自定义时间) ───
export const batchStepConfigs = mysqlTable("batch_step_configs", {
  id: int("id").autoincrement().primaryKey(),
  batchId: int("batch_id").notNull(),
  stepNumber: int("step_number").notNull(),
  stepName: varchar("step_name", { length: 100 }).notNull(),
  expectedDays: int("expected_days").default(0).notNull(),
  actualStartAt: bigint("actual_start_at", { mode: "number" }),
  actualEndAt: bigint("actual_end_at", { mode: "number" }),
  actualDays: int("actual_days"),
  notes: text("notes"),
  status: mysqlEnum("step_status", ["pending", "active", "completed", "skipped"]).default("pending").notNull(),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
  updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
});
export type BatchStepConfig = typeof batchStepConfigs.$inferSelect;
export type InsertBatchStepConfig = typeof batchStepConfigs.$inferInsert;

// ─── Batch Products (批次产品明细) ───
export const batchProducts = mysqlTable("batch_products", {
  id: int("id").autoincrement().primaryKey(),
  batchId: int("batch_id").notNull(),
  sku: varchar("sku", { length: 255 }).notNull(),
  asin: varchar("asin", { length: 50 }),
  productName: varchar("product_name", { length: 500 }),
  quantity: int("quantity").default(0).notNull(),
  unitCost: decimal("unit_cost", { precision: 10, scale: 2 }).default("0"),
  totalCost: decimal("total_cost", { precision: 12, scale: 2 }).default("0"),
  weight: decimal("weight", { precision: 8, scale: 2 }),
  volume: decimal("volume", { precision: 10, scale: 4 }),
  fnsku: varchar("fnsku", { length: 50 }),
  lingxingProductId: varchar("lingxing_product_id", { length: 255 }),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
});
export type BatchProduct = typeof batchProducts.$inferSelect;
export type InsertBatchProduct = typeof batchProducts.$inferInsert;

// ─── Batch Logs (批次操作日志) ───
export const batchLogs = mysqlTable("batch_logs", {
  id: int("id").autoincrement().primaryKey(),
  batchId: int("batch_id").notNull(),
  userId: varchar("user_id", { length: 255 }),
  userName: varchar("user_name", { length: 255 }),
  action: varchar("action", { length: 100 }).notNull(),
  fromStep: int("from_step"),
  toStep: int("to_step"),
  details: text("details"),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
});
export type BatchLog = typeof batchLogs.$inferSelect;
export type InsertBatchLog = typeof batchLogs.$inferInsert;

// ─── Step Time History (步骤时间历史/AI学习) ───
export const stepTimeHistory = mysqlTable("step_time_history", {
  id: int("id").autoincrement().primaryKey(),
  userId: varchar("user_id", { length: 255 }).notNull(),
  batchId: int("batch_id").notNull(),
  stepNumber: int("step_number").notNull(),
  shippingMethod: varchar("shipping_method", { length: 100 }),
  carrierName: varchar("carrier_name", { length: 255 }),
  route: varchar("route", { length: 255 }),
  expectedDays: int("expected_days"),
  actualDays: int("actual_days"),
  monthOfYear: int("month_of_year"),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
});
export type StepTimeHistoryRow = typeof stepTimeHistory.$inferSelect;
export type InsertStepTimeHistory = typeof stepTimeHistory.$inferInsert;

// ─── Replenishment Predictions (补货预测) ───
export const replenishmentPredictions = mysqlTable("replenishment_predictions", {
  id: int("id").autoincrement().primaryKey(),
  userId: varchar("user_id", { length: 255 }).notNull(),
  sku: varchar("sku", { length: 255 }).notNull(),
  asin: varchar("asin", { length: 50 }),
  storeName: varchar("store_name", { length: 255 }),

  // 当前状态
  currentAvailableInventory: int("current_available_inventory").default(0).notNull(),
  dailySalesAvg: decimal("daily_sales_avg", { precision: 10, scale: 2 }).default("0"),
  daysOfStockRemaining: int("days_of_stock_remaining").default(0).notNull(),

  // 预测结果
  fullCycleDays: int("full_cycle_days").default(0).notNull(),
  recommendedQuantity: int("recommended_quantity").default(0).notNull(),
  recommendedOrderDate: bigint("recommended_order_date", { mode: "number" }),
  recommendedShippingMethod: varchar("recommended_shipping_method", { length: 100 }),
  estimatedArrivalDate: bigint("estimated_arrival_date", { mode: "number" }),
  confidence: decimal("confidence", { precision: 3, scale: 2 }).default("0"),

  // AI建议详情
  aiSuggestion: json("ai_suggestion"),
  riskFactors: json("risk_factors"),
  alternativePlans: json("alternative_plans"),

  // 提醒状态
  alertLevel: varchar("alert_level", { length: 20 }),
  alertSentAt: bigint("alert_sent_at", { mode: "number" }),
  userConfirmed: int("user_confirmed").default(0).notNull(),

  // 时间
  predictedAt: bigint("predicted_at", { mode: "number" }).notNull(),
  updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
});
export type ReplenishmentPrediction = typeof replenishmentPredictions.$inferSelect;
export type InsertReplenishmentPrediction = typeof replenishmentPredictions.$inferInsert;

// ─── Step Time Templates (步骤时间模板) ───
export const stepTimeTemplates = mysqlTable("step_time_templates", {
  id: int("id").autoincrement().primaryKey(),
  userId: varchar("user_id", { length: 255 }).notNull(),
  templateName: varchar("template_name", { length: 200 }).notNull(),
  shippingMethod: varchar("shipping_method", { length: 100 }).notNull(),
  step1Days: int("step1_days").default(3).notNull(),
  step2Days: int("step2_days").default(14).notNull(),
  step3Days: int("step3_days").default(3).notNull(),
  step4Days: int("step4_days").default(1).notNull(),
  step5Days: int("step5_days").default(3).notNull(),
  step6Days: int("step6_days").default(2).notNull(),
  step7Days: int("step7_days").default(30).notNull(),
  step8Days: int("step8_days").default(7).notNull(),
  step9Days: int("step9_days").default(3).notNull(),
  step10Days: int("step10_days").default(1).notNull(),
  isDefault: int("is_default").default(0).notNull(),
  aiSuggested: int("ai_suggested").default(0).notNull(),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
  updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
});
export type StepTimeTemplate = typeof stepTimeTemplates.$inferSelect;
export type InsertStepTimeTemplate = typeof stepTimeTemplates.$inferInsert;


// ============== User Settings (Global Preferences) ==============
export const userSettings = mysqlTable("user_settings", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("user_id").notNull(),
  settingKey: varchar("setting_key", { length: 100 }).notNull(),
  settingValue: text("setting_value"),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
  updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
});
export type UserSetting = typeof userSettings.$inferSelect;
export type InsertUserSetting = typeof userSettings.$inferInsert;

// ============== ASIN Permissions ==============
export const asinPermissions = mysqlTable("asin_permissions", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("user_id").notNull(),
  asin: varchar("asin", { length: 20 }).notNull(),
  msku: varchar("msku", { length: 100 }),
  marketplace: varchar("marketplace", { length: 10 }).default("US"),
  permissionLevel: mysqlEnum("permission_level", ["read", "write", "admin"]).default("read").notNull(),
  grantedBy: int("granted_by"),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
  updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
});
export type AsinPermission = typeof asinPermissions.$inferSelect;

// ============== ASIN Status Cache ==============
export const asinStatusCache = mysqlTable("asin_status_cache", {
  id: int("id").autoincrement().primaryKey(),
  asin: varchar("asin", { length: 20 }).notNull(),
  msku: varchar("msku", { length: 100 }),
  sid: varchar("sid", { length: 20 }),
  marketplace: varchar("marketplace", { length: 10 }).default("US"),
  listingStatus: mysqlEnum("listing_status", ["active", "inactive", "deleted", "manual_inactive"]).default("active").notNull(),
  lastSyncedAt: bigint("last_synced_at", { mode: "number" }),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
  updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
});
export type AsinStatusCache = typeof asinStatusCache.$inferSelect;

// ============== ASIN Custom Tags ==============
export const asinTagDefinitions = mysqlTable("asin_tag_definitions", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("user_id").notNull(),
  name: varchar("name", { length: 50 }).notNull(),
  color: varchar("color", { length: 20 }).default("#6366f1").notNull(), // hex color
  isSystem: int("is_system").default(0).notNull(), // 1=system tag (e.g. discontinued), 0=user-created
  hideFromInventory: int("hide_from_inventory").default(0).notNull(), // 1=hide tagged ASINs from inventory
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type AsinTagDefinition = typeof asinTagDefinitions.$inferSelect;

export const asinTagAssignments = mysqlTable("asin_tag_assignments", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("user_id").notNull(),
  tagId: int("tag_id").notNull(),
  asin: varchar("asin", { length: 20 }).notNull(),
  msku: varchar("msku", { length: 100 }),
  sid: varchar("sid", { length: 20 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type AsinTagAssignment = typeof asinTagAssignments.$inferSelect;

// ============== ASIN Operation Logs (ASIN维度操作日志) ==============
export const asinLogs = mysqlTable("asin_logs", {
  id: int("id").autoincrement().primaryKey(),
  userId: varchar("user_id", { length: 255 }).notNull(),
  userName: varchar("user_name", { length: 255 }),
  asin: varchar("asin", { length: 50 }).notNull(),
  content: text("content").notNull(),
  logType: varchar("log_type", { length: 50 }).default("manual"), // manual, system, batch_update
  batchId: int("batch_id"),
  batchName: varchar("batch_name", { length: 255 }),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
});
export type AsinLog = typeof asinLogs.$inferSelect;
export type InsertAsinLog = typeof asinLogs.$inferInsert;


// ==================== 运营计划目标跟踪模块 (Phase 2) ====================

// Product operations plan - target setting & daily tracking
export const productOpsPlans = mysqlTable("product_ops_plans", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("user_id").notNull(),
  productProfileId: int("product_profile_id"),
  asin: varchar("asin", { length: 20 }).notNull(),
  planName: varchar("plan_name", { length: 200 }).notNull(),
  // Target metrics
  targetBsr: int("target_bsr"),
  targetDailyOrders: decimal("target_daily_orders", { precision: 10, scale: 2 }),
  targetAdOrders: decimal("target_ad_orders", { precision: 10, scale: 2 }),
  targetOrganicOrders: decimal("target_organic_orders", { precision: 10, scale: 2 }),
  targetAcos: decimal("target_acos", { precision: 6, scale: 2 }),
  targetProfitMargin: decimal("target_profit_margin", { precision: 6, scale: 2 }),
  targetOrganicRatio: decimal("target_organic_ratio", { precision: 6, scale: 2 }),
  targetConversionRate: decimal("target_conversion_rate", { precision: 6, scale: 2 }),
  promotionCycleDays: int("promotion_cycle_days"),
  startDate: varchar("start_date", { length: 10 }),
  endDate: varchar("end_date", { length: 10 }),
  status: mysqlEnum("product_ops_plan_status", ["planning", "active", "completed", "paused"]).default("planning").notNull(),
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type ProductOpsPlan = typeof productOpsPlans.$inferSelect;
export type InsertProductOpsPlan = typeof productOpsPlans.$inferInsert;

// Product ops daily record - daily tracking data
export const productOpsDailyRecords = mysqlTable("product_ops_daily_records", {
  id: int("id").autoincrement().primaryKey(),
  planId: int("plan_id").notNull(),
  recordDate: varchar("record_date", { length: 10 }).notNull(),
  // Actual metrics
  actualBsr: int("actual_bsr"),
  actualImpressions: int("actual_impressions"),
  actualTotalOrders: int("actual_total_orders"),
  actualAdOrders: int("actual_ad_orders"),
  actualOrganicOrders: int("actual_organic_orders"),
  actualAcos: decimal("actual_acos", { precision: 6, scale: 2 }),
  actualProfitMargin: decimal("actual_profit_margin", { precision: 6, scale: 2 }),
  actualConversionRate: decimal("actual_conversion_rate", { precision: 6, scale: 2 }),
  actualOrganicRatio: decimal("actual_organic_ratio", { precision: 6, scale: 2 }),
  actualUnitPrice: decimal("actual_unit_price", { precision: 10, scale: 2 }),
  actualSales: decimal("actual_sales", { precision: 12, scale: 2 }),
  actualAdSpend: decimal("actual_ad_spend", { precision: 12, scale: 2 }),
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type ProductOpsDailyRecord = typeof productOpsDailyRecords.$inferSelect;
export type InsertProductOpsDailyRecord = typeof productOpsDailyRecords.$inferInsert;

// Keyword tracking configuration
export const keywordTrackings = mysqlTable("keyword_trackings", {
  id: int("id").autoincrement().primaryKey(),
  planId: int("plan_id").notNull(),
  keyword: varchar("keyword", { length: 300 }).notNull(),
  keywordCn: varchar("keyword_cn", { length: 300 }),
  targetOrganicRank: int("target_organic_rank"),
  targetDailyAdOrders: int("target_daily_ad_orders"),
  isCoreKeyword: int("is_core_keyword").default(0),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type KeywordTracking = typeof keywordTrackings.$inferSelect;
export type InsertKeywordTracking = typeof keywordTrackings.$inferInsert;

// Keyword daily record
export const keywordDailyRecords = mysqlTable("keyword_daily_records", {
  id: int("id").autoincrement().primaryKey(),
  trackingId: int("tracking_id").notNull(),
  recordDate: varchar("record_date", { length: 10 }).notNull(),
  actualOrganicRank: int("actual_organic_rank"),
  actualAdOrders: int("actual_ad_orders"),
  actualAdSpend: decimal("actual_ad_spend", { precision: 12, scale: 2 }),
  actualImpressions: int("actual_impressions"),
  actualClicks: int("actual_clicks"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type KeywordDailyRecord = typeof keywordDailyRecords.$inferSelect;
export type InsertKeywordDailyRecord = typeof keywordDailyRecords.$inferInsert;
