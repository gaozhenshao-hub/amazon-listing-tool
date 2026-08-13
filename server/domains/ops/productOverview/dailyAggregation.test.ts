import { describe, expect, it } from "vitest";
import { summarizeParentAsinWeeks, summarizeVariantSales } from "./dailyAggregation";

const records = [
  { reportDate: "2026-08-03", asin: "A1", parentAsin: "P1", storeName: "店铺", country: "US", salesQty: 2, orderQty: 2, salesAmount: 20, orderProfit: 5, adSpend: 2, adSales: 10, sessionsTotal: 10, fbaAvailable: 10, fbaInTransit: 1, sourceLocalAvailable: 0 },
  { reportDate: "2026-08-04", asin: "A1", parentAsin: "P1", storeName: "店铺", country: "US", salesQty: 3, orderQty: 3, salesAmount: 30, orderProfit: 7, adSpend: 3, adSales: 15, sessionsTotal: 12, fbaAvailable: 8, fbaInTransit: 2, sourceLocalAvailable: 0 },
  { reportDate: "2026-08-04", asin: "A2", parentAsin: "P1", storeName: "店铺", country: "US", salesQty: 4, orderQty: 4, salesAmount: 40, orderProfit: 8, adSpend: 4, adSales: 20, sessionsTotal: 15, fbaAvailable: 7, fbaInTransit: 1, sourceLocalAvailable: 2 },
];

describe("领星日快照周汇总", () => {
  it("按父 ASIN 汇总销量，并仅取每个子 ASIN 截止日库存", () => {
    const [summary] = summarizeParentAsinWeeks(records, 4);
    expect(summary.weeks[0]).toMatchObject({ salesQty: 9, fbaAvailable: 15, fbaInTransit: 3, sourceLocalAvailable: 2, activeDays: 2 });
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
});
