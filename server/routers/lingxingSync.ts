import { createHash } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { adCampaignReports, adKeywordWeekly, adReportImports, dataImports, lingxingProductWeekly, opsAsinDailySnapshots, opsExternalSyncBatches, opsExternalSyncConfirmations, opsExternalSyncRows } from "../../drizzle/schema";
import { router } from "../_core/trpc";
import { protectedProcedure } from "../domains/ops/workspaceProcedure";
import { ensureAgentRunTrace } from "../domains/ai_os/services/runLedger";
import { invokeEmperorTool } from "../domains/ai_os/services/toolGateway/executors";
import { getDb } from "../repositories/dbClient";

const domainSchema = z.enum(["product_performance", "fba_inventory", "ad_campaign", "ad_keyword"]);
const scopeSchema = z.object({
  storeId: z.string().trim().min(1),
  profileId: z.string().trim().optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  marketplace: z.string().trim().optional(),
});

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
function todayIso() { return new Date().toISOString().slice(0, 10); }
export function previewBatchStatusFor(sourceRowCount: number) { return sourceRowCount > 0 ? "ready_for_review" : "empty"; }

export function normalizeRow(domain: z.infer<typeof domainSchema>, source: RecordValue, scope: z.infer<typeof scopeSchema>) {
  const asin = value(source, ["asin", "child_asin", "childAsin", "子ASIN"]);
  const parentAsin = value(source, ["parent_asin_real", "parent_asin", "parentAsin", "p_asin", "父ASIN"]);
  const sku = value(source, ["sku", "local_sku", "seller_sku", "msku", "sellerSku", "SKU"]);
  const normalized: RecordValue = {
    sourceDomain: domain,
    storeId: scope.storeId,
    profileId: scope.profileId || null,
    periodStart: scope.startDate || null,
    periodEnd: scope.endDate || null,
    asin: asin ? String(asin) : null,
    parentAsin: parentAsin ? String(parentAsin) : null,
    sku: sku ? String(sku) : null,
    productName: value(source, ["local_name", "product_name", "item_name", "title", "name", "品名", "产品名称"]),
    storeName: value(source, ["shop_name", "store_name", "storeName", "seller_name"]) || `SID ${scope.storeId}`,
    country: value(source, ["country", "site", "marketplace"]) || scope.marketplace || "US",
    salesQty: value(source, ["volume", "sales_qty", "salesQty", "units", "quantity", "销量"]),
    salesAmount: value(source, ["sales_amount", "sales", "salesAmount", "revenue", "销售额"]),
    orderProfit: value(source, ["profit", "order_profit", "orderProfit", "订单利润"]),
    adSpend: value(source, ["ad_spend", "spend", "spends", "cost", "广告花费"]),
    campaignName: value(source, ["campaign_name", "campaignName", "campaign", "name", "广告活动", "广告活动名称"]),
    campaignId: value(source, ["campaign_id", "campaignId"]),
    portfolioName: value(source, ["portfolio_name", "portfolioName", "广告组合"]),
    adType: value(source, ["ad_type", "adType", "ads_type", "sponsored_type", "广告类型"]),
    keyword: value(source, ["keyword", "关键词", "targeting", "targeting_value"]),
    matchType: value(source, ["match_type", "matchType", "匹配方式"]),
    adImpressions: value(source, ["impressions", "曝光量"]),
    adClicks: value(source, ["clicks", "点击量"]),
    adSales: value(source, ["ad_sales", "sales", "广告销售额"]),
    fbaAvailable: value(source, ["afn_fulfillable_quantity", "fulfillable_qty", "available", "fba_available", "可售库存"]),
    fbaReserved: value(source, ["afn_reserved_quantity", "reserved_qty", "reserved", "fba_reserved", "预留库存"]),
    fbaInTransit: sumValues(source, ["afn_inbound_receiving_quantity", "afn_inbound_shipped_quantity", "afn_inbound_working_quantity"]) ?? value(source, ["inbound_qty", "in_transit", "fba_in_transit", "在途库存"]),
    rawFieldNames: Object.keys(source).sort(),
  };
  const entityKey = [scope.storeId, domain, normalized.parentAsin || normalized.asin || "unmatched", normalized.sku || "", scope.startDate || "latest", scope.endDate || ""].join("|");
  const validationErrors: string[] = [];
  if (domain === "product_performance" && !normalized.asin && !normalized.parentAsin) validationErrors.push("未识别ASIN或父ASIN，不能确认写入产品总览。");
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
    const request = buildMcpArguments(input.dataDomain, input.scope);
    const execution = await invokeEmperorTool({ toolSlug: "internal.lingxing.read", params: request, userId: ctx.user.id, userRole: ctx.user.role, workspaceId, runId, nodeId: "read_external_data" });
    const rawSnapshot = normalizeMcpPayload(execution.output);
    const sourceRows = pickRecords(rawSnapshot).slice(0, 500);
    const summary = { totalRead: sourceRows.length, selected: sourceRows.length, needsReview: 0, unmatched: 0 };
    const [created] = await db.insert(opsExternalSyncBatches).values({ workspaceId, userId: ctx.user.id, source: "lingxing_mcp", dataDomain: input.dataDomain, status: previewBatchStatusFor(sourceRows.length), scope: input.scope, toolRunId: execution.metadata.toolRunId, traceId: runId, rawResponseHash: createHash("sha256").update(JSON.stringify(rawSnapshot)).digest("hex"), rawSnapshot: rawSnapshot as any, summary }).$returningId();
    const batchId = created.id;
    const stagedRows = sourceRows.map((source) => ({ source, normalized: normalizeRow(input.dataDomain, source, input.scope) }));
    const periodStart = input.scope.startDate || todayIso();
    const periodEnd = input.scope.endDate || periodStart;
    const parentAsins = [...new Set(stagedRows.map((item) => asText(item.normalized.normalized.parentAsin || item.normalized.normalized.asin)).filter(Boolean))];
    const childAsins = [...new Set(stagedRows.map((item) => asText(item.normalized.normalized.asin)).filter(Boolean))];
    const existingProductRows = input.dataDomain === "product_performance" && parentAsins.length
      ? await db.select().from(lingxingProductWeekly).where(and(eq(lingxingProductWeekly.workspaceId, workspaceId), eq(lingxingProductWeekly.weekStartDate, periodStart), inArray(lingxingProductWeekly.parentAsin, parentAsins)))
      : [];
    const existingInventoryRows = input.dataDomain === "fba_inventory" && childAsins.length
      ? await db.select().from(opsAsinDailySnapshots).where(and(eq(opsAsinDailySnapshots.workspaceId, workspaceId), eq(opsAsinDailySnapshots.reportDate, periodEnd), inArray(opsAsinDailySnapshots.asin, childAsins)))
      : [];
    const existingCampaignRows = input.dataDomain === "ad_campaign"
      ? await db.select().from(adCampaignReports).where(and(eq(adCampaignReports.workspaceId, workspaceId), eq(adCampaignReports.weekStartDate, periodStart), eq(adCampaignReports.weekEndDate, periodEnd)))
      : [];
    const existingKeywordRows = input.dataDomain === "ad_keyword"
      ? await db.select().from(adKeywordWeekly).where(and(eq(adKeywordWeekly.workspaceId, workspaceId), eq(adKeywordWeekly.weekStartDate, periodStart), eq(adKeywordWeekly.weekEndDate, periodEnd)))
      : [];
    const productByParentAsin = new Map(existingProductRows.map((row) => [asText(row.parentAsin), row]));
    const inventoryByAsin = new Map(existingInventoryRows.map((row) => [asText(row.asin), row]));
    const campaignByKey = new Map(existingCampaignRows.map((row) => [`${asText(row.campaignName)}|${asText(row.storeName)}`, row]));
    const keywordByKey = new Map(existingKeywordRows.map((row) => [`${asText(row.campaignName)}|${asText(row.keyword)}|${asText(row.matchType)}`, row]));
    const rows = stagedRows.map(({ source, normalized }) => {
      const output = { ...normalized.normalized };
      const errors = [...normalized.validationErrors];
      let current: RecordValue = {};
      let targetReference: RecordValue | null = null;
      let matchInfo: RecordValue | null = null;
      if (input.dataDomain === "product_performance") {
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
      const comparedFields = input.dataDomain === "fba_inventory"
        ? ["fbaAvailable", "fbaInTransit", "fbaReserved", "sku", "productName"]
        : input.dataDomain === "ad_campaign"
          ? ["adImpressions", "adClicks", "adSpend", "adSales", "campaignName"]
          : input.dataDomain === "ad_keyword"
            ? ["adImpressions", "adClicks", "adSpend", "adSales", "keyword", "matchType"]
        : ["salesQty", "salesAmount", "orderProfit", "adSpend", "sku", "productName"];
      const currentComparable: RecordValue = input.dataDomain === "fba_inventory"
        ? { fbaAvailable: current.fbaAvailable, fbaInTransit: current.fbaInTransit, fbaReserved: current.fbaReserved, sku: current.sku, productName: current.productName }
        : input.dataDomain === "ad_campaign" || input.dataDomain === "ad_keyword"
          ? { adImpressions: current.impressions, adClicks: current.clicks, adSpend: current.spend, adSales: current.sales, campaignName: current.campaignName, keyword: current.keyword, matchType: current.matchType }
        : { salesQty: current.salesQty, salesAmount: current.salesAmount, orderProfit: current.orderProfit, adSpend: current.adSpend, sku: current.sku, productName: current.productName };
      const fieldDiffs = targetReference ? calculateFieldDiffs(currentComparable, output, comparedFields) : [];
      const rowStatus = errors.length ? "needs_review" : !targetReference ? "new" : fieldDiffs.length ? "changed" : "unchanged";
      if (rowStatus === "needs_review") summary.needsReview += 1;
      return { workspaceId, batchId, entityKey: normalized.entityKey, rowStatus, selected: ["new", "changed"].includes(rowStatus) ? 1 : 0, sourceData: source as any, normalizedData: output as any, fieldDiffs: fieldDiffs as any, matchInfo: matchInfo as any, targetReference: targetReference as any, validationErrors: errors as any };
    });
    if (rows.length) await db.insert(opsExternalSyncRows).values(rows as any);
    await db.update(opsExternalSyncBatches).set({ summary }).where(eq(opsExternalSyncBatches.id, batchId));
    return { batchId, totalRows: rows.length, toolRunId: execution.metadata.toolRunId, traceId: runId };
  }),

  updateRows: protectedProcedure.input(z.object({ batchId: z.number().int().positive(), rows: z.array(z.object({ id: z.number().int().positive(), selected: z.boolean(), normalizedData: z.record(z.unknown()).optional(), rowStatus: z.enum(["new", "changed", "unchanged", "unmatched", "needs_review", "skipped"]).optional() })).min(1).max(500) })).mutation(async ({ ctx, input }) => {
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

  confirm: protectedProcedure.input(z.object({ batchId: z.number().int().positive(), selectedRowIds: z.array(z.number().int().positive()).max(500), note: z.string().max(1000).optional() })).mutation(async ({ ctx, input }) => {
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
    if (!["product_performance", "fba_inventory"].includes(batch.dataDomain)) throw new Error("当前应用入口仅支持产品表现和FBA库存草稿。");
    const selectedRows = await db.select().from(opsExternalSyncRows).where(and(eq(opsExternalSyncRows.batchId, input.batchId), eq(opsExternalSyncRows.workspaceId, workspaceId), eq(opsExternalSyncRows.selected, 1)));
    if (!selectedRows.length) throw new Error("没有已选择的草稿行可应用。");
    const scope = object(batch.scope);
    const periodStart = asText(scope.startDate, todayIso());
    const periodEnd = asText(scope.endDate, periodStart);
    const [importRecord] = await db.insert(dataImports).values({
      workspaceId, userId: ctx.user.id, sourceType: "lingxing", fileName: `领星MCP-${batch.dataDomain}-批次${batch.id}`,
      weekStartDate: periodStart, weekEndDate: periodEnd, dataGranularity: batch.dataDomain === "fba_inventory" ? "daily" : "weekly",
      totalRows: selectedRows.length, importedRows: 0, skippedRows: 0, status: "importing",
    }).$returningId();
    const importId = importRecord.id;
    let importedRows = 0;
    let skippedRows = 0;
    for (const row of selectedRows) {
      const data = object(row.normalizedData);
      const source = object(row.sourceData);
      if (batch.dataDomain === "product_performance") {
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
        const fbaAvailable = asNumber(data.fbaAvailable);
        const fbaInTransit = asNumber(data.fbaInTransit);
        const fbaReserved = asNumber(data.fbaReserved);
        await db.insert(opsAsinDailySnapshots).values({
          workspaceId, importId, userId: ctx.user.id, sourceType: "lingxing_mcp", reportDate: periodEnd,
          asin, parentAsin, storeName: asText(data.storeId, `SID ${asText(scope.storeId)}`), country: asText(scope.marketplace, "US"),
          msku: asText(data.sku), sku: asText(data.sku), title: asText(data.productName), productName: asText(data.productName),
          salesQty: asNumber(data.salesQty), salesAmount: String(asNumber(data.salesAmount)), orderProfit: String(asNumber(data.orderProfit)), adSpend: String(asNumber(data.adSpend)),
          fbaAvailable, fbaInTransit, fbaPlanInbound: 0, fbaTotal: fbaAvailable + fbaInTransit + fbaReserved, availableStock: fbaAvailable,
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
