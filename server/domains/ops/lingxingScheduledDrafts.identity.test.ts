import { describe, expect, it } from "vitest";
import { collapseWeeklyFactMarketplaceAliases, weeklyRollupIdentity } from "./lingxingScheduledDrafts";

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
