import { describe, expect, it } from "vitest";
import { summarizeParentAsinWeeks, summarizeVariantSales } from "./dailyAggregation";

const records = [
  { reportDate: "2026-08-03", asin: "A1", parentAsin: "P1", storeName: "店铺", country: "US", salesQty: 2, orderQty: 2, salesAmount: 20, orderProfit: 5, adSpend: 2, adSales: 10, adOrders: 1, organicOrders: 1, adClicks: 4, adImpressions: 40, returnQty: 0, sessionsTotal: 10, fbaAvailable: 10, fbaInTransit: 1, sourceLocalAvailable: 0 },
  { reportDate: "2026-08-04", asin: "A1", parentAsin: "P1", storeName: "店铺", country: "US", salesQty: 3, orderQty: 3, salesAmount: 30, orderProfit: 7, adSpend: 3, adSales: 15, adOrders: 1, organicOrders: 2, adClicks: 6, adImpressions: 60, returnQty: 1, sessionsTotal: 12, fbaAvailable: 8, fbaInTransit: 2, sourceLocalAvailable: 0, sku: "SKU-A1" },
  { reportDate: "2026-08-04", asin: "A2", parentAsin: "P1", storeName: "店铺", country: "US", salesQty: 4, orderQty: 4, salesAmount: 40, orderProfit: 8, adSpend: 4, adSales: 20, adOrders: 2, organicOrders: 2, adClicks: 8, adImpressions: 80, returnQty: 1, sessionsTotal: 15, fbaAvailable: 7, fbaInTransit: 1, sourceLocalAvailable: 2, sku: "SKU-A2" },
];

describe("领星日快照周汇总", () => {
  it("按父 ASIN 汇总销量，并仅取每个子 ASIN 截止日库存", () => {
    const [summary] = summarizeParentAsinWeeks(records, 4);
    expect(summary.weeks[0]).toMatchObject({ salesQty: 9, fbaAvailable: 15, fbaInTransit: 3, sourceLocalAvailable: 2, activeDays: 2 });
    expect(summary).toMatchObject({ variantCount: 2, skus: ["SKU-A1", "SKU-A2"] });
  });

  it("对多变体广告和流量原子指标求和，并以汇总分子分母重算比率", () => {
    const [summary] = summarizeParentAsinWeeks(records, 4);
    const week = summary.weeks[0];
    expect(week).toMatchObject({ adOrders: 4, organicOrders: 5, adClicks: 18, adImpressions: 180, adSpend: 9, returnQty: 2 });
    expect(week.totalCvr).toBeCloseTo(9 / 37 * 100, 6);
    expect(week.adCvr).toBeCloseTo(4 / 18 * 100, 6);
    expect(week.ctr).toBeCloseTo(18 / 180 * 100, 6);
    expect(week.cpc).toBeCloseTo(9 / 18, 6);
    expect(week.acos).toBeCloseTo(9 / 45 * 100, 6);
    expect(week.organicCvr).toBeNull();
    expect(week.rating).toBeNull();
    expect(week.reviewCount).toBeNull();
  });

  it("按子 ASIN 输出最近周销量和截止日库存", () => {
    const variants = summarizeVariantSales(records, 1);
    expect(variants.find(item => item.asin === "A1")).toMatchObject({ fbaAvailable: 8, weekly: [{ salesQty: 5, activeDays: 2 }] });
    expect(variants.find(item => item.asin === "A2")).toMatchObject({ fbaAvailable: 7, weekly: [{ salesQty: 4, activeDays: 1 }] });
  });

  it("保留最新日快照中的上传运营人员以供名称映射", () => {
    const [summary] = summarizeParentAsinWeeks([{ ...records[0], operator: "董静静" }], 1);
    expect(summary.operator).toBe("董静静");
  });

  it("使用领星实际周一到周日窗口，周日与次日周一不得混入同一周", () => {
    const boundaryRecords = [
      { ...records[0], reportDate: "2026-08-23", salesQty: 5 },
      { ...records[0], reportDate: "2026-08-24", salesQty: 8 },
    ];
    const [summary] = summarizeParentAsinWeeks(boundaryRecords, 2);
    expect(summary.weeks).toEqual(expect.arrayContaining([
      expect.objectContaining({ weekStartDate: "2026-08-24", weekEndDate: "2026-08-30", salesQty: 8 }),
      expect.objectContaining({ weekStartDate: "2026-08-17", weekEndDate: "2026-08-23", salesQty: 5 }),
    ]));

    const variants = summarizeVariantSales(boundaryRecords, 2);
    expect(variants[0].weekly).toEqual(expect.arrayContaining([
      expect.objectContaining({ weekStartDate: "2026-08-24", weekEndDate: "2026-08-30", salesQty: 8 }),
      expect.objectContaining({ weekStartDate: "2026-08-17", weekEndDate: "2026-08-23", salesQty: 5 }),
    ]));
  });
});
