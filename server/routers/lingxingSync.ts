import { createHash } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import { parse as parseCookie } from "cookie";
import { z } from "zod";
import { adCampaignReports, adKeywordWeekly, adReportImports, dataImports, lingxingProductWeekly, opsAsinDailySnapshots, opsExternalSyncBatches, opsExternalSyncConfirmations, opsExternalSyncRows, opsLingxingSyncSchedules } from "../../drizzle/schema";
import { router } from "../_core/trpc";
import { createHeartbeatJob, updateHeartbeatJob } from "../_core/heartbeat";
import { COOKIE_NAME } from "@shared/const";
import { protectedProcedure } from "../domains/ops/workspaceProcedure";
import { ensureAgentRunTrace } from "../domains/ai_os/services/runLedger";
import { registerUnifiedArtifact } from "../domains/ai_os/services/artifactLifecycle";
import { invokeEmperorTool } from "../domains/ai_os/services/toolGateway/executors";
import { getDb } from "../repositories/dbClient";

const domainSchema = z.enum(["product_performance", "product_performance_daily", "order_profit", "fba_inventory", "ad_campaign", "ad_keyword"]);
const scopeSchema = z.object({
  storeId: z.string().trim().min(1),
  profileId: z.string().trim().optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  marketplace: z.string().trim().optional(),
});
const scheduledDomainSchema = z.enum(["product_performance_daily", "parent_asin_weekly_rollup"]);
const SCHEDULE_PRESETS = {
  product_performance_daily: {
    cadence: "daily_previous_day", cronExpression: "0 0 9 * * *",
    description: "北京时间每日17:00读取前一天美国站ASIN日数据，仅生成待审核草稿",
  },
  parent_asin_weekly_rollup: {
    cadence: "weekly_parent_asin_rollup", cronExpression: "0 10 9 * * 1",
    description: "北京时间每周一17:10汇总上一自然周已确认日快照，仅生成待审核父ASIN周汇总草稿",
  },
} as const;

type RecordValue = Record<string, unknown>;

function object(value: unknown): RecordValue { return value && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : {}; }

function parseJsonText(value: string): unknown {
  try { return JSON.parse(value); } catch {}
  for (let start = 0; start < value.length; start += 1) {
    const opener = value[start];
    if (opener !== "{" && opener !== "[") continue;
    const stack = [opener === "{" ? "}" : "]"];
    let quoted = false;
    let escaped = false;
    for (let end = start + 1; end < value.length; end += 1) {
      const character = value[end];
      if (quoted) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === '"') quoted = false;
        continue;
      }
      if (character === '"') { quoted = true; continue; }
      if (character === "{") stack.push("}");
      else if (character === "[") stack.push("]");
      else if (character === stack.at(-1)) {
        stack.pop();
        if (!stack.length) {
          try { return JSON.parse(value.slice(start, end + 1)); } catch { break; }
        }
      }
    }
  }
  const keyAliases: Record<string, string> = {
    "店铺ID": "sid", "店铺名称": "shop_name", "ASIN": "asin", "父ASIN": "parent_asin", "SKU": "sku", "MSKU": "msku",
    "产品名称": "product_name", "品名": "product_name", "标题": "title", "销量": "sales_qty", "销售额": "sales_amount", "订单利润": "order_profit",
    "广告花费": "ad_spend", "可售库存": "fba_available", "预留库存": "fba_reserved", "在途库存": "fba_in_transit",
    "广告活动": "campaign_name", "广告活动名称": "campaign_name", "广告组合": "portfolio_name", "关键词": "keyword", "匹配方式": "match_type",
    "曝光量": "impressions", "点击量": "clicks", "花费": "spend", "广告销售额": "sales",
  };
  const recordStartKeys = new Set(["sid", "asin", "campaign_name", "keyword"]);
  const records: RecordValue[] = [];
  let current: RecordValue | null = null;
  for (const line of value.split(/\r?\n/)) {
    const matched = line.match(/^\s*(?:[-*•]\s*)?([^:：]{1,80})\s*[:：]\s*(.+?)\s*$/);
    if (!matched) continue;
    const [, rawKey, rawValue] = matched;
    const label = rawKey.trim();
    const key = keyAliases[label] || label.replace(/[\s-]+/g, "_").toLowerCase();
    if (recordStartKeys.has(key) && current?.[key]) {
      records.push(current);
      current = {};
    }
    current ||= {};
    current[key] = rawValue.trim();
  }
  if (current && Object.keys(current).some((key) => recordStartKeys.has(key))) records.push(current);
  if (records.length) return { list: records };
  return value;
}

export function normalizeMcpPayload(value: unknown): unknown {
  if (typeof value === "string") {
    const parsed = parseJsonText(value);
    return parsed === value ? value : normalizeMcpPayload(parsed);
  }
  if (Array.isArray(value)) return value.map(normalizeMcpPayload);
  if (!value || typeof value !== "object") return value;
  const record = value as RecordValue;
  if (Array.isArray(record.content)) {
    const textItems = record.content.map((item) => object(item).text).filter((item): item is string => typeof item === "string");
    if (textItems.length === 1) return normalizeMcpPayload(textItems[0]);
  }
  const resultRecord = object(record.result);
  if (Array.isArray(resultRecord.content)) return normalizeMcpPayload(resultRecord);
  return Object.fromEntries(Object.entries(record).map(([key, nested]) => [key, normalizeMcpPayload(nested)]));
}

export function pickRecords(value: unknown, depth = 0): RecordValue[] {
  if (depth > 6 || value === null || value === undefined) return [];
  if (Array.isArray(value)) {
    const direct = value.filter((item): item is RecordValue => Boolean(item) && typeof item === "object" && !Array.isArray(item));
    return direct.length ? direct : value.flatMap((item) => pickRecords(item, depth + 1));
  }
  if (typeof value !== "object") return [];
  const record = value as RecordValue;
  for (const key of ["list", "rows", "data", "items", "records", "result"]) {
    if (record[key] !== undefined) {
      const found = pickRecords(record[key], depth + 1);
      if (found.length) return found;
    }
  }
  return [];
}

function value(record: RecordValue, keys: string[]) {
  for (const key of keys) if (record[key] !== undefined && record[key] !== null && String(record[key]).trim()) return record[key];
  return null;
}

function asText(input: unknown, fallback = "") { return input === null || input === undefined ? fallback : String(input).trim(); }
function asNumber(input: unknown) {
  const parsed = Number(String(input ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}
function sumValues(record: RecordValue, keys: string[]) {
  const values = keys.map((key) => value(record, [key])).filter((item) => item !== null);
  return values.length ? values.reduce((total, item) => total + asNumber(item), 0) : null;
}
function firstText(input: unknown) {
  if (Array.isArray(input)) return asText(input[0]);
  return asText(input).split(",")[0]?.trim() || "";
}
function nestedText(input: unknown, keys: string[]) {
  if (Array.isArray(input)) {
    for (const item of input) {
      const found = value(object(item), keys);
      if (found !== null) return asText(found);
    }
  }
  return "";
}
function isoDates(startDate: string, endDate: string) {
  const dates: string[] = [];
  const current = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  while (current <= end) {
    dates.push(current.toISOString().slice(0, 10));
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return dates;
}
function isUsStore(record: RecordValue) {
  const country = asText(value(record, ["country", "site", "marketplace", "country_name"]));
  return country === "US" || country === "美国" || /\bUS\b/i.test(country);
}
export function normalizeLingxingStoreDirectoryRecord(record: RecordValue) {
  const rawSid = asText(value(record, ["sid", "id"]));
  const compact = rawSid.match(/^(\d+)\s*,\s*店铺名:\s*([^,]+),\s*国家:\s*.+?\(([A-Z]{2})\)\s*$/i);
  if (compact) return { sid: compact[1], name: compact[2].trim(), country: compact[3].toUpperCase() };
  return {
    sid: rawSid,
    name: asText(value(record, ["shop_name", "seller_name", "name"])),
    country: asText(value(record, ["country", "site", "marketplace", "country_name"])),
  };
}
function isPlaceholderAsin(record: RecordValue) {
  const asin = asText(value(record, ["asin", "child_asin", "childAsin"]));
  return !asin || asin === "-";
}
export function dailySnapshotIdentityKey(input: { sourceStoreId?: unknown; country?: unknown; asin?: unknown; reportDate?: unknown }) {
  return [asText(input.sourceStoreId), asText(input.country), asText(input.asin), asText(input.reportDate)].join("|");
}
export function normalizeDailyPreviewPage(pageRows: RecordValue[], context: { storeId: string; storeName: string; reportDate: string }) {
  let placeholderRows = 0;
  const rows: RecordValue[] = [];
  for (const source of pageRows) {
    if (isPlaceholderAsin(source)) { placeholderRows += 1; continue; }
    rows.push({ ...source, __lingxingSid: context.storeId, __lingxingStoreName: context.storeName, __reportDate: context.reportDate });
  }
  return { rows, placeholderRows };
}
export function isValidDailySnapshotForApply(input: RecordValue) {
  return asText(input.asin) !== "-" && Boolean(asText(input.asin)) && Boolean(asText(input.parentAsin)) && /^\d{4}-\d{2}-\d{2}$/.test(asText(input.reportDate));
}
export function shouldExternalizeSyncRawSnapshot(input: unknown) {
  return Buffer.byteLength(JSON.stringify(input), "utf8") > 1_000_000;
}
function todayIso() { return new Date().toISOString().slice(0, 10); }
export function previewBatchStatusFor(sourceRowCount: number) { return sourceRowCount > 0 ? "ready_for_review" : "empty"; }

export function normalizeRow(domain: z.infer<typeof domainSchema>, source: RecordValue, scope: z.infer<typeof scopeSchema>) {
  const asin = value(source, ["asin", "child_asin", "childAsin", "子ASIN"]);
  const parentAsin = value(source, ["parent_asin_real", "parent_asin", "parentAsin", "p_asin", "父ASIN"]) || nestedText(source.parent_asins, ["parent_asin", "asin"]);
  const sku = value(source, ["sku", "local_sku", "seller_sku", "msku", "sellerSku", "SKU"]);
  const sourceStoreId = value(source, ["__lingxingSid", "sid", "store_id", "storeId"]) || scope.storeId;
  const reportDate = value(source, ["rdate", "report_date", "reportDate", "__reportDate"]) || scope.endDate || scope.startDate;
  const normalized: RecordValue = {
    sourceDomain: domain,
    storeId: sourceStoreId,
    profileId: scope.profileId || null,
    periodStart: scope.startDate || null,
    periodEnd: scope.endDate || null,
    asin: asin ? firstText(asin) : firstText(value(source, ["asins"])),
    parentAsin: parentAsin ? firstText(parentAsin) : null,
    reportDate,
    sku: sku ? String(sku) : null,
    productName: value(source, ["local_name", "product_name", "item_name", "title", "name", "品名", "产品名称"]),
    storeName: value(source, ["__lingxingStoreName", "shop_name", "store_name", "storeName", "seller_name"]) || `SID ${sourceStoreId}`,
    country: value(source, ["country", "site", "marketplace"]) || scope.marketplace || "US",
    salesQty: value(source, ["volume", "sales_qty", "salesQty", "units", "quantity", "销量"]),
    orderQty: value(source, ["order_items", "order_qty", "orderQty", "orders"]),
    salesAmount: value(source, ["sales_amount", "sales", "salesAmount", "revenue", "amount", "销售额"]),
    netSalesAmount: value(source, ["net_amount", "net_sales_amount", "netSalesAmount"]),
    orderProfit: value(source, ["profit", "order_profit", "orderProfit", "gross_profit", "订单利润"]),
    adSpend: value(source, ["ad_spend", "spend", "spends", "cost", "广告花费"]),
    adSales: value(source, ["ad_sales_amount", "ad_sales", "ads_sales", "sales", "广告销售额"]),
    adOrders: value(source, ["ad_order_quantity", "ad_orders", "ads_sales_volume_quantity"]),
    organicOrders: value(source, ["nature_order_items", "organic_orders"]),
    sessionsTotal: value(source, ["sessions_total", "sessions"]),
    campaignName: value(source, ["campaign_name", "campaignName", "campaign", "name", "广告活动", "广告活动名称"]),
    campaignId: value(source, ["campaign_id", "campaignId"]),
    portfolioName: value(source, ["portfolio_name", "portfolioName", "广告组合"]),
    adType: value(source, ["ad_type", "adType", "ads_type", "sponsored_type", "广告类型"]),
    keyword: value(source, ["keyword_text", "keyword", "关键词", "targeting_text", "targeting", "targeting_value"]),
    matchType: value(source, ["match_type", "matchType", "匹配方式"]),
    adImpressions: value(source, ["impressions", "曝光量"]),
    adClicks: value(source, ["clicks", "点击量"]),
    returnQty: value(source, ["return_count", "return_goods_count", "return_qty"]),
    fbaAvailable: value(source, ["afn_fulfillable_quantity", "fulfillable_qty", "available", "fba_available", "可售库存"]),
    fbaReserved: value(source, ["afn_reserved_quantity", "reserved_qty", "reserved", "fba_reserved", "预留库存"]),
    fbaInTransit: sumValues(source, ["afn_inbound_receiving_quantity", "afn_inbound_shipped_quantity", "afn_inbound_working_quantity"]) ?? value(source, ["inbound_qty", "in_transit", "fba_in_transit", "在途库存"]),
    rawFieldNames: Object.keys(source).sort(),
  };
  const entityKey = domain === "product_performance_daily"
    ? [normalized.storeId, domain, normalized.asin || "unmatched", normalized.reportDate || "missing"].join("|")
    : [normalized.storeId, domain, normalized.parentAsin || normalized.asin || "unmatched", normalized.sku || "", scope.startDate || "latest", scope.endDate || ""].join("|");
  const validationErrors: string[] = [];
  if (["product_performance", "product_performance_daily", "order_profit"].includes(domain) && !normalized.asin && !normalized.parentAsin) validationErrors.push("未识别ASIN或父ASIN，不能确认写入产品总览。");
  if (domain === "product_performance_daily" && (!normalized.asin || normalized.asin === "-" || !normalized.parentAsin || !normalized.reportDate)) validationErrors.push("ASIN日快照需要有效子ASIN、父ASIN和报告日期；占位ASIN不能写入。");
  if (domain === "fba_inventory" && (!normalized.asin || !normalized.parentAsin)) validationErrors.push("库存快照需要子ASIN和父ASIN映射；请在草稿中补充或取消选择该行。");
  if (domain === "ad_campaign" && !normalized.campaignName) validationErrors.push("广告活动报表需要活动名称；请核对草稿后再确认。");
  if (domain === "ad_keyword" && (!normalized.keyword || !normalized.campaignName)) validationErrors.push("广告关键词报表需要关键词和活动名称；请核对草稿后再确认。");
  return { entityKey, normalized, validationErrors };
}

export function calculateFieldDiffs(current: RecordValue, incoming: RecordValue, fields: string[]) {
  return fields.flatMap((field) => {
    const before = current[field] ?? null;
    const after = incoming[field] ?? null;
    return String(before ?? "") === String(after ?? "") ? [] : [{ field, before, after }];
  });
}

export function buildMcpArguments(domain: z.infer<typeof domainSchema>, scope: z.infer<typeof scopeSchema>) {
  const commonDate = { start_date: scope.startDate, end_date: scope.endDate };
  if (domain === "product_performance") return { capability: "query_product_performance_asin_lists", arguments: { sids: scope.storeId, offset: 0, length: 200, ...commonDate, date_type: "purchase", date_view_type: "week", date_view_order_type: 2, summary_field: "parent_asin", turn_on_summary: 1, query_order_profit: true, currency_code: "USD" } };
  if (domain === "product_performance_daily") return { capability: "query_product_performance_asin_lists", arguments: { sids: scope.storeId, offset: 0, length: 200, ...commonDate, date_type: "purchase", date_view_type: "day", date_view_order_type: 1, summary_field: "asin", turn_on_summary: 1, query_order_profit: true, currency_code: "USD" } };
  if (domain === "order_profit") return { capability: "query_order_profit_list", arguments: { sids: scope.storeId, ...commonDate, currency_type: "USD", external_service_mark: 1, source_service: "mcp", length: "200", offset: "0", sort_type: "desc", turn_on_summary: "1", search_type: 0, search_field: "parent_asin", summary_field: "parent_asin", date_summary_type: 2, query_order_gross_first: true } };
  if (domain === "fba_inventory") return { capability: "get_fba_stock_list", arguments: { sid: scope.storeId, offset: 0, length: 200, sort_field: "sku", sort_type: "asc", is_cost_page: "0", is_hide_zero_stock: 0, is_parant_asin_merge: "1" } };
  if (domain === "ad_campaign") return { capability: "ad_campaign_report", arguments: { profile_ids: [scope.profileId || scope.storeId], report_date: `${scope.startDate} - ${scope.endDate}`, page: 1, length: 200, sort_field: "spends", sort_type: "desc" } };
  return { capability: "ad_campaign_keyword_report", arguments: { profile_ids: [scope.profileId || scope.storeId], report_date: `${scope.startDate} - ${scope.endDate}`, page: 1, length: 200, sort_field: "spends", sort_type: "desc" } };
}

export const lingxingSyncRouter = router({
  listStores: protectedProcedure.query(async ({ ctx }) => {
    const workspaceId = ctx.user.defaultWorkspaceId!;
    const execution = await invokeEmperorTool({ toolSlug: "internal.lingxing.read", params: { capability: "get_my_sids", arguments: {} }, userId: ctx.user.id, userRole: ctx.user.role, workspaceId });
    const records = pickRecords(normalizeMcpPayload(execution.output));
    return records.slice(0, 100).map((record) => ({
      sid: String(value(record, ["sid", "shop_id", "shopId", "id"]) || ""),
      name: String(value(record, ["shop_name", "shopName", "name", "store_name"]) || "未命名店铺"),
    })).filter((store) => Boolean(store.sid));
  }),

  listAdProfiles: protectedProcedure.query(async ({ ctx }) => {
    const workspaceId = ctx.user.defaultWorkspaceId!;
    const execution = await invokeEmperorTool({ toolSlug: "internal.lingxing.read", params: { capability: "ad_auth_shops", arguments: {} }, userId: ctx.user.id, userRole: ctx.user.role, workspaceId });
    const records = pickRecords(normalizeMcpPayload(execution.output));
    return records.map((record) => ({
      profileId: String(value(record, ["profile_id", "profileId", "profile", "id"]) || ""),
      sid: String(value(record, ["sid", "shop_id", "shopId"]) || ""),
      name: String(value(record, ["shop_name", "shopName", "name", "store_name", "seller_name"]) || "未命名广告店铺"),
      country: String(value(record, ["country", "site", "marketplace"]) || ""),
    })).filter((profile) => Boolean(profile.profileId));
  }),

  list: protectedProcedure.input(z.object({ limit: z.number().min(1).max(100).default(30) })).query(async ({ ctx, input }) => {
    const db = await getDb();
    if (!db) throw new Error("数据库不可用");
    const workspaceId = ctx.user.defaultWorkspaceId!;
    return db.select().from(opsExternalSyncBatches).where(eq(opsExternalSyncBatches.workspaceId, workspaceId)).orderBy(desc(opsExternalSyncBatches.createdAt)).limit(input.limit);
  }),

  listSchedules: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new Error("数据库不可用");
    return db.select().from(opsLingxingSyncSchedules)
      .where(eq(opsLingxingSyncSchedules.workspaceId, ctx.user.defaultWorkspaceId!))
      .orderBy(desc(opsLingxingSyncSchedules.createdAt));
  }),

  setScheduleEnabled: protectedProcedure.input(z.object({
    dataDomain: scheduledDomainSchema,
    enabled: z.boolean(),
  })).mutation(async ({ ctx, input }) => {
    const db = await getDb();
    if (!db) throw new Error("数据库不可用");
    const workspaceId = ctx.user.defaultWorkspaceId!;
    const preset = SCHEDULE_PRESETS[input.dataDomain];
    const sessionToken = parseCookie(ctx.req.headers.cookie ?? "")[COOKIE_NAME] ?? "";
    const [existing] = await db.select().from(opsLingxingSyncSchedules).where(and(
      eq(opsLingxingSyncSchedules.workspaceId, workspaceId),
      eq(opsLingxingSyncSchedules.dataDomain, input.dataDomain),
    )).limit(1);
    let taskUid = existing?.scheduleCronTaskUid ?? null;
    let nextExecutionAt: string | null | undefined;
    if (!taskUid && input.enabled) {
      const created = await createHeartbeatJob({
        name: `ops-lingxing-${input.dataDomain}-workspace-${workspaceId}`,
        cron: preset.cronExpression,
        path: "/api/scheduled/lingxing-sync-draft",
        payload: { domain: input.dataDomain },
        description: preset.description,
      }, sessionToken);
      taskUid = created.taskUid;
      nextExecutionAt = created.nextExecutionAt;
    } else if (taskUid) {
      const updated = await updateHeartbeatJob(taskUid, {
        enable: input.enabled,
        cron: preset.cronExpression,
        path: "/api/scheduled/lingxing-sync-draft",
        description: preset.description,
      }, sessionToken);
      nextExecutionAt = updated.nextExecutionAt;
    }
    const payload = {
      workspaceId, dataDomain: input.dataDomain, cadence: preset.cadence, timezone: "Asia/Shanghai", cronExpression: preset.cronExpression,
      enabled: input.enabled ? 1 : 0, scheduleCronTaskUid: taskUid, ownerUserId: ctx.user.id,
      lastStatus: existing?.lastStatus ?? "idle", lastRunKey: existing?.lastRunKey ?? null, lastRunAt: existing?.lastRunAt ?? null,
      lastBatchId: existing?.lastBatchId ?? null, lastError: existing?.lastError ?? null,
    };
    if (existing) await db.update(opsLingxingSyncSchedules).set(payload).where(eq(opsLingxingSyncSchedules.id, existing.id));
    else await db.insert(opsLingxingSyncSchedules).values(payload);
    return { dataDomain: input.dataDomain, enabled: input.enabled, taskUid, nextExecutionAt, writePolicy: "draft_only" as const };
  }),

  get: protectedProcedure.input(z.object({ batchId: z.number().int().positive() })).query(async ({ ctx, input }) => {
    const db = await getDb();
    if (!db) throw new Error("数据库不可用");
    const workspaceId = ctx.user.defaultWorkspaceId!;
    const [batch] = await db.select().from(opsExternalSyncBatches).where(and(eq(opsExternalSyncBatches.id, input.batchId), eq(opsExternalSyncBatches.workspaceId, workspaceId))).limit(1);
    if (!batch) throw new Error("同步批次不存在或无权访问");
    const rows = await db.select().from(opsExternalSyncRows).where(and(eq(opsExternalSyncRows.batchId, input.batchId), eq(opsExternalSyncRows.workspaceId, workspaceId))).orderBy(desc(opsExternalSyncRows.createdAt));
    return { batch, rows };
  }),

  createPreview: protectedProcedure.input(z.object({ dataDomain: domainSchema, scope: scopeSchema })).mutation(async ({ ctx, input }) => {
    const db = await getDb();
    if (!db) throw new Error("数据库不可用");
    const workspaceId = ctx.user.defaultWorkspaceId!;
    const runId = `ops_lingxing_sync_${Date.now()}_${ctx.user.id}`;
    await ensureAgentRunTrace({ runId, workspaceId, userId: ctx.user.id, agentSlug: "ops.lingxing_sync_preview", metadata: { dataDomain: input.dataDomain, scope: input.scope } }).catch(() => null);
    let rawSnapshot: unknown;
    let sourceRows: RecordValue[];
    let toolRunId: string | null = null;
    const summary: { totalRead: number; selected: number; needsReview: number; unmatched: number; [key: string]: unknown } = { totalRead: 0, selected: 0, needsReview: 0, unmatched: 0 };
    if (input.dataDomain === "product_performance_daily") {
      const storesExecution = input.scope.storeId === "ALL_US"
        ? await invokeEmperorTool({ toolSlug: "internal.lingxing.read", params: { capability: "get_my_sids", arguments: {} }, userId: ctx.user.id, userRole: ctx.user.role, workspaceId, runId, nodeId: "read_us_store_directory" })
        : null;
      const stores = storesExecution
        ? pickRecords(normalizeMcpPayload(storesExecution.output)).map(normalizeLingxingStoreDirectoryRecord).filter(isUsStore).filter((store) => Boolean(store.sid))
        : [{ sid: input.scope.storeId, name: "" }];
      const dates = input.scope.startDate && input.scope.endDate ? isoDates(input.scope.startDate, input.scope.endDate) : [];
      const rows: RecordValue[] = [];
      const toolRunIds: string[] = [];
      let placeholderRows = 0;
      let pageTruncations = 0;
      let capped = false;
      for (const store of stores) {
        for (const reportDate of dates) {
          let exhausted = false;
          for (let page = 0; page < 10 && !exhausted; page += 1) {
            if (rows.length >= 5000) { capped = true; break; }
            const request = buildMcpArguments("product_performance_daily", { ...input.scope, storeId: store.sid, startDate: reportDate, endDate: reportDate });
            request.arguments.offset = page * 200;
            const execution = await invokeEmperorTool({ toolSlug: "internal.lingxing.read", params: request, userId: ctx.user.id, userRole: ctx.user.role, workspaceId, runId, nodeId: `read_asin_daily_${store.sid}_${reportDate}_${page}` });
            toolRunId = execution.metadata.toolRunId || toolRunId;
            if (execution.metadata.toolRunId) toolRunIds.push(execution.metadata.toolRunId);
            const pageRows = pickRecords(normalizeMcpPayload(execution.output));
            const normalizedPage = normalizeDailyPreviewPage(pageRows, { storeId: store.sid, storeName: store.name, reportDate });
            placeholderRows += normalizedPage.placeholderRows;
            for (const source of normalizedPage.rows) if (rows.length < 5000) rows.push(source);
            exhausted = pageRows.length < 200;
            if (page === 9 && !exhausted) pageTruncations += 1;
          }
          if (capped) break;
        }
        if (capped) break;
      }
      sourceRows = rows;
      rawSnapshot = { source: "lingxing_mcp", dataDomain: input.dataDomain, stores, dates, rows, toolRunIds };
      Object.assign(summary, { totalRead: sourceRows.length, selected: sourceRows.length, storesRead: stores.length, datesRead: dates.length, placeholderRows, pageTruncations, capped, toolRunIds });
    } else {
      const request = buildMcpArguments(input.dataDomain, input.scope);
      const execution = await invokeEmperorTool({ toolSlug: "internal.lingxing.read", params: request, userId: ctx.user.id, userRole: ctx.user.role, workspaceId, runId, nodeId: "read_external_data" });
      toolRunId = execution.metadata.toolRunId;
      rawSnapshot = normalizeMcpPayload(execution.output);
      sourceRows = pickRecords(rawSnapshot).slice(0, 500);
      Object.assign(summary, { totalRead: sourceRows.length, selected: sourceRows.length });
    }
    const rawResponseHash = createHash("sha256").update(JSON.stringify(rawSnapshot)).digest("hex");
    const externalizeRawSnapshot = shouldExternalizeSyncRawSnapshot(rawSnapshot);
    const compactRawSnapshot = externalizeRawSnapshot
      ? { source: "lingxing_mcp", dataDomain: input.dataDomain, externalized: true, rawResponseHash, stores: object(rawSnapshot).stores || [], dates: object(rawSnapshot).dates || [], rowCount: sourceRows.length, toolRunIds: object(rawSnapshot).toolRunIds || [] }
      : rawSnapshot;
    Object.assign(summary, { rawResponseExternalized: externalizeRawSnapshot });
    const [created] = await db.insert(opsExternalSyncBatches).values({ workspaceId, userId: ctx.user.id, source: "lingxing_mcp", dataDomain: input.dataDomain, status: previewBatchStatusFor(sourceRows.length), scope: input.scope, toolRunId, traceId: runId, rawResponseHash, rawSnapshot: compactRawSnapshot as any, summary }).$returningId();
    const batchId = created.id;
    if (externalizeRawSnapshot) {
      const artifact = await registerUnifiedArtifact({
        workspaceId,
        domain: "ops",
        artifactKey: "ops.lingxing_sync.raw_response",
        artifactType: "json",
        sourceType: "tool_output",
        sourceTable: "ops_external_sync_batches",
        sourceRowId: batchId,
        runId,
        userId: ctx.user.id,
        status: "draft",
        content: rawSnapshot,
        metadata: { batchId, dataDomain: input.dataDomain, rawResponseHash, toolRunId, traceId: runId, externalized: true },
        failOnError: true,
      });
      await db.update(opsExternalSyncBatches).set({ rawSnapshot: { ...object(compactRawSnapshot), rawArtifactRef: artifact?.ref || null, rawArtifactUri: artifact?.storageUri || null } as any }).where(eq(opsExternalSyncBatches.id, batchId));
    }
    const stagedRows = sourceRows.map((source) => ({ source, normalized: normalizeRow(input.dataDomain, source, input.scope) }));
    const periodStart = input.scope.startDate || todayIso();
    const periodEnd = input.scope.endDate || periodStart;
    const parentAsins = [...new Set(stagedRows.map((item) => asText(item.normalized.normalized.parentAsin || item.normalized.normalized.asin)).filter(Boolean))];
    const childAsins = [...new Set(stagedRows.map((item) => asText(item.normalized.normalized.asin)).filter(Boolean))];
    const existingProductRows = ["product_performance", "order_profit"].includes(input.dataDomain) && parentAsins.length
      ? await db.select().from(lingxingProductWeekly).where(and(eq(lingxingProductWeekly.workspaceId, workspaceId), eq(lingxingProductWeekly.weekStartDate, periodStart), inArray(lingxingProductWeekly.parentAsin, parentAsins)))
      : [];
    const existingInventoryRows = ["fba_inventory", "product_performance_daily"].includes(input.dataDomain) && childAsins.length
      ? await db.select().from(opsAsinDailySnapshots).where(and(eq(opsAsinDailySnapshots.workspaceId, workspaceId), inArray(opsAsinDailySnapshots.asin, childAsins)))
      : [];
    const existingCampaignRows = input.dataDomain === "ad_campaign"
      ? await db.select().from(adCampaignReports).where(and(eq(adCampaignReports.workspaceId, workspaceId), eq(adCampaignReports.weekStartDate, periodStart), eq(adCampaignReports.weekEndDate, periodEnd)))
      : [];
    const existingKeywordRows = input.dataDomain === "ad_keyword"
      ? await db.select().from(adKeywordWeekly).where(and(eq(adKeywordWeekly.workspaceId, workspaceId), eq(adKeywordWeekly.weekStartDate, periodStart), eq(adKeywordWeekly.weekEndDate, periodEnd)))
      : [];
    const productByParentAsin = new Map(existingProductRows.map((row) => [asText(row.parentAsin), row]));
    const inventoryByAsin = new Map(existingInventoryRows.map((row) => [asText(row.asin), row]));
    const inventoryByAsinDate = new Map(existingInventoryRows.map((row) => [dailySnapshotIdentityKey({ sourceStoreId: row.sourceStoreId, country: row.country, asin: row.asin, reportDate: row.reportDate }), row]));
    const campaignByKey = new Map(existingCampaignRows.map((row) => [`${asText(row.campaignName)}|${asText(row.storeName)}`, row]));
    const keywordByKey = new Map(existingKeywordRows.map((row) => [`${asText(row.campaignName)}|${asText(row.keyword)}|${asText(row.matchType)}`, row]));
    const rows = stagedRows.map(({ source, normalized }) => {
      const output = { ...normalized.normalized };
      const errors = [...normalized.validationErrors];
      let current: RecordValue = {};
      let targetReference: RecordValue | null = null;
      let matchInfo: RecordValue | null = null;
      if (["product_performance", "order_profit"].includes(input.dataDomain)) {
        const target = productByParentAsin.get(asText(output.parentAsin || output.asin));
        if (target) {
          current = target as unknown as RecordValue;
          targetReference = { table: "lingxing_product_weekly", id: target.id, parentAsin: target.parentAsin, weekStartDate: target.weekStartDate };
          matchInfo = { strategy: "workspace_parent_asin_period", confidence: "high" };
        }
      }
      if (input.dataDomain === "fba_inventory") {
        const target = inventoryByAsin.get(asText(output.asin));
        if (target) {
          if (!asText(output.parentAsin) && target.parentAsin) {
            output.parentAsin = target.parentAsin;
            const errorIndex = errors.findIndex((error) => error.includes("父ASIN映射"));
            if (errorIndex >= 0) errors.splice(errorIndex, 1);
          }
          current = target as unknown as RecordValue;
          targetReference = { table: "ops_asin_daily_snapshots", id: target.id, asin: target.asin, reportDate: target.reportDate };
          matchInfo = { strategy: "workspace_child_asin_latest_snapshot", confidence: "high", parentAsinResolved: Boolean(target.parentAsin) };
        }
      }
      if (input.dataDomain === "product_performance_daily") {
        const target = inventoryByAsinDate.get(dailySnapshotIdentityKey({ sourceStoreId: output.storeId, country: output.country, asin: output.asin, reportDate: output.reportDate }));
        if (target) {
          current = target as unknown as RecordValue;
          targetReference = { table: "ops_asin_daily_snapshots", id: target.id, asin: target.asin, reportDate: target.reportDate };
          matchInfo = { strategy: "workspace_child_asin_report_date", confidence: "high", sourcePriority: "lingxing_mcp" };
        }
      }
      if (input.dataDomain === "ad_campaign") {
        const target = campaignByKey.get(`${asText(output.campaignName)}|${asText(output.storeName)}`);
        if (target) {
          current = target as unknown as RecordValue;
          targetReference = { table: "ad_campaign_reports", id: target.id, campaignName: target.campaignName, weekStartDate: target.weekStartDate };
          matchInfo = { strategy: "workspace_campaign_period", confidence: "high" };
        }
      }
      if (input.dataDomain === "ad_keyword") {
        const target = keywordByKey.get(`${asText(output.campaignName)}|${asText(output.keyword)}|${asText(output.matchType)}`);
        if (target) {
          current = target as unknown as RecordValue;
          targetReference = { table: "ad_keyword_weekly", id: target.id, campaignName: target.campaignName, keyword: target.keyword, weekStartDate: target.weekStartDate };
          matchInfo = { strategy: "workspace_campaign_keyword_period", confidence: "high" };
        }
      }
      const comparedFields = input.dataDomain === "product_performance_daily"
        ? ["salesQty", "orderQty", "salesAmount", "orderProfit", "adSpend", "adSales", "adOrders", "sessionsTotal", "adClicks", "adImpressions", "returnQty"]
        : input.dataDomain === "fba_inventory"
        ? ["fbaAvailable", "fbaInTransit", "fbaReserved", "sku", "productName"]
        : input.dataDomain === "ad_campaign"
          ? ["adImpressions", "adClicks", "adSpend", "adSales", "campaignName"]
          : input.dataDomain === "ad_keyword"
            ? ["adImpressions", "adClicks", "adSpend", "adSales", "keyword", "matchType"]
        : ["salesQty", "salesAmount", "orderProfit", "adSpend", "sku", "productName"];
      const currentComparable: RecordValue = input.dataDomain === "product_performance_daily"
        ? { salesQty: current.salesQty, orderQty: current.orderQty, salesAmount: current.salesAmount, orderProfit: current.orderProfit, adSpend: current.adSpend, adSales: current.adSales, adOrders: current.adOrders, sessionsTotal: current.sessionsTotal, adClicks: current.adClicks, adImpressions: current.adImpressions, returnQty: current.returnQty }
        : input.dataDomain === "fba_inventory"
        ? { fbaAvailable: current.fbaAvailable, fbaInTransit: current.fbaInTransit, fbaReserved: current.fbaReserved, sku: current.sku, productName: current.productName }
        : input.dataDomain === "ad_campaign" || input.dataDomain === "ad_keyword"
          ? { adImpressions: current.impressions, adClicks: current.clicks, adSpend: current.spend, adSales: current.sales, campaignName: current.campaignName, keyword: current.keyword, matchType: current.matchType }
        : { salesQty: current.salesQty, salesAmount: current.salesAmount, orderProfit: current.orderProfit, adSpend: current.adSpend, sku: current.sku, productName: current.productName };
      const fieldDiffs = targetReference ? calculateFieldDiffs(currentComparable, output, comparedFields) : [];
      const rowStatus = errors.length ? "needs_review" : !targetReference ? "new" : fieldDiffs.length ? "changed" : "unchanged";
      if (rowStatus === "needs_review") summary.needsReview += 1;
      return { workspaceId, batchId, entityKey: normalized.entityKey, rowStatus, selected: ["new", "changed"].includes(rowStatus) ? 1 : 0, sourceData: source as any, normalizedData: output as any, fieldDiffs: fieldDiffs as any, matchInfo: matchInfo as any, targetReference: targetReference as any, validationErrors: errors as any };
    });
    for (let offset = 0; offset < rows.length; offset += 250) {
      await db.insert(opsExternalSyncRows).values(rows.slice(offset, offset + 250) as any);
    }
    await db.update(opsExternalSyncBatches).set({ summary }).where(eq(opsExternalSyncBatches.id, batchId));
    return { batchId, totalRows: rows.length, toolRunId, traceId: runId };
  }),

  updateRows: protectedProcedure.input(z.object({ batchId: z.number().int().positive(), rows: z.array(z.object({ id: z.number().int().positive(), selected: z.boolean(), normalizedData: z.record(z.unknown()).optional(), rowStatus: z.enum(["new", "changed", "unchanged", "unmatched", "needs_review", "skipped"]).optional() })).min(1).max(5000) })).mutation(async ({ ctx, input }) => {
    const db = await getDb();
    if (!db) throw new Error("数据库不可用");
    const workspaceId = ctx.user.defaultWorkspaceId!;
    const rowIds = input.rows.map((row) => row.id);
    const existing = await db.select().from(opsExternalSyncRows).where(and(eq(opsExternalSyncRows.workspaceId, workspaceId), eq(opsExternalSyncRows.batchId, input.batchId), inArray(opsExternalSyncRows.id, rowIds)));
    if (existing.length !== input.rows.length) throw new Error("存在不可编辑的同步草稿行");
    for (const patch of input.rows) {
      await db.update(opsExternalSyncRows).set({ selected: patch.selected ? 1 : 0, normalizedData: patch.normalizedData as any, rowStatus: patch.rowStatus }).where(and(eq(opsExternalSyncRows.id, patch.id), eq(opsExternalSyncRows.workspaceId, workspaceId)));
    }
    return { success: true };
  }),

  confirm: protectedProcedure.input(z.object({ batchId: z.number().int().positive(), selectedRowIds: z.array(z.number().int().positive()).max(5000), note: z.string().max(1000).optional() })).mutation(async ({ ctx, input }) => {
    const db = await getDb();
    if (!db) throw new Error("数据库不可用");
    const workspaceId = ctx.user.defaultWorkspaceId!;
    const [batch] = await db.select().from(opsExternalSyncBatches).where(and(eq(opsExternalSyncBatches.id, input.batchId), eq(opsExternalSyncBatches.workspaceId, workspaceId))).limit(1);
    if (!batch || batch.status !== "ready_for_review") throw new Error("该同步批次不在可确认状态");
    await db.insert(opsExternalSyncConfirmations).values({ workspaceId, batchId: input.batchId, userId: ctx.user.id, action: "confirm", selectedRowIds: input.selectedRowIds, note: input.note || null });
    await db.update(opsExternalSyncRows).set({ selected: 0, rowStatus: "skipped" }).where(and(eq(opsExternalSyncRows.workspaceId, workspaceId), eq(opsExternalSyncRows.batchId, input.batchId)));
    if (input.selectedRowIds.length) await db.update(opsExternalSyncRows).set({ selected: 1 }).where(and(eq(opsExternalSyncRows.workspaceId, workspaceId), eq(opsExternalSyncRows.batchId, input.batchId), inArray(opsExternalSyncRows.id, input.selectedRowIds)));
    await db.update(opsExternalSyncBatches).set({ status: "confirmed", reviewedAt: new Date(), reviewedBy: ctx.user.id }).where(eq(opsExternalSyncBatches.id, input.batchId));
    return { success: true, nextStep: "待应用到业务数据链路" };
  }),

  applyConfirmedProductInventory: protectedProcedure.input(z.object({ batchId: z.number().int().positive(), note: z.string().max(1000).optional() })).mutation(async ({ ctx, input }) => {
    const db = await getDb();
    if (!db) throw new Error("数据库不可用");
    const workspaceId = ctx.user.defaultWorkspaceId!;
    const [batch] = await db.select().from(opsExternalSyncBatches).where(and(eq(opsExternalSyncBatches.id, input.batchId), eq(opsExternalSyncBatches.workspaceId, workspaceId))).limit(1);
    if (!batch || batch.status !== "confirmed") throw new Error("请先完成人工确认；已应用或不在确认状态的批次不能重复写入。");
    if (!["product_performance", "product_performance_daily", "order_profit", "fba_inventory"].includes(batch.dataDomain)) throw new Error("当前应用入口仅支持产品表现、ASIN日产品表现、订单利润和FBA库存草稿。");
    const selectedRows = await db.select().from(opsExternalSyncRows).where(and(eq(opsExternalSyncRows.batchId, input.batchId), eq(opsExternalSyncRows.workspaceId, workspaceId), eq(opsExternalSyncRows.selected, 1)));
    if (!selectedRows.length) throw new Error("没有已选择的草稿行可应用。");
    const scope = object(batch.scope);
    const periodStart = asText(scope.startDate, todayIso());
    const periodEnd = asText(scope.endDate, periodStart);
    const [importRecord] = await db.insert(dataImports).values({
      workspaceId, userId: ctx.user.id, sourceType: "lingxing", fileName: `领星MCP-${batch.dataDomain}-批次${batch.id}`,
      weekStartDate: periodStart, weekEndDate: periodEnd, dataGranularity: ["fba_inventory", "product_performance_daily"].includes(batch.dataDomain) ? "daily" : "weekly",
      totalRows: selectedRows.length, importedRows: 0, skippedRows: 0, status: "importing",
    }).$returningId();
    const importId = importRecord.id;
    let importedRows = 0;
    let skippedRows = 0;
    for (const row of selectedRows) {
      const data = object(row.normalizedData);
      const source = object(row.sourceData);
      if (["product_performance", "order_profit"].includes(batch.dataDomain)) {
        const parentAsin = asText(data.parentAsin || data.asin);
        if (!parentAsin) { skippedRows += 1; continue; }
        await db.insert(lingxingProductWeekly).values({
          workspaceId, importId, userId: ctx.user.id, weekStartDate: periodStart, weekEndDate: periodEnd,
          asin: asText(data.asin), parentAsin, msku: asText(data.sku), sku: asText(data.sku),
          storeName: asText(data.storeId, `SID ${asText(scope.storeId)}`), country: asText(scope.marketplace, "US"),
          title: asText(data.productName), productName: asText(data.productName), salesQty: asNumber(data.salesQty),
          salesAmount: String(asNumber(data.salesAmount)), orderProfit: String(asNumber(data.orderProfit)), adSpend: String(asNumber(data.adSpend)),
        });
        importedRows += 1;
      } else {
        const asin = asText(data.asin);
        const parentAsin = asText(data.parentAsin);
        if (!asin || !parentAsin) { skippedRows += 1; continue; }
        const isDailyPerformance = batch.dataDomain === "product_performance_daily";
        const reportDate = isDailyPerformance ? asText(data.reportDate) : periodEnd;
        if (isDailyPerformance && !isValidDailySnapshotForApply({ ...data, reportDate })) { skippedRows += 1; continue; }
        const fbaAvailable = asNumber(data.fbaAvailable);
        const fbaInTransit = asNumber(data.fbaInTransit);
        const fbaReserved = asNumber(data.fbaReserved);
        const fbaTotal = fbaAvailable + fbaInTransit + fbaReserved;
        await db.insert(opsAsinDailySnapshots).values({
          workspaceId, importId, userId: ctx.user.id, sourceType: "lingxing_mcp", reportDate,
          sourceStoreId: asText(data.storeId), sourceBatchHash: asText(batch.rawResponseHash),
          asin, parentAsin, storeName: asText(data.storeName, `SID ${asText(data.storeId || scope.storeId)}`), country: asText(data.country, "US"),
          msku: asText(data.sku), sku: asText(data.sku), title: asText(data.productName), productName: asText(data.productName),
          salesQty: asNumber(data.salesQty), orderQty: asNumber(data.orderQty), salesAmount: String(asNumber(data.salesAmount)), netSalesAmount: String(asNumber(data.netSalesAmount)), orderProfit: String(asNumber(data.orderProfit)), adSpend: String(asNumber(data.adSpend)), adSales: String(asNumber(data.adSales)), adOrders: asNumber(data.adOrders), organicOrders: asNumber(data.organicOrders), sessionsTotal: asNumber(data.sessionsTotal), adClicks: asNumber(data.adClicks), adImpressions: asNumber(data.adImpressions), returnQty: asNumber(data.returnQty),
          fbaAvailable, fbaInTransit, fbaPlanInbound: 0, fbaTotal, availableStock: fbaAvailable,
          sourceRowHash: createHash("sha256").update(JSON.stringify(source)).digest("hex"), isValid: 1,
        });
        importedRows += 1;
      }
      await db.update(opsExternalSyncRows).set({ rowStatus: "applied", appliedAt: new Date() }).where(eq(opsExternalSyncRows.id, row.id));
    }
    await db.update(dataImports).set({ importedRows, skippedRows, status: "completed" }).where(eq(dataImports.id, importId));
    await db.insert(opsExternalSyncConfirmations).values({ workspaceId, batchId: input.batchId, userId: ctx.user.id, action: "apply", selectedRowIds: selectedRows.map((row) => row.id), note: input.note || null });
    await db.update(opsExternalSyncBatches).set({ status: "applied", appliedAt: new Date(), appliedBy: ctx.user.id, summary: { ...object(batch.summary), appliedRows: importedRows, skippedRows } }).where(eq(opsExternalSyncBatches.id, input.batchId));
    return { success: true, importId, importedRows, skippedRows };
  }),

  applyConfirmedAds: protectedProcedure.input(z.object({ batchId: z.number().int().positive(), note: z.string().max(1000).optional() })).mutation(async ({ ctx, input }) => {
    const db = await getDb();
    if (!db) throw new Error("数据库不可用");
    const workspaceId = ctx.user.defaultWorkspaceId!;
    const [batch] = await db.select().from(opsExternalSyncBatches).where(and(eq(opsExternalSyncBatches.id, input.batchId), eq(opsExternalSyncBatches.workspaceId, workspaceId))).limit(1);
    if (!batch || batch.status !== "confirmed") throw new Error("请先完成人工确认；已应用或不在确认状态的批次不能重复写入。");
    if (!["ad_campaign", "ad_keyword"].includes(batch.dataDomain)) throw new Error("当前广告应用入口仅支持广告活动和关键词报表草稿。");
    const selectedRows = await db.select().from(opsExternalSyncRows).where(and(eq(opsExternalSyncRows.batchId, input.batchId), eq(opsExternalSyncRows.workspaceId, workspaceId), eq(opsExternalSyncRows.selected, 1)));
    if (!selectedRows.length) throw new Error("没有已选择的草稿行可应用。");
    const scope = object(batch.scope);
    const periodStart = asText(scope.startDate, todayIso());
    const periodEnd = asText(scope.endDate, periodStart);
    const [importRecord] = await db.insert(adReportImports).values({ workspaceId, userId: ctx.user.id, fileName: `领星MCP-${batch.dataDomain}-批次${batch.id}`, weekStartDate: periodStart, weekEndDate: periodEnd, totalRows: selectedRows.length, keywordRows: batch.dataDomain === "ad_keyword" ? selectedRows.length : 0, mappedRows: 0, status: "importing" }).$returningId();
    let importedRows = 0;
    let skippedRows = 0;
    for (const row of selectedRows) {
      const data = object(row.normalizedData);
      const adType = asText(data.adType, "SP");
      const storeName = asText(data.storeName, `SID ${asText(scope.storeId)}`);
      if (batch.dataDomain === "ad_campaign") {
        const campaignName = asText(data.campaignName);
        if (!campaignName) { skippedRows += 1; continue; }
        await db.insert(adCampaignReports).values({
          workspaceId, uploadId: importRecord.id, userId: ctx.user.id, weekStartDate: periodStart, weekEndDate: periodEnd,
          storeName, country: asText(data.country, "US"), adType, portfolioName: asText(data.portfolioName), campaignName,
          effectiveStatus: asText(data.effectiveStatus), impressions: asNumber(data.adImpressions), clicks: asNumber(data.adClicks),
          spend: String(asNumber(data.adSpend)), sales: String(asNumber(data.adSales)), orders: asNumber(data.adOrders),
          acos: String(asNumber(data.acos)), roas: String(asNumber(data.roas)),
        });
      } else {
        const campaignName = asText(data.campaignName);
        const keyword = asText(data.keyword);
        if (!campaignName || !keyword) { skippedRows += 1; continue; }
        await db.insert(adKeywordWeekly).values({
          workspaceId, importId: importRecord.id, userId: ctx.user.id, weekStartDate: periodStart, weekEndDate: periodEnd,
          storeName, country: asText(data.country, "US"), adType, portfolioName: asText(data.portfolioName), campaignName,
          keyword, matchType: asText(data.matchType, "unknown"), targetingType: "keyword", status: asText(data.effectiveStatus),
          impressions: asNumber(data.adImpressions), clicks: asNumber(data.adClicks), spend: String(asNumber(data.adSpend)), sales: String(asNumber(data.adSales)),
          orders: asNumber(data.adOrders), acos: String(asNumber(data.acos)), roas: String(asNumber(data.roas)),
        });
      }
      importedRows += 1;
      await db.update(opsExternalSyncRows).set({ rowStatus: "applied", appliedAt: new Date() }).where(eq(opsExternalSyncRows.id, row.id));
    }
    await db.update(adReportImports).set({ status: "completed", mappedRows: importedRows, keywordRows: batch.dataDomain === "ad_keyword" ? importedRows : 0 }).where(eq(adReportImports.id, importRecord.id));
    await db.insert(opsExternalSyncConfirmations).values({ workspaceId, batchId: input.batchId, userId: ctx.user.id, action: "apply", selectedRowIds: selectedRows.map((row) => row.id), note: input.note || null });
    await db.update(opsExternalSyncBatches).set({ status: "applied", appliedAt: new Date(), appliedBy: ctx.user.id, summary: { ...object(batch.summary), appliedRows: importedRows, skippedRows } }).where(eq(opsExternalSyncBatches.id, input.batchId));
    return { success: true, importId: importRecord.id, importedRows, skippedRows };
  }),
});
