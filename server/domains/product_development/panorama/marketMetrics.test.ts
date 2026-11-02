import { describe, expect, it } from "vitest";
import {
  buildAdaptivePriceBands,
  getListingAgeLabel,
  normalizeParentMarketMetrics,
} from "./marketMetrics";

describe("parent ASIN market metric normalization", () => {
  it("counts one representative row per parent and ignores child metrics", () => {
    const products = normalizeParentMarketMetrics([
      { id: 1, asin: "CHILD-A", parentAsin: "PARENT-1", monthlySales: 500, monthlyRevenue: "5000", price: "20", childSales: 9000 } as any,
      { id: 2, asin: "CHILD-B", parentAsin: "PARENT-1", monthlySales: 800, monthlyRevenue: "7600", price: "24", childSales: 9999 } as any,
      { id: 3, asin: "SOLO", parentAsin: null, monthlySales: 300, monthlyRevenue: "2700", price: "18" },
    ]);

    expect(products.map((product) => product.monthlySales)).toEqual([0, 800, 300]);
    expect(products.map((product) => Number(product.monthlyRevenue))).toEqual([0, 7600, 2700]);
    expect(products[1].parentSalesRepresentative).toBe(true);
    expect(products[0].salesTier).toBe(products[1].salesTier);
  });

  it("assigns deterministic listing-age labels", () => {
    const now = new Date("2026-08-10T00:00:00Z");
    expect(getListingAgeLabel({ listingDays: 0 }, now)).toBe("6个月以内");
    expect(getListingAgeLabel({ listingDays: 90 }, now)).toBe("6个月以内");
    expect(getListingAgeLabel({ listingDays: 250 }, now)).toBe("6–12个月");
    expect(getListingAgeLabel({ listingDays: 500 }, now)).toBe("12–24个月");
    expect(getListingAgeLabel({ listingDays: 900 }, now)).toBe("24个月以上");
  });

  it("builds four or five non-overlapping adaptive price bands", () => {
    const bands = buildAdaptivePriceBands(Array.from({ length: 20 }, (_, index) => ({ price: index + 1 })), 5);
    expect(bands).toHaveLength(5);
    expect(bands.every((band, index) => index === 0 || band.min > bands[index - 1].max)).toBe(true);
    expect(buildAdaptivePriceBands([{ price: 20 }], 4)).toHaveLength(4);
  });
});
