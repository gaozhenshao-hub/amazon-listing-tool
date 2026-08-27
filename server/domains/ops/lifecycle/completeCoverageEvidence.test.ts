import { describe, expect, it } from "vitest";
import { buildCompleteCoverageEvidence } from "./completeCoverageEvidence";

const coveredDates = (start: string, days: number) => {
  const dates = new Set<string>();
  const value = new Date(`${start}T00:00:00Z`);
  for (let index = 0; index < days; index += 1) {
    dates.add(value.toISOString().slice(0, 10));
    value.setUTCDate(value.getUTCDate() + 1);
  }
  return dates;
};

describe("完整读取覆盖的停售零值证据", () => {
  it("仅在连续90个已完整读取日期中为缺席活跃行补零", () => {
    const result = buildCompleteCoverageEvidence([{
      asin: "B0ZERO", storeName: "1店-US", country: "US", reportDate: "2026-05-28",
      salesQty: 0, orderProfit: 0, fbaAvailable: 0, availableStock: 0, fbaInTransit: 0, sourceType: "lingxing_mcp",
    }], coveredDates("2026-05-28", 90));
    const evidence = result.get("B0ZERO::1店-US::US");
    expect(evidence).toHaveLength(90);
    expect(evidence?.every(row => row.salesQty === 0 && row.orderProfit === 0 && row.totalInventory === 0)).toBe(true);
  });

  it("90天内存在任一未完整读取日期时拒绝构造零值证据", () => {
    const dates = coveredDates("2026-05-28", 90);
    dates.delete("2026-07-01");
    const result = buildCompleteCoverageEvidence([{
      asin: "B0ZERO", storeName: "1店-US", country: "US", reportDate: "2026-05-28",
      salesQty: 0, orderProfit: 0, fbaAvailable: 0, availableStock: 0, fbaInTransit: 0,
    }], dates);
    expect(result.size).toBe(0);
  });

  it("同日多来源只采用官方MCP优先记录，不双重累计", () => {
    const dates = coveredDates("2026-05-28", 90);
    const result = buildCompleteCoverageEvidence([
      { asin: "B0SOURCE", storeName: "1店-US", country: "US", reportDate: "2026-05-28", salesQty: 99, orderProfit: 99, fbaAvailable: 0, availableStock: 0, fbaInTransit: 0, sourceType: "lingxing" },
      { asin: "B0SOURCE", storeName: "1店-US", country: "US", reportDate: "2026-05-28", salesQty: 2, orderProfit: 3, fbaAvailable: 4, availableStock: 0, fbaInTransit: 1, sourceType: "lingxing_mcp" },
    ], dates);
    expect(result.get("B0SOURCE::1店-US::US")?.at(0)).toMatchObject({ salesQty: 2, orderProfit: 3, totalInventory: 5 });
  });

  it("窗口内后续真实活跃行会阻止停售，不能被补零规则遗漏", () => {
    const result = buildCompleteCoverageEvidence([
      { asin: "B0ACTIVE", storeName: "1店-US", country: "US", reportDate: "2026-05-28", salesQty: 0, orderProfit: 0, fbaAvailable: 0, availableStock: 0, fbaInTransit: 0, sourceType: "lingxing_mcp" },
      { asin: "B0ACTIVE", storeName: "1店-US", country: "US", reportDate: "2026-08-25", salesQty: 8, orderProfit: 12, fbaAvailable: 3, availableStock: 0, fbaInTransit: 0, sourceType: "lingxing_mcp" },
    ], coveredDates("2026-05-28", 90));
    expect(result.get("B0ACTIVE::1店-US::US")?.at(-1)).toMatchObject({ salesQty: 8, orderProfit: 12, totalInventory: 3 });
  });

  it("已有生命周期身份可作为历史种子，在完整窗口内补零并更新证据期", () => {
    const result = buildCompleteCoverageEvidence([
      { asin: "B0LEGACY", storeName: "1店-US", country: "US", reportDate: "2026-03-30", salesQty: 0, orderProfit: 0, fbaAvailable: 0, availableStock: 0, fbaInTransit: 0, sourceType: "lifecycle_identity_seed" },
    ], coveredDates("2026-05-28", 90));
    const evidence = result.get("B0LEGACY::1店-US::US");
    expect(evidence).toHaveLength(90);
    expect(evidence?.[0]?.reportDate).toBe("2026-05-28");
    expect(evidence?.every(row => row.salesQty === 0 && row.totalInventory === 0)).toBe(true);
  });
});
