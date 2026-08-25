import { describe, expect, it } from "vitest";
import { mergeProductWeeksPreferPrimary } from "../shared/erpProductMerge";

describe("领星日快照与历史周表合并", () => {
  const historical = [{
    parentAsin: "P1", storeName: "Store", marketplace: "US", erpSource: "lingxing" as const,
    title: "历史标题", monthlySummaries: [{ yearMonth: "2026-08" }],
    weeks: [{ weekStartDate: "2026-08-10", source: "weekly", salesQty: 99 }, { weekStartDate: "2026-08-03", source: "weekly", salesQty: 80 }],
  }];
  const daily = [{
    parentAsin: "P1", storeName: "Store", marketplace: "US", erpSource: "lingxing" as const,
    title: "日快照标题", monthlySummaries: [],
    weeks: [{ weekStartDate: "2026-08-10", source: "daily", salesQty: 135 }],
  }];

  it("同一自然周由日快照覆盖，未覆盖周保留历史周表且不双重累计", () => {
    const [product] = mergeProductWeeksPreferPrimary(daily, historical);
    expect(product.title).toBe("日快照标题");
    expect(product.weeks).toEqual([
      expect.objectContaining({ weekStartDate: "2026-08-10", source: "daily", salesQty: 135 }),
      expect.objectContaining({ weekStartDate: "2026-08-03", source: "weekly", salesQty: 80 }),
    ]);
    expect(product.monthlySummaries).toEqual([{ yearMonth: "2026-08" }]);
  });

  it("保留没有日快照的历史父ASIN", () => {
    const merged = mergeProductWeeksPreferPrimary([], historical);
    expect(merged).toHaveLength(1);
    expect(merged[0].parentAsin).toBe("P1");
  });
});
