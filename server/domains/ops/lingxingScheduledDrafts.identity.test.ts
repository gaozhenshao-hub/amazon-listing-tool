import { describe, expect, it } from "vitest";
import { aggregateParentAsinWeeklyMemberFacts, collapseWeeklyFactMarketplaceAliases, rawMarketplaceFromWeeklySyncRow, weeklyRollupIdentity } from "./lingxingScheduledDrafts";

function candidate(country: string, rawCountry = country, storeName = "Store A", salesQty = 10) {
  return {
    rawCountry,
    fact: { workspaceId: 1, parentAsin: "PARENT-1", storeName, country, weekStartDate: "2026-03-01", salesQty },
  };
}

describe("父ASIN周报站点别名身份", () => {
  it("将US与美国归并为同一业务身份", () => {
    expect(weeklyRollupIdentity(candidate("US").fact)).toBe(weeklyRollupIdentity(candidate("美国").fact));
  });

  it("只保留规范站点标签的候选，不合并或累计别名行指标", () => {
    const collapsed = collapseWeeklyFactMarketplaceAliases([
      candidate("US", "US", "Store A", 10),
      candidate("美国", "美国", "Store A", 90),
    ]);
    expect(collapsed).toHaveLength(1);
    expect(collapsed[0]?.fact.country).toBe("US");
    expect(collapsed[0]?.fact.salesQty).toBe(10);
  });

  it("优先保留同步行sourceData中的原始站点别名证据", () => {
    expect(rawMarketplaceFromWeeklySyncRow({
      sourceData: { marketplace: "美国" },
      normalizedData: { country: "US" },
    })).toBe("美国");
  });

  it("跨店铺候选保持独立，不因站点标准化被合并", () => {
    expect(collapseWeeklyFactMarketplaceAliases([
      candidate("US", "US", "Store A"),
      candidate("美国", "美国", "Store B"),
    ])).toHaveLength(2);
  });

  it("同一原始站点的重复候选保持失败关闭，让后续严格检查阻断应用", () => {
    expect(collapseWeeklyFactMarketplaceAliases([
      candidate("US", "US"),
      candidate("US", "US"),
    ])).toHaveLength(2);
  });
});

function memberCandidate(childAsin: string, storeName = "Store A", overrides: Record<string, unknown> = {}) {
  return {
    fact: {
      workspaceId: 1,
      importId: 0,
      userId: 1,
      sourceKind: "lingxing_mcp_parent_asin_weekly",
      sourceBatchId: 100,
      sourceSchemaVersion: "lingxing_parent_asin_weekly_v1",
      parentAsin: "PARENT-1",
      asin: childAsin,
      sku: `SKU-${childAsin}`,
      msku: `SKU-${childAsin}`,
      storeName,
      country: "US",
      weekStartDate: "2026-03-01",
      weekEndDate: "2026-03-07",
      salesQty: 10,
      salesAmount: "100",
      orderQty: 5,
      orderProfit: "20",
      sessionsTotal: 50,
      adOrders: 2,
      organicOrders: 3,
      adClicks: 10,
      adImpressions: 100,
      adSpend: "20",
      adSales: "30",
      returnQty: 1,
      fbaAvailable: 5,
      fbaInTransit: 2,
      ...overrides,
    } as any,
  };
}

describe("父ASIN周报子ASIN成员聚合", () => {
  it("将不同子ASIN周行汇总为一条父ASIN周事实并重算比率", () => {
    const result = aggregateParentAsinWeeklyMemberFacts([
      memberCandidate("CHILD-B"),
      memberCandidate("CHILD-A", "Store A", {
        salesQty: 20,
        salesAmount: "200",
        orderQty: 10,
        orderProfit: "40",
        sessionsTotal: 100,
        adOrders: 4,
        organicOrders: 6,
        adClicks: 20,
        adImpressions: 200,
        adSpend: "30",
        adSales: "70",
        returnQty: 2,
        fbaAvailable: 7,
        fbaInTransit: 3,
      }),
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]?.fact).toMatchObject({
      asin: "CHILD-A,CHILD-B",
      country: "US",
      sourceSchemaVersion: "lx_asin_weekly_parent_v2",
      salesQty: 30,
      salesAmount: "300",
      orderQty: 15,
      orderProfit: "60",
      orderProfitMargin: "20",
      sessionsTotal: 150,
      cvr: "10",
      adOrders: 6,
      organicOrders: 9,
      adClicks: 30,
      adImpressions: 300,
      ctr: "10",
      cpc: "1.67",
      adSpend: "50",
      adSales: "100",
      acos: "50",
      returnQty: 3,
      returnRate: "10",
      fbaAvailable: 12,
      fbaInTransit: 5,
      organicCvr: null,
    });
  });

  it("同一父ASIN在不同店铺保持独立", () => {
    expect(aggregateParentAsinWeeklyMemberFacts([
      memberCandidate("CHILD-A", "Store A"),
      memberCandidate("CHILD-B", "Store B"),
    ])).toHaveLength(2);
  });

  it("同一父ASIN周内重复子ASIN保持失败关闭", () => {
    expect(() => aggregateParentAsinWeeklyMemberFacts([
      memberCandidate("CHILD-A"),
      memberCandidate("CHILD-A", "Store A", { salesQty: 99 }),
    ])).toThrow("重复子ASIN成员");
  });
});
