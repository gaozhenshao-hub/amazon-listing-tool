import { describe, expect, it } from "vitest";
import { calculateInventoryPlan } from "./calculator";

describe("库存规划计算器", () => {
  it("使用默认 30/30/10 货期和 7/30 各 50% 加权日销", () => {
    const salesHistory = Array.from({ length: 30 }, (_, index) => {
      const date = new Date("2026-07-11T00:00:00Z");
      date.setUTCDate(date.getUTCDate() + index);
      return { reportDate: date.toISOString().slice(0, 10), salesQty: 2, totalInventory: 80 };
    });
    const result = calculateInventoryPlan({ asOfDate: "2026-08-09", fbaAvailable: 40, fbaInTransit: 20, localInventory: 10, salesHistory });
    expect(result).toMatchObject({ totalInventory: 70, totalLeadDays: 70, weightedDailySales: 2, safetyStock: 140, suggestedOrderQuantity: 130 });
  });

  it("人工日销覆盖加权结果，并只用在售日期计算样本", () => {
    const result = calculateInventoryPlan({ asOfDate: "2026-08-09", fbaAvailable: 10, fbaInTransit: 0, localInventory: 0, manualDailySales: 5, salesHistory: [{ reportDate: "2026-08-09", salesQty: 9, totalInventory: 10, isActive: false }] });
    expect(result.weightedDailySales).toBe(5);
    expect(result.sales7.sampleDays).toBe(0);
  });

  it("仅在连续三日均有零库存零销量证据时确认断货", () => {
    const records = ["2026-08-07", "2026-08-08", "2026-08-09"].map(reportDate => ({ reportDate, salesQty: 0, totalInventory: 0 }));
    expect(calculateInventoryPlan({ asOfDate: "2026-08-09", fbaAvailable: 0, fbaInTransit: 0, localInventory: 0, salesHistory: records }).confirmedStockout).toBe(true);
  });
});
