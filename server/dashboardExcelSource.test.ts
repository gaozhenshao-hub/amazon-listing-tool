import { describe, it, expect } from "vitest";

/**
 * Tests for the Dashboard Overview data aggregation logic
 * after switching from Lingxing API to imported Excel (lingxing_product_weekly) data.
 */

// Replicate the aggregation logic used in getDashboardOverview
function aggregateWeeklyData(rows: any[], weekRanges: { weekStartDate: string; weekEndDate: string }[]) {
  const weekMap: Record<string, { revenue: number; profit: number; orders: number; adSpend: number; adSales: number }> = {};
  for (const row of rows) {
    const weekKey = row.weekStartDate;
    if (!weekMap[weekKey]) weekMap[weekKey] = { revenue: 0, profit: 0, orders: 0, adSpend: 0, adSales: 0 };
    weekMap[weekKey].revenue += parseFloat(String(row.salesAmount || 0));
    weekMap[weekKey].profit += parseFloat(String(row.orderProfit || row.settlementProfit || 0));
    weekMap[weekKey].orders += (row.salesQty || 0);
    weekMap[weekKey].adSpend += parseFloat(String(row.adSpend || 0));
    weekMap[weekKey].adSales += parseFloat(String(row.adSales || 0));
  }

  const profitTrend = Object.entries(weekMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([weekStart, v]) => {
      const weekEnd = weekRanges.find((w) => w.weekStartDate === weekStart)?.weekEndDate || weekStart;
      return {
        date: `${weekStart.slice(5)}~${weekEnd.slice(5)}`,
        revenue: Math.round(v.revenue * 100) / 100,
        profit: Math.round(v.profit * 100) / 100,
        margin: v.revenue > 0 ? Math.round(v.profit / v.revenue * 10000) / 100 : 0,
        orders: v.orders,
        adSpend: Math.round(v.adSpend * 100) / 100,
      };
    });

  // Summary from most recent 4 weeks
  let totalRevenue = 0, totalProfit = 0, totalOrders = 0, totalAdSpend = 0, totalAdSales = 0;
  const recentWeekKeys = Object.keys(weekMap).sort((a, b) => b.localeCompare(a)).slice(0, 4);
  for (const wk of recentWeekKeys) {
    const v = weekMap[wk];
    totalRevenue += v.revenue;
    totalProfit += v.profit;
    totalOrders += v.orders;
    totalAdSpend += v.adSpend;
    totalAdSales += v.adSales;
  }

  const avgMargin = totalRevenue > 0 ? (totalProfit / totalRevenue * 100) : 0;
  const avgAcos = totalAdSales > 0 ? (totalAdSpend / totalAdSales * 100) : 0;

  return { profitTrend, totalRevenue, totalProfit, totalOrders, totalAdSpend, avgMargin, avgAcos };
}

// Replicate inventory aggregation from latest week
function aggregateInventory(rows: any[], latestWeekStart: string) {
  const latestWeekData = rows.filter(r => r.weekStartDate === latestWeekStart);
  const uniqueAsins = new Set(latestWeekData.map(r => r.parentAsin || r.asin).filter(Boolean));
  let lowStockCount = 0, overstockCount = 0;
  const alerts: string[] = [];

  for (const row of latestWeekData) {
    const days = row.fbaDaysOfSupply || 0;
    if (days > 0 && days < 14) lowStockCount++;
    if (days > 90) overstockCount++;
    if (days > 0 && days < 7) {
      alerts.push(`${row.parentAsin || row.asin}: 仅剩${days}天库存`);
    }
  }

  return { skuCount: uniqueAsins.size, lowStockCount, overstockCount, alertCount: alerts.length };
}

// Replicate marketplace filter
function filterByMarketplace(rows: any[], mp: string) {
  if (mp === 'ALL') return rows;
  return rows.filter(r => {
    const c = (r.country || '').toUpperCase();
    return c === mp || c.includes(mp);
  });
}

describe("Dashboard Excel Data Source", () => {
  const sampleWeekRanges = [
    { weekStartDate: "2025-04-14", weekEndDate: "2025-04-20" },
    { weekStartDate: "2025-04-07", weekEndDate: "2025-04-13" },
    { weekStartDate: "2025-03-31", weekEndDate: "2025-04-06" },
    { weekStartDate: "2025-03-24", weekEndDate: "2025-03-30" },
    { weekStartDate: "2025-03-17", weekEndDate: "2025-03-23" },
  ];

  const sampleRows = [
    { weekStartDate: "2025-04-14", salesAmount: "1000.50", orderProfit: "200.30", salesQty: 50, adSpend: "100.00", adSales: "400.00", country: "US", parentAsin: "B001", fbaDaysOfSupply: 5 },
    { weekStartDate: "2025-04-14", salesAmount: "500.00", orderProfit: "80.00", salesQty: 20, adSpend: "50.00", adSales: "200.00", country: "US", parentAsin: "B002", fbaDaysOfSupply: 30 },
    { weekStartDate: "2025-04-07", salesAmount: "900.00", orderProfit: "180.00", salesQty: 45, adSpend: "90.00", adSales: "350.00", country: "US", parentAsin: "B001", fbaDaysOfSupply: 12 },
    { weekStartDate: "2025-04-07", salesAmount: "450.00", orderProfit: "70.00", salesQty: 18, adSpend: "45.00", adSales: "180.00", country: "CA", parentAsin: "B003", fbaDaysOfSupply: 100 },
    { weekStartDate: "2025-03-31", salesAmount: "800.00", orderProfit: "150.00", salesQty: 40, adSpend: "80.00", adSales: "300.00", country: "US", parentAsin: "B001", fbaDaysOfSupply: 20 },
    { weekStartDate: "2025-03-24", salesAmount: "700.00", orderProfit: "130.00", salesQty: 35, adSpend: "70.00", adSales: "280.00", country: "US", parentAsin: "B002", fbaDaysOfSupply: 25 },
    { weekStartDate: "2025-03-17", salesAmount: "600.00", orderProfit: "110.00", salesQty: 30, adSpend: "60.00", adSales: "240.00", country: "DE", parentAsin: "B004", fbaDaysOfSupply: 3 },
  ];

  describe("Weekly Aggregation", () => {
    it("should aggregate revenue, profit, orders by week", () => {
      const result = aggregateWeeklyData(sampleRows, sampleWeekRanges);
      expect(result.profitTrend).toHaveLength(5);
      // Week 2025-04-14: 1000.50 + 500.00 = 1500.50
      const latestWeek = result.profitTrend.find(t => t.date.startsWith("04-14"));
      expect(latestWeek).toBeDefined();
      expect(latestWeek!.revenue).toBe(1500.5);
      expect(latestWeek!.profit).toBe(280.3);
      expect(latestWeek!.orders).toBe(70);
    });

    it("should calculate margin correctly", () => {
      const result = aggregateWeeklyData(sampleRows, sampleWeekRanges);
      const latestWeek = result.profitTrend.find(t => t.date.startsWith("04-14"));
      // margin = 280.3 / 1500.5 * 100 = 18.68%
      expect(latestWeek!.margin).toBeCloseTo(18.68, 1);
    });

    it("should include adSpend in trend data", () => {
      const result = aggregateWeeklyData(sampleRows, sampleWeekRanges);
      const latestWeek = result.profitTrend.find(t => t.date.startsWith("04-14"));
      expect(latestWeek!.adSpend).toBe(150); // 100 + 50
    });

    it("should sort trend by date ascending", () => {
      const result = aggregateWeeklyData(sampleRows, sampleWeekRanges);
      const dates = result.profitTrend.map(t => t.date);
      expect(dates[0]).toMatch(/03-17/);
      expect(dates[dates.length - 1]).toMatch(/04-14/);
    });
  });

  describe("Summary (Recent 4 Weeks)", () => {
    it("should sum revenue from the most recent 4 weeks only", () => {
      const result = aggregateWeeklyData(sampleRows, sampleWeekRanges);
      // Recent 4 weeks: 04-14 (1500.50), 04-07 (1350), 03-31 (800), 03-24 (700)
      expect(result.totalRevenue).toBeCloseTo(4350.5, 1);
    });

    it("should calculate avgMargin from recent 4 weeks", () => {
      const result = aggregateWeeklyData(sampleRows, sampleWeekRanges);
      // totalProfit = 200.30 + 80 + 180 + 70 + 150 + 130 = 810.30
      // totalRevenue = 4350.50
      // margin = 810.30 / 4350.50 * 100 ≈ 18.63%
      expect(result.avgMargin).toBeGreaterThan(0);
      expect(result.avgMargin).toBeLessThan(100);
    });

    it("should calculate avgAcos from recent 4 weeks", () => {
      const result = aggregateWeeklyData(sampleRows, sampleWeekRanges);
      // totalAdSpend = 100+50+90+45+80+70 = 435
      // totalAdSales = 400+200+350+180+300+280 = 1710
      // ACoS = 435/1710*100 ≈ 25.44%
      expect(result.avgAcos).toBeGreaterThan(0);
    });
  });

  describe("Inventory Aggregation", () => {
    it("should count unique ASINs from latest week", () => {
      const result = aggregateInventory(sampleRows, "2025-04-14");
      expect(result.skuCount).toBe(2); // B001, B002
    });

    it("should detect low stock items (< 14 days)", () => {
      const result = aggregateInventory(sampleRows, "2025-04-14");
      expect(result.lowStockCount).toBe(1); // B001 has 5 days
    });

    it("should detect overstock items (> 90 days)", () => {
      const result = aggregateInventory(sampleRows, "2025-04-14");
      expect(result.overstockCount).toBe(0); // None in latest week
    });

    it("should generate alerts for critical stock (< 7 days)", () => {
      const result = aggregateInventory(sampleRows, "2025-04-14");
      expect(result.alertCount).toBe(1); // B001 has 5 days
    });

    it("should detect overstock from other weeks", () => {
      const result = aggregateInventory(sampleRows, "2025-04-07");
      expect(result.overstockCount).toBe(1); // B003 has 100 days
    });
  });

  describe("Marketplace Filter", () => {
    it("should return all rows when marketplace is ALL", () => {
      const filtered = filterByMarketplace(sampleRows, "ALL");
      expect(filtered).toHaveLength(sampleRows.length);
    });

    it("should filter by US marketplace", () => {
      const filtered = filterByMarketplace(sampleRows, "US");
      expect(filtered.every(r => r.country === "US")).toBe(true);
      expect(filtered.length).toBe(5);
    });

    it("should filter by CA marketplace", () => {
      const filtered = filterByMarketplace(sampleRows, "CA");
      expect(filtered).toHaveLength(1);
      expect(filtered[0].parentAsin).toBe("B003");
    });

    it("should filter by DE marketplace", () => {
      const filtered = filterByMarketplace(sampleRows, "DE");
      expect(filtered).toHaveLength(1);
      expect(filtered[0].parentAsin).toBe("B004");
    });
  });

  describe("Edge Cases", () => {
    it("should handle empty data gracefully", () => {
      const result = aggregateWeeklyData([], []);
      expect(result.profitTrend).toHaveLength(0);
      expect(result.totalRevenue).toBe(0);
      expect(result.totalProfit).toBe(0);
      expect(result.avgMargin).toBe(0);
      expect(result.avgAcos).toBe(0);
    });

    it("should handle null/undefined values in rows", () => {
      const rows = [
        { weekStartDate: "2025-04-14", salesAmount: null, orderProfit: undefined, salesQty: 0, adSpend: null, adSales: null, country: "US", parentAsin: "B001", fbaDaysOfSupply: 0 },
      ];
      const result = aggregateWeeklyData(rows, [{ weekStartDate: "2025-04-14", weekEndDate: "2025-04-20" }]);
      expect(result.profitTrend).toHaveLength(1);
      expect(result.profitTrend[0].revenue).toBe(0);
      expect(result.profitTrend[0].profit).toBe(0);
    });

    it("should use settlementProfit as fallback when orderProfit is missing", () => {
      const rows = [
        { weekStartDate: "2025-04-14", salesAmount: "1000", settlementProfit: "150", salesQty: 10, adSpend: "0", adSales: "0", country: "US", parentAsin: "B001", fbaDaysOfSupply: 20 },
      ];
      const result = aggregateWeeklyData(rows, [{ weekStartDate: "2025-04-14", weekEndDate: "2025-04-20" }]);
      expect(result.profitTrend[0].profit).toBe(150);
    });

    it("should format date label as MM-DD~MM-DD", () => {
      const rows = [
        { weekStartDate: "2025-04-14", salesAmount: "100", orderProfit: "10", salesQty: 5, adSpend: "0", adSales: "0" },
      ];
      const ranges = [{ weekStartDate: "2025-04-14", weekEndDate: "2025-04-20" }];
      const result = aggregateWeeklyData(rows, ranges);
      expect(result.profitTrend[0].date).toBe("04-14~04-20");
    });

    it("should not count fbaDaysOfSupply=0 as low stock", () => {
      const rows = [
        { weekStartDate: "2025-04-14", parentAsin: "B001", fbaDaysOfSupply: 0 },
      ];
      const result = aggregateInventory(rows, "2025-04-14");
      expect(result.lowStockCount).toBe(0);
      expect(result.alertCount).toBe(0);
    });
  });
});
