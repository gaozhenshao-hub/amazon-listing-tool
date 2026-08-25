import { bigint, boolean, decimal, index, int, json, mysqlEnum, mysqlTable, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/mysql-core";
import { currentOpsWorkspaceId } from "../../server/domains/ops/workspaceContext";

// ═══════════════════════════════════════════════════════════════════════
// System Settings - global configuration (proxy, API keys, etc.)
// ═══════════════════════════════════════════════════════════════════════

export const systemSettings = mysqlTable("system_settings", {
  workspaceId: int("workspaceId").$defaultFn(currentOpsWorkspaceId),
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

// ============== Module 3: Operations (领星ERP Data) ==============

// Lingxing API config & token cache
export const lingxingConfig = mysqlTable("lingxing_config", {
  workspaceId: int("workspaceId").$defaultFn(currentOpsWorkspaceId),
  id: int("id").autoincrement().primaryKey(),
  configKey: varchar("config_key", { length: 100 }).notNull().unique(),
  configValue: text("config_value"),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

// Lingxing API call logs
export const lingxingApiLogs = mysqlTable("lingxing_api_logs", {
  workspaceId: int("workspaceId").$defaultFn(currentOpsWorkspaceId),
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

// 官方MCP读取先保存为独立草稿批次；人工确认前绝不更新产品、库存或广告业务表。
export const opsExternalSyncBatches = mysqlTable("ops_external_sync_batches", {
  workspaceId: int("workspaceId").$defaultFn(currentOpsWorkspaceId),
  id: int("id").autoincrement().primaryKey(),
  userId: int("user_id").notNull(),
  source: varchar("source", { length: 32 }).notNull(),
  dataDomain: varchar("data_domain", { length: 48 }).notNull(),
  status: varchar("status", { length: 32 }).notNull().default("draft"),
  scope: json("scope").notNull(),
  toolRunId: varchar("tool_run_id", { length: 128 }),
  traceId: varchar("trace_id", { length: 128 }),
  rawResponseHash: varchar("raw_response_hash", { length: 64 }),
  rawSnapshot: json("raw_snapshot"),
  normalizationVersion: varchar("normalization_version", { length: 32 }).notNull().default("v1"),
  summary: json("summary"),
  errorMessage: text("error_message"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  reviewedAt: timestamp("reviewed_at"),
  reviewedBy: int("reviewed_by"),
  appliedAt: timestamp("applied_at"),
  appliedBy: int("applied_by"),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => [
  index("idx_ops_external_sync_batches_workspace_status").on(table.workspaceId, table.status, table.createdAt),
  index("idx_ops_external_sync_batches_domain").on(table.workspaceId, table.dataDomain, table.createdAt),
]);

export const opsExternalSyncRows = mysqlTable("ops_external_sync_rows", {
  workspaceId: int("workspaceId").$defaultFn(currentOpsWorkspaceId),
  id: int("id").autoincrement().primaryKey(),
  batchId: int("batch_id").notNull(),
  entityKey: varchar("entity_key", { length: 512 }).notNull(),
  rowStatus: varchar("row_status", { length: 32 }).notNull().default("needs_review"),
  selected: int("selected").notNull().default(1),
  sourceData: json("source_data").notNull(),
  normalizedData: json("normalized_data").notNull(),
  fieldDiffs: json("field_diffs"),
  matchInfo: json("match_info"),
  targetReference: json("target_reference"),
  validationErrors: json("validation_errors"),
  appliedAt: timestamp("applied_at"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => [
  index("idx_ops_external_sync_rows_batch").on(table.batchId, table.rowStatus),
  index("idx_ops_external_sync_rows_entity").on(table.workspaceId, table.entityKey),
]);

export const opsExternalSyncConfirmations = mysqlTable("ops_external_sync_confirmations", {
  workspaceId: int("workspaceId").$defaultFn(currentOpsWorkspaceId),
  id: int("id").autoincrement().primaryKey(),
  batchId: int("batch_id").notNull(),
  userId: int("user_id").notNull(),
  action: varchar("action", { length: 32 }).notNull(),
  selectedRowIds: json("selected_row_ids"),
  note: text("note"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [index("idx_ops_external_sync_confirmations_batch").on(table.batchId, table.createdAt)]);

// Inventory configuration (per-SKU replenishment params)
export const inventoryConfig = mysqlTable("inventory_config", {
  workspaceId: int("workspaceId").$defaultFn(currentOpsWorkspaceId),
  id: int("id").autoincrement().primaryKey(),
  userId: int("user_id").notNull(),
  sellerSku: varchar("seller_sku", { length: 100 }).notNull(),
  marketplace: varchar("marketplace", { length: 10 }).default("US"),
  // Replenishment params
  leadTimeDays: int("lead_time_days").default(30),
  productionTimeDays: int("production_time_days").default(15),
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
  workspaceId: int("workspaceId").$defaultFn(currentOpsWorkspaceId),
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

// Production config (per parent ASIN production/shipping time settings)
export const productionConfig = mysqlTable("production_config", {
  workspaceId: int("workspaceId").$defaultFn(currentOpsWorkspaceId),
  id: int("id").autoincrement().primaryKey(),
  userId: int("user_id").notNull(),
  parentAsin: varchar("parent_asin", { length: 50 }).notNull(),
  marketplace: varchar("marketplace", { length: 10 }).default("US"),
  productionTimeDays: int("production_time_days").default(15),
  shippingTimeDays: int("shipping_time_days").default(30),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});

// Profit snapshots (daily profit data)
export const profitSnapshots = mysqlTable("profit_snapshots", {
  workspaceId: int("workspaceId").$defaultFn(currentOpsWorkspaceId),
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
  workspaceId: int("workspaceId").$defaultFn(currentOpsWorkspaceId),
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

// ─── Product Operations Overview ───

// Product profiles (parent ASIN level)
export const productProfiles = mysqlTable("product_profiles", {
  workspaceId: int("workspaceId").$defaultFn(currentOpsWorkspaceId),
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
  chineseName: varchar("chinese_name", { length: 500 }),
  operator: varchar("operator", { length: 200 }),
  storeName: varchar("store_name", { length: 255 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type ProductProfile = typeof productProfiles.$inferSelect;

export type InsertProductProfile = typeof productProfiles.$inferInsert;

// Product variants (child ASIN level)
export const productVariants = mysqlTable("product_variants", {
  workspaceId: int("workspaceId").$defaultFn(currentOpsWorkspaceId),
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
  workspaceId: int("workspaceId").$defaultFn(currentOpsWorkspaceId),
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
  workspaceId: int("workspaceId").$defaultFn(currentOpsWorkspaceId),
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
  workspaceId: int("workspaceId").$defaultFn(currentOpsWorkspaceId),
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
  workspaceId: int("workspaceId").$defaultFn(currentOpsWorkspaceId),
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
  workspaceId: int("workspaceId").$defaultFn(currentOpsWorkspaceId),
  id: int("id").autoincrement().primaryKey(),
  userId: int("user_id").notNull(),
  productProfileId: int("product_profile_id").notNull(),
  parentAsin: varchar("parent_asin", { length: 20 }), // 父ASIN，用于import模式下的数据隔离
  planName: varchar("plan_name", { length: 200 }).notNull(),
  planPeriod: varchar("plan_period", { length: 50 }), // e.g. "2026Q1"
  projectManager: varchar("project_manager", { length: 100 }),
  projectMembers: text("project_members"), // JSON array of member names
  gamePlanner: varchar("game_planner", { length: 100 }), // 游戏策划师 (formerly 项目教练)
  // 基期现状数据 (周维度)
  baselineWeekLabel: varchar("baseline_week_label", { length: 50 }), // e.g. "04/06-04/12"
  baselineSales: decimal("baseline_sales", { precision: 12, scale: 2 }), // 销售额
  baselineSubcategoryRank: int("baseline_subcategory_rank"), // 小类排名
  baselineProfitRate: decimal("baseline_profit_rate", { precision: 6, scale: 2 }), // 利润率%
  baselineConvRate: decimal("baseline_conv_rate", { precision: 6, scale: 2 }), // 转化率%
  baselineOrganicOrders: int("baseline_organic_orders"), // 自然单
  baselineAdOrders: int("baseline_ad_orders"), // 广告单
  baselineRatingScore: decimal("baseline_rating_score", { precision: 3, scale: 1 }), // 评分
  baselineRatingCount: int("baseline_rating_count"), // Rating数量
  // 当期现状数据 (周维度)
  currentWeekLabel: varchar("current_week_label", { length: 50 }), // e.g. "04/13-04/19"
  currentSales: decimal("current_sales", { precision: 12, scale: 2 }), // 销售额
  currentSubcategoryRank: int("current_subcategory_rank"), // 小类排名
  currentProfitRate: decimal("current_profit_rate", { precision: 6, scale: 2 }), // 利润率%
  currentConvRate: decimal("current_conv_rate", { precision: 6, scale: 2 }), // 转化率%
  currentOrganicOrders: int("current_organic_orders"), // 自然单
  currentAdOrders: int("current_ad_orders"), // 广告单
  currentRatingScore: decimal("current_rating_score", { precision: 3, scale: 1 }), // 评分
  currentRatingCount: int("current_rating_count"), // Rating数量
  // 目标数据
  targetSales: decimal("target_sales", { precision: 12, scale: 2 }),
  targetSubcategoryRank: int("target_subcategory_rank"),
  targetProfitRate: decimal("target_profit_rate", { precision: 6, scale: 2 }),
  targetConvRate: decimal("target_conv_rate", { precision: 6, scale: 2 }),
  targetOrganicOrders: int("target_organic_orders"),
  targetAdOrders: int("target_ad_orders"),
  targetRatingScore: decimal("target_rating_score", { precision: 3, scale: 1 }),
  targetRatingCount: int("target_rating_count"),
  // 状态
  status: mysqlEnum("plan_status", ["draft", "active", "completed", "archived"]).default("draft").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type OpsPlan = typeof opsPlans.$inferSelect;

export type InsertOpsPlan = typeof opsPlans.$inferInsert;

// Plan improvement actions (each row = one improvement action, linked to todos)
export const opsPlanActions = mysqlTable("ops_plan_actions", {
  workspaceId: int("workspaceId").$defaultFn(currentOpsWorkspaceId),
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
  workspaceId: int("workspaceId").$defaultFn(currentOpsWorkspaceId),
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
  workspaceId: int("workspaceId").$defaultFn(currentOpsWorkspaceId),
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
  workspaceId: int("workspaceId").$defaultFn(currentOpsWorkspaceId),
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
  workspaceId: int("workspaceId").$defaultFn(currentOpsWorkspaceId),
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
  workspaceId: int("workspaceId").$defaultFn(currentOpsWorkspaceId),
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
  workspaceId: int("workspaceId").$defaultFn(currentOpsWorkspaceId),
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
  workspaceId: int("workspaceId").$defaultFn(currentOpsWorkspaceId),
  id: int("id").autoincrement().primaryKey(),
  productProfileId: int("product_profile_id").notNull(),
  userId: int("user_id").notNull(),
  planId: int("plan_id"),
  parentAsin: varchar("parent_asin", { length: 20 }),
  period: varchar("period", { length: 50 }).notNull(),
  periodType: mysqlEnum("period_type", ["weekly", "monthly", "quarterly"]).default("monthly").notNull(),
  // Baseline metrics (基线数据 - 从运营计划基期带入)
  baselineSales: decimal("baseline_sales", { precision: 12, scale: 2 }),
  baselineProfitRate: decimal("baseline_profit_rate", { precision: 5, scale: 2 }),
  baselineSubcategoryRank: int("baseline_subcategory_rank"),
  baselineConvRate: decimal("baseline_conv_rate", { precision: 5, scale: 2 }),
  baselineOrganicOrders: int("baseline_organic_orders"),
  baselineAdOrders: int("baseline_ad_orders"),
  baselineRatingScore: decimal("baseline_rating_score", { precision: 3, scale: 2 }),
  baselineRatingCount: int("baseline_rating_count"),
  baselineWeekLabel: varchar("baseline_week_label", { length: 50 }),
  // Actual metrics (实际数据 - 从导入的周度数据中查询)
  actualSales: decimal("actual_sales", { precision: 12, scale: 2 }),
  actualProfitRate: decimal("actual_profit_rate", { precision: 5, scale: 2 }),
  actualSubcategoryRank: int("actual_subcategory_rank"),
  actualConvRate: decimal("actual_conv_rate", { precision: 5, scale: 2 }),
  actualOrganicOrders: int("actual_organic_orders"),
  actualAdOrders: int("actual_ad_orders"),
  actualRatingScore: decimal("actual_rating_score", { precision: 3, scale: 2 }),
  actualRatingCount: int("actual_rating_count"),
  actualWeekLabel: varchar("actual_week_label", { length: 100 }),
  actualWeekCount: int("actual_week_count").default(1),
  // Target metrics (目标数据 - 从运营计划目标带入)
  targetSales: decimal("target_sales", { precision: 12, scale: 2 }),
  targetSubcategoryRank: int("target_subcategory_rank"),
  targetConvRate: decimal("target_conv_rate", { precision: 5, scale: 2 }),
  targetOrganicOrders: int("target_organic_orders"),
  targetAdOrders: int("target_ad_orders"),
  targetRatingScore: decimal("target_rating_score", { precision: 3, scale: 2 }),
  targetRatingCount: int("target_rating_count"),
  targetWeekLabel: varchar("target_week_label", { length: 50 }),
  // Review content
  achievementSummary: text("achievement_summary"),
  keyActions: text("key_actions"),
  lessonsLearned: text("lessons_learned"),
  nextPeriodPlan: text("next_period_plan"),
  // Game strategist feedback
  strategistFeedback: text("strategist_feedback"),
  strategistRating: mysqlEnum("strategist_rating", ["S", "A", "B", "C", "D"]),
  // AI analysis
  aiAnalysis: text("ai_analysis"),
  aiAnalysisLocked: int("ai_analysis_locked").default(0),
  status: mysqlEnum("review_status", ["draft", "submitted", "reviewed"]).default("draft").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type ExecutionReview = typeof executionReviews.$inferSelect;

export type InsertExecutionReview = typeof executionReviews.$inferInsert;

// ─── Ops Import History (运营数据导入历史) ───
export const opsImportHistory = mysqlTable("ops_import_history", {
  workspaceId: int("workspaceId").$defaultFn(currentOpsWorkspaceId),
  id: int("id").autoincrement().primaryKey(),
  userId: int("user_id").notNull(),
  importType: mysqlEnum("import_type", ["plan", "review"]).notNull(), // 导入类型：计划/复盘
  fileName: varchar("file_name", { length: 255 }).notNull(),
  totalCount: int("total_count").default(0).notNull(), // 总行数
  createdCount: int("created_count").default(0).notNull(), // 新建数
  updatedCount: int("updated_count").default(0).notNull(), // 更新数
  skippedCount: int("skipped_count").default(0).notNull(), // 跳过数
  recordIds: text("record_ids"), // JSON array of created/updated record IDs
  parentAsins: text("parent_asins"), // JSON array of affected parent ASINs
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type OpsImportHistory = typeof opsImportHistory.$inferSelect;

export type InsertOpsImportHistory = typeof opsImportHistory.$inferInsert;

// ─── Team Tasks (团队协作看板) ───
export const teamTasks = mysqlTable("team_tasks", {
  workspaceId: int("workspaceId").$defaultFn(currentOpsWorkspaceId),
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
  meetingRecordId: int("meeting_record_id"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type TeamTask = typeof teamTasks.$inferSelect;

export type InsertTeamTask = typeof teamTasks.$inferInsert;

// ─── Shipping Batches (物流批次管理) ───
export const shippingBatches = mysqlTable("shipping_batches", {
  workspaceId: int("workspaceId").$defaultFn(currentOpsWorkspaceId),
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
  workspaceId: int("workspaceId").$defaultFn(currentOpsWorkspaceId),
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
  workspaceId: int("workspaceId").$defaultFn(currentOpsWorkspaceId),
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
  workspaceId: int("workspaceId").$defaultFn(currentOpsWorkspaceId),
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
  workspaceId: int("workspaceId").$defaultFn(currentOpsWorkspaceId),
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
  workspaceId: int("workspaceId").$defaultFn(currentOpsWorkspaceId),
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
  workspaceId: int("workspaceId").$defaultFn(currentOpsWorkspaceId),
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

// ============== ASIN Permissions ==============
export const asinPermissions = mysqlTable("asin_permissions", {
  workspaceId: int("workspaceId").$defaultFn(currentOpsWorkspaceId),
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
  workspaceId: int("workspaceId").$defaultFn(currentOpsWorkspaceId),
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
  workspaceId: int("workspaceId").$defaultFn(currentOpsWorkspaceId),
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
  workspaceId: int("workspaceId").$defaultFn(currentOpsWorkspaceId),
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
  workspaceId: int("workspaceId").$defaultFn(currentOpsWorkspaceId),
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
  workspaceId: int("workspaceId").$defaultFn(currentOpsWorkspaceId),
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
  workspaceId: int("workspaceId").$defaultFn(currentOpsWorkspaceId),
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
  workspaceId: int("workspaceId").$defaultFn(currentOpsWorkspaceId),
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
  workspaceId: int("workspaceId").$defaultFn(currentOpsWorkspaceId),
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

// Promotion Phase (推广周期管理)
export const promotionPhases = mysqlTable("promotion_phases", {
  workspaceId: int("workspaceId").$defaultFn(currentOpsWorkspaceId),
  id: int("id").autoincrement().primaryKey(),
  planId: int("plan_id").notNull(),
  phaseName: varchar("phase_name", { length: 200 }).notNull(),
  phaseType: mysqlEnum("phase_type", [
    "launch", "growth", "maturity", "optimization", "clearance", "custom"
  ]).default("custom").notNull(),
  bsrRangeStart: int("bsr_range_start"),
  bsrRangeEnd: int("bsr_range_end"),
  durationDays: int("duration_days"),
  startDate: varchar("start_date", { length: 10 }),
  endDate: varchar("end_date", { length: 10 }),
  adBudgetDaily: decimal("ad_budget_daily", { precision: 10, scale: 2 }),
  targetAcos: decimal("target_acos", { precision: 8, scale: 2 }),
  keyStrategy: text("key_strategy"),
  milestones: text("milestones"),
  status: mysqlEnum("status", ["pending", "active", "completed", "skipped"]).default("pending").notNull(),
  progress: int("progress").default(0),
  sortOrder: int("sort_order").default(0),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type PromotionPhase = typeof promotionPhases.$inferSelect;

export type InsertPromotionPhase = typeof promotionPhases.$inferInsert;

// ============================================================
// Module 4: 智能售后管理
// ============================================================

// Review Records (同步的Review记录+AI分析结果)
export const reviewRecords = mysqlTable("review_records", {
  workspaceId: int("workspaceId").$defaultFn(currentOpsWorkspaceId),
  id: int("id").autoincrement().primaryKey(),
  userId: int("user_id").notNull(),
  sid: int("sid"), // 店铺ID
  asin: varchar("asin", { length: 20 }).notNull(),
  reviewId: varchar("review_id", { length: 100 }),
  starRating: int("star_rating").notNull(),
  reviewTitle: text("review_title"),
  reviewContent: text("review_content"),
  reviewerName: varchar("reviewer_name", { length: 200 }),
  isVerifiedPurchase: int("is_verified_purchase").default(0),
  hasImage: int("has_image").default(0),
  hasVideo: int("has_video").default(0),
  reviewDate: varchar("review_date", { length: 20 }),
  // AI analysis fields
  aiProblemCategory: varchar("ai_problem_category", { length: 100 }),
  aiSeverity: mysqlEnum("ai_severity", ["high", "medium", "low"]),
  aiKeyIssues: json("ai_key_issues"), // string[]
  aiSentiment: mysqlEnum("ai_sentiment", ["negative", "neutral", "positive"]),
  aiSuggestedReply: text("ai_suggested_reply"),
  aiInternalAction: text("ai_internal_action"),
  aiFollowUpNeeded: int("ai_follow_up_needed").default(0),
  // Processing status
  processStatus: mysqlEnum("process_status", ["pending", "in_progress", "replied", "ignored"]).default("pending").notNull(),
  processedBy: int("processed_by"),
  processedAt: timestamp("processed_at"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type ReviewRecord = typeof reviewRecords.$inferSelect;

export type InsertReviewRecord = typeof reviewRecords.$inferInsert;

// Review Replies (Review回复记录)
export const reviewReplies = mysqlTable("review_replies", {
  workspaceId: int("workspaceId").$defaultFn(currentOpsWorkspaceId),
  id: int("id").autoincrement().primaryKey(),
  reviewRecordId: int("review_record_id").notNull(),
  userId: int("user_id").notNull(),
  aiDraftReply: text("ai_draft_reply"),
  editedReply: text("edited_reply"),
  finalReply: text("final_reply"),
  replyLanguage: varchar("reply_language", { length: 10 }).default("en"),
  status: mysqlEnum("status", ["draft", "edited", "confirmed", "sent"]).default("draft").notNull(),
  confirmedAt: timestamp("confirmed_at"),
  sentAt: timestamp("sent_at"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type ReviewReply = typeof reviewReplies.$inferSelect;

export type InsertReviewReply = typeof reviewReplies.$inferInsert;

// Email Templates (邮件模板库)
export const emailTemplates = mysqlTable("email_templates", {
  workspaceId: int("workspaceId").$defaultFn(currentOpsWorkspaceId),
  id: int("id").autoincrement().primaryKey(),
  userId: int("user_id").notNull(),
  category: mysqlEnum("category", [
    "return_handling", "product_inquiry", "negative_review_reply",
    "positive_review_thanks", "logistics_inquiry", "after_sales_followup", "other"
  ]).default("other").notNull(),
  templateName: varchar("template_name", { length: 200 }).notNull(),
  subject: varchar("subject", { length: 500 }),
  bodyContent: text("body_content").notNull(),
  language: varchar("language", { length: 10 }).default("en").notNull(),
  variables: json("variables"), // string[] e.g. ["{buyer_name}", "{order_id}", "{product_name}"]
  isAiGenerated: int("is_ai_generated").default(0),
  usageCount: int("usage_count").default(0),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type EmailTemplate = typeof emailTemplates.$inferSelect;

export type InsertEmailTemplate = typeof emailTemplates.$inferInsert;

// Email Replies (邮件回复记录)
export const emailReplies = mysqlTable("email_replies", {
  workspaceId: int("workspaceId").$defaultFn(currentOpsWorkspaceId),
  id: int("id").autoincrement().primaryKey(),
  userId: int("user_id").notNull(),
  sid: int("sid"),
  emailId: varchar("email_id", { length: 100 }),
  buyerEmail: varchar("buyer_email", { length: 320 }),
  orderId: varchar("order_id", { length: 50 }),
  asin: varchar("asin", { length: 20 }),
  emailCategory: mysqlEnum("email_category", [
    "return_request", "product_inquiry", "complaint",
    "positive_feedback", "other"
  ]),
  urgencyLevel: mysqlEnum("urgency_level", ["critical", "high", "medium", "low"]).default("medium"),
  aiClassification: text("ai_classification"),
  aiDraftReply: text("ai_draft_reply"),
  editedReply: text("edited_reply"),
  finalReply: text("final_reply"),
  templateId: int("template_id"),
  status: mysqlEnum("status", ["unread", "read", "draft", "replied", "closed"]).default("unread").notNull(),
  repliedAt: timestamp("replied_at"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type EmailReply = typeof emailReplies.$inferSelect;

export type InsertEmailReply = typeof emailReplies.$inferInsert;

// Return Analysis Cache (退货分析缓存)
export const returnAnalysisCache = mysqlTable("return_analysis_cache", {
  workspaceId: int("workspaceId").$defaultFn(currentOpsWorkspaceId),
  id: int("id").autoincrement().primaryKey(),
  userId: int("user_id").notNull(),
  asin: varchar("asin", { length: 20 }).notNull(),
  sid: int("sid"),
  returnRate: decimal("return_rate", { precision: 8, scale: 2 }),
  totalReturns: int("total_returns"),
  totalOrders: int("total_orders"),
  returnReasons: json("return_reasons"), // {reason: string, count: number, pct: number}[]
  aiRootCauseAnalysis: text("ai_root_cause_analysis"),
  aiPrimaryCauses: json("ai_primary_causes"), // {cause, evidence, impact_pct, fix_difficulty}[]
  aiImprovementPlan: json("ai_improvement_plan"), // {priority, action, responsible, expected_reduction}[]
  aiListingOptimization: text("ai_listing_optimization"),
  analysisDateStart: varchar("analysis_date_start", { length: 10 }),
  analysisDateEnd: varchar("analysis_date_end", { length: 10 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type ReturnAnalysisCache = typeof returnAnalysisCache.$inferSelect;

export type InsertReturnAnalysisCache = typeof returnAnalysisCache.$inferInsert;

// Service Tasks (售后任务队列)
export const serviceTasks = mysqlTable("service_tasks", {
  workspaceId: int("workspaceId").$defaultFn(currentOpsWorkspaceId),
  id: int("id").autoincrement().primaryKey(),
  userId: int("user_id").notNull(),
  taskType: mysqlEnum("task_type", [
    "negative_review", "return_handling", "email_reply",
    "rma_processing", "performance_notice", "feedback_response"
  ]).notNull(),
  relatedId: varchar("related_id", { length: 100 }),
  asin: varchar("asin", { length: 20 }),
  sid: int("sid"),
  title: varchar("title", { length: 500 }).notNull(),
  description: text("description"),
  priority: mysqlEnum("priority", ["critical", "high", "medium", "low"]).default("medium").notNull(),
  status: mysqlEnum("status", ["open", "in_progress", "resolved", "closed"]).default("open").notNull(),
  assignedTo: int("assigned_to"),
  dueDate: varchar("due_date", { length: 10 }),
  resolvedAt: timestamp("resolved_at"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type ServiceTask = typeof serviceTasks.$inferSelect;

export type InsertServiceTask = typeof serviceTasks.$inferInsert;

// ============ Phase 4 Tables ============

// Custom Dashboards (自定义看板)
export const customDashboards = mysqlTable("custom_dashboards", {
  workspaceId: int("workspaceId").$defaultFn(currentOpsWorkspaceId),
  id: int("id").autoincrement().primaryKey(),
  userId: int("user_id").notNull(),
  name: varchar("name", { length: 200 }).notNull(),
  description: varchar("description", { length: 500 }),
  layout: json("layout"), // react-grid-layout JSON config
  isDefault: boolean("is_default").default(false).notNull(),
  template: varchar("template", { length: 50 }), // 'ad_manager' | 'ops_director' | 'inventory_manager' | null
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type CustomDashboard = typeof customDashboards.$inferSelect;

export type InsertCustomDashboard = typeof customDashboards.$inferInsert;

// Dashboard Widgets (看板组件)
export const dashboardWidgets = mysqlTable("dashboard_widgets", {
  workspaceId: int("workspaceId").$defaultFn(currentOpsWorkspaceId),
  id: int("id").autoincrement().primaryKey(),
  dashboardId: int("dashboard_id").notNull(),
  widgetType: mysqlEnum("widget_type", [
    "kpi_card", "line_chart", "bar_chart", "pie_chart",
    "heatmap", "table", "ai_summary", "calendar", "radar_chart"
  ]).notNull(),
  title: varchar("title", { length: 200 }).notNull(),
  dataSource: varchar("data_source", { length: 100 }).notNull(), // e.g. 'sales', 'ads_sp', 'inventory', 'profit', 'reviews'
  config: json("config"), // widget-specific config (filters, date range, metrics, etc.)
  position: json("position"), // { x, y, w, h } for grid layout
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type DashboardWidget = typeof dashboardWidgets.$inferSelect;

export type InsertDashboardWidget = typeof dashboardWidgets.$inferInsert;

// Customer Profiles (客户画像)
export const customerProfiles = mysqlTable("customer_profiles", {
  workspaceId: int("workspaceId").$defaultFn(currentOpsWorkspaceId),
  id: int("id").autoincrement().primaryKey(),
  userId: int("user_id").notNull(),
  customerId: varchar("customer_id", { length: 100 }).notNull(),
  buyerName: varchar("buyer_name", { length: 200 }),
  email: varchar("email", { length: 200 }),
  sid: int("sid"),
  totalOrders: int("total_orders").default(0),
  totalSpent: decimal("total_spent", { precision: 12, scale: 2 }).default("0"),
  firstOrderDate: varchar("first_order_date", { length: 10 }),
  lastOrderDate: varchar("last_order_date", { length: 10 }),
  avgOrderValue: decimal("avg_order_value", { precision: 10, scale: 2 }).default("0"),
  reviewCount: int("review_count").default(0),
  avgRating: decimal("avg_rating", { precision: 3, scale: 1 }),
  returnCount: int("return_count").default(0),
  returnRate: decimal("return_rate", { precision: 5, scale: 2 }).default("0"),
  communicationCount: int("communication_count").default(0),
  aiValueScore: decimal("ai_value_score", { precision: 5, scale: 2 }),
  aiValueTag: mysqlEnum("ai_value_tag", ["high_value", "normal", "risk", "new"]),
  aiAnalysis: json("ai_analysis"), // AI generated analysis JSON
  lastSyncAt: timestamp("last_sync_at"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type CustomerProfile = typeof customerProfiles.$inferSelect;

export type InsertCustomerProfile = typeof customerProfiles.$inferInsert;

// ============================================================
// Module 6: Off-site Marketing (站外营销)
// ============================================================

// 6.1 Influencers
export const offInfluencers = mysqlTable("off_influencers", {
  workspaceId: int("workspaceId").$defaultFn(currentOpsWorkspaceId),
  id: int("id").autoincrement().primaryKey(),
  userId: int("user_id").notNull(),
  platform: varchar("platform", { length: 50 }).notNull(),
  handle: varchar("handle", { length: 200 }).notNull(),
  displayName: varchar("display_name", { length: 200 }),
  profileUrl: varchar("profile_url", { length: 500 }),
  avatarUrl: varchar("avatar_url", { length: 500 }),
  email: varchar("email", { length: 320 }),
  phone: varchar("phone", { length: 50 }),
  country: varchar("country", { length: 50 }),
  language: varchar("language", { length: 50 }),
  category: varchar("category", { length: 100 }),
  tags: text("tags"),
  followerCount: int("follower_count").default(0),
  avgViews: int("avg_views").default(0),
  avgLikes: int("avg_likes").default(0),
  engagementRate: decimal("engagement_rate", { precision: 5, scale: 2 }),
  estimatedCpm: decimal("estimated_cpm", { precision: 10, scale: 2 }),
  priceRange: varchar("price_range", { length: 100 }),
  notes: text("notes"),
  status: varchar("status", { length: 30 }).default("active"),
  source: varchar("source", { length: 50 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type OffInfluencer = typeof offInfluencers.$inferSelect;

export type InsertOffInfluencer = typeof offInfluencers.$inferInsert;

// 6.2 Influencer AI Scores
export const offInfluencerScores = mysqlTable("off_influencer_scores", {
  workspaceId: int("workspaceId").$defaultFn(currentOpsWorkspaceId),
  id: int("id").autoincrement().primaryKey(),
  influencerId: int("influencer_id").notNull(),
  overallScore: decimal("overall_score", { precision: 5, scale: 2 }).default("0"),
  relevanceScore: decimal("relevance_score", { precision: 5, scale: 2 }).default("0"),
  engagementScore: decimal("engagement_score", { precision: 5, scale: 2 }).default("0"),
  authenticityScore: decimal("authenticity_score", { precision: 5, scale: 2 }).default("0"),
  costEfficiencyScore: decimal("cost_efficiency_score", { precision: 5, scale: 2 }).default("0"),
  audienceMatchScore: decimal("audience_match_score", { precision: 5, scale: 2 }).default("0"),
  aiAnalysis: text("ai_analysis"),
  scoredForProduct: varchar("scored_for_product", { length: 200 }),
  scoredAt: timestamp("scored_at").defaultNow().notNull(),
});

export type OffInfluencerScore = typeof offInfluencerScores.$inferSelect;

// 6.3 Campaigns
export const offCampaigns = mysqlTable("off_campaigns", {
  workspaceId: int("workspaceId").$defaultFn(currentOpsWorkspaceId),
  id: int("id").autoincrement().primaryKey(),
  userId: int("user_id").notNull(),
  name: varchar("name", { length: 300 }).notNull(),
  description: text("description"),
  type: varchar("type", { length: 50 }).default("influencer"),
  status: varchar("status", { length: 30 }).default("draft"),
  targetMarketplace: varchar("target_marketplace", { length: 10 }),
  targetAsin: varchar("target_asin", { length: 50 }),
  targetProductName: varchar("target_product_name", { length: 300 }),
  budget: decimal("budget", { precision: 12, scale: 2 }).default("0"),
  spentAmount: decimal("spent_amount", { precision: 12, scale: 2 }).default("0"),
  startDate: varchar("start_date", { length: 20 }),
  endDate: varchar("end_date", { length: 20 }),
  goals: text("goals"),
  kpiTargets: text("kpi_targets"),
  tags: text("tags"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type OffCampaign = typeof offCampaigns.$inferSelect;

export type InsertOffCampaign = typeof offCampaigns.$inferInsert;

// 6.4 Collaborations (Kanban board items)
export const offCollaborations = mysqlTable("off_collaborations", {
  workspaceId: int("workspaceId").$defaultFn(currentOpsWorkspaceId),
  id: int("id").autoincrement().primaryKey(),
  campaignId: int("campaign_id").notNull(),
  influencerId: int("influencer_id").notNull(),
  userId: int("user_id").notNull(),
  stage: varchar("stage", { length: 30 }).default("contacted"),
  agreedPrice: decimal("agreed_price", { precision: 10, scale: 2 }).default("0"),
  paymentStatus: varchar("payment_status", { length: 30 }).default("pending"),
  deliverables: text("deliverables"),
  deadline: varchar("deadline", { length: 20 }),
  contentUrl: text("content_url"),
  trackingLink: text("tracking_link"),
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type OffCollaboration = typeof offCollaborations.$inferSelect;

export type InsertOffCollaboration = typeof offCollaborations.$inferInsert;

// 6.5 Outreach Messages
export const offOutreachMessages = mysqlTable("off_outreach_messages", {
  workspaceId: int("workspaceId").$defaultFn(currentOpsWorkspaceId),
  id: int("id").autoincrement().primaryKey(),
  userId: int("user_id").notNull(),
  influencerId: int("influencer_id").notNull(),
  campaignId: int("campaign_id"),
  collaborationId: int("collaboration_id"),
  channel: varchar("channel", { length: 30 }).default("email"),
  direction: varchar("direction", { length: 10 }).default("outbound"),
  subject: varchar("subject", { length: 500 }),
  body: text("body"),
  aiGenerated: boolean("ai_generated").default(false),
  status: varchar("status", { length: 30 }).default("draft"),
  scheduledAt: timestamp("scheduled_at"),
  sentAt: timestamp("sent_at"),
  sequenceStep: int("sequence_step"),
  templateId: varchar("template_id", { length: 100 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type OffOutreachMessage = typeof offOutreachMessages.$inferSelect;

export type InsertOffOutreachMessage = typeof offOutreachMessages.$inferInsert;

// 6.6 Content Submissions (for review)
export const offContentSubmissions = mysqlTable("off_content_submissions", {
  workspaceId: int("workspaceId").$defaultFn(currentOpsWorkspaceId),
  id: int("id").autoincrement().primaryKey(),
  collaborationId: int("collaboration_id"),
  influencerId: int("influencer_id"),
  userId: int("user_id").notNull(),
  contentType: varchar("content_type", { length: 30 }).default("post"),
  contentUrl: text("content_url"),
  thumbnailUrl: text("thumbnail_url"),
  caption: text("caption"),
  status: varchar("status", { length: 30 }).default("pending"),
  aiReviewResult: text("ai_review_result"),
  humanReviewNotes: text("human_review_notes"),
  revisionCount: int("revision_count").default(0),
  publishedAt: timestamp("published_at"),
  metrics: text("metrics"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type OffContentSubmission = typeof offContentSubmissions.$inferSelect;

export type InsertOffContentSubmission = typeof offContentSubmissions.$inferInsert;

// 6.7 Social Accounts
export const offSocialAccounts = mysqlTable("off_social_accounts", {
  workspaceId: int("workspaceId").$defaultFn(currentOpsWorkspaceId),
  id: int("id").autoincrement().primaryKey(),
  userId: int("user_id").notNull(),
  platform: varchar("platform", { length: 50 }).notNull(),
  accountName: varchar("account_name", { length: 200 }).notNull(),
  accountId: varchar("account_id", { length: 200 }),
  profileUrl: varchar("profile_url", { length: 500 }),
  avatarUrl: varchar("avatar_url", { length: 500 }),
  followerCount: int("follower_count").default(0),
  followingCount: int("following_count").default(0),
  postCount: int("post_count").default(0),
  matrixGroupId: int("matrix_group_id"),
  status: varchar("status", { length: 30 }).default("active"),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  tokenExpiresAt: timestamp("token_expires_at"),
  lastSyncAt: timestamp("last_sync_at"),
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type OffSocialAccount = typeof offSocialAccounts.$inferSelect;

export type InsertOffSocialAccount = typeof offSocialAccounts.$inferInsert;

// 6.8 Content Calendar
export const offContentCalendar = mysqlTable("off_content_calendar", {
  workspaceId: int("workspaceId").$defaultFn(currentOpsWorkspaceId),
  id: int("id").autoincrement().primaryKey(),
  userId: int("user_id").notNull(),
  socialAccountId: int("social_account_id"),
  campaignId: int("campaign_id"),
  title: varchar("title", { length: 300 }).notNull(),
  contentType: varchar("content_type", { length: 50 }),
  platform: varchar("platform", { length: 50 }).notNull(),
  status: varchar("status", { length: 30 }).default("draft"),
  scheduledDate: varchar("scheduled_date", { length: 20 }).notNull(),
  scheduledTime: varchar("scheduled_time", { length: 10 }),
  publishedAt: timestamp("published_at"),
  content: text("content"),
  mediaUrls: text("media_urls"),
  hashtags: text("hashtags"),
  aiGeneratedContent: text("ai_generated_content"),
  metrics: text("metrics"),
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type OffContentCalendarItem = typeof offContentCalendar.$inferSelect;

export type InsertOffContentCalendarItem = typeof offContentCalendar.$inferInsert;

// 6.9 Attribution Links
export const offAttributionLinks = mysqlTable("off_attribution_links", {
  workspaceId: int("workspaceId").$defaultFn(currentOpsWorkspaceId),
  id: int("id").autoincrement().primaryKey(),
  userId: int("user_id").notNull(),
  campaignId: int("campaign_id"),
  collaborationId: int("collaboration_id"),
  influencerId: int("influencer_id"),
  originalUrl: text("original_url").notNull(),
  shortUrl: varchar("short_url", { length: 500 }),
  amazonTag: varchar("amazon_tag", { length: 100 }),
  utmSource: varchar("utm_source", { length: 100 }),
  utmMedium: varchar("utm_medium", { length: 100 }),
  utmCampaign: varchar("utm_campaign", { length: 200 }),
  utmContent: varchar("utm_content", { length: 200 }),
  clickCount: int("click_count").default(0),
  conversionCount: int("conversion_count").default(0),
  revenue: decimal("revenue", { precision: 12, scale: 2 }).default("0"),
  brbAmount: decimal("brb_amount", { precision: 12, scale: 2 }).default("0"),
  lastClickAt: timestamp("last_click_at"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type OffAttributionLink = typeof offAttributionLinks.$inferSelect;

export type InsertOffAttributionLink = typeof offAttributionLinks.$inferInsert;

// 6.10 Campaign Analytics
export const offCampaignAnalytics = mysqlTable("off_campaign_analytics", {
  workspaceId: int("workspaceId").$defaultFn(currentOpsWorkspaceId),
  id: int("id").autoincrement().primaryKey(),
  campaignId: int("campaign_id").notNull(),
  date: varchar("date", { length: 20 }).notNull(),
  impressions: int("impressions").default(0),
  reach: int("reach").default(0),
  clicks: int("clicks").default(0),
  conversions: int("conversions").default(0),
  revenue: decimal("revenue", { precision: 12, scale: 2 }).default("0"),
  spend: decimal("spend", { precision: 12, scale: 2 }).default("0"),
  engagements: int("engagements").default(0),
  videoViews: int("video_views").default(0),
  shares: int("shares").default(0),
  comments: int("comments").default(0),
  saves: int("saves").default(0),
  brbRevenue: decimal("brb_revenue", { precision: 12, scale: 2 }).default("0"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type OffCampaignAnalytic = typeof offCampaignAnalytics.$inferSelect;

// 6.11 Matrix Groups (TikTok account groups)
export const offMatrixGroups = mysqlTable("off_matrix_groups", {
  workspaceId: int("workspaceId").$defaultFn(currentOpsWorkspaceId),
  id: int("id").autoincrement().primaryKey(),
  userId: int("user_id").notNull(),
  name: varchar("name", { length: 200 }).notNull(),
  description: text("description"),
  platform: varchar("platform", { length: 50 }).default("tiktok"),
  strategy: text("strategy"),
  accountCount: int("account_count").default(0),
  totalFollowers: int("total_followers").default(0),
  totalViews: int("total_views").default(0),
  status: varchar("status", { length: 30 }).default("active"),
  aiContentStrategy: text("ai_content_strategy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type OffMatrixGroup = typeof offMatrixGroups.$inferSelect;

export type InsertOffMatrixGroup = typeof offMatrixGroups.$inferInsert;

// 6.12 AI Analysis Logs (off-site)
export const offAiAnalysisLogs = mysqlTable("off_ai_analysis_logs", {
  workspaceId: int("workspaceId").$defaultFn(currentOpsWorkspaceId),
  id: int("id").autoincrement().primaryKey(),
  userId: int("user_id").notNull(),
  analysisType: varchar("analysis_type", { length: 50 }).notNull(),
  entityType: varchar("entity_type", { length: 50 }),
  entityId: int("entity_id"),
  inputData: text("input_data"),
  outputData: text("output_data"),
  promptUsed: text("prompt_used"),
  tokensUsed: int("tokens_used").default(0),
  durationMs: int("duration_ms").default(0),
  status: varchar("status", { length: 30 }).default("completed"),
  errorMessage: text("error_message"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type OffAiAnalysisLog = typeof offAiAnalysisLogs.$inferSelect;

export type InsertOffAiAnalysisLog = typeof offAiAnalysisLogs.$inferInsert;

// ═══════════════════════════════════════════════════════
// Product Weekly Operations Data (产品周度运营数据)
// ═══════════════════════════════════════════════════════
export const productWeeklyOps = mysqlTable("product_weekly_ops", {
  workspaceId: int("workspaceId").$defaultFn(currentOpsWorkspaceId),
  id: int("id").autoincrement().primaryKey(),
  productId: int("product_id").notNull(),
  userId: int("user_id").notNull(),
  weekStartDate: varchar("week_start_date", { length: 10 }).notNull(),
  weekEndDate: varchar("week_end_date", { length: 10 }).notNull(),
  salesTrend: mysqlEnum("sales_trend", ["up", "down", "stable"]).default("stable"),
  salesQty: int("sales_qty").default(0),
  orderQty: int("order_qty").default(0),
  salesAmount: decimal("sales_amount", { precision: 12, scale: 2 }).default("0"),
  orderProfit: decimal("order_profit", { precision: 12, scale: 2 }).default("0"),
  orderProfitMargin: decimal("order_profit_margin", { precision: 6, scale: 2 }).default("0"),
  sessionTotal: int("session_total").default(0),
  totalCvr: decimal("total_cvr", { precision: 6, scale: 2 }).default("0"),
  adCvr: decimal("ad_cvr", { precision: 6, scale: 2 }).default("0"),
  organicCvr: decimal("organic_cvr", { precision: 6, scale: 2 }).default("0"),
  adOrders: int("ad_orders").default(0),
  organicOrders: int("organic_orders").default(0),
  adClicks: int("ad_clicks").default(0),
  organicClicks: int("organic_clicks").default(0),
  ctr: decimal("ctr", { precision: 6, scale: 4 }).default("0"),
  adImpressions: int("ad_impressions").default(0),
  cpc: decimal("cpc", { precision: 8, scale: 2 }).default("0"),
  adSpend: decimal("ad_spend", { precision: 12, scale: 2 }).default("0"),
  adSales: decimal("ad_sales", { precision: 12, scale: 2 }).default("0"),
  acos: decimal("acos", { precision: 6, scale: 2 }).default("0"),
  rating: decimal("rating", { precision: 3, scale: 1 }).default("0"),
  reviewCount: int("review_count").default(0),
  returnRate: decimal("return_rate", { precision: 6, scale: 2 }).default("0"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type ProductWeeklyOps = typeof productWeeklyOps.$inferSelect;

export type InsertProductWeeklyOps = typeof productWeeklyOps.$inferInsert;

// Product Monthly Summary (产品月度汇总)
export const productMonthlySummary = mysqlTable("product_monthly_summary", {
  workspaceId: int("workspaceId").$defaultFn(currentOpsWorkspaceId),
  id: int("id").autoincrement().primaryKey(),
  productId: int("product_id").notNull(),
  userId: int("user_id").notNull(),
  yearMonth: varchar("year_month", { length: 7 }).notNull(),
  financialProfit: decimal("financial_profit", { precision: 12, scale: 2 }).default("0"),
  orderProfitTotal: decimal("order_profit_total", { precision: 12, scale: 2 }).default("0"),
  totalSalesQty: int("total_sales_qty").default(0),
  totalOrderQty: int("total_order_qty").default(0),
  totalSalesAmount: decimal("total_sales_amount", { precision: 12, scale: 2 }).default("0"),
  totalAdSpend: decimal("total_ad_spend", { precision: 12, scale: 2 }).default("0"),
  avgAcos: decimal("avg_acos", { precision: 6, scale: 2 }).default("0"),
  avgRating: decimal("avg_rating", { precision: 3, scale: 1 }).default("0"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type ProductMonthlySummary = typeof productMonthlySummary.$inferSelect;

export type InsertProductMonthlySummary = typeof productMonthlySummary.$inferInsert;

// Product Basic Info (产品基础信息 - 售价/平手价/毛利润等)
export const productBasicInfo = mysqlTable("product_basic_info", {
  workspaceId: int("workspaceId").$defaultFn(currentOpsWorkspaceId),
  id: int("id").autoincrement().primaryKey(),
  productId: int("product_id").notNull(),
  userId: int("user_id").notNull(),
  sellingPrice: decimal("selling_price", { precision: 10, scale: 2 }),
  breakEvenPrice: decimal("break_even_price", { precision: 10, scale: 2 }),
  grossProfit: decimal("gross_profit", { precision: 10, scale: 2 }),
  grossMargin: decimal("gross_margin", { precision: 6, scale: 2 }),
  returnRate: decimal("return_rate", { precision: 6, scale: 2 }).default("0"),
  rating: decimal("rating", { precision: 3, scale: 1 }),
  reviewCount: int("review_count").default(0),
  productCost: decimal("product_cost", { precision: 10, scale: 2 }),
  shippingCost: decimal("shipping_cost", { precision: 10, scale: 2 }),
  fbaFee: decimal("fba_fee", { precision: 10, scale: 2 }),
  referralFee: decimal("referral_fee", { precision: 10, scale: 2 }),
  currentStock: int("current_stock").default(0),
  inTransitStock: int("in_transit_stock").default(0),
  packingQty: int("packing_qty"),
  weightKg: decimal("weight_kg", { precision: 8, scale: 2 }),
  shippingUnitPrice: decimal("shipping_unit_price", { precision: 8, scale: 2 }),
  lastMonthProfit: decimal("last_month_profit", { precision: 12, scale: 2 }),
  trackingSheetUrl: text("tracking_sheet_url"),
  listingDate: varchar("listing_date", { length: 10 }),
  asin: varchar("asin", { length: 20 }),
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type ProductBasicInfo = typeof productBasicInfo.$inferSelect;

export type InsertProductBasicInfo = typeof productBasicInfo.$inferInsert;

// ─── Meeting Records (会议录音记录) ───
export const meetingRecords = mysqlTable("meeting_records", {
  workspaceId: int("workspaceId").$defaultFn(currentOpsWorkspaceId),
  id: int("id").autoincrement().primaryKey(),
  userId: int("user_id").notNull(),
  title: varchar("title", { length: 300 }),
  audioUrl: text("audio_url"), // S3 URL of the uploaded audio
  transcript: text("transcript"), // Full transcription text
  extractedTasks: text("extracted_tasks"), // JSON array of extracted tasks
  status: mysqlEnum("meeting_status", ["uploading", "transcribing", "extracting", "done", "error"]).default("uploading").notNull(),
  errorMessage: text("error_message"),
  duration: int("duration"), // audio duration in seconds
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type MeetingRecord = typeof meetingRecords.$inferSelect;

export type InsertMeetingRecord = typeof meetingRecords.$inferInsert;

// ─── Budget Tracking (预算执行效果追踪) ───
export const budgetTracking = mysqlTable("budget_tracking", {
  workspaceId: int("workspaceId").$defaultFn(currentOpsWorkspaceId),
  id: int("id").autoincrement().primaryKey(),
  userId: int("user_id").notNull(),
  marketplace: varchar("marketplace", { length: 20 }).default("US").notNull(),
  // Snapshot of the AI suggestion batch
  batchId: varchar("batch_id", { length: 64 }).notNull(), // unique ID per AI suggestion run
  totalBudgetBefore: decimal("total_budget_before", { precision: 12, scale: 2 }),
  totalBudgetAfter: decimal("total_budget_after", { precision: 12, scale: 2 }),
  campaignCount: int("campaign_count").default(0),
  // Metrics at the time of suggestion (baseline)
  baselineSpend: decimal("baseline_spend", { precision: 12, scale: 2 }),
  baselineSales: decimal("baseline_sales", { precision: 12, scale: 2 }),
  baselineAcos: decimal("baseline_acos", { precision: 8, scale: 4 }),
  baselineRoas: decimal("baseline_roas", { precision: 8, scale: 4 }),
  baselineOrders: int("baseline_orders").default(0),
  // User decision
  userDecision: mysqlEnum("budget_user_decision", ["accepted", "modified", "rejected", "partial"]).default("accepted").notNull(),
  userNotes: text("user_notes"),
  // Detailed campaign-level decisions (JSON array)
  campaignDecisions: text("campaign_decisions"), // JSON: [{ campaignId, campaignName, action, currentBudget, suggestedBudget, confirmedBudget, reason, priority }]
  // Follow-up metrics (filled later when evaluating effect)
  followupSpend: decimal("followup_spend", { precision: 12, scale: 2 }),
  followupSales: decimal("followup_sales", { precision: 12, scale: 2 }),
  followupAcos: decimal("followup_acos", { precision: 8, scale: 4 }),
  followupRoas: decimal("followup_roas", { precision: 8, scale: 4 }),
  followupOrders: int("followup_orders"),
  followupEvaluatedAt: timestamp("followup_evaluated_at"),
  // AI summary of the effect
  effectSummary: text("effect_summary"), // AI-generated summary of the effect
  effectScore: int("effect_score"), // 1-100 score of how well the suggestion performed
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type BudgetTracking = typeof budgetTracking.$inferSelect;

export type InsertBudgetTracking = typeof budgetTracking.$inferInsert;

// ─── Data Import Center (数据导入中心) ───

// Import records table - tracks each file upload
export const dataImports = mysqlTable("data_imports", {
  workspaceId: int("workspaceId").$defaultFn(currentOpsWorkspaceId),
  id: int("id").autoincrement().primaryKey(),
  userId: int("user_id").notNull(),
  sourceType: mysqlEnum("source_type", ["lingxing", "saihu"]).notNull(),
  fileName: varchar("file_name", { length: 500 }).notNull(),
  fileUrl: text("file_url"), // S3 URL
  weekStartDate: varchar("week_start_date", { length: 10 }).notNull(), // YYYY-MM-DD
  weekEndDate: varchar("week_end_date", { length: 10 }).notNull(),   // YYYY-MM-DD
  dataGranularity: mysqlEnum("data_granularity", ["weekly", "daily"]).default("weekly").notNull(),
  replacesImportId: int("replaces_import_id"),
  supersededAt: timestamp("superseded_at"),
  totalRows: int("total_rows").default(0),
  importedRows: int("imported_rows").default(0),
  skippedRows: int("skipped_rows").default(0),
  status: mysqlEnum("import_status", ["pending", "parsing", "previewing", "importing", "completed", "failed"]).default("pending").notNull(),
  errorMessage: text("error_message"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type DataImport = typeof dataImports.$inferSelect;

export type InsertDataImport = typeof dataImports.$inferInsert;

// ASIN daily snapshots are the source of truth for newly imported product-performance files.
// Weekly views and inventory plans are derived from these immutable source snapshots.
export const opsAsinDailySnapshots = mysqlTable("ops_asin_daily_snapshots", {
  workspaceId: int("workspaceId").$defaultFn(currentOpsWorkspaceId),
  id: int("id").autoincrement().primaryKey(),
  importId: int("import_id").notNull(),
  userId: int("user_id").notNull(),
  sourceType: varchar("source_type", { length: 20 }).default("lingxing").notNull(),
  sourceStoreId: varchar("source_store_id", { length: 64 }),
  sourceBatchHash: varchar("source_batch_hash", { length: 64 }),
  reportDate: varchar("report_date", { length: 10 }).notNull(),
  asin: varchar("asin", { length: 20 }).notNull(),
  parentAsin: varchar("parent_asin", { length: 20 }).notNull(),
  storeName: varchar("store_name", { length: 200 }).notNull(),
  country: varchar("country", { length: 50 }).notNull(),
  msku: varchar("msku", { length: 200 }),
  sku: varchar("sku", { length: 200 }),
  title: varchar("title", { length: 1000 }),
  productName: varchar("product_name", { length: 500 }),
  brand: varchar("brand", { length: 200 }),
  category1: varchar("category1", { length: 200 }),
  category2: varchar("category2", { length: 200 }),
  category3: varchar("category3", { length: 200 }),
  operator: varchar("operator", { length: 200 }),
  createdTime: varchar("created_time", { length: 50 }),
  salesQty: int("sales_qty").default(0).notNull(),
  orderQty: int("order_qty").default(0).notNull(),
  salesAmount: decimal("sales_amount", { precision: 14, scale: 2 }).default("0").notNull(),
  netSalesAmount: decimal("net_sales_amount", { precision: 14, scale: 2 }).default("0").notNull(),
  orderProfit: decimal("order_profit", { precision: 14, scale: 2 }).default("0").notNull(),
  adSpend: decimal("ad_spend", { precision: 14, scale: 2 }).default("0").notNull(),
  adSales: decimal("ad_sales", { precision: 14, scale: 2 }).default("0").notNull(),
  adOrders: int("ad_orders").default(0).notNull(),
  organicOrders: int("organic_orders").default(0).notNull(),
  sessionsTotal: int("sessions_total").default(0).notNull(),
  adClicks: int("ad_clicks").default(0).notNull(),
  adImpressions: int("ad_impressions").default(0).notNull(),
  returnQty: int("return_qty").default(0).notNull(),
  fbaAvailable: int("fba_available").default(0).notNull(),
  fbaInTransit: int("fba_in_transit").default(0).notNull(),
  fbaPlanInbound: int("fba_plan_inbound").default(0).notNull(),
  fbaTotal: int("fba_total").default(0).notNull(),
  availableStock: int("available_stock").default(0).notNull(),
  fbmAvailable: int("fbm_available").default(0).notNull(),
  awdAvailable: int("awd_available").default(0).notNull(),
  awdInTransit: int("awd_in_transit").default(0).notNull(),
  overseasAvailable: int("overseas_available").default(0).notNull(),
  sourceLocalAvailable: int("source_local_available").default(0).notNull(),
  sourceRowHash: varchar("source_row_hash", { length: 64 }).notNull(),
  isValid: int("is_valid").default(1).notNull(),
  validationReason: text("validation_reason"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
}, (table) => [
  index("ops_asin_daily_source_identity_idx").on(table.workspaceId, table.sourceStoreId, table.country, table.asin, table.reportDate),
  index("ops_asin_daily_batch_hash_idx").on(table.workspaceId, table.sourceBatchHash),
]);

export type OpsAsinDailySnapshot = typeof opsAsinDailySnapshots.$inferSelect;
export type InsertOpsAsinDailySnapshot = typeof opsAsinDailySnapshots.$inferInsert;

// Child-ASIN lifecycle status, derived from imported operational evidence and reversible by a human.
export const opsAsinLifecycleStatuses = mysqlTable("ops_asin_lifecycle_statuses", {
  workspaceId: int("workspaceId").$defaultFn(currentOpsWorkspaceId),
  id: int("id").autoincrement().primaryKey(),
  userId: int("user_id").notNull(),
  asin: varchar("asin", { length: 20 }).notNull(),
  parentAsin: varchar("parent_asin", { length: 20 }),
  storeName: varchar("store_name", { length: 200 }).notNull(),
  country: varchar("country", { length: 50 }).notNull(),
  status: mysqlEnum("status", ["active", "discontinued"]).default("active").notNull(),
  reason: varchar("reason", { length: 80 }),
  evidenceStartDate: varchar("evidence_start_date", { length: 10 }),
  evidenceEndDate: varchar("evidence_end_date", { length: 10 }),
  evidenceDays: int("evidence_days").default(0).notNull(),
  evidenceSalesQty: int("evidence_sales_qty").default(0).notNull(),
  evidenceProfit: decimal("evidence_profit", { precision: 14, scale: 2 }).default("0").notNull(),
  evidenceMaxInventory: int("evidence_max_inventory").default(0).notNull(),
  changedBy: int("changed_by"),
  changedAt: timestamp("changed_at").defaultNow().notNull(),
  restoredAt: timestamp("restored_at"),
  restoreReason: varchar("restore_reason", { length: 500 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  asinStoreCountryIdx: index("ops_asin_lifecycle_asin_store_country_idx").on(table.workspaceId, table.asin, table.storeName, table.country),
  statusIdx: index("ops_asin_lifecycle_status_idx").on(table.workspaceId, table.status),
}));

export type OpsAsinLifecycleStatus = typeof opsAsinLifecycleStatuses.$inferSelect;

// User-entered local inventory is versioned and never overwrites an imported source snapshot.
export const opsLocalInventoryAdjustments = mysqlTable("ops_local_inventory_adjustments", {
  workspaceId: int("workspaceId").$defaultFn(currentOpsWorkspaceId),
  id: int("id").autoincrement().primaryKey(),
  userId: int("user_id").notNull(),
  asin: varchar("asin", { length: 20 }).notNull(),
  storeName: varchar("store_name", { length: 200 }).notNull(),
  country: varchar("country", { length: 50 }).notNull(),
  effectiveDate: varchar("effective_date", { length: 10 }).notNull(),
  localQty: int("local_qty").notNull(),
  reason: varchar("reason", { length: 500 }),
  status: mysqlEnum("status", ["draft", "confirmed", "superseded"]).default("draft").notNull(),
  confirmedBy: int("confirmed_by"),
  confirmedAt: timestamp("confirmed_at"),
  supersededById: int("superseded_by_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});

export type OpsLocalInventoryAdjustment = typeof opsLocalInventoryAdjustments.$inferSelect;
export type InsertOpsLocalInventoryAdjustment = typeof opsLocalInventoryAdjustments.$inferInsert;

// Parameters are resolved in priority order: ASIN > parent ASIN > store-country > workspace default.
export const opsInventoryPlanningParameters = mysqlTable("ops_inventory_planning_parameters", {
  workspaceId: int("workspaceId").$defaultFn(currentOpsWorkspaceId),
  id: int("id").autoincrement().primaryKey(),
  userId: int("user_id").notNull(),
  scopeType: mysqlEnum("scope_type", ["workspace", "store_country", "parent_asin", "asin"]).default("workspace").notNull(),
  asin: varchar("asin", { length: 20 }),
  parentAsin: varchar("parent_asin", { length: 20 }),
  storeName: varchar("store_name", { length: 200 }),
  country: varchar("country", { length: 50 }),
  productionDays: int("production_days").default(30).notNull(),
  shippingDays: int("shipping_days").default(30).notNull(),
  bufferDays: int("buffer_days").default(10).notNull(),
  targetCoverDays: int("target_cover_days").default(30).notNull(),
  moq: int("moq").default(0).notNull(),
  packSize: int("pack_size").default(1).notNull(),
  productCost: decimal("product_cost", { precision: 10, scale: 2 }),
  estimatedFirstLegCost: decimal("estimated_first_leg_cost", { precision: 10, scale: 2 }),
  actualFirstLegCost: decimal("actual_first_leg_cost", { precision: 10, scale: 2 }),
  estimatedFbaFee: decimal("estimated_fba_fee", { precision: 10, scale: 2 }),
  actualFbaFee: decimal("actual_fba_fee", { precision: 10, scale: 2 }),
  sellingPrice: decimal("selling_price", { precision: 10, scale: 2 }),
  estimatedDimensions: varchar("estimated_dimensions", { length: 120 }),
  actualDimensions: varchar("actual_dimensions", { length: 120 }),
  estimatedWeight: decimal("estimated_weight", { precision: 10, scale: 3 }),
  actualWeight: decimal("actual_weight", { precision: 10, scale: 3 }),
  dimensionUnit: varchar("dimension_unit", { length: 12 }).default("in").notNull(),
  weightUnit: varchar("weight_unit", { length: 12 }).default("lb").notNull(),
  currency: varchar("currency", { length: 8 }).default("USD").notNull(),
  isActive: int("is_active").default(1).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});

export type OpsInventoryPlanningParameter = typeof opsInventoryPlanningParameters.$inferSelect;
export type InsertOpsInventoryPlanningParameter = typeof opsInventoryPlanningParameters.$inferInsert;

export const opsMonthlyFinancialProfits = mysqlTable("ops_monthly_financial_profits", {
  workspaceId: int("workspaceId").$defaultFn(currentOpsWorkspaceId),
  id: int("id").autoincrement().primaryKey(),
  userId: int("user_id").notNull(),
  parentAsin: varchar("parent_asin", { length: 20 }).notNull(),
  yearMonth: varchar("year_month", { length: 7 }).notNull(),
  financialProfit: decimal("financial_profit", { precision: 14, scale: 2 }).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
}, (table) => [
  uniqueIndex("ops_monthly_financial_profit_unique").on(table.workspaceId, table.userId, table.parentAsin, table.yearMonth),
]);

// Confirmed future supply can be incorporated into the planning timeline only after its availability date is known.
export const opsReplenishmentPlans = mysqlTable("ops_replenishment_plans", {
  workspaceId: int("workspaceId").$defaultFn(currentOpsWorkspaceId),
  id: int("id").autoincrement().primaryKey(),
  userId: int("user_id").notNull(),
  asin: varchar("asin", { length: 20 }).notNull(),
  storeName: varchar("store_name", { length: 200 }).notNull(),
  country: varchar("country", { length: 50 }).notNull(),
  plannedQty: int("planned_qty").notNull(),
  estimatedAvailableDate: varchar("estimated_available_date", { length: 10 }).notNull(),
  notes: text("notes"),
  status: mysqlEnum("replenishment_plan_status", ["draft", "confirmed", "cancelled", "completed"]).default("draft").notNull(),
  confirmedBy: int("confirmed_by"),
  confirmedAt: timestamp("confirmed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});

export type OpsReplenishmentPlan = typeof opsReplenishmentPlans.$inferSelect;
export type InsertOpsReplenishmentPlan = typeof opsReplenishmentPlans.$inferInsert;

// A confirmed planning version freezes source date, parameters, local inventory and calculation outputs together.
export const opsInventoryPlanningVersions = mysqlTable("ops_inventory_planning_versions", {
  workspaceId: int("workspaceId").$defaultFn(currentOpsWorkspaceId),
  id: int("id").autoincrement().primaryKey(),
  userId: int("user_id").notNull(),
  version: int("version").notNull(),
  sourceAsOfDate: varchar("source_as_of_date", { length: 10 }).notNull(),
  status: mysqlEnum("inventory_planning_version_status", ["draft", "confirmed", "superseded"]).default("draft").notNull(),
  inputSnapshot: json("input_snapshot").notNull(),
  resultSnapshot: json("result_snapshot").notNull(),
  confirmedBy: int("confirmed_by"),
  confirmedAt: timestamp("confirmed_at"),
  supersededAt: timestamp("superseded_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});

export type OpsInventoryPlanningVersion = typeof opsInventoryPlanningVersions.$inferSelect;
export type InsertOpsInventoryPlanningVersion = typeof opsInventoryPlanningVersions.$inferInsert;

// Lingxing product weekly data (领星产品表现 - 父ASIN维度)
export const lingxingProductWeekly = mysqlTable("lingxing_product_weekly", {
  workspaceId: int("workspaceId").$defaultFn(currentOpsWorkspaceId),
  id: int("id").autoincrement().primaryKey(),
  importId: int("import_id").notNull(),
  userId: int("user_id").notNull(),
  weekStartDate: varchar("week_start_date", { length: 10 }).notNull(),
  weekEndDate: varchar("week_end_date", { length: 10 }).notNull(),
  // Basic info
  asin: varchar("asin", { length: 2000 }), // expanded: stores comma-joined child ASINs under a parent ASIN
  parentAsin: varchar("parent_asin", { length: 500 }),
  msku: varchar("msku", { length: 200 }),
  storeName: varchar("store_name", { length: 200 }),
  country: varchar("country", { length: 50 }),
  title: varchar("title", { length: 1000 }),
  price: varchar("price", { length: 200 }),
  operator: varchar("operator", { length: 200 }),
  productName: varchar("product_name", { length: 500 }),
  sku: varchar("sku", { length: 200 }),
  brand: varchar("brand", { length: 200 }),
  category1: varchar("category1", { length: 200 }),
  category2: varchar("category2", { length: 200 }),
  category3: varchar("category3", { length: 200 }),
  autoTag: varchar("auto_tag", { length: 500 }),
  listingTag: varchar("listing_tag", { length: 500 }),
  createdTime: varchar("created_time", { length: 50 }),
  // Sales data
  salesQty: int("sales_qty").default(0),
  salesAmount: decimal("sales_amount", { precision: 14, scale: 2 }).default("0"),
  orderQty: int("order_qty").default(0),
  netSalesAmount: decimal("net_sales_amount", { precision: 14, scale: 2 }).default("0"),
  salesQtyMom: varchar("sales_qty_mom", { length: 20 }),
  salesAmountMom: varchar("sales_amount_mom", { length: 20 }),
  orderQtyMom: varchar("order_qty_mom", { length: 20 }),
  salesQtyYoy: varchar("sales_qty_yoy", { length: 20 }),
  salesAmountYoy: varchar("sales_amount_yoy", { length: 20 }),
  orderQtyYoy: varchar("order_qty_yoy", { length: 20 }),
  avgSalesQty: decimal("avg_sales_qty", { precision: 10, scale: 1 }).default("0"),
  avgPrice: varchar("avg_price", { length: 50 }),
  b2bSalesQty: int("b2b_sales_qty").default(0),
  b2bSalesAmount: decimal("b2b_sales_amount", { precision: 14, scale: 2 }).default("0"),
  b2bOrderQty: int("b2b_order_qty").default(0),
  promoSalesQty: int("promo_sales_qty").default(0),
  promoSalesAmount: decimal("promo_sales_amount", { precision: 14, scale: 2 }).default("0"),
  promoOrderQty: int("promo_order_qty").default(0),
  promoDiscount: decimal("promo_discount", { precision: 12, scale: 2 }).default("0"),
  fbmBuyerShipping: decimal("fbm_buyer_shipping", { precision: 12, scale: 2 }).default("0"),
  // Ranking
  bsrMain: varchar("bsr_main", { length: 100 }),
  bsrSub: varchar("bsr_sub", { length: 100 }),
  // Profit data
  settlementProfit: decimal("settlement_profit", { precision: 14, scale: 2 }).default("0"),
  orderProfit: decimal("order_profit", { precision: 14, scale: 2 }).default("0"),
  settlementProfitMargin: varchar("settlement_profit_margin", { length: 20 }),
  orderProfitMargin: varchar("order_profit_margin", { length: 20 }),
  roi: varchar("roi", { length: 20 }),
  // Returns
  refundQty: int("refund_qty").default(0),
  refundAmount: decimal("refund_amount", { precision: 12, scale: 2 }).default("0"),
  refundRate: varchar("refund_rate", { length: 20 }),
  returnQty: int("return_qty").default(0),
  returnRate: varchar("return_rate", { length: 20 }),
  // Reviews
  rating: varchar("rating", { length: 10 }),
  reviewCount: int("review_count").default(0),
  reviewRate: varchar("review_rate", { length: 20 }),
  // Inventory
  fbmAvailable: int("fbm_available").default(0),
  fbaAvailable: int("fba_available").default(0),
  fbaTransferPending: int("fba_transfer_pending").default(0),
  fbaTransferring: int("fba_transferring").default(0),
  fbaInbound: int("fba_inbound").default(0),
  fbaTotal: int("fba_total").default(0),
  fbaPendingShip: int("fba_pending_ship").default(0),
  fbaInTransit: int("fba_in_transit").default(0),
  fbaPlanInbound: int("fba_plan_inbound").default(0),
  fbaUnavailable: int("fba_unavailable").default(0),
  availableStock: int("available_stock").default(0),
  fbaDaysOfSupply: int("fba_days_of_supply").default(0),
  fbmDaysOfSupply: int("fbm_days_of_supply").default(0),
  awdInStock: int("awd_in_stock").default(0),
  awdAvailable: int("awd_available").default(0),
  awdPendingShip: int("awd_pending_ship").default(0),
  awdInTransit: int("awd_in_transit").default(0),
  overseasAvailable: int("overseas_available").default(0),
  localAvailable: int("local_available").default(0),
  purchaseQty: int("purchase_qty").default(0),
  monthlyStockSalesRatio: varchar("monthly_stock_sales_ratio", { length: 50 }),
  stockoutDate: varchar("stockout_date", { length: 50 }),
  // Traffic
  sessionsBrowser: int("sessions_browser").default(0),
  sessionsBrowserPct: varchar("sessions_browser_pct", { length: 20 }),
  sessionsMobile: int("sessions_mobile").default(0),
  sessionsMobilePct: varchar("sessions_mobile_pct", { length: 20 }),
  sessionsTotal: int("sessions_total").default(0),
  sessionsPct: varchar("sessions_pct", { length: 20 }),
  unitSessionsPct: varchar("unit_sessions_pct", { length: 20 }),
  pvBrowser: int("pv_browser").default(0),
  pvBrowserPct: varchar("pv_browser_pct", { length: 20 }),
  pvMobile: int("pv_mobile").default(0),
  pvMobilePct: varchar("pv_mobile_pct", { length: 20 }),
  pvTotal: int("pv_total").default(0),
  pvPct: varchar("pv_pct", { length: 20 }),
  cvr: varchar("cvr", { length: 20 }),
  salesCvr: varchar("sales_cvr", { length: 20 }),
  buyboxRate: varchar("buybox_rate", { length: 20 }),
  // Ads
  adImpressions: int("ad_impressions").default(0),
  adClicks: int("ad_clicks").default(0),
  adSpend: decimal("ad_spend", { precision: 14, scale: 2 }).default("0"),
  spAdSpend: decimal("sp_ad_spend", { precision: 14, scale: 2 }).default("0"),
  sbAdSpend: decimal("sb_ad_spend", { precision: 14, scale: 2 }).default("0"),
  sbvAdSpend: decimal("sbv_ad_spend", { precision: 14, scale: 2 }).default("0"),
  sdAdSpend: decimal("sd_ad_spend", { precision: 14, scale: 2 }).default("0"),
  stAdSpend: decimal("st_ad_spend", { precision: 14, scale: 2 }).default("0"),
  liveAdSpend: decimal("live_ad_spend", { precision: 14, scale: 2 }).default("0"),
  adSales: decimal("ad_sales", { precision: 14, scale: 2 }).default("0"),
  spAdSales: decimal("sp_ad_sales", { precision: 14, scale: 2 }).default("0"),
  sbAdSales: decimal("sb_ad_sales", { precision: 14, scale: 2 }).default("0"),
  sbvAdSales: decimal("sbv_ad_sales", { precision: 14, scale: 2 }).default("0"),
  sdAdSales: decimal("sd_ad_sales", { precision: 14, scale: 2 }).default("0"),
  adOrders: int("ad_orders").default(0),
  spAdOrders: int("sp_ad_orders").default(0),
  sbAdOrders: int("sb_ad_orders").default(0),
  sbvAdOrders: int("sbv_ad_orders").default(0),
  sdAdOrders: int("sd_ad_orders").default(0),
  adOrderPct: varchar("ad_order_pct", { length: 20 }),
  directSales: decimal("direct_sales", { precision: 14, scale: 2 }).default("0"),
  directOrders: int("direct_orders").default(0),
  ctr: varchar("ctr", { length: 20 }),
  adCvr: varchar("ad_cvr", { length: 20 }),
  cpc: varchar("cpc", { length: 20 }),
  cpm: varchar("cpm", { length: 20 }),
  roas: varchar("roas", { length: 20 }),
  acos: varchar("acos", { length: 20 }),
  tacos: varchar("tacos", { length: 20 }),
  acoas: varchar("acoas", { length: 20 }),
  asoas: varchar("asoas", { length: 20 }),
  cpo: varchar("cpo", { length: 20 }),
  cpu: varchar("cpu", { length: 20 }),
  // Organic
  organicClicks: int("organic_clicks").default(0),
  organicOrders: int("organic_orders").default(0),
  organicCvr: varchar("organic_cvr", { length: 20 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type LingxingProductWeekly = typeof lingxingProductWeekly.$inferSelect;

export type InsertLingxingProductWeekly = typeof lingxingProductWeekly.$inferInsert;

// Saihu product weekly data (赛狐产品分析 - ASIN维度)
export const saihuProductWeekly = mysqlTable("saihu_product_weekly", {
  workspaceId: int("workspaceId").$defaultFn(currentOpsWorkspaceId), // asin expanded to 2000 for multi-child ASIN support
  id: int("id").autoincrement().primaryKey(),
  importId: int("import_id").notNull(),
  userId: int("user_id").notNull(),
  weekStartDate: varchar("week_start_date", { length: 10 }).notNull(),
  weekEndDate: varchar("week_end_date", { length: 10 }).notNull(),
  // Basic info
  currency: varchar("currency", { length: 10 }),
  imageUrl: text("image_url"),
  asin: varchar("asin", { length: 2000 }), // expanded: stores comma-joined child ASINs under a parent ASIN
  title: varchar("title", { length: 1000 }),
  parentAsin: varchar("parent_asin", { length: 500 }),
  msku: varchar("msku", { length: 500 }),
  productName: varchar("product_name", { length: 500 }),
  sku: varchar("sku", { length: 500 }),
  storeName: varchar("store_name", { length: 200 }),
  site: varchar("site", { length: 50 }),
  category: varchar("category", { length: 500 }),
  brand: varchar("brand", { length: 200 }),
  operator: varchar("operator", { length: 200 }),
  developer: varchar("developer", { length: 200 }),
  productTag: varchar("product_tag", { length: 500 }),
  listingDate: varchar("listing_date", { length: 50 }),
  // Multi-period sales
  sales3d: int("sales_3d").default(0),
  sales7d: int("sales_7d").default(0),
  sales14d: int("sales_14d").default(0),
  sales30d: int("sales_30d").default(0),
  sales60d: int("sales_60d").default(0),
  sales90d: int("sales_90d").default(0),
  // Profit
  grossProfit: decimal("gross_profit", { precision: 14, scale: 2 }).default("0"),
  grossMargin: decimal("gross_margin", { precision: 8, scale: 4 }).default("0"),
  avgGrossProfit: decimal("avg_gross_profit", { precision: 10, scale: 2 }).default("0"),
  // Sales data
  salesQty: int("sales_qty").default(0),
  fbaSalesQty: int("fba_sales_qty").default(0),
  fbmSalesQty: int("fbm_sales_qty").default(0),
  avgSalesQty: decimal("avg_sales_qty", { precision: 10, scale: 1 }).default("0"),
  promoSalesQty: int("promo_sales_qty").default(0),
  b2bSalesQty: int("b2b_sales_qty").default(0),
  b2bOrderQty: int("b2b_order_qty").default(0),
  vineSalesQty: int("vine_sales_qty").default(0),
  multiChannelSalesQty: int("multi_channel_sales_qty").default(0),
  orderQty: int("order_qty").default(0),
  promoOrderQty: int("promo_order_qty").default(0),
  cancelOrderQty: int("cancel_order_qty").default(0),
  cancelOrderPct: decimal("cancel_order_pct", { precision: 8, scale: 4 }).default("0"),
  salesAmount: decimal("sales_amount", { precision: 14, scale: 2 }).default("0"),
  netSalesAmount: decimal("net_sales_amount", { precision: 14, scale: 2 }).default("0"),
  promoSalesAmount: decimal("promo_sales_amount", { precision: 14, scale: 2 }).default("0"),
  salesRevenue: decimal("sales_revenue", { precision: 14, scale: 2 }).default("0"),
  avgPrice: decimal("avg_price", { precision: 10, scale: 2 }).default("0"),
  productDiscount: decimal("product_discount", { precision: 12, scale: 2 }).default("0"),
  fbmBuyerShipping: decimal("fbm_buyer_shipping", { precision: 12, scale: 2 }).default("0"),
  b2bSalesAmount: decimal("b2b_sales_amount", { precision: 14, scale: 2 }).default("0"),
  // Returns & Refunds
  refundAmount: decimal("refund_amount", { precision: 12, scale: 2 }).default("0"),
  refundQty: int("refund_qty").default(0),
  refundRate: decimal("refund_rate", { precision: 8, scale: 4 }).default("0"),
  returnQty: int("return_qty").default(0),
  fbaReturnQty: int("fba_return_qty").default(0),
  fbmReturnQty: int("fbm_return_qty").default(0),
  returnRate: decimal("return_rate", { precision: 8, scale: 4 }).default("0"),
  fbaReturnRate: decimal("fba_return_rate", { precision: 8, scale: 4 }).default("0"),
  fbmReturnRate: decimal("fbm_return_rate", { precision: 8, scale: 4 }).default("0"),
  exchangeQty: int("exchange_qty").default(0),
  exchangeRate: decimal("exchange_rate", { precision: 8, scale: 4 }).default("0"),
  testSalesAmount: decimal("test_sales_amount", { precision: 12, scale: 2 }).default("0"),
  // Inventory
  fbaAvailable: int("fba_available").default(0),
  reservedTransfer: int("reserved_transfer").default(0),
  reservedProcessing: int("reserved_processing").default(0),
  inboundReceiving: int("inbound_receiving").default(0),
  reservedOrder: int("reserved_order").default(0),
  inboundProcessing: int("inbound_processing").default(0),
  inboundShipped: int("inbound_shipped").default(0),
  fbaUnavailable: int("fba_unavailable").default(0),
  investigating: int("investigating").default(0),
  fbaUsable: int("fba_usable").default(0),
  fbaInTransit: int("fba_in_transit").default(0),
  fbaDaysOfSupply: decimal("fba_days_of_supply", { precision: 8, scale: 1 }).default("0"),
  fbmAvailable: int("fbm_available").default(0),
  fbmDaysOfSupply: decimal("fbm_days_of_supply", { precision: 8, scale: 1 }),
  awdStock: int("awd_stock"),
  awdAvailable: int("awd_available"),
  awdReserved: int("awd_reserved"),
  awdInTransit: int("awd_in_transit"),
  awdToFbaInTransit: int("awd_to_fba_in_transit"),
  suggestedReplenishQty: int("suggested_replenish_qty"),
  localWarehouseAvailable: int("local_warehouse_available"),
  overseasWarehouseAvailable: int("overseas_warehouse_available"),
  // Inventory age
  age0to30: int("age_0_to_30").default(0),
  age31to60: int("age_31_to_60").default(0),
  age61to90: int("age_61_to_90").default(0),
  age91to180: int("age_91_to_180").default(0),
  age181to270: int("age_181_to_270").default(0),
  age271to365: int("age_271_to_365").default(0),
  age365plus: int("age_365_plus").default(0),
  // Traffic
  sessionsMobile: int("sessions_mobile").default(0),
  sessionsBrowser: int("sessions_browser").default(0),
  sessionsTotal: int("sessions_total").default(0),
  pvMobile: int("pv_mobile").default(0),
  pvBrowser: int("pv_browser").default(0),
  pvTotal: int("pv_total").default(0),
  buyboxPrice: varchar("buybox_price", { length: 20 }),
  buyboxRate: decimal("buybox_rate", { precision: 8, scale: 4 }),
  cvr: decimal("cvr", { precision: 8, scale: 4 }).default("0"),
  orderCvr: decimal("order_cvr", { precision: 8, scale: 4 }).default("0"),
  // Rankings
  bsrSub: varchar("bsr_sub", { length: 200 }),
  bsrMain: varchar("bsr_main", { length: 200 }),
  // Reviews
  rating: decimal("rating", { precision: 3, scale: 1 }),
  ratingCount: int("rating_count").default(0),
  negativeReviewCount: int("negative_review_count"),
  effectiveReviewCount: int("effective_review_count"),
  reviewRate: decimal("review_rate", { precision: 8, scale: 4 }).default("0"),
  // Organic
  organicClicks: int("organic_clicks").default(0),
  organicOrders: int("organic_orders").default(0),
  organicCvr: decimal("organic_cvr", { precision: 8, scale: 4 }).default("0"),
  organicOrderPct: decimal("organic_order_pct", { precision: 8, scale: 4 }),
  // Ads
  adImpressions: int("ad_impressions").default(0),
  adClicks: int("ad_clicks").default(0),
  adClickRate: decimal("ad_click_rate", { precision: 8, scale: 4 }).default("0"),
  adCvr: decimal("ad_cvr", { precision: 8, scale: 4 }).default("0"),
  cpcAdCvr: decimal("cpc_ad_cvr", { precision: 8, scale: 4 }).default("0"),
  vcpmAdCvr: decimal("vcpm_ad_cvr", { precision: 8, scale: 4 }).default("0"),
  adSpend: decimal("ad_spend", { precision: 14, scale: 2 }).default("0"),
  spAdSpend: decimal("sp_ad_spend", { precision: 14, scale: 2 }).default("0"),
  sbCollectionAdSpend: decimal("sb_collection_ad_spend", { precision: 14, scale: 2 }).default("0"),
  sbStoreAdSpend: decimal("sb_store_ad_spend", { precision: 14, scale: 2 }).default("0"),
  sbVideoAdSpend: decimal("sb_video_ad_spend", { precision: 14, scale: 2 }).default("0"),
  sdAdSpend: decimal("sd_ad_spend", { precision: 14, scale: 2 }).default("0"),
  cpc: decimal("cpc", { precision: 10, scale: 2 }).default("0"),
  cpa: decimal("cpa", { precision: 10, scale: 2 }).default("0"),
  cpo: decimal("cpo", { precision: 10, scale: 2 }).default("0"),
  cpu: decimal("cpu", { precision: 10, scale: 2 }).default("0"),
  acos: decimal("acos", { precision: 8, scale: 4 }).default("0"),
  spAcos: decimal("sp_acos", { precision: 8, scale: 4 }).default("0"),
  sbCollectionAcos: decimal("sb_collection_acos", { precision: 8, scale: 4 }).default("0"),
  sbStoreAcos: decimal("sb_store_acos", { precision: 8, scale: 4 }).default("0"),
  sbVideoAcos: decimal("sb_video_acos", { precision: 8, scale: 4 }).default("0"),
  sdAcos: decimal("sd_acos", { precision: 8, scale: 4 }).default("0"),
  acoas: decimal("acoas", { precision: 8, scale: 4 }).default("0"),
  asoas: decimal("asoas", { precision: 8, scale: 4 }).default("0"),
  adSalesQty: int("ad_sales_qty").default(0),
  adOrders: int("ad_orders").default(0),
  spAdOrders: int("sp_ad_orders").default(0),
  sbCollectionAdOrders: int("sb_collection_ad_orders").default(0),
  sbStoreAdOrders: int("sb_store_ad_orders").default(0),
  sbVideoAdOrders: int("sb_video_ad_orders").default(0),
  sdAdOrders: int("sd_ad_orders").default(0),
  adOrderPct: decimal("ad_order_pct", { precision: 8, scale: 4 }).default("0"),
  adSalesAmount: decimal("ad_sales_amount", { precision: 14, scale: 2 }).default("0"),
  spAdSales: decimal("sp_ad_sales", { precision: 14, scale: 2 }).default("0"),
  sbCollectionAdSales: decimal("sb_collection_ad_sales", { precision: 14, scale: 2 }).default("0"),
  sbStoreAdSales: decimal("sb_store_ad_sales", { precision: 14, scale: 2 }).default("0"),
  sbVideoAdSales: decimal("sb_video_ad_sales", { precision: 14, scale: 2 }).default("0"),
  sdAdSales: decimal("sd_ad_sales", { precision: 14, scale: 2 }).default("0"),
  // Self-product ad data
  selfAdSales: decimal("self_ad_sales", { precision: 14, scale: 2 }).default("0"),
  spSelfAdSales: decimal("sp_self_ad_sales", { precision: 14, scale: 2 }).default("0"),
  sbCollectionSelfAdSales: decimal("sb_collection_self_ad_sales", { precision: 14, scale: 2 }).default("0"),
  sbStoreSelfAdSales: decimal("sb_store_self_ad_sales", { precision: 14, scale: 2 }).default("0"),
  sbVideoSelfAdSales: decimal("sb_video_self_ad_sales", { precision: 14, scale: 2 }).default("0"),
  sdSelfAdSales: decimal("sd_self_ad_sales", { precision: 14, scale: 2 }).default("0"),
  selfAdOrders: int("self_ad_orders").default(0),
  spSelfAdOrders: int("sp_self_ad_orders").default(0),
  sbCollectionSelfAdOrders: int("sb_collection_self_ad_orders").default(0),
  sbStoreSelfAdOrders: int("sb_store_self_ad_orders").default(0),
  sbVideoSelfAdOrders: int("sb_video_self_ad_orders").default(0),
  sdSelfAdOrders: int("sd_self_ad_orders").default(0),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type SaihuProductWeekly = typeof saihuProductWeekly.$inferSelect;

export type InsertSaihuProductWeekly = typeof saihuProductWeekly.$inferInsert;

// ==================== 运营人员名称映射表 ====================
// Maps external operator names (from Lingxing/Saihu exports) to system user IDs
export const operatorNameMappings = mysqlTable("operator_name_mappings", {
  workspaceId: int("workspaceId").$defaultFn(currentOpsWorkspaceId),
  id: int("id").autoincrement().primaryKey(),
  userId: int("user_id").notNull(), // The user who created this mapping
  externalName: varchar("external_name", { length: 200 }).notNull(), // Name from Lingxing/Saihu export (e.g. "运营 超级管理员_XM-1")
  sourceType: mysqlEnum("source_type", ["lingxing", "saihu", "all"]).default("all").notNull(), // Which data source this mapping applies to
  systemUserName: varchar("system_user_name", { length: 200 }), // Mapped system user name (from users.name)
  systemUserId: int("system_user_id"), // Mapped system user ID (from users.id)
  isConfirmed: int("is_confirmed").default(1).notNull(), // Whether this mapping has been confirmed by user
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type OperatorNameMapping = typeof operatorNameMappings.$inferSelect;

export type InsertOperatorNameMapping = typeof operatorNameMappings.$inferInsert;
