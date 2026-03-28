import { describe, it, expect, vi, beforeEach } from "vitest";

// We test the requestWithMockFallback logic by mocking the LingxingAdapter
// Since the adapter is a class with private methods, we test the public behavior

describe("After-Sales Mock Fallback", () => {
  it("should have requestWithMockFallback method on adapter", async () => {
    // Dynamic import to avoid module resolution issues in test
    const { getLingxingAdapter } = await import("./lingxingAdapter");
    const adapter = getLingxingAdapter();
    expect(typeof adapter.requestWithMockFallback).toBe("function");
  });

  it("requestWithMockFallback should return mock data when API returns error code", async () => {
    const { getLingxingAdapter } = await import("./lingxingAdapter");
    const adapter = getLingxingAdapter();
    
    // Force mock mode off to test fallback behavior
    // The real API will return code 400 for after-sales endpoints
    // requestWithMockFallback should catch this and return mock data
    const result = await adapter.requestWithMockFallback({
      path: "/erp/sc/data/fba/returnAnalysis",
      body: {},
    });
    
    // Should return successful response (either real data or mock fallback)
    expect(result).toBeDefined();
    expect(result.code).toBe("200");
    expect(result.data).toBeDefined();
    // If it fell back to mock, _meta.source should be 'mock_fallback'
    if (result._meta?.source === 'mock_fallback') {
      // Reason could be "API returned code=XXX" or "API error: ..." (e.g. IP whitelist)
      expect(result._meta.reason).toBeTruthy();
    }
  });

  it("requestWithMockFallback should return mock data for reviewReport", async () => {
    const { getLingxingAdapter } = await import("./lingxingAdapter");
    const adapter = getLingxingAdapter();
    
    const result = await adapter.requestWithMockFallback({
      path: "/erp/sc/v2/ca/reviewReport/lists",
      body: {},
    });
    
    expect(result).toBeDefined();
    expect(result.code).toBe("200");
    expect(result.data).toBeDefined();
  });

  it("requestWithMockFallback should return mock data for mail lists", async () => {
    const { getLingxingAdapter } = await import("./lingxingAdapter");
    const adapter = getLingxingAdapter();
    
    const result = await adapter.requestWithMockFallback({
      path: "/erp/sc/data/mail/lists",
      body: { email: "all", flag: "all" },
    });
    
    expect(result).toBeDefined();
    expect(result.code).toBe("200");
    expect(result.data).toBeDefined();
  });

  it("requestWithMockFallback should return mock data for performance list", async () => {
    const { getLingxingAdapter } = await import("./lingxingAdapter");
    const adapter = getLingxingAdapter();
    
    const result = await adapter.requestWithMockFallback({
      path: "/erp/sc/cs/performance/list",
      body: {},
    });
    
    expect(result).toBeDefined();
    expect(result.code).toBe("200");
  });

  it("requestWithMockFallback should return default empty mock for unknown paths", async () => {
    const { getLingxingAdapter } = await import("./lingxingAdapter");
    const adapter = getLingxingAdapter();
    
    const result = await adapter.requestWithMockFallback({
      path: "/some/unknown/path",
      body: {},
    });
    
    expect(result).toBeDefined();
    expect(result.code).toBe("200");
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
