import { int, json, mysqlEnum, mysqlTable, text, timestamp, varchar } from "drizzle-orm/mysql-core";

export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

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
  version: int("version").default(1).notNull(),
  isActive: int("isActive").default(1).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Listing = typeof listings.$inferSelect;
export type InsertListing = typeof listings.$inferInsert;

// Image analysis results
export const imageAnalyses = mysqlTable("imageAnalyses", {
  id: int("id").autoincrement().primaryKey(),
  projectId: int("projectId").notNull(),
  imageUrl: text("imageUrl").notNull(),
  analysisResult: text("analysisResult"), // JSON: extracted title, bullet points, brand, ASIN, features
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type ImageAnalysis = typeof imageAnalyses.$inferSelect;
export type InsertImageAnalysis = typeof imageAnalyses.$inferInsert;

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
