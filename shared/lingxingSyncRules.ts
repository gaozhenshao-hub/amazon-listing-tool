export type LingxingSyncDomain =
  | "product_performance"
  | "product_performance_daily"
  | "parent_asin_weekly_rollup"
  | "fba_inventory"
  | "ad_campaign"
  | "ad_keyword"
  | "ad_search_term"
  | "ad_targeting"
  | "order_profit"
  | "listing_master"
  | "parent_asin_traffic";

export type LingxingSyncRule = {
  domain: LingxingSyncDomain;
  label: string;
  source: string;
  grain: string;
  identity: string;
  sourceFields: string[];
  target: string;
  downstream: string[];
  cadence: string;
  confirmation: string;
  protectedFields: string[];
  missingValue: string;
};

/**
 * 数据域规则是同步治理的单一配置目录；显示层、定时计划与确认写入必须以此为边界，
 * 不得将库存、广告或主数据套入产品日表现的重复键和写入策略。
 */
export const LINGXING_SYNC_RULES: readonly LingxingSyncRule[] = [
  {
    domain: "product_performance",
    label: "产品表现历史周度",
    source: "query_product_performance_asin_lists",
    grain: "店铺SID × 站点 × 父ASIN × 报告周",
    identity: "workspaceId + sourceStoreId + country + parentAsin + weekStart",
    sourceFields: ["销量", "销售额", "订单利润", "广告花费"],
    target: "lingxing_product_weekly",
    downstream: ["产品总览历史回溯", "经营复盘"],
    cadence: "独立手动周度预览；不与ASIN日表现共用身份键",
    confirmation: "人工确认后仅追加周度历史事实",
    protectedFields: ["月度财务利润", "产品负责人", "产品基本信息"],
    missingValue: "无周度源数据时保留历史数据，不将缺失解释为0",
  },
  {
    domain: "product_performance_daily",
    label: "ASIN日产品表现",
    source: "query_product_performance_asin_lists",
    grain: "店铺SID × 站点 × 子ASIN × 报告日",
    identity: "workspaceId + sourceStoreId + country + asin + reportDate",
    sourceFields: ["销量", "订单", "销售额", "订单利润", "Session", "广告订单/销售/花费/点击/曝光", "自然订单", "库存"],
    target: "ops_asin_daily_snapshots",
    downstream: ["产品总览父ASIN自然周汇总", "库存规划基准日", "月度采购与资金规划"],
    cadence: "每日北京时间17:00读取前一天，仅生成草稿",
    confirmation: "人工确认后追加日快照；不覆盖历史Excel快照",
    protectedFields: ["人工货期", "缓冲", "MOQ", "产品成本", "财务利润"],
    missingValue: "源字段缺失显示“数据未提供”，不显示0",
  },
  {
    domain: "parent_asin_weekly_rollup",
    label: "父ASIN自然周汇总",
    source: "已确认的ASIN日快照（不再次读取MCP）",
    grain: "店铺SID × 站点 × 父ASIN × 自然周",
    identity: "workspaceId + sourceStoreId + country + parentAsin + weekStart",
    sourceFields: ["日销量/订单/销售额/Session/广告原子指标"],
    target: "产品总览查询投影",
    downstream: ["产品总览趋势", "异常摘要", "经营复盘"],
    cadence: "每周一北京时间17:10生成汇总草稿与异常摘要",
    confirmation: "只读汇总投影，不写回日快照或人工财务利润",
    protectedFields: ["月度财务利润", "产品负责人", "产品基本信息"],
    missingValue: "比率由汇总分子分母重算；不可推导指标显示“数据未提供”",
  },
  {
    domain: "fba_inventory",
    label: "FBA库存",
    source: "get_fba_stock_list",
    grain: "店铺SID × 站点 × 子ASIN × 快照时点",
    identity: "workspaceId + sourceStoreId + country + asin + snapshotDate",
    sourceFields: ["可售", "预留", "在途", "不可售", "库存快照时间"],
    target: "ops_asin_daily_snapshots",
    downstream: ["库存规划工作台（最新库存基准日）", "补货建议", "月度采购表", "资金规划"],
    cadence: "独立手动预览；不与产品表现日数据的读取窗口绑定",
    confirmation: "人工确认后追加库存快照；读取的是库存事实，不重算人工策略",
    protectedFields: ["生产周期", "物流周期", "缓冲天数", "MOQ", "采购成本", "补货建议人工调整"],
    missingValue: "无库存记录显示“数据未提供”，不将缺失解释为0库存",
  },
  {
    domain: "ad_campaign",
    label: "广告活动历史表现",
    source: "ad_campaign_report",
    grain: "广告Profile × 活动实体 × 报告期",
    identity: "workspaceId + profileId + campaignId/campaignName + reportStart + reportEnd",
    sourceFields: ["曝光", "点击", "花费", "广告销售额", "广告订单", "ACOS", "CPC"],
    target: "ad_campaign_reports",
    downstream: ["广告优化看板", "广告深度优化", "活动级广告贡献审阅（不直接叠加至产品总览）"],
    cadence: "独立手动历史报表预览；以结算后数据为准",
    confirmation: "人工确认后仅追加历史事实报表",
    protectedFields: ["预算", "竞价", "投放状态", "活动结构", "否词", "投放目标"],
    missingValue: "缺失广告字段显示“数据未提供”，不伪造0花费或0订单",
  },
  {
    domain: "ad_keyword",
    label: "广告关键词历史表现",
    source: "ad_campaign_keyword_report",
    grain: "广告Profile × 活动 × 关键词/投放目标 × 匹配方式 × 报告周",
    identity: "workspaceId + profileId + campaign + keyword/target + matchType + weekStart",
    sourceFields: ["曝光", "点击", "花费", "销售额", "订单", "ACOS", "CPC", "CTR"],
    target: "ad_keyword_weekly",
    downstream: ["关键词分析", "广告优化", "搜索词策略", "关键词级历史表现审阅"],
    cadence: "独立手动周报预览；不与活动报表共用实体键",
    confirmation: "人工确认后仅追加关键词历史报表",
    protectedFields: ["竞价", "匹配方式", "否词", "状态", "关键词投放设置"],
    missingValue: "缺失关键词指标显示“数据未提供”，不生成自动投放动作",
  },
  {
    domain: "order_profit",
    label: "订单利润周报",
    source: "query_order_profit_list",
    grain: "店铺SID × 父ASIN × 结算周",
    identity: "workspaceId + sourceStoreId + parentAsin + weekStart",
    sourceFields: ["销量", "销售额", "订单利润", "广告花费"],
    target: "lingxing_product_weekly",
    downstream: ["产品总览历史回溯", "经营利润分析"],
    cadence: "周一读取上一自然周；独立预览确认",
    confirmation: "人工确认后追加周度历史事实，不替代人工财务利润",
    protectedFields: ["月度财务利润", "成本参数", "产品负责人"],
    missingValue: "缺失利润显示“数据未提供”，不按0利润判断停售",
  },
  {
    domain: "listing_master",
    label: "Listing主数据",
    source: "erp_listing",
    grain: "店铺SID × 站点 × 子ASIN",
    identity: "workspaceId + sourceStoreId + country + asin",
    sourceFields: ["标题", "SKU", "父ASIN", "状态", "类目"],
    target: "主数据差异草稿（未启用自动写入）",
    downstream: ["产品基本信息审阅", "Listing工作流"],
    cadence: "按店铺/国家分页只读预览；不进入自动计划",
    confirmation: "仅字段差异审阅；后续单独确认写入策略",
    protectedFields: ["品名", "负责人", "产品成本", "人工分类"],
    missingValue: "保留现有人工字段，不用空值覆盖",
  },
  {
    domain: "ad_search_term",
    label: "广告搜索词历史事实",
    source: "ad_campaign_search_term_report",
    grain: "广告Profile × 搜索词/来源投放 × 报告期",
    identity: "workspaceId + profileId + searchTerm + sourceTarget + reportStart + reportEnd",
    sourceFields: ["搜索词", "来源投放", "曝光", "点击", "花费", "广告销售额", "广告订单", "ACOS", "CTR", "CPC"],
    target: "广告搜索词草稿（未启用自动写入）",
    downstream: ["广告搜索词分析", "关键词优化候选", "广告深度优化审阅"],
    cadence: "按广告Profile和报告期分页只读预览；不进入自动计划",
    confirmation: "先完成人工字段/粒度对账；后续单独确认历史事实表结构",
    protectedFields: ["搜索词否定状态", "竞价", "匹配方式", "广告状态", "投放设置"],
    missingValue: "未返回来源实体或日期时拒绝写入，仅保留预览异常",
  },
  {
    domain: "ad_targeting",
    label: "广告投放目标历史事实",
    source: "ad_campaign_targeting_report",
    grain: "广告Profile × Campaign/Ad Group × 投放目标 × 报告期",
    identity: "workspaceId + profileId + campaignId + adGroupId + targetingEntity + reportStart + reportEnd",
    sourceFields: ["投放目标", "活动/广告组", "曝光", "点击", "花费", "广告销售额", "广告订单", "ACOS", "CTR", "CPC"],
    target: "广告投放目标草稿（未启用自动写入）",
    downstream: ["投放目标分析", "广告优化候选", "商品/自动投放复盘"],
    cadence: "按广告Profile和报告期分页只读预览；不进入自动计划",
    confirmation: "先完成人工字段/粒度对账；后续单独确认历史事实表结构",
    protectedFields: ["投放目标状态", "竞价", "预算", "广告状态", "投放结构"],
    missingValue: "未返回目标实体或日期时拒绝写入，仅保留预览异常",
  },
  {
    domain: "parent_asin_traffic",
    label: "父ASIN原始流量",
    source: "query_product_performance_asin_lists（需以parent_asin汇总粒度重新验证返回）",
    grain: "店铺SID × 站点 × 父ASIN × 报告日",
    identity: "workspaceId + sourceStoreId + country + parentAsin + reportDate",
    sourceFields: ["父ASIN原始Session/浏览/转化字段"],
    target: "独立父ASIN流量表（未启用自动写入）",
    downstream: ["产品总览流量诊断"],
    cadence: "以父ASIN汇总粒度重新完成字段/返回验证后启用只读预览；不进入自动计划",
    confirmation: "与子ASIN流量分库存储、分开显示，禁止直接相加",
    protectedFields: ["子ASIN日快照", "人工流量备注"],
    missingValue: "未提供原始字段时显示“数据未提供”",
  },
] as const;

export type LingxingSyncGovernance = {
  dedupeKey: string;
  diffFields: readonly string[];
  writePolicy: "manual_append" | "validated_daily_auto_apply" | "draft_only" | "preview_only" | "unavailable";
  schedulePolicy: "manual" | "daily_17_shanghai" | "weekly_1710_shanghai" | "disabled_pending_source";
  scopePolicy: string;
  readWindowPolicy: string;
};

/** 规则目录的可执行治理补充；不得由页面或路由自行猜测重复键、写入及定时策略。 */
export const LINGXING_SYNC_GOVERNANCE: Record<LingxingSyncDomain, LingxingSyncGovernance> = {
  product_performance: { dedupeKey: "sourceStoreId|country|parentAsin|weekStart", diffFields: ["salesQty", "salesAmount", "orderProfit", "adSpend"], writePolicy: "manual_append", schedulePolicy: "manual", scopePolicy: "single-selected-store-and-marketplace", readWindowPolicy: "manual-complete-natural-week" },
  product_performance_daily: { dedupeKey: "sourceStoreId|country|asin|reportDate", diffFields: ["salesQty", "orderQty", "salesAmount", "orderProfit", "adSpend", "adSales", "adOrders", "sessionsTotal", "adClicks", "adImpressions", "returnQty"], writePolicy: "validated_daily_auto_apply", schedulePolicy: "daily_17_shanghai", scopePolicy: "authorized-US-stores-or-single-selected-store", readWindowPolicy: "previous-calendar-day" },
  parent_asin_weekly_rollup: { dedupeKey: "sourceStoreId|country|parentAsin|weekStart", diffFields: ["salesQty", "orderQty", "salesAmount", "adSpend", "sessionsTotal", "adOrders"], writePolicy: "draft_only", schedulePolicy: "weekly_1710_shanghai", scopePolicy: "confirmed-daily-snapshots-in-workspace", readWindowPolicy: "previous-complete-natural-week" },
  fba_inventory: { dedupeKey: "sourceStoreId|country|asin|snapshotDate", diffFields: ["fbaAvailable", "fbaReserved", "fbaInTransit", "sku", "productName"], writePolicy: "manual_append", schedulePolicy: "manual", scopePolicy: "single-selected-store-and-marketplace", readWindowPolicy: "provider-current-inventory-snapshot" },
  ad_campaign: { dedupeKey: "profileId|campaignId|reportStart|reportEnd", diffFields: ["adImpressions", "adClicks", "adSpend", "adSales", "adOrders", "adAcos", "adCpc"], writePolicy: "manual_append", schedulePolicy: "manual", scopePolicy: "single-selected-ad-profile", readWindowPolicy: "manual-closed-report-period" },
  ad_keyword: { dedupeKey: "profileId|campaignId|keyword|matchType|weekStart", diffFields: ["adImpressions", "adClicks", "adSpend", "adSales", "adOrders", "adAcos", "adCpc", "adCtr"], writePolicy: "manual_append", schedulePolicy: "manual", scopePolicy: "single-selected-ad-profile", readWindowPolicy: "manual-complete-week" },
  order_profit: { dedupeKey: "sourceStoreId|parentAsin|weekStart", diffFields: ["salesQty", "salesAmount", "orderProfit", "adSpend"], writePolicy: "manual_append", schedulePolicy: "manual", scopePolicy: "single-selected-store", readWindowPolicy: "manual-closed-settlement-week" },
  listing_master: { dedupeKey: "sourceStoreId|country|asin", diffFields: ["productName", "sku", "parentAsin", "listingStatus", "marketplace"], writePolicy: "preview_only", schedulePolicy: "manual", scopePolicy: "authorized-US-stores-or-single-selected-store", readWindowPolicy: "provider-current-listing-page" },
  ad_search_term: { dedupeKey: "profileId|searchTerm|sourceTarget|reportStart|reportEnd", diffFields: ["adImpressions", "adClicks", "adSpend", "adSales", "adOrders", "adAcos", "adCpc", "adCtr", "adCvr"], writePolicy: "preview_only", schedulePolicy: "manual", scopePolicy: "authorized-US-ad-profiles-or-selected-profile", readWindowPolicy: "manual-closed-report-period" },
  ad_targeting: { dedupeKey: "profileId|campaignId|adGroupId|targetingEntity|reportStart|reportEnd", diffFields: ["adImpressions", "adClicks", "adSpend", "adSales", "adOrders", "adAcos", "adCpc", "adCtr", "adCvr"], writePolicy: "preview_only", schedulePolicy: "manual", scopePolicy: "authorized-US-ad-profiles-or-selected-profile", readWindowPolicy: "manual-closed-report-period" },
  parent_asin_traffic: { dedupeKey: "sourceStoreId|country|parentAsin|reportDate", diffFields: ["sessionsTotal", "traffic", "conversion"], writePolicy: "unavailable", schedulePolicy: "disabled_pending_source", scopePolicy: "unavailable-until-official-parent-source-verified", readWindowPolicy: "unavailable-until-official-parent-source-verified" },
};

export function getLingxingSyncRule(domain: LingxingSyncDomain) {
  return LINGXING_SYNC_RULES.find((rule) => rule.domain === domain) || null;
}

export function getLingxingSyncGovernance(domain: LingxingSyncDomain) {
  return LINGXING_SYNC_GOVERNANCE[domain];
}
