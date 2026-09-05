import { describe, expect, it } from "vitest";
import { buildUnifiedProductOverview, getUnifiedProductIdentity } from "../shared/unifiedProductOverview";

type Product = {
  parentAsin: string;
  storeName: string;
  marketplace: string;
  weeks: Array<{ weekStartDate: string; source: string }>;
};

describe("统一产品总览来源合同", () => {
  it("对同一父ASIN、店铺、站点仅保留一张卡片，且同周MCP周报覆盖ERP历史", () => {
    const result = buildUnifiedProductOverview<Product>([
      { parentAsin: "P1", storeName: "Store A", marketplace: "US", weeks: [{ weekStartDate: "2026-08-24", source: "mcp" }] },
    ], [
      { parentAsin: "P1", storeName: "Store A", marketplace: "US", weeks: [{ weekStartDate: "2026-08-24", source: "erp" }, { weekStartDate: "2026-08-17", source: "erp" }] },
    ]);

    expect(result).toHaveLength(1);
    expect(result[0].weeklySource).toBe("mcp_parent_weekly");
    expect(result[0].hasErpHistory).toBe(true);
    expect(result[0].weeks).toEqual([
      { weekStartDate: "2026-08-24", source: "mcp" },
      { weekStartDate: "2026-08-17", source: "erp" },
    ]);
  });

  it("保留跨店铺同父ASIN的独立业务身份，并将ERP独有行明确标为历史来源", () => {
    const result = buildUnifiedProductOverview<Product>([
      { parentAsin: "P1", storeName: "Store A", marketplace: "US", weeks: [{ weekStartDate: "2026-08-24", source: "mcp" }] },
      { parentAsin: "P1", storeName: "Store B", marketplace: "US", weeks: [{ weekStartDate: "2026-08-24", source: "mcp" }] },
    ], [
      { parentAsin: "P2", storeName: "Store A", marketplace: "US", weeks: [{ weekStartDate: "2026-08-17", source: "erp" }] },
    ]);

    expect(result).toHaveLength(3);
    expect(getUnifiedProductIdentity(result[0])).not.toBe(getUnifiedProductIdentity(result[1]));
    expect(result.find(product => product.parentAsin === "P2")?.weeklySource).toBe("erp_history");
  });

  it("将US与美国站点别名归并为一张卡片，MCP仍覆盖同周ERP历史", () => {
    const result = buildUnifiedProductOverview<Product>([
      { parentAsin: "P1", storeName: "Store A", marketplace: "US", weeks: [{ weekStartDate: "2026-08-24", source: "mcp" }] },
    ], [
      { parentAsin: "P1", storeName: "Store A", marketplace: "美国", weeks: [{ weekStartDate: "2026-08-24", source: "erp" }, { weekStartDate: "2026-08-17", source: "erp" }] },
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ weeklySource: "mcp_parent_weekly", hasErpHistory: true });
    expect(result[0].weeks).toEqual([
      { weekStartDate: "2026-08-24", source: "mcp" },
      { weekStartDate: "2026-08-17", source: "erp" },
    ]);
  });
});
