import { bigint, boolean, decimal, int, json, mysqlEnum, mysqlTable, text, timestamp, varchar } from "drizzle-orm/mysql-core";
import { currentOpsWorkspaceId } from "../../server/domains/ops/workspaceContext";

// Ad analysis tasks (AI-powered ad analysis)
export const adAnalysisTasks = mysqlTable("ad_analysis_tasks", {
  workspaceId: int("workspaceId").$defaultFn(currentOpsWorkspaceId),
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
  workspaceId: int("workspaceId").$defaultFn(currentOpsWorkspaceId),
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
  workspaceId: int("workspaceId").$defaultFn(currentOpsWorkspaceId),
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
  workspaceId: int("workspaceId").$defaultFn(currentOpsWorkspaceId),
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
  workspaceId: int("workspaceId").$defaultFn(currentOpsWorkspaceId),
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
  workspaceId: int("workspaceId").$defaultFn(currentOpsWorkspaceId),
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

// Competitor Ad Benchmark (竞品广告对标)
export const competitorAdBenchmarks = mysqlTable("competitor_ad_benchmarks", {
  workspaceId: int("workspaceId").$defaultFn(currentOpsWorkspaceId),
  id: int("id").autoincrement().primaryKey(),
  planId: int("plan_id").notNull(),
  competitorBrand: varchar("competitor_brand", { length: 200 }).notNull(),
  competitorAsin: varchar("competitor_asin", { length: 20 }),
  adType: mysqlEnum("ad_type", ["sp", "sb", "sd", "dsp", "mixed"]).default("mixed").notNull(),
  // Five radar dimensions
  acos: decimal("acos", { precision: 8, scale: 2 }),
  ctr: decimal("ctr", { precision: 8, scale: 4 }),
  cvr: decimal("cvr", { precision: 8, scale: 4 }),
  cpc: decimal("cpc", { precision: 8, scale: 2 }),
  cpa: decimal("cpa", { precision: 8, scale: 2 }),
  // Additional metrics
  totalSpend: decimal("total_spend", { precision: 12, scale: 2 }),
  totalSales: decimal("total_sales", { precision: 12, scale: 2 }),
  totalOrders: int("total_orders"),
  totalImpressions: int("total_impressions"),
  totalClicks: int("total_clicks"),
  dataPeriod: varchar("data_period", { length: 50 }),
  analysisNotes: text("analysis_notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type CompetitorAdBenchmark = typeof competitorAdBenchmarks.$inferSelect;

export type InsertCompetitorAdBenchmark = typeof competitorAdBenchmarks.$inferInsert;

// ═══════════════════════════════════════════════════════════════
// Ad Keyword Tracking Module
// ═══════════════════════════════════════════════════════════════

// ASIN ↔ Ad Portfolio mapping (manual mapping by user)
export const adPortfolioMappings = mysqlTable("ad_portfolio_mappings", {
  workspaceId: int("workspaceId").$defaultFn(currentOpsWorkspaceId),
  id: int("id").autoincrement().primaryKey(),
  userId: int("user_id").notNull(),
  productId: int("product_id").notNull(), // FK → product_profiles.id
  parentAsin: varchar("parent_asin", { length: 20 }).notNull(),
  portfolioName: varchar("portfolio_name", { length: 300 }).notNull(), // e.g. "48黄色"
  storeName: varchar("store_name", { length: 255 }), // e.g. "1店-US"
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type AdPortfolioMapping = typeof adPortfolioMappings.$inferSelect;

export type InsertAdPortfolioMapping = typeof adPortfolioMappings.$inferInsert;

// Ad report imports (tracks each uploaded ad report file)
export const adReportImports = mysqlTable("ad_report_imports", {
  workspaceId: int("workspaceId").$defaultFn(currentOpsWorkspaceId),
  id: int("id").autoincrement().primaryKey(),
  userId: int("user_id").notNull(),
  fileName: varchar("file_name", { length: 500 }).notNull(),
  fileUrl: text("file_url"),
  weekStartDate: varchar("week_start_date", { length: 10 }).notNull(), // YYYY-MM-DD
  weekEndDate: varchar("week_end_date", { length: 10 }).notNull(),
  totalRows: int("total_rows").default(0),
  keywordRows: int("keyword_rows").default(0),
  productTargetRows: int("product_target_rows").default(0),
  mappedRows: int("mapped_rows").default(0), // rows matched to a product via portfolio mapping
  unmappedPortfolios: text("unmapped_portfolios"), // JSON array of portfolio names without mapping
  status: mysqlEnum("import_status", ["pending", "parsing", "previewing", "importing", "completed", "failed"]).default("pending").notNull(),
  errorMessage: text("error_message"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type AdReportImport = typeof adReportImports.$inferSelect;

export type InsertAdReportImport = typeof adReportImports.$inferInsert;

// Ad keyword weekly data (one row per keyword per match type per ad type per week)
export const adKeywordWeekly = mysqlTable("ad_keyword_weekly", {
  workspaceId: int("workspaceId").$defaultFn(currentOpsWorkspaceId),
  id: int("id").autoincrement().primaryKey(),
  importId: int("import_id").notNull(), // FK → ad_report_imports.id
  userId: int("user_id").notNull(),
  productId: int("product_id"), // FK → product_profiles.id (resolved via portfolio mapping)
  parentAsin: varchar("parent_asin", { length: 20 }),
  weekStartDate: varchar("week_start_date", { length: 10 }).notNull(),
  weekEndDate: varchar("week_end_date", { length: 10 }).notNull(),
  // Ad structure info
  storeName: varchar("store_name", { length: 200 }),
  country: varchar("country", { length: 50 }),
  adType: varchar("ad_type", { length: 10 }).notNull(), // SP, SB, SD
  portfolioName: varchar("portfolio_name", { length: 300 }),
  campaignName: varchar("campaign_name", { length: 500 }),
  adGroupName: varchar("ad_group_name", { length: 500 }),
  // Keyword info
  keyword: varchar("keyword", { length: 500 }).notNull(),
  matchType: varchar("match_type", { length: 20 }).notNull(), // 精准, 广泛, 词组
  targetingType: varchar("targeting_type", { length: 20 }).default("keyword").notNull(), // keyword or product
  status: varchar("ad_status", { length: 50 }), // enabled, paused, etc.
  // Bid info
  bid: decimal("bid", { precision: 10, scale: 2 }),
  defaultBid: decimal("default_bid", { precision: 10, scale: 2 }),
  // Performance metrics
  impressions: int("impressions").default(0),
  impressionShare: varchar("impression_share", { length: 20 }), // IS%
  clicks: int("clicks").default(0),
  ctr: decimal("ctr", { precision: 6, scale: 2 }), // stored as percentage, e.g. 2.69
  cpc: decimal("cpc", { precision: 10, scale: 2 }),
  spend: decimal("spend", { precision: 12, scale: 2 }),
  sales: decimal("sales", { precision: 12, scale: 2 }),
  directSales: decimal("direct_sales", { precision: 12, scale: 2 }),
  indirectSales: decimal("indirect_sales", { precision: 12, scale: 2 }),
  acos: decimal("acos", { precision: 6, scale: 2 }), // stored as percentage
  roas: decimal("roas", { precision: 8, scale: 2 }),
  orders: int("orders").default(0),
  directOrders: int("direct_orders").default(0),
  indirectOrders: int("indirect_orders").default(0),
  cvr: decimal("cvr", { precision: 6, scale: 2 }),
  adSalesQty: int("ad_sales_qty").default(0),
  directSalesQty: int("direct_sales_qty").default(0),
  indirectSalesQty: int("indirect_sales_qty").default(0),
  // Brand metrics (SB/SD)
  brandNewOrders: int("brand_new_orders").default(0),
  brandNewSales: decimal("brand_new_sales", { precision: 12, scale: 2 }),
  brandSearchCount: int("brand_search_count").default(0),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type AdKeywordWeekly = typeof adKeywordWeekly.$inferSelect;

export type InsertAdKeywordWeekly = typeof adKeywordWeekly.$inferInsert;

// Ad keyword metadata (manually editable fields like monthly search volume)
export const adKeywordMeta = mysqlTable("ad_keyword_meta", {
  workspaceId: int("workspaceId").$defaultFn(currentOpsWorkspaceId),
  id: int("id").autoincrement().primaryKey(),
  userId: int("user_id").notNull(),
  productId: int("product_id"), // FK → product_profiles.id
  parentAsin: varchar("parent_asin", { length: 20 }),
  keyword: varchar("keyword", { length: 500 }).notNull(),
  matchType: varchar("match_type", { length: 20 }), // optional: can be global for keyword
  monthlySearchVolume: int("monthly_search_volume"), // manually entered
  searchVolumeUpdatedAt: timestamp("search_volume_updated_at"),
  notes: text("notes"),
  isTracked: int("is_tracked").default(1).notNull(), // whether to show in tracking UI
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type AdKeywordMeta = typeof adKeywordMeta.$inferSelect;

export type InsertAdKeywordMeta = typeof adKeywordMeta.$inferInsert;

// Competitor rank data (per keyword, per week) - reserved for future
export const adCompetitorRanks = mysqlTable("ad_competitor_ranks", {
  workspaceId: int("workspaceId").$defaultFn(currentOpsWorkspaceId),
  id: int("id").autoincrement().primaryKey(),
  userId: int("user_id").notNull(),
  productId: int("product_id"),
  parentAsin: varchar("parent_asin", { length: 20 }),
  keyword: varchar("keyword", { length: 500 }).notNull(),
  weekStartDate: varchar("week_start_date", { length: 10 }).notNull(),
  weekEndDate: varchar("week_end_date", { length: 10 }).notNull(),
  // Competitor info
  competitorBrand: varchar("competitor_brand", { length: 200 }).notNull(),
  competitorAsin: varchar("competitor_asin", { length: 20 }),
  organicRank: int("organic_rank"), // natural position
  adRank: int("ad_rank"), // ad position
  abaClickShare: decimal("aba_click_share", { precision: 6, scale: 2 }), // ABA click share %
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type AdCompetitorRank = typeof adCompetitorRanks.$inferSelect;

export type InsertAdCompetitorRank = typeof adCompetitorRanks.$inferInsert;

// ═══════════════════════════════════════════════════════════════
// Ad Report Upload Tables (replacing Lingxing API with file uploads)
// ═══════════════════════════════════════════════════════════════

// Unified upload history for all ad report types
export const adReportUploads = mysqlTable("ad_report_uploads", {
  workspaceId: int("workspaceId").$defaultFn(currentOpsWorkspaceId),
  id: int("id").autoincrement().primaryKey(),
  userId: int("user_id").notNull(),
  reportType: mysqlEnum("report_type", [
    "search_term",    // 搜索词报告
    "campaign",       // 广告活动报告
    "placement",      // 广告位报告
    "hourly",         // 广告小时报告 (CSV)
    "order",          // SC订单导出
    "dsp",            // DSP广告报告
    "daily_placement",          // 每日广告位报告
    "daily_search_term",        // 每日搜索词报告
    "daily_impression_share",   // 每日展示份额报告
    "daily_sb_benchmark",       // 每日SB基准报告
    "daily_business",           // 每日业务报告
  ]).notNull(),
  fileName: varchar("file_name", { length: 500 }).notNull(),
  fileUrl: text("file_url"),
  weekStartDate: varchar("week_start_date", { length: 10 }), // YYYY-MM-DD (optional for hourly/order)
  weekEndDate: varchar("week_end_date", { length: 10 }),
  dateLabel: varchar("date_label", { length: 50 }), // e.g. "2026-W17" or "04/21-04/27"
  totalRows: int("total_rows").default(0),
  importedRows: int("imported_rows").default(0),
  storeName: varchar("store_name", { length: 200 }), // detected from file
  status: mysqlEnum("upload_status", ["pending", "parsing", "completed", "failed"]).default("pending").notNull(),
  errorMessage: text("error_message"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type AdReportUpload = typeof adReportUploads.$inferSelect;

export type InsertAdReportUpload = typeof adReportUploads.$inferInsert;

// Search term report data (领星用户搜索词报告)
export const adSearchTermReports = mysqlTable("ad_search_term_reports", {
  workspaceId: int("workspaceId").$defaultFn(currentOpsWorkspaceId),
  id: int("id").autoincrement().primaryKey(),
  uploadId: int("upload_id").notNull(), // FK → ad_report_uploads.id
  userId: int("user_id").notNull(),
  productId: int("product_id"), // resolved via portfolio mapping
  parentAsin: varchar("parent_asin", { length: 20 }),
  weekStartDate: varchar("week_start_date", { length: 10 }).notNull(),
  weekEndDate: varchar("week_end_date", { length: 10 }).notNull(),
  // Structure
  storeName: varchar("store_name", { length: 200 }),
  country: varchar("country", { length: 50 }),
  adType: varchar("ad_type", { length: 10 }).notNull(), // SP, SB, SD
  portfolioName: varchar("portfolio_name", { length: 300 }),
  campaignName: varchar("campaign_name", { length: 500 }),
  adGroupName: varchar("ad_group_name", { length: 500 }),
  keyword: varchar("keyword", { length: 500 }),
  matchType: varchar("match_type", { length: 20 }),
  targeting: varchar("targeting", { length: 500 }), // 投放
  searchTerm: varchar("search_term", { length: 500 }).notNull(),
  // Metrics
  impressions: int("impressions").default(0),
  clicks: int("clicks").default(0),
  ctr: decimal("ctr", { precision: 8, scale: 4 }),
  cpc: decimal("cpc", { precision: 10, scale: 2 }),
  spend: decimal("spend", { precision: 12, scale: 2 }),
  sales: decimal("sales", { precision: 12, scale: 2 }),
  directSales: decimal("direct_sales", { precision: 12, scale: 2 }),
  indirectSales: decimal("indirect_sales", { precision: 12, scale: 2 }),
  acos: decimal("acos", { precision: 8, scale: 4 }),
  roas: decimal("roas", { precision: 8, scale: 2 }),
  orders: int("orders").default(0),
  directOrders: int("direct_orders").default(0),
  indirectOrders: int("indirect_orders").default(0),
  indirectOrderRatio: decimal("indirect_order_ratio", { precision: 6, scale: 4 }),
  cpa: decimal("cpa", { precision: 10, scale: 2 }),
  cvr: decimal("cvr", { precision: 8, scale: 4 }),
  avgOrderValue: decimal("avg_order_value", { precision: 10, scale: 2 }),
  directAvgOrderValue: decimal("direct_avg_order_value", { precision: 10, scale: 2 }),
  indirectAvgOrderValue: decimal("indirect_avg_order_value", { precision: 10, scale: 2 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type AdSearchTermReport = typeof adSearchTermReports.$inferSelect;

export type InsertAdSearchTermReport = typeof adSearchTermReports.$inferInsert;

// Campaign report data (领星广告活动报告)
export const adCampaignReports = mysqlTable("ad_campaign_reports", {
  workspaceId: int("workspaceId").$defaultFn(currentOpsWorkspaceId),
  id: int("id").autoincrement().primaryKey(),
  uploadId: int("upload_id").notNull(),
  userId: int("user_id").notNull(),
  productId: int("product_id"),
  parentAsin: varchar("parent_asin", { length: 20 }),
  weekStartDate: varchar("week_start_date", { length: 10 }).notNull(),
  weekEndDate: varchar("week_end_date", { length: 10 }).notNull(),
  // Structure
  storeName: varchar("store_name", { length: 200 }),
  country: varchar("country", { length: 50 }),
  adType: varchar("ad_type", { length: 10 }).notNull(),
  portfolioName: varchar("portfolio_name", { length: 300 }),
  campaignName: varchar("campaign_name", { length: 500 }).notNull(),
  effectiveStatus: varchar("effective_status", { length: 50 }),
  budget: decimal("budget", { precision: 10, scale: 2 }),
  // Metrics
  impressions: int("impressions").default(0),
  impressionShare: varchar("impression_share", { length: 20 }),
  clicks: int("clicks").default(0),
  ctr: decimal("ctr", { precision: 8, scale: 4 }),
  cpc: decimal("cpc", { precision: 10, scale: 2 }),
  spend: decimal("spend", { precision: 12, scale: 2 }),
  sales: decimal("sales", { precision: 12, scale: 2 }),
  directSales: decimal("direct_sales", { precision: 12, scale: 2 }),
  indirectSales: decimal("indirect_sales", { precision: 12, scale: 2 }),
  acos: decimal("acos", { precision: 8, scale: 4 }),
  roas: decimal("roas", { precision: 8, scale: 2 }),
  orders: int("orders").default(0),
  directOrders: int("direct_orders").default(0),
  indirectOrders: int("indirect_orders").default(0),
  indirectOrderRatio: decimal("indirect_order_ratio", { precision: 6, scale: 4 }),
  cpa: decimal("cpa", { precision: 10, scale: 2 }),
  cvr: decimal("cvr", { precision: 8, scale: 4 }),
  avgOrderValue: decimal("avg_order_value", { precision: 10, scale: 2 }),
  directAvgOrderValue: decimal("direct_avg_order_value", { precision: 10, scale: 2 }),
  indirectAvgOrderValue: decimal("indirect_avg_order_value", { precision: 10, scale: 2 }),
  // Brand metrics
  brandNewOrders: int("brand_new_orders").default(0),
  brandNewCvr: decimal("brand_new_cvr", { precision: 8, scale: 4 }),
  brandNewSales: decimal("brand_new_sales", { precision: 12, scale: 2 }),
  brandNewSalesQty: int("brand_new_sales_qty").default(0),
  adSalesQty: int("ad_sales_qty").default(0),
  directSalesQty: int("direct_sales_qty").default(0),
  indirectSalesQty: int("indirect_sales_qty").default(0),
  // Video metrics
  vcpm: decimal("vcpm", { precision: 10, scale: 2 }),
  viewableImpressions: int("viewable_impressions").default(0),
  dpv: int("dpv").default(0),
  fiveSecViews: int("five_sec_views").default(0),
  fiveSecViewRate: decimal("five_sec_view_rate", { precision: 8, scale: 4 }),
  videoQuarter: int("video_quarter").default(0),
  videoHalf: int("video_half").default(0),
  videoThreeQuarter: int("video_three_quarter").default(0),
  videoComplete: int("video_complete").default(0),
  videoUnmute: int("video_unmute").default(0),
  vtr: decimal("vtr", { precision: 8, scale: 4 }),
  vctr: decimal("vctr", { precision: 8, scale: 4 }),
  brandSearchCount: int("brand_search_count").default(0),
  avgReach: decimal("avg_reach", { precision: 8, scale: 2 }),
  cumulativeReach: int("cumulative_reach").default(0),
  tags: text("tags"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type AdCampaignReport = typeof adCampaignReports.$inferSelect;

export type InsertAdCampaignReport = typeof adCampaignReports.$inferInsert;

// Placement report data (领星广告位报告)
export const adPlacementReports = mysqlTable("ad_placement_reports", {
  workspaceId: int("workspaceId").$defaultFn(currentOpsWorkspaceId),
  id: int("id").autoincrement().primaryKey(),
  uploadId: int("upload_id").notNull(),
  userId: int("user_id").notNull(),
  productId: int("product_id"),
  parentAsin: varchar("parent_asin", { length: 20 }),
  weekStartDate: varchar("week_start_date", { length: 10 }).notNull(),
  weekEndDate: varchar("week_end_date", { length: 10 }).notNull(),
  // Structure
  storeName: varchar("store_name", { length: 200 }),
  country: varchar("country", { length: 50 }),
  adType: varchar("ad_type", { length: 10 }).notNull(),
  portfolioName: varchar("portfolio_name", { length: 300 }),
  campaignName: varchar("campaign_name", { length: 500 }).notNull(),
  placement: varchar("placement", { length: 100 }).notNull(), // TOP_OF_SEARCH, DETAIL_PAGE, OTHER, OFF_AMAZON
  // Metrics
  impressions: int("impressions").default(0),
  clicks: int("clicks").default(0),
  ctr: decimal("ctr", { precision: 8, scale: 4 }),
  cpc: decimal("cpc", { precision: 10, scale: 2 }),
  spend: decimal("spend", { precision: 12, scale: 2 }),
  sales: decimal("sales", { precision: 12, scale: 2 }),
  directSales: decimal("direct_sales", { precision: 12, scale: 2 }),
  indirectSales: decimal("indirect_sales", { precision: 12, scale: 2 }),
  acos: decimal("acos", { precision: 8, scale: 4 }),
  roas: decimal("roas", { precision: 8, scale: 2 }),
  orders: int("orders").default(0),
  directOrders: int("direct_orders").default(0),
  indirectOrders: int("indirect_orders").default(0),
  indirectOrderRatio: decimal("indirect_order_ratio", { precision: 6, scale: 4 }),
  cpa: decimal("cpa", { precision: 10, scale: 2 }),
  cvr: decimal("cvr", { precision: 8, scale: 4 }),
  avgOrderValue: decimal("avg_order_value", { precision: 10, scale: 2 }),
  directAvgOrderValue: decimal("direct_avg_order_value", { precision: 10, scale: 2 }),
  indirectAvgOrderValue: decimal("indirect_avg_order_value", { precision: 10, scale: 2 }),
  // Brand & video metrics
  brandNewOrders: int("brand_new_orders").default(0),
  brandNewCvr: decimal("brand_new_cvr", { precision: 8, scale: 4 }),
  brandNewSales: decimal("brand_new_sales", { precision: 12, scale: 2 }),
  brandNewSalesQty: int("brand_new_sales_qty").default(0),
  adSalesQty: int("ad_sales_qty").default(0),
  directSalesQty: int("direct_sales_qty").default(0),
  indirectSalesQty: int("indirect_sales_qty").default(0),
  viewableImpressions: int("viewable_impressions").default(0),
  dpv: int("dpv").default(0),
  fiveSecViews: int("five_sec_views").default(0),
  fiveSecViewRate: decimal("five_sec_view_rate", { precision: 8, scale: 4 }),
  videoQuarter: int("video_quarter").default(0),
  videoHalf: int("video_half").default(0),
  videoThreeQuarter: int("video_three_quarter").default(0),
  videoComplete: int("video_complete").default(0),
  videoUnmute: int("video_unmute").default(0),
  vtr: decimal("vtr", { precision: 8, scale: 4 }),
  vctr: decimal("vctr", { precision: 8, scale: 4 }),
  brandSearchCount: int("brand_search_count").default(0),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type AdPlacementReport = typeof adPlacementReports.$inferSelect;

export type InsertAdPlacementReport = typeof adPlacementReports.$inferInsert;

// Hourly report data (亚马逊广告小时报告 CSV)
export const adHourlyReports = mysqlTable("ad_hourly_reports", {
  workspaceId: int("workspaceId").$defaultFn(currentOpsWorkspaceId),
  id: int("id").autoincrement().primaryKey(),
  uploadId: int("upload_id").notNull(),
  userId: int("user_id").notNull(),
  productId: int("product_id"),
  parentAsin: varchar("parent_asin", { length: 20 }),
  // Time
  hour: int("hour").notNull(), // 0-23
  reportDate: varchar("report_date", { length: 10 }), // YYYY-MM-DD if available
  // Structure
  currency: varchar("currency", { length: 10 }),
  accountName: varchar("account_name", { length: 200 }),
  portfolioName: varchar("portfolio_name", { length: 300 }),
  campaignName: varchar("campaign_name", { length: 500 }),
  campaignId: varchar("campaign_id", { length: 100 }),
  adGroupName: varchar("ad_group_name", { length: 500 }),
  adGroupId: varchar("ad_group_id", { length: 100 }),
  targetingValue: varchar("targeting_value", { length: 500 }),
  searchTerm: varchar("search_term", { length: 500 }),
  promotedSku: varchar("promoted_sku", { length: 100 }),
  promotedAsin: varchar("promoted_asin", { length: 20 }),
  placementName: varchar("placement_name", { length: 200 }),
  placementClassification: varchar("placement_classification", { length: 100 }), // Top of Search, Detail Page, Other, Off Amazon
  // Metrics
  impressions: int("impressions").default(0),
  invalidImpressions: int("invalid_impressions").default(0),
  clicks: int("clicks").default(0),
  invalidClicks: int("invalid_clicks").default(0),
  ctr: decimal("ctr", { precision: 8, scale: 4 }),
  cpc: decimal("cpc", { precision: 10, scale: 2 }),
  cpm: decimal("cpm", { precision: 10, scale: 2 }),
  vcpm: decimal("vcpm", { precision: 10, scale: 2 }),
  vctr: decimal("vctr", { precision: 8, scale: 4 }),
  spend: decimal("spend", { precision: 12, scale: 2 }), // derived: clicks * cpc
  purchases: int("purchases").default(0),
  sales: decimal("sales", { precision: 12, scale: 2 }),
  costPerPurchase: decimal("cost_per_purchase", { precision: 10, scale: 2 }),
  purchaseRate: decimal("purchase_rate", { precision: 8, scale: 4 }),
  roas: decimal("roas", { precision: 8, scale: 2 }),
  clickPurchases: int("click_purchases").default(0),
  clickRoas: decimal("click_roas", { precision: 8, scale: 2 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type AdHourlyReport = typeof adHourlyReports.$inferSelect;

export type InsertAdHourlyReport = typeof adHourlyReports.$inferInsert;

// Order hourly data (extracted from 领星SC订单导出, for dayparting analysis)
export const adOrderHourly = mysqlTable("ad_order_hourly", {
  workspaceId: int("workspaceId").$defaultFn(currentOpsWorkspaceId),
  id: int("id").autoincrement().primaryKey(),
  uploadId: int("upload_id").notNull(),
  userId: int("user_id").notNull(),
  productId: int("product_id"),
  parentAsin: varchar("parent_asin", { length: 20 }),
  // Order info
  orderId: varchar("order_id", { length: 50 }).notNull(),
  orderStatus: varchar("order_status", { length: 50 }),
  orderType: varchar("order_type", { length: 20 }), // AFN, MFN
  orderDate: timestamp("order_date").notNull(), // original order datetime (UTC from Lingxing)
  // Time dimensions (pre-computed for pivot analysis)
  orderHour: int("order_hour").notNull(), // 0-23 (PST)
  orderDayOfWeek: int("order_day_of_week").notNull(), // 0=Sunday, 6=Saturday
  orderDateStr: varchar("order_date_str", { length: 10 }).notNull(), // YYYY-MM-DD (PST)
  // Product info
  storeName: varchar("store_name", { length: 200 }),
  country: varchar("country", { length: 50 }),
  asin: varchar("asin", { length: 20 }),
  sku: varchar("sku", { length: 100 }),
  msku: varchar("msku", { length: 100 }),
  productName: varchar("product_name", { length: 500 }),
  // Financials
  quantity: int("quantity").default(1),
  unitPrice: decimal("unit_price", { precision: 10, scale: 2 }),
  salesRevenue: decimal("sales_revenue", { precision: 10, scale: 2 }),
  itemPrice: decimal("item_price", { precision: 10, scale: 2 }),
  currency: varchar("currency", { length: 10 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type AdOrderHourly = typeof adOrderHourly.$inferSelect;

export type InsertAdOrderHourly = typeof adOrderHourly.$inferInsert;

// ─── DSP Report Table ────────────────────────────────────────────
export const adDspReports = mysqlTable("ad_dsp_reports", {
  workspaceId: int("workspaceId").$defaultFn(currentOpsWorkspaceId),
  id: int("id").autoincrement().primaryKey(),
  userId: int("user_id").notNull(),
  uploadId: int("upload_id").notNull(),
  productId: int("product_id"),
  // Date range
  weekStartDate: varchar("week_start_date", { length: 10 }),
  weekEndDate: varchar("week_end_date", { length: 10 }),
  // Order info
  orderName: varchar("order_name", { length: 500 }),
  orderBudget: decimal("order_budget", { precision: 12, scale: 2 }).default("0"),
  orderStatus: varchar("order_status", { length: 50 }),
  // Spend & Revenue
  spends: decimal("spends", { precision: 12, scale: 2 }).default("0"),
  sales: decimal("sales", { precision: 12, scale: 2 }).default("0"),
  orders: int("orders").default(0),
  // Impressions & Engagement
  impressions: int("impressions").default(0),
  viewableImpressions: int("viewable_impressions").default(0),
  clicks: int("clicks").default(0),
  dpv: int("dpv").default(0),
  totalAddToCart: int("total_add_to_cart").default(0),
  // Derived metrics (stored for convenience)
  roas: decimal("roas", { precision: 8, scale: 2 }).default("0"),
  acos: decimal("acos", { precision: 8, scale: 2 }).default("0"),
  ctr: decimal("ctr", { precision: 8, scale: 4 }).default("0"),
  // Raw extra fields
  lineItemType: varchar("line_item_type", { length: 100 }),
  creativeType: varchar("creative_type", { length: 100 }),
  storeName: varchar("store_name", { length: 200 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type AdDspReport = typeof adDspReports.$inferSelect;

export type InsertAdDspReport = typeof adDspReports.$inferInsert;

// ═══════════════════════════════════════════════════════════════
// 广告深度优化模块 - 数据基座：五大每日报告表
// ═══════════════════════════════════════════════════════════════

// 每日广告位报告表 (Daily Placement Report)
export const adDailyPlacementReports = mysqlTable("ad_daily_placement_reports", {
  workspaceId: int("workspaceId").$defaultFn(currentOpsWorkspaceId),
  id: int("id").autoincrement().primaryKey(),
  uploadId: int("upload_id").notNull(),
  userId: int("user_id").notNull(),
  productId: int("product_id"),
  parentAsin: varchar("parent_asin", { length: 20 }),
  reportDate: varchar("report_date", { length: 10 }).notNull(), // YYYY-MM-DD
  storeName: varchar("store_name", { length: 200 }),
  country: varchar("country", { length: 50 }),
  adType: varchar("ad_type", { length: 10 }).notNull(), // SP/SB/SD
  portfolioName: varchar("portfolio_name", { length: 300 }),
  campaignName: varchar("campaign_name", { length: 500 }).notNull(),
  placement: varchar("placement", { length: 100 }).notNull(), // Top of Search, Detail Page, Other, Off Amazon
  impressions: int("impressions").default(0),
  clicks: int("clicks").default(0),
  ctr: decimal("ctr", { precision: 8, scale: 4 }),
  cpc: decimal("cpc", { precision: 10, scale: 2 }),
  spend: decimal("spend", { precision: 12, scale: 2 }),
  sales: decimal("sales", { precision: 12, scale: 2 }),
  directSales: decimal("direct_sales", { precision: 12, scale: 2 }),
  indirectSales: decimal("indirect_sales", { precision: 12, scale: 2 }),
  acos: decimal("acos", { precision: 8, scale: 4 }),
  roas: decimal("roas", { precision: 8, scale: 2 }),
  orders: int("orders").default(0),
  directOrders: int("direct_orders").default(0),
  indirectOrders: int("indirect_orders").default(0),
  cvr: decimal("cvr", { precision: 8, scale: 4 }),
  cpa: decimal("cpa", { precision: 10, scale: 2 }),
  brandNewOrders: int("brand_new_orders").default(0),
  brandNewSales: decimal("brand_new_sales", { precision: 12, scale: 2 }),
  viewableImpressions: int("viewable_impressions").default(0),
  vtr: decimal("vtr", { precision: 8, scale: 4 }),
  vctr: decimal("vctr", { precision: 8, scale: 4 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type AdDailyPlacementReport = typeof adDailyPlacementReports.$inferSelect;

export type InsertAdDailyPlacementReport = typeof adDailyPlacementReports.$inferInsert;

// 每日搜索词报告表 (Daily Search Term Report)
export const adDailySearchTermReports = mysqlTable("ad_daily_search_term_reports", {
  workspaceId: int("workspaceId").$defaultFn(currentOpsWorkspaceId),
  id: int("id").autoincrement().primaryKey(),
  uploadId: int("upload_id").notNull(),
  userId: int("user_id").notNull(),
  productId: int("product_id"),
  parentAsin: varchar("parent_asin", { length: 20 }),
  reportDate: varchar("report_date", { length: 10 }).notNull(),
  storeName: varchar("store_name", { length: 200 }),
  country: varchar("country", { length: 50 }),
  adType: varchar("ad_type", { length: 10 }).notNull(),
  portfolioName: varchar("portfolio_name", { length: 300 }),
  campaignName: varchar("campaign_name", { length: 500 }),
  adGroupName: varchar("ad_group_name", { length: 500 }),
  keyword: varchar("keyword", { length: 500 }),
  matchType: varchar("match_type", { length: 20 }),
  targeting: varchar("targeting", { length: 500 }),
  searchTerm: varchar("search_term", { length: 500 }).notNull(),
  impressions: int("impressions").default(0),
  clicks: int("clicks").default(0),
  ctr: decimal("ctr", { precision: 8, scale: 4 }),
  cpc: decimal("cpc", { precision: 10, scale: 2 }),
  spend: decimal("spend", { precision: 12, scale: 2 }),
  sales: decimal("sales", { precision: 12, scale: 2 }),
  directSales: decimal("direct_sales", { precision: 12, scale: 2 }),
  indirectSales: decimal("indirect_sales", { precision: 12, scale: 2 }),
  acos: decimal("acos", { precision: 8, scale: 4 }),
  roas: decimal("roas", { precision: 8, scale: 2 }),
  orders: int("orders").default(0),
  directOrders: int("direct_orders").default(0),
  indirectOrders: int("indirect_orders").default(0),
  cvr: decimal("cvr", { precision: 8, scale: 4 }),
  cpa: decimal("cpa", { precision: 10, scale: 2 }),
  avgOrderValue: decimal("avg_order_value", { precision: 10, scale: 2 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type AdDailySearchTermReport = typeof adDailySearchTermReports.$inferSelect;

export type InsertAdDailySearchTermReport = typeof adDailySearchTermReports.$inferInsert;

// 每日搜索词展示量份额报告表 (Daily Impression Share Report)
export const adDailyImpressionShareReports = mysqlTable("ad_daily_impression_share_reports", {
  workspaceId: int("workspaceId").$defaultFn(currentOpsWorkspaceId),
  id: int("id").autoincrement().primaryKey(),
  uploadId: int("upload_id").notNull(),
  userId: int("user_id").notNull(),
  productId: int("product_id"),
  parentAsin: varchar("parent_asin", { length: 20 }),
  reportDate: varchar("report_date", { length: 10 }).notNull(),
  storeName: varchar("store_name", { length: 200 }),
  country: varchar("country", { length: 50 }),
  adType: varchar("ad_type", { length: 10 }).default("SP"),
  portfolioName: varchar("portfolio_name", { length: 300 }),
  campaignName: varchar("campaign_name", { length: 500 }),
  adGroupName: varchar("ad_group_name", { length: 500 }),
  targeting: varchar("targeting", { length: 500 }),
  searchTerm: varchar("search_term", { length: 500 }),
  impressionShare: decimal("impression_share", { precision: 8, scale: 4 }),
  impressionRank: int("impression_rank"),
  impressions: int("impressions").default(0),
  clicks: int("clicks").default(0),
  ctr: decimal("ctr", { precision: 8, scale: 4 }),
  spend: decimal("spend", { precision: 12, scale: 2 }),
  sales: decimal("sales", { precision: 12, scale: 2 }),
  acos: decimal("acos", { precision: 8, scale: 4 }),
  orders: int("orders").default(0),
  topCompetitorShare: decimal("top_competitor_share", { precision: 8, scale: 4 }),
  topCompetitorAsin: varchar("top_competitor_asin", { length: 20 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type AdDailyImpressionShareReport = typeof adDailyImpressionShareReports.$inferSelect;

export type InsertAdDailyImpressionShareReport = typeof adDailyImpressionShareReports.$inferInsert;

// 每日SB Benchmark广告报告表 (Daily SB Benchmark Report)
export const adDailySbBenchmarkReports = mysqlTable("ad_daily_sb_benchmark_reports", {
  workspaceId: int("workspaceId").$defaultFn(currentOpsWorkspaceId),
  id: int("id").autoincrement().primaryKey(),
  uploadId: int("upload_id").notNull(),
  userId: int("user_id").notNull(),
  productId: int("product_id"),
  parentAsin: varchar("parent_asin", { length: 20 }),
  reportDate: varchar("report_date", { length: 10 }).notNull(),
  storeName: varchar("store_name", { length: 200 }),
  country: varchar("country", { length: 50 }),
  campaignName: varchar("campaign_name", { length: 500 }).notNull(),
  adFormat: varchar("ad_format", { length: 50 }), // Product Collection, Store Spotlight, Video
  impressions: int("impressions").default(0),
  clicks: int("clicks").default(0),
  ctr: decimal("ctr", { precision: 8, scale: 4 }),
  cpc: decimal("cpc", { precision: 10, scale: 2 }),
  spend: decimal("spend", { precision: 12, scale: 2 }),
  sales: decimal("sales", { precision: 12, scale: 2 }),
  acos: decimal("acos", { precision: 8, scale: 4 }),
  roas: decimal("roas", { precision: 8, scale: 2 }),
  orders: int("orders").default(0),
  dpv: int("dpv").default(0),
  newToBrandOrders: int("new_to_brand_orders").default(0),
  newToBrandSales: decimal("new_to_brand_sales", { precision: 12, scale: 2 }),
  newToBrandRate: decimal("new_to_brand_rate", { precision: 8, scale: 4 }),
  benchmarkCtr: decimal("benchmark_ctr", { precision: 8, scale: 4 }),
  benchmarkCpc: decimal("benchmark_cpc", { precision: 10, scale: 2 }),
  benchmarkAcos: decimal("benchmark_acos", { precision: 8, scale: 4 }),
  benchmarkRoas: decimal("benchmark_roas", { precision: 8, scale: 2 }),
  benchmarkCvr: decimal("benchmark_cvr", { precision: 8, scale: 4 }),
  benchmarkDpvRate: decimal("benchmark_dpv_rate", { precision: 8, scale: 4 }),
  benchmarkNewToBrandRate: decimal("benchmark_new_to_brand_rate", { precision: 8, scale: 4 }),
  ctrVsBenchmark: varchar("ctr_vs_benchmark", { length: 20 }),
  cpcVsBenchmark: varchar("cpc_vs_benchmark", { length: 20 }),
  acosVsBenchmark: varchar("acos_vs_benchmark", { length: 20 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type AdDailySbBenchmarkReport = typeof adDailySbBenchmarkReports.$inferSelect;

export type InsertAdDailySbBenchmarkReport = typeof adDailySbBenchmarkReports.$inferInsert;

// 每日业务报告表 (Daily Business Report)
export const adDailyBusinessReports = mysqlTable("ad_daily_business_reports", {
  workspaceId: int("workspaceId").$defaultFn(currentOpsWorkspaceId),
  id: int("id").autoincrement().primaryKey(),
  uploadId: int("upload_id").notNull(),
  userId: int("user_id").notNull(),
  productId: int("product_id"),
  parentAsin: varchar("parent_asin", { length: 20 }),
  childAsin: varchar("child_asin", { length: 20 }),
  reportDate: varchar("report_date", { length: 10 }).notNull(),
  storeName: varchar("store_name", { length: 200 }),
  country: varchar("country", { length: 50 }),
  sku: varchar("sku", { length: 100 }),
  productName: varchar("product_name", { length: 500 }),
  sessions: int("sessions").default(0),
  sessionPercentage: decimal("session_percentage", { precision: 8, scale: 4 }),
  pageViews: int("page_views").default(0),
  pageViewsPercentage: decimal("page_views_percentage", { precision: 8, scale: 4 }),
  buyBoxPercentage: decimal("buy_box_percentage", { precision: 8, scale: 4 }),
  unitsOrdered: int("units_ordered").default(0),
  unitsOrderedB2b: int("units_ordered_b2b").default(0),
  unitSessionPercentage: decimal("unit_session_percentage", { precision: 8, scale: 4 }),
  unitSessionPercentageB2b: decimal("unit_session_percentage_b2b", { precision: 8, scale: 4 }),
  orderedProductSales: decimal("ordered_product_sales", { precision: 12, scale: 2 }),
  orderedProductSalesB2b: decimal("ordered_product_sales_b2b", { precision: 12, scale: 2 }),
  totalOrderItems: int("total_order_items").default(0),
  totalOrderItemsB2b: int("total_order_items_b2b").default(0),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type AdDailyBusinessReport = typeof adDailyBusinessReports.$inferSelect;

export type InsertAdDailyBusinessReport = typeof adDailyBusinessReports.$inferInsert;

// ═══════════════════════════════════════════════════════════════
// 广告深度优化模块 - 子模块数据表
// ═══════════════════════════════════════════════════════════════

// 产品周期判定记录 (子模块1)
export const adProductStages = mysqlTable("ad_product_stages", {
  workspaceId: int("workspaceId").$defaultFn(currentOpsWorkspaceId),
  id: int("id").autoincrement().primaryKey(),
  userId: int("user_id").notNull(),
  portfolioNames: text("portfolio_names"), // JSON array of selected portfolios
  parentAsin: varchar("parent_asin", { length: 20 }),
  dateRangeStart: varchar("date_range_start", { length: 10 }).notNull(),
  dateRangeEnd: varchar("date_range_end", { length: 10 }).notNull(),
  stage: varchar("stage", { length: 20 }).notNull(), // 止血期/稳结构期/放量期
  confidence: int("confidence").default(0), // 0-100
  evidence: text("evidence"), // JSON array of evidence strings
  redFlags: text("red_flags"), // JSON array
  dailyHighlights: text("daily_highlights"), // JSON array of {date, event, impact}
  strategy: text("strategy"), // JSON: {core_action, keyword_strategy, budget_strategy, bid_strategy, dont_do}
  transitionSignals: text("transition_signals"), // JSON array
  userEdits: text("user_edits"), // JSON: user modifications to AI suggestions
  status: mysqlEnum("status", ["draft", "confirmed", "archived"]).default("draft").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type AdProductStage = typeof adProductStages.$inferSelect;

export type InsertAdProductStage = typeof adProductStages.$inferInsert;

// 关键词分级记录 (子模块2)
export const adKeywordTiers = mysqlTable("ad_keyword_tiers", {
  workspaceId: int("workspaceId").$defaultFn(currentOpsWorkspaceId),
  id: int("id").autoincrement().primaryKey(),
  userId: int("user_id").notNull(),
  portfolioNames: text("portfolio_names"),
  dateRangeStart: varchar("date_range_start", { length: 10 }).notNull(),
  dateRangeEnd: varchar("date_range_end", { length: 10 }).notNull(),
  keyword: varchar("keyword", { length: 500 }).notNull(),
  tier: varchar("tier", { length: 20 }).notNull(), // 核心词/腰部词/长尾词
  role: varchar("role", { length: 20 }), // 结构支点/输出核心/修复核心
  currentPerformance: varchar("current_performance", { length: 20 }), // 优秀/良好/待优化/需止血
  dailyTrend: varchar("daily_trend", { length: 20 }), // 上升/稳定/下降/波动
  anomalyDates: text("anomaly_dates"), // JSON array
  action: text("action"), // 具体操作建议
  bidSuggestion: text("bid_suggestion"),
  priority: varchar("priority", { length: 10 }), // 高/中/低
  reason: text("reason"),
  userEdited: int("user_edited").default(0),
  userAction: text("user_action"), // User's modified action
  status: mysqlEnum("status", ["pending", "confirmed", "ignored"]).default("pending").notNull(),
  batchId: int("batch_id"), // Groups keywords from same analysis run
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type AdKeywordTier = typeof adKeywordTiers.$inferSelect;

export type InsertAdKeywordTier = typeof adKeywordTiers.$inferInsert;

// 串联诊断记录 (子模块3)
export const adDiagnoses = mysqlTable("ad_diagnoses", {
  workspaceId: int("workspaceId").$defaultFn(currentOpsWorkspaceId),
  id: int("id").autoincrement().primaryKey(),
  userId: int("user_id").notNull(),
  portfolioNames: text("portfolio_names"),
  dateRangeStart: varchar("date_range_start", { length: 10 }).notNull(),
  dateRangeEnd: varchar("date_range_end", { length: 10 }).notNull(),
  diagnosisResult: text("diagnosis_result"), // Full JSON of 5-step diagnosis
  overallVerdict: text("overall_verdict"),
  priorityActions: text("priority_actions"), // JSON array of actions
  warning: text("warning"),
  userEdits: text("user_edits"),
  status: mysqlEnum("status", ["draft", "confirmed", "archived"]).default("draft").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type AdDiagnosis = typeof adDiagnoses.$inferSelect;

export type InsertAdDiagnosis = typeof adDiagnoses.$inferInsert;

// 五大报表独立分析记录 (子模块4)
export const adReportAnalysisRecords = mysqlTable("ad_report_analysis_records", {
  workspaceId: int("workspaceId").$defaultFn(currentOpsWorkspaceId),
  id: int("id").autoincrement().primaryKey(),
  userId: int("user_id").notNull(),
  reportType: varchar("report_type", { length: 30 }).notNull(), // placement/search_term/impression_share/sb_benchmark/business_cross
  portfolioNames: text("portfolio_names"),
  dateRangeStart: varchar("date_range_start", { length: 10 }).notNull(),
  dateRangeEnd: varchar("date_range_end", { length: 10 }).notNull(),
  analysisResult: text("analysis_result"), // Full JSON of analysis output
  actionItems: text("action_items"), // JSON array of editable action items
  userEdits: text("user_edits"),
  status: mysqlEnum("status", ["draft", "confirmed", "archived"]).default("draft").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type AdReportAnalysisRecord = typeof adReportAnalysisRecords.$inferSelect;

export type InsertAdReportAnalysisRecord = typeof adReportAnalysisRecords.$inferInsert;

// SOP任务清单 (子模块5)
export const adSopTasks = mysqlTable("ad_sop_tasks", {
  workspaceId: int("workspaceId").$defaultFn(currentOpsWorkspaceId),
  id: int("id").autoincrement().primaryKey(),
  userId: int("user_id").notNull(),
  portfolioNames: text("portfolio_names"),
  period: varchar("period", { length: 20 }).notNull(), // daily/weekly/monthly
  category: varchar("category", { length: 50 }).notNull(), // 止血/优化/拓展/监控
  title: varchar("title", { length: 500 }).notNull(),
  description: text("description"),
  evidence: text("evidence"), // JSON: data basis for this task
  priority: varchar("priority", { length: 10 }), // 高/中/低
  status: mysqlEnum("status", ["pending", "in_progress", "completed", "skipped"]).default("pending").notNull(),
  completedAt: timestamp("completedAt"),
  completedNote: text("completed_note"),
  sourceModule: varchar("source_module", { length: 30 }), // which sub-module generated this
  sourceRecordId: int("source_record_id"),
  dueDate: varchar("due_date", { length: 10 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type AdSopTask = typeof adSopTasks.$inferSelect;

export type InsertAdSopTask = typeof adSopTasks.$inferInsert;

// 疑难杂症AI诊所记录 (子模块6)
export const adClinicRecords = mysqlTable("ad_clinic_records", {
  workspaceId: int("workspaceId").$defaultFn(currentOpsWorkspaceId),
  id: int("id").autoincrement().primaryKey(),
  userId: int("user_id").notNull(),
  portfolioNames: text("portfolio_names"),
  dateRangeStart: varchar("date_range_start", { length: 10 }),
  dateRangeEnd: varchar("date_range_end", { length: 10 }),
  symptomCategory: varchar("symptom_category", { length: 50 }), // ACoS飙升/自然排名下降/广告无曝光/...
  symptomDescription: text("symptom_description"),
  additionalContext: text("additional_context"), // User-provided extra info
  diagnosis: text("diagnosis"), // JSON: AI diagnosis result
  prescription: text("prescription"), // JSON array of treatment actions
  userEdits: text("user_edits"),
  status: mysqlEnum("status", ["consulting", "diagnosed", "treating", "resolved", "archived"]).default("consulting").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type AdClinicRecord = typeof adClinicRecords.$inferSelect;

export type InsertAdClinicRecord = typeof adClinicRecords.$inferInsert;
