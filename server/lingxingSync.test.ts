import { describe, expect, it } from "vitest";
import { buildMcpArguments, calculateFieldDiffs, coalesceFbaInventoryPreviewRows, dailyReadCoverageSummary, dailySnapshotIdentityKey, hasSelectedPeriodActivity, isValidDailySnapshotForApply, keywordSnapshotIdentityHash, normalizeDailyPreviewPage, normalizeLingxingStoreDirectoryRecord, normalizeMcpPayload, normalizeRow, pickRecords, shouldExternalizeSyncRawSnapshot } from "./routers/lingxingSync";

describe("领星运营同步预览契约", () => {
  it("产品表现使用官方sids范围且保留人工选择的周期", () => {
    const request = buildMcpArguments("product_performance", { storeId: "123", startDate: "2026-08-01", endDate: "2026-08-07" });
    expect(request.capability).toBe("query_product_performance_asin_lists");
    expect(request.arguments.sids).toBe("123");
    expect(request.arguments.start_date).toBe("2026-08-01");
    expect(request.arguments.end_date).toBe("2026-08-07");
  });

  it("ASIN日产品表现固定使用日粒度、ASIN汇总与订单利润读取", () => {
    const request = buildMcpArguments("product_performance_daily", { storeId: "7392", startDate: "2026-08-10", endDate: "2026-08-10" });
    expect(request.capability).toBe("query_product_performance_asin_lists");
    expect(request.arguments).toMatchObject({ sids: "7392", date_view_type: "day", summary_field: "asin", query_order_profit: true });
  });

  it("广告报表使用profile_ids范围，不借用产品店铺参数", () => {
    const request = buildMcpArguments("ad_campaign", { storeId: "sid-1", profileId: "profile-9", startDate: "2026-08-01", endDate: "2026-08-07" });
    expect(request.capability).toBe("ad_campaign_report");
    expect(request.arguments.profile_ids).toEqual(["profile-9"]);
    expect(request.arguments).not.toHaveProperty("sids");
  });

  it("解析MCP content文本包装并仅提取业务记录行", () => {
    const payload = normalizeMcpPayload({ content: [{ type: "text", text: '{"data":{"list":[{"asin":"B012","sku":"SKU-1","volume":3}]}}' }] });
    expect(pickRecords(payload)).toEqual([{ asin: "B012", sku: "SKU-1", volume: 3 }]);
  });

  it("解析JSON-RPC result外层的MCP content文本包装", () => {
    const payload = normalizeMcpPayload({ jsonrpc: "2.0", result: { content: [{ type: "text", text: '{"list":[{"asin":"B013"}]}' }] } });
    expect(pickRecords(payload)).toEqual([{ asin: "B013" }]);
  });

  it("解析领星自然语言店铺目录中的sid范围", () => {
    const payload = normalizeMcpPayload("店铺列表\nsid: 1001\nshop_name: 测试店铺\nsid: 1002\nshop_name: 第二店铺");
    expect(pickRecords(payload)).toEqual([{ sid: 1001, shop_name: "测试店铺" }, { sid: 1002, shop_name: "第二店铺" }]);
  });

  it("规范化自然语言产品与库存字段为既有运营数据字段", () => {
    const payload = normalizeMcpPayload("ASIN: B012\n父ASIN: P012\nSKU: SKU-1\n可售库存: 8\n在途库存: 2");
    const normalized = normalizeRow("fba_inventory", pickRecords(payload)[0], { storeId: "123" });
    expect(normalized.normalized).toMatchObject({ asin: "B012", parentAsin: "P012", sku: "SKU-1", fbaAvailable: 8, fbaInTransit: 2 });
  });

  it("广告关键词草稿缺少活动名称时必须进入人工核对", () => {
    const normalized = normalizeRow("ad_keyword", { keyword: "power bank" }, { storeId: "123", profileId: "456", startDate: "2026-08-01", endDate: "2026-08-07" });
    expect(normalized.validationErrors[0]).toContain("关键词和活动名称");
  });

  it("广告活动字段可规范化为只读报表草稿，不产生投放操作字段", () => {
    const normalized = normalizeRow("ad_campaign", { campaign_name: "SP-Brand", impressions: 100, clicks: 8, spend: 12.5, sales: 80 }, { storeId: "123", profileId: "456", startDate: "2026-08-01", endDate: "2026-08-07" });
    expect(normalized.validationErrors).toEqual([]);
    expect(normalized.normalized).toMatchObject({ campaignName: "SP-Brand", adImpressions: 100, adClicks: 8, adSpend: 12.5, adSales: 80 });
    expect(normalized.normalized).not.toHaveProperty("operation");
  });

  it("未识别ASIN的产品表现行保持草稿并标为需人工核对", () => {
    const normalized = normalizeRow("product_performance", { local_name: "无ASIN产品" }, { storeId: "123", startDate: "2026-08-01", endDate: "2026-08-07" });
    expect(normalized.validationErrors).toHaveLength(1);
    expect(normalized.normalized.productName).toBe("无ASIN产品");
  });

  it("ASIN日记录从MCP父ASIN数组和报告日期映射产品总览原子指标", () => {
    const normalized = normalizeRow("product_performance_daily", { asin: "B012", parent_asins: [{ parent_asin: "P012" }], rdate: "2026-08-10", volume: 3, order_items: 2, amount: "58.20", gross_profit: "12.10", spend: "4.20", ad_sales_amount: "20.10", ad_order_quantity: 1, nature_order_items: 1, sessions_total: 20, clicks: 4, impressions: 100, return_count: 1 }, { storeId: "7392", startDate: "2026-08-10", endDate: "2026-08-10" });
    expect(normalized.validationErrors).toEqual([]);
    expect(normalized.normalized).toMatchObject({ asin: "B012", parentAsin: "P012", reportDate: "2026-08-10", salesQty: 3, orderQty: 2, adOrders: 1, organicOrders: 1, sessionsTotal: 20, adClicks: 4, adImpressions: 100, returnQty: 1 });
  });

  it("ASIN日订单利润优先使用领星预测毛利润而非结算毛利润", () => {
    const normalized = normalizeRow("product_performance_daily", { asin: "B012", parent_asins: [{ parent_asin: "P012" }], rdate: "2026-08-10", gross_profit: "12.10", predict_gross_profit: "8.75" }, { storeId: "7392", startDate: "2026-08-10", endDate: "2026-08-10" });
    expect(normalized.normalized.orderProfit).toBe("8.75");
  });

  it("将领星广告指标的负哨兵值归一为缺失，不误作负数业务事实", () => {
    const normalized = normalizeRow("product_performance_daily", {
      asin: "B0SENTINEL", parent_asins: [{ parent_asin: "P0SENTINEL" }], rdate: "2026-02-26",
      clicks: -1, impressions: -1, spend: -1, acos: -1, ctr: -0.0159,
    }, { storeId: "12507", startDate: "2026-02-26", endDate: "2026-02-26" });
    expect(normalized.normalized.adClicks).toBeNull();
    expect(normalized.normalized.adImpressions).toBeNull();
    expect(normalized.normalized.adSpend).toBeNull();
    expect(normalized.normalized.adAcos).toBeNull();
    expect(normalized.normalized.adCtr).toBeNull();
  });

  it("仅将所选时间内有销量、广告或表现指标的ASIN日行纳入系统应用", () => {
    expect(hasSelectedPeriodActivity({ salesQty: 0, adSpend: 0, sessionsTotal: 0 })).toBe(false);
    expect(hasSelectedPeriodActivity({ salesQty: 2 })).toBe(true);
    expect(hasSelectedPeriodActivity({ adImpressions: 100 })).toBe(true);
    expect(hasSelectedPeriodActivity({ sessionsTotal: 1 })).toBe(true);
    expect(hasSelectedPeriodActivity({ orderProfit: -3.2 })).toBe(true);
  });

  it("ASIN日占位行在人工确认前被阻断", () => {
    const normalized = normalizeRow("product_performance_daily", { asin: "-", parent_asins: [{ parent_asin: "P012" }], rdate: "2026-08-10" }, { storeId: "7392", startDate: "2026-08-10", endDate: "2026-08-10" });
    expect(normalized.validationErrors.join(" ")).toContain("占位ASIN");
  });

  it("ASIN日快照身份键区分同店铺SID下不同站点，避免跨站点误匹配", () => {
    const us = dailySnapshotIdentityKey({ sourceStoreId: "7392", country: "US", asin: "B012", reportDate: "2026-08-10" });
    const ca = dailySnapshotIdentityKey({ sourceStoreId: "7392", country: "CA", asin: "B012", reportDate: "2026-08-10" });
    expect(us).not.toBe(ca);
  });

  it("ASIN日预览保留店铺与日期元数据并过滤占位ASIN", () => {
    const preview = normalizeDailyPreviewPage([{ asin: "-" }, { asin: "B012", parent_asins: [{ parent_asin: "P012" }] }], { storeId: "7392", storeName: "2店-US", reportDate: "2026-08-10" });
    expect(preview).toMatchObject({ placeholderRows: 1, rows: [{ asin: "B012", __lingxingSid: "7392", __lingxingStoreName: "2店-US", __reportDate: "2026-08-10" }] });
  });

  it("ASIN日自动应用覆盖统计只计入实际完成全部日期窗口的店铺", () => {
    const coverage = dailyReadCoverageSummary([{ sid: "7392" }, { sid: "7395" }], ["2026-08-10", "2026-08-11"], new Set(["7392|2026-08-10", "7392|2026-08-11", "7395|2026-08-10"]));
    expect(coverage).toEqual({ storesExpected: 2, storesRead: 1, storeDateWindowsExpected: 4, storeDateWindowsRead: 3 });
  });

  it("确认应用仅接受带有效父ASIN和报告日期的ASIN日快照", () => {
    expect(isValidDailySnapshotForApply({ asin: "B012", parentAsin: "P012", reportDate: "2026-08-10" })).toBe(true);
    expect(isValidDailySnapshotForApply({ asin: "-", parentAsin: "P012", reportDate: "2026-08-10" })).toBe(false);
    expect(isValidDailySnapshotForApply({ asin: "B012", parentAsin: "P012", reportDate: "invalid" })).toBe(false);
  });

  it("解析领星文本型店铺目录并保留可筛选的美国站SID", () => {
    expect(normalizeLingxingStoreDirectoryRecord({ sid: "7392, 店铺名: 1店-US, 国家: 美国(US)" })).toEqual({ sid: "7392", name: "1店-US", country: "US" });
  });

  it("超大领星原始响应改为Artifact引用而非写入批次JSON", () => {
    expect(shouldExternalizeSyncRawSnapshot({ payload: "x".repeat(1_000_001) })).toBe(true);
    expect(shouldExternalizeSyncRawSnapshot({ payload: "x".repeat(100) })).toBe(false);
  });

  it("FBA库存缺少父ASIN映射时不能被误写入子ASIN库存快照", () => {
    const normalized = normalizeRow("fba_inventory", { asin: "B012", sku: "SKU-1" }, { storeId: "123" });
    expect(normalized.validationErrors[0]).toContain("父ASIN映射");
  });

  it("FBA库存身份键优先使用领星unique_id，避免同ASIN/SKU细分记录被错误判为重复", () => {
    const first = normalizeRow("fba_inventory", { unique_id: "stock-a", asin: "B012", parent_asin: "P012", sku: "SKU-1" }, { storeId: "123", endDate: "2026-08-31" });
    const second = normalizeRow("fba_inventory", { unique_id: "stock-b", asin: "B012", parent_asin: "P012", sku: "SKU-1" }, { storeId: "123", endDate: "2026-08-31" });
    expect(first.validationErrors).toEqual([]);
    expect(second.validationErrors).toEqual([]);
    expect(first.entityKey).not.toBe(second.entityKey);
  });

  it("FBA库存同一ASIN细分记录在应用前聚合为单一可审计日快照", () => {
    const scope = { storeId: "123", marketplace: "US", endDate: "2026-08-31" };
    const first = { unique_id: "stock-a", asin: "B012", parent_asin: "P012", sku: "SKU-1", afn_fulfillable_quantity: 8, afn_reserved_quantity: 1, afn_inbound_shipped_quantity: 2 };
    const second = { unique_id: "stock-b", asin: "B012", parent_asin: "P012", sku: "SKU-1", afn_fulfillable_quantity: 3, afn_reserved_quantity: 2, afn_inbound_shipped_quantity: 1 };
    const result = coalesceFbaInventoryPreviewRows([first, second].map((source) => ({ source, normalized: normalizeRow("fba_inventory", source, scope) })));
    expect(result).toHaveLength(1);
    expect(result[0].normalized.normalized).toMatchObject({ fbaAvailable: 11, fbaReserved: 3, fbaInTransit: 3, inventoryAggregation: { sourceRecordCount: 2, sourceRecordIds: ["stock-a", "stock-b"] } });
    expect(result[0].normalized.validationErrors).toEqual([]);
  });

  it("仅将实际变化字段列为差异，供人工确认新增或更新", () => {
    expect(calculateFieldDiffs({ salesQty: 3, sku: "A" }, { salesQty: 5, sku: "A" }, ["salesQty", "sku"])).toEqual([{ field: "salesQty", before: 3, after: 5 }]);
  });

  it("广告关键词来源身份哈希依赖Profile、活动、广告组、关键词、匹配方式与报告期", () => {
    const identity = { profileId: "P-1", campaignId: "C-1", campaignName: "SP-Core", adGroupId: "G-1", keyword: "power bank", matchType: "exact", periodStart: "2026-08-24", periodEnd: "2026-08-24" };
    expect(keywordSnapshotIdentityHash(identity)).toBe(keywordSnapshotIdentityHash({ ...identity, campaignName: "SP-Core renamed" }));
    expect(keywordSnapshotIdentityHash(identity)).not.toBe(keywordSnapshotIdentityHash({ ...identity, periodEnd: "2026-08-25" }));
    expect(keywordSnapshotIdentityHash(identity)).not.toBe(keywordSnapshotIdentityHash({ ...identity, adGroupId: "G-2" }));
  });
});
