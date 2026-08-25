import { describe, expect, it } from "vitest";
import { summarizeParentAsinWeeks } from "./domains/ops/productOverview/dailyAggregation";

describe("产品总览日快照来源优先级", () => {
  it("同一店铺、ASIN和日期同时存在MCP与历史Excel快照时仅保留MCP记录", () => {
    const weeks = summarizeParentAsinWeeks([
      { sourceType: "lingxing", reportDate: "2026-08-10", asin: "B001", parentAsin: "P001", storeName: "2店-US", country: "US", salesQty: 99, orderQty: 99, salesAmount: 990, orderProfit: 99, adSpend: 99, adSales: 99, sessionsTotal: 99, fbaAvailable: 1, fbaInTransit: 0, sourceLocalAvailable: 0 },
      { sourceType: "lingxing_mcp", reportDate: "2026-08-10", asin: "B001", parentAsin: "P001", storeName: "2店-US", country: "US", salesQty: 3, orderQty: 2, salesAmount: 58, orderProfit: 12, adSpend: 4, adSales: 20, sessionsTotal: 20, fbaAvailable: 2, fbaInTransit: 0, sourceLocalAvailable: 0 },
    ], 4);
    expect(weeks[0].weeks[0]).toMatchObject({ salesQty: 3, orderQty: 2, salesAmount: 58, sessionsTotal: 20, fbaAvailable: 2 });
  });
});
