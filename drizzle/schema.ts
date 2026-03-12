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
  confirmedAt: timestamp("confirmedAt"),
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
  confirmedAt: timestamp("confirmedAt"),
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
  confirmedAt: timestamp("confirmedAt"),
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
  imagePosition: mysqlEnum("imagePosition", ["main", "secondary", "aplus"]).notNull(),
  positionIndex: int("positionIndex"), // e.g. secondary image #2
  // Four-dimension tags
  tagCategory: varchar("tagCategory", { length: 64 }),
  tagColorScheme: varchar("tagColorScheme", { length: 64 }),
  tagImageType: varchar("tagImageType", { length: 64 }),
  tagDesignStyle: varchar("tagDesignStyle", { length: 64 }),
  // AI analysis
  aiDimensionAnalysis: text("aiDimensionAnalysis"), // 12-dimension analysis JSON
  userEditedDimensionAnalysis: text("userEditedDimensionAnalysis"),
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
  confirmedAt: timestamp("confirmedAt"),
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
  confirmedAt: timestamp("confirmedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type KbVideo = typeof kbVideos.$inferSelect;
export type InsertKbVideo = typeof kbVideos.$inferInsert;

// ═══════════════════════════════════════════════════════════════════
// ─── Module 1: 智能产品开发分析 (Product Development AI Analysis) ──
// ═══════════════════════════════════════════════════════════════════

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
  appearanceColors: text("appearanceColors"), // JSON: { colors, diff, matching, other }
  mainFunctions: text("mainFunctions"), // JSON: { mainFunctions, upgrades, diffDesign }
  costBreakdown: text("costBreakdown"), // JSON: { breakdown, targetPrice, targetMargin }
  packageDimensions: text("packageDimensions"), // JSON: { dimensions, boxType, filling, weight }
  packageDesign: text("packageDesign"), // JSON: { style, colorScheme, printInfo }
  userPersona: text("userPersona"), // JSON: { age, gender, income, interests, painPoints, description }
  usageScenarios: text("usageScenarios"), // JSON: { scenarios }
  productMap: text("productMap"), // JSON: { positioning, competitors, advantages, gaps }
  status: mysqlEnum("status", ["draft", "confirmed"]).default("draft").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type DevProductProfile = typeof devProductProfiles.$inferSelect;
export type InsertDevProductProfile = typeof devProductProfiles.$inferInsert;

// 产品说明书
export const devProductManuals = mysqlTable("dev_product_manuals", {
  id: int("id").autoincrement().primaryKey(),
  projectId: int("projectId").notNull(),
  userId: int("userId").notNull(),
  brandName: varchar("brandName", { length: 255 }),
  logoUrl: text("logoUrl"),
  contentSections: text("contentSections"), // JSON: array of { sectionKey, titleEn, titleEs, contentEn, contentEs, status }
  contentStatus: mysqlEnum("contentStatus", ["draft", "editing", "confirmed"]).default("draft").notNull(),
  finalManualUrl: text("finalManualUrl"), // S3 URL for final PDF
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type DevProductManual = typeof devProductManuals.$inferSelect;
export type InsertDevProductManual = typeof devProductManuals.$inferInsert;

// 测试报告
export const devTestReports = mysqlTable("dev_test_reports", {
  id: int("id").autoincrement().primaryKey(),
  projectId: int("projectId").notNull(),
  userId: int("userId").notNull(),
  testItems: text("testItems"), // JSON: array of test items with status
  reportContent: text("reportContent"), // JSON: additional report content
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
  partName: varchar("partName", { length: 255 }).notNull(),
  material: varchar("material", { length: 255 }),
  process: varchar("process", { length: 255 }),
  specification: text("specification"),
  quantity: int("quantity").default(1),
  unitPrice: varchar("unitPrice", { length: 50 }),
  subtotal: varchar("subtotal", { length: 50 }),
  remark: text("remark"),
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
  currentStep: int("currentStep").default(1).notNull(), // 1-5

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

  // PDF export
  pdfUrl: text("pdfUrl"),                      // S3 URL for exported PDF

  status: mysqlEnum("status", ["in_progress", "completed"]).default("in_progress").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type ImageWorkflowSession = typeof imageWorkflowSessions.$inferSelect;
export type InsertImageWorkflowSession = typeof imageWorkflowSessions.$inferInsert;
