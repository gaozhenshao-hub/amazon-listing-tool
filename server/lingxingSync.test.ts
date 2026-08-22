import { describe, expect, it } from "vitest";
import { buildMcpArguments, calculateFieldDiffs, normalizeMcpPayload, normalizeRow, pickRecords, previewBatchStatusFor } from "./routers/lingxingSync";

describe("领星运营同步预览契约", () => {
  it("产品表现使用官方sids范围且保留人工选择的周期", () => {
    const request = buildMcpArguments("product_performance", { storeId: "123", startDate: "2026-08-01", endDate: "2026-08-07" });
    expect(request.capability).toBe("query_product_performance_asin_lists");
    expect(request.arguments.sids).toBe("123");
    expect(request.arguments.start_date).toBe("2026-08-01");
    expect(request.arguments.end_date).toBe("2026-08-07");
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

  it("兼容领星真实广告活动报表的name、spends和ads_type字段", () => {
    const normalized = normalizeRow("ad_campaign", { name: "SP-Brand", spends: 12.5, ads_type: "sp", sales: 80, store_name: "示例店铺" }, { storeId: "123", profileId: "456", startDate: "2026-08-01", endDate: "2026-08-07" });
    expect(normalized.validationErrors).toEqual([]);
    expect(normalized.normalized).toMatchObject({ campaignName: "SP-Brand", adSpend: 12.5, adType: "sp", adSales: 80, storeName: "示例店铺" });
  });

  it("兼容领星真实广告关键词报表的keyword_text、spends和ads_type字段", () => {
    const normalized = normalizeRow("ad_keyword", { campaign_name: "SP-Brand", keyword_text: "cordless drill", match_type: "exact", spends: 12.5, ads_type: "sp", sales: 66 }, { storeId: "123", profileId: "456", startDate: "2026-08-01", endDate: "2026-08-07" });
    expect(normalized.validationErrors).toEqual([]);
    expect(normalized.normalized).toMatchObject({ campaignName: "SP-Brand", keyword: "cordless drill", matchType: "exact", adSpend: 12.5, adType: "sp", adSales: 66 });
  });

  it("未识别ASIN的产品表现行保持草稿并标为需人工核对", () => {
    const normalized = normalizeRow("product_performance", { local_name: "无ASIN产品" }, { storeId: "123", startDate: "2026-08-01", endDate: "2026-08-07" });
    expect(normalized.validationErrors).toHaveLength(1);
    expect(normalized.normalized.productName).toBe("无ASIN产品");
  });

  it("FBA库存缺少父ASIN映射时不能被误写入子ASIN库存快照", () => {
    const normalized = normalizeRow("fba_inventory", { asin: "B012", sku: "SKU-1" }, { storeId: "123" });
    expect(normalized.validationErrors[0]).toContain("父ASIN映射");
  });

  it("兼容领星FBA库存真实字段并汇总三类在途库存", () => {
    const normalized = normalizeRow("fba_inventory", { asin: "B012", parent_asin_real: "P012", seller_sku: "SKU-1", afn_fulfillable_quantity: 8, afn_reserved_quantity: 2, afn_inbound_receiving_quantity: 1, afn_inbound_shipped_quantity: 3, afn_inbound_working_quantity: 4 }, { storeId: "123" });
    expect(normalized.validationErrors).toEqual([]);
    expect(normalized.normalized).toMatchObject({ asin: "B012", parentAsin: "P012", sku: "SKU-1", fbaAvailable: 8, fbaReserved: 2, fbaInTransit: 8 });
  });

  it("将订单利润报表的父ASIN、销量、销售额和毛利润归一化为产品总览草稿", () => {
    const normalized = normalizeRow("order_profit", { parent_asins: ["P123"], asins: ["B123"], item_name: "产品A", volume: 12, amount: 345.6, gross_profit: 78.9, spend: 10.2 }, { storeId: "123", startDate: "2026-08-01", endDate: "2026-08-07" });
    expect(normalized.validationErrors).toEqual([]);
    expect(normalized.normalized).toMatchObject({ asin: "B123", parentAsin: "P123", productName: "产品A", salesQty: 12, salesAmount: 345.6, orderProfit: 78.9, adSpend: 10.2 });
  });

  it("仅将实际变化字段列为差异，供人工确认新增或更新", () => {
    expect(calculateFieldDiffs({ salesQty: 3, sku: "A" }, { salesQty: 5, sku: "A" }, ["salesQty", "sku"])).toEqual([{ field: "salesQty", before: 3, after: 5 }]);
  });

  it("官方读取零行时只保留empty审计批次，不进入人工确认", () => {
    expect(previewBatchStatusFor(0)).toBe("empty");
    expect(previewBatchStatusFor(1)).toBe("ready_for_review");
  });
});
