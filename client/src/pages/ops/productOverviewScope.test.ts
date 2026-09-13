import { describe, expect, it } from "vitest";
import { countLegacyFinancialProfitMonths, hasVerifiedSourceScope, isSameSourceProductScope, selectFinancialProfitsForProduct, shouldWaitForProductOverviewFallback } from "./productOverviewScope";

describe("产品总览来源型身份范围", () => {
  const scopedProduct = { parentAsin: "PARENT-1", storeName: "Store A", marketplace: "US" };

  it("将站点别名归一并保持父ASIN、店铺、站点三元组隔离", () => {
    expect(isSameSourceProductScope(scopedProduct, { parentAsin: "parent-1", storeName: " store a ", country: "美国" })).toBe(true);
    expect(isSameSourceProductScope(scopedProduct, { parentAsin: "PARENT-1", storeName: "Store B", country: "US" })).toBe(false);
    expect(isSameSourceProductScope(scopedProduct, { parentAsin: "PARENT-1", storeName: "Store A", country: "CA" })).toBe(false);
    expect(hasVerifiedSourceScope({ parentAsin: "PARENT-1", storeName: "Store A", marketplace: "US" })).toBe(true);
    expect(hasVerifiedSourceScope({ parentAsin: "PARENT-1", storeName: "", marketplace: "US" })).toBe(false);
  });

  it("来源型产品只读取自身精确范围利润，旧版无范围记录不自动归属", () => {
    const entries = [
      { parentAsin: "PARENT-1", storeName: "Store A", country: "US", yearMonth: "2026-08", financialProfit: "1" },
      { parentAsin: "PARENT-1", storeName: "Store B", country: "US", yearMonth: "2026-08", financialProfit: "2" },
      { parentAsin: "PARENT-1", storeName: null, country: null, yearMonth: "2026-08", financialProfit: "3" },
    ];

    expect(selectFinancialProfitsForProduct(entries, scopedProduct)).toEqual([entries[0]]);
    expect(countLegacyFinancialProfitMonths(entries, scopedProduct)).toBe(1);
    expect(selectFinancialProfitsForProduct(entries, { parentAsin: "PARENT-1", storeName: null, marketplace: null })).toEqual([entries[2]]);
  });

  it("权威周度为空且ERP回退仍在加载时保持加载态，而非过早显示0个产品", () => {
    expect(shouldWaitForProductOverviewFallback(0, true)).toBe(true);
    expect(shouldWaitForProductOverviewFallback(0, false)).toBe(false);
    expect(shouldWaitForProductOverviewFallback(1, true)).toBe(false);
  });
});
