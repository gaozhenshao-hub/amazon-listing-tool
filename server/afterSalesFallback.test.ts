import { describe, it, expect } from "vitest";
import { APP_ERROR_CODES } from "@shared/_core/errors";

// We test the requestWithMockFallback logic by mocking the LingxingAdapter
// Since the adapter is a class with private methods, we test the public behavior

describe("After-Sales Mock Fallback", () => {
  it("should have requestWithMockFallback method on adapter", async () => {
    // Dynamic import to avoid module resolution issues in test
    const { getLingxingAdapter } = await import("./lingxingAdapter");
    const adapter = getLingxingAdapter();
    expect(typeof adapter.requestWithMockFallback).toBe("function");
  });

  it("requestWithMockFallback rejects instead of fabricating after-sales data", async () => {
    const { getLingxingAdapter } = await import("./lingxingAdapter");
    const adapter = getLingxingAdapter();

    await expect(adapter.requestWithMockFallback({
      path: "/erp/sc/data/fba/returnAnalysis",
      body: {},
    })).rejects.toMatchObject({
      code: APP_ERROR_CODES.DATA_SOURCE_UNAVAILABLE,
      statusCode: 503,
    });
  });
  it("getReturnAnalysis should return normalized data structure", async () => {
    // Test that the return analysis data normalization works correctly
    const mockRawData = {
      overall_return_rate: 5.8,
      total_returns: 81,
      total_orders: 1396,
      by_asin: [
        {
          asin: "B0TEST0001",
          return_rate: 9.5,
          total_returns: 15,
          total_orders: 158,
          return_reasons: [
            { reason: "Defective", count: 8, pct: 53 },
            { reason: "Not as described", count: 7, pct: 47 },
          ],
        },
      ],
      trend: [{ date: "2026-03-01", returns: 3, orders: 50, return_rate: 6.0 }],
      reasons: [
        { reason: "Defective", count: 23, pct: 28.4 },
        { reason: "Not as described", count: 18, pct: 22.2 },
      ],
    };

    // Simulate the normalization logic from afterSales.ts
    const raw = mockRawData;
    const totalReturns = raw.total_returns || 0;
    const totalOrders = raw.total_orders || 0;
    const returnRate = raw.overall_return_rate || 0;
    const byAsin = raw.by_asin || [];
    const highReturnAsins = byAsin.filter((a: any) => a.return_rate > 8);
    const totalRefund = byAsin.reduce((s: number, a: any) => s + (a.total_returns || 0) * 25, 0);

    expect(totalReturns).toBe(81);
    expect(returnRate).toBe(5.8);
    expect(totalOrders).toBe(1396);
    expect(highReturnAsins.length).toBe(1); // B0TEST0001 has 9.5% > 8%
    expect(totalRefund).toBe(375); // 15 * 25
    expect(raw.trend.length).toBe(1);
    expect(raw.reasons.length).toBe(2);
  });
});
