import { describe, expect, it } from "vitest";
import { buildParentWeeklyOverview, type ParentWeeklyFact, type ProductProfileSeed } from "./parentWeeklyOverview";

const fact = (patch: Partial<ParentWeeklyFact> = {}): ParentWeeklyFact => ({
  id: 1,
  sourceKind: "lingxing_mcp_parent_asin_weekly",
  createdAt: new Date("2026-09-01T00:00:00Z"),
  weekStartDate: "2026-08-24",
  weekEndDate: "2026-08-30",
  parentAsin: "PARENT-1",
  asin: "CHILD-1,CHILD-2",
  sku: "SKU-1",
  storeName: "Store A",
  country: "US",
  title: "Source title",
  productName: "来源商品",
  brand: "Brand",
  category1: "Category",
  operator: "Operator",
  salesQty: 70,
  orderQty: 65,
  salesAmount: 700,
  orderProfit: 140,
  sessionsTotal: 1000,
  adOrders: 20,
  organicOrders: 45,
  adClicks: 100,
  adImpressions: 5000,
  adSpend: 70,
  adSales: 350,
  returnQty: 2,
  fbaAvailable: 210,
  fbaInbound: 15,
  fbaInTransit: 8,
  fbaTotal: 233,
  availableStock: 210,
  fbaDaysOfSupply: 21,
  rating: null,
  reviewCount: null,
  ...patch,
});

const profile = (patch: Partial<ProductProfileSeed> = {}): ProductProfileSeed => ({
  id: 101,
  parentAsin: "PARENT-1",
  title: "Manual title",
  chineseName: null,
  brand: null,
  category: null,
  marketplace: "US",
  imageUrl: null,
  status: "active",
  operator: "Manual owner",
  storeName: "Store A",
  updatedAt: new Date("2026-08-01T00:00:00Z"),
  basicInfo: null,
  monthlySummaries: [],
  manualChildAsins: ["CHILD-1"],
  manualSkus: ["MANUAL-SKU"],
  ...patch,
});

describe("父ASIN周报权威总览", () => {
  it("同店铺、站点、父ASIN和自然周只保留官方MCP事实，并以来源成员计算子ASIN数", () => {
    const overview = buildParentWeeklyOverview([
      fact({ id: 1, sourceKind: "uploaded_parent_asin_weekly", salesQty: 999, asin: "STALE-CHILD" }),
      fact({ id: 2, sourceKind: "lingxing_mcp_parent_asin_weekly", salesQty: 70, asin: "CHILD-1, CHILD-2, CHILD-1" }),
      fact({ id: 3, weekStartDate: "2026-08-17", weekEndDate: "2026-08-23", salesQty: 60, asin: "CHILD-1,CHILD-2" }),
    ], [profile()], 4);

    expect(overview).toHaveLength(1);
    expect(overview[0]).toMatchObject({ id: 101, parentAsin: "PARENT-1", variantCount: 2, skus: ["MANUAL-SKU"] });
    expect(overview[0].weeks).toEqual(expect.arrayContaining([
      expect.objectContaining({ weekStartDate: "2026-08-24", salesQty: 70, orderProfit: 140, adSpend: 70 }),
      expect.objectContaining({ weekStartDate: "2026-08-17", salesQty: 60 }),
    ]));
  });

  it("相同父ASIN在不同店铺保持独立身份，不会被错误压缩或累计", () => {
    const overview = buildParentWeeklyOverview([
      fact({ storeName: "Store A", asin: "A-1", salesQty: 10 }),
      fact({ id: 2, storeName: "Store B", asin: "B-1", salesQty: 20 }),
    ], [profile()], 1);

    expect(overview).toHaveLength(2);
    expect(overview).toEqual(expect.arrayContaining([
      expect.objectContaining({ storeName: "Store A", variantCount: 1, weeks: [expect.objectContaining({ salesQty: 10 })] }),
      expect.objectContaining({ storeName: "Store B", variantCount: 1, weeks: [expect.objectContaining({ salesQty: 20 })] }),
    ]));
  });

  it("同一权威业务身份即使存在重复手工产品档案也只生成一张总览卡片", () => {
    const overview = buildParentWeeklyOverview([fact()], [
      profile({ id: 101, updatedAt: new Date("2026-08-01T00:00:00Z") }),
      profile({ id: 102, updatedAt: new Date("2026-09-01T00:00:00Z"), title: "Latest manual title" }),
    ], 1);

    expect(overview).toHaveLength(1);
    expect(overview[0]).toMatchObject({ id: 102, title: "Source title", operator: "Manual owner" });
  });
});
