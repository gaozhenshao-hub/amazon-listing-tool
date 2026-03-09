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
