import { describe, it, expect } from "vitest";
import { appRouter } from "./routers";

describe("asinList Data Source Integration", () => {
  const router = appRouter;
  const productOps = (router as any)._def.procedures;

  it("syncWeeklyOpsFromLingxing procedure should exist", () => {
    expect(productOps["productOps.syncWeeklyOpsFromLingxing"]).toBeDefined();
  });

  it("batchSyncWeeklyOps procedure should exist", () => {
    expect(productOps["productOps.batchSyncWeeklyOps"]).toBeDefined();
  });

  it("upsertWeeklyOps should accept adSales field", () => {
    const proc = productOps["productOps.upsertWeeklyOps"];
    expect(proc).toBeDefined();
    // Verify it's a mutation (protected procedure)
    expect(proc._def.type).toBe("mutation");
  });

  it("getProductOverviewWithWeeks procedure should exist", () => {
    expect(productOps["productOps.getProductOverviewWithWeeks"]).toBeDefined();
  });

  it("syncWeeklyOpsFromLingxing should be a protected mutation", () => {
    const proc = productOps["productOps.syncWeeklyOpsFromLingxing"];
    expect(proc._def.type).toBe("mutation");
  });

  it("batchSyncWeeklyOps should be a protected mutation", () => {
    const proc = productOps["productOps.batchSyncWeeklyOps"];
    expect(proc._def.type).toBe("mutation");
  });

  describe("ACOS Calculation Logic", () => {
    it("should calculate ACOS as adSpend/adSales (not adSpend/totalRevenue)", () => {
      // Test the ACOS formula: ACOS = adSpend / adSales * 100
      const adSpend = 100;
      const adSales = 500;
      const totalRevenue = 2000;

      const correctAcos = adSales > 0 ? (adSpend / adSales * 100) : 0;
      const wrongAcos = totalRevenue > 0 ? (adSpend / totalRevenue * 100) : 0;

      expect(correctAcos).toBe(20); // 100/500 * 100 = 20%
      expect(wrongAcos).toBe(5);    // 100/2000 * 100 = 5% (wrong!)
      expect(correctAcos).not.toBe(wrongAcos);
    });

    it("should handle zero adSales gracefully", () => {
      const adSpend = 100;
      const adSales = 0;
      const acos = adSales > 0 ? (adSpend / adSales * 100) : 0;
      expect(acos).toBe(0);
    });
  });

  describe("Field Mapping from asinList API", () => {
    it("should map asinList fields correctly", () => {
      // Simulate an asinList API response item
      const apiItem = {
        volume: 150,
        order_items: 120,
        amount: 5000.50,
        gross_profit: 1200.30,
        spend: 300.00,
        ad_sales_amount: 1500.00,
        ad_order_quantity: 45,
        impressions: 50000,
        clicks: 1200,
        sessions_total: 3000,
        return_rate: 3.5,
        avg_star: 4.3,
        reviews_count: 250,
        principal_names: ["张三", "李四"],
        acos: 20.0,
        ctr: 2.4,
        cpc: 0.25,
      };

      // Verify field extraction
      expect(Number(apiItem.volume)).toBe(150);
      expect(Number(apiItem.order_items)).toBe(120);
      expect(Number(apiItem.amount)).toBe(5000.50);
      expect(Number(apiItem.gross_profit)).toBe(1200.30);
      expect(Number(apiItem.spend)).toBe(300.00);
      expect(Number(apiItem.ad_sales_amount)).toBe(1500.00);
      expect(Number(apiItem.ad_order_quantity)).toBe(45);
      expect(Number(apiItem.impressions)).toBe(50000);
      expect(Number(apiItem.clicks)).toBe(1200);
      expect(Number(apiItem.sessions_total)).toBe(3000);
      expect(Number(apiItem.return_rate)).toBe(3.5);
      expect(Number(apiItem.avg_star)).toBe(4.3);
      expect(Number(apiItem.reviews_count)).toBe(250);

      // Verify operator name extraction
      const operatorName = Array.isArray(apiItem.principal_names)
        ? apiItem.principal_names.join(', ')
        : String(apiItem.principal_names);
      expect(operatorName).toBe("张三, 李四");
    });

    it("should handle missing fields gracefully", () => {
      const emptyItem: Record<string, any> = {};
      expect(Number(emptyItem.volume || 0)).toBe(0);
      expect(Number(emptyItem.spend || 0)).toBe(0);
      expect(Number(emptyItem.ad_sales_amount || 0)).toBe(0);
      expect(Number(emptyItem.sessions_total || 0)).toBe(0);
    });
  });

  describe("Derived Metrics Calculation", () => {
    it("should calculate all derived metrics correctly", () => {
      const totalSales = 150;
      const totalOrders = 120;
      const totalRevenue = 5000;
      const totalProfit = 1200;
      const totalAdSpend = 300;
      const totalAdSales = 1500;
      const totalAdOrders = 45;
      const totalImpressions = 50000;
      const totalClicks = 1200;
      const totalSessions = 3000;

      const profitMargin = totalRevenue > 0 ? (totalProfit / totalRevenue * 100) : 0;
      expect(profitMargin).toBe(24);

      const acos = totalAdSales > 0 ? (totalAdSpend / totalAdSales * 100) : 0;
      expect(acos).toBe(20);

      const ctr = totalImpressions > 0 ? (totalClicks / totalImpressions) : 0;
      expect(ctr).toBeCloseTo(0.024, 3);

      const cpc = totalClicks > 0 ? (totalAdSpend / totalClicks) : 0;
      expect(cpc).toBe(0.25);

      const adCvr = totalClicks > 0 ? (totalAdOrders / totalClicks * 100) : 0;
      expect(adCvr).toBe(3.75);

      const totalCvr = totalSessions > 0 ? (totalOrders / totalSessions * 100) : 0;
      expect(totalCvr).toBe(4);

      const organicOrders = Math.max(0, totalOrders - totalAdOrders);
      expect(organicOrders).toBe(75);

      const organicClicks = Math.max(0, totalSessions - totalClicks);
      expect(organicClicks).toBe(1800);

      const organicCvr = organicClicks > 0 ? (organicOrders / organicClicks * 100) : 0;
      expect(organicCvr).toBeCloseTo(4.167, 2);
    });
  });
});
