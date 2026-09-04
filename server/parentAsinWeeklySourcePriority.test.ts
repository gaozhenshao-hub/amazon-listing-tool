import { describe, expect, it } from "vitest";
import { preferParentAsinWeeklySources } from "./routers/dataImport";

describe("父ASIN周报来源优先级", () => {
  it("同店铺、站点、父ASIN和自然周同时存在时只消费领星MCP周报", () => {
    const selected = preferParentAsinWeeklySources([
      { storeName: "US Store", country: "US", parentAsin: "P001", weekStartDate: "2026-08-24", sourceKind: "uploaded_parent_asin_weekly", createdAt: new Date("2026-08-31"), salesQty: 10 },
      { storeName: "US Store", country: "US", parentAsin: "P001", weekStartDate: "2026-08-24", sourceKind: "internal_daily_rollup", createdAt: new Date("2026-09-01"), salesQty: 20 },
      { storeName: "US Store", country: "US", parentAsin: "P001", weekStartDate: "2026-08-24", sourceKind: "lingxing_mcp_parent_asin_weekly", createdAt: new Date("2026-09-02"), salesQty: 30 },
    ]);

    expect(selected).toHaveLength(1);
    expect(selected[0]).toMatchObject({ sourceKind: "lingxing_mcp_parent_asin_weekly", salesQty: 30 });
  });

  it("保留没有同身份MCP周报的上传周事实作为历史回退", () => {
    const selected = preferParentAsinWeeklySources([
      { storeName: "US Store", country: "US", parentAsin: "P001", weekStartDate: "2026-08-24", sourceKind: "uploaded_parent_asin_weekly", createdAt: new Date("2026-08-31") },
      { storeName: "US Store", country: "US", parentAsin: "P002", weekStartDate: "2026-08-24", sourceKind: "uploaded_parent_asin_weekly", createdAt: new Date("2026-08-31") },
      { storeName: "US Store", country: "US", parentAsin: "P001", weekStartDate: "2026-08-24", sourceKind: "lingxing_mcp_parent_asin_weekly", createdAt: new Date("2026-09-02") },
    ]);

    expect(selected.map((row) => row.parentAsin).sort()).toEqual(["P001", "P002"]);
    expect(selected.find((row) => row.parentAsin === "P001")?.sourceKind).toBe("lingxing_mcp_parent_asin_weekly");
  });
});
