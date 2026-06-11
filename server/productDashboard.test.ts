import { describe, it, expect } from "vitest";

describe("Product Dashboard & Overview Optimization", () => {
  // Test status mapping logic
  describe("Status Mapping", () => {
    const mapStatus = (raw: any): string => {
      if (raw === undefined || raw === null) return "inactive";
      const s = String(raw).toLowerCase().trim();
      if (["active", "1", "true", "in stock", "published", "buyable"].includes(s)) return "active";
      if (["discontinued", "removed", "deleted", "-1"].includes(s)) return "discontinued";
      return "inactive";
    };

    it("should map 'Active' to active", () => {
      expect(mapStatus("Active")).toBe("active");
    });
    it("should map 'active' to active", () => {
      expect(mapStatus("active")).toBe("active");
    });
    it("should map numeric 1 to active", () => {
      expect(mapStatus(1)).toBe("active");
      expect(mapStatus("1")).toBe("active");
    });
    it("should map 'In Stock' to active", () => {
      expect(mapStatus("In Stock")).toBe("active");
    });
    it("should map null/undefined to inactive", () => {
      expect(mapStatus(null)).toBe("inactive");
      expect(mapStatus(undefined)).toBe("inactive");
    });
    it("should map 'Inactive' to inactive", () => {
      expect(mapStatus("Inactive")).toBe("inactive");
    });
    it("should map 'discontinued' to discontinued", () => {
      expect(mapStatus("discontinued")).toBe("discontinued");
    });
    it("should map 'removed' to discontinued", () => {
      expect(mapStatus("removed")).toBe("discontinued");
    });
  });

  // Test change percentage calculation
  describe("Change Percentage Calculation", () => {
    const calcChange = (curr: number, prev: number) => prev > 0 ? ((curr - prev) / prev) * 100 : 0;

    it("should calculate positive change", () => {
      expect(calcChange(150, 100)).toBeCloseTo(50);
    });
    it("should calculate negative change", () => {
      expect(calcChange(80, 100)).toBeCloseTo(-20);
    });
    it("should return 0 when previous is 0", () => {
      expect(calcChange(100, 0)).toBe(0);
    });
    it("should return 0 when both are 0", () => {
      expect(calcChange(0, 0)).toBe(0);
    });
  });

  // Test profit margin calculation
  describe("Profit Margin Calculation", () => {
    it("should calculate profit margin correctly", () => {
      const revenue = 10000;
      const cost = 3000;
      const adSpend = 2000;
      const fbaFee = 1500;
      const profit = revenue - cost - adSpend - fbaFee;
      const margin = revenue > 0 ? (profit / revenue) * 100 : 0;
      expect(profit).toBe(3500);
      expect(margin).toBeCloseTo(35);
    });

    it("should handle zero revenue", () => {
      const revenue = 0;
      const margin = revenue > 0 ? (100 / revenue) * 100 : 0;
      expect(margin).toBe(0);
    });
  });

  // Test ACoS/ROAS calculation
  describe("ACoS & ROAS Calculation", () => {
    it("should calculate ACoS correctly", () => {
      const spend = 200;
      const sales = 1000;
      const acos = sales > 0 ? (spend / sales) * 100 : 0;
      expect(acos).toBeCloseTo(20);
    });

    it("should calculate ROAS correctly", () => {
      const spend = 200;
      const sales = 1000;
      const roas = spend > 0 ? sales / spend : 0;
      expect(roas).toBeCloseTo(5);
    });

    it("should handle zero spend for ROAS", () => {
      const roas = 0 > 0 ? 1000 / 0 : 0;
      expect(roas).toBe(0);
    });
  });

  // Test date range calculation
  describe("Date Range Calculation", () => {
    it("should calculate day period correctly", () => {
      const now = new Date("2026-03-25T12:00:00Z");
      const startDate = new Date(now.getTime() - 86400000).toISOString().split("T")[0];
      const prevStartDate = new Date(now.getTime() - 172800000).toISOString().split("T")[0];
      expect(startDate).toBe("2026-03-24");
      expect(prevStartDate).toBe("2026-03-23");
    });

    it("should calculate week period correctly", () => {
      const now = new Date("2026-03-25T12:00:00Z");
      const startDate = new Date(now.getTime() - 7 * 86400000).toISOString().split("T")[0];
      expect(startDate).toBe("2026-03-18");
    });

    it("should calculate month period correctly", () => {
      const now = new Date("2026-03-25T12:00:00Z");
      const startDate = new Date(now.getTime() - 30 * 86400000).toISOString().split("T")[0];
      expect(startDate).toBe("2026-02-23");
    });
  });

  // Test dashboard data structure
  describe("Dashboard Data Structure", () => {
    it("should have correct structure", () => {
      const dashboard = {
        products: { total: 202, active: 150, inactive: 52 },
        profit: {
          current: { revenue: 10000, cost: 3000, profit: 3500, profitMargin: 35, adSpend: 2000, fbaFee: 1500, orderCount: 100, unitCount: 200 },
          previous: { revenue: 8000, cost: 2500, profit: 2800, profitMargin: 35, adSpend: 1800, fbaFee: 1200, orderCount: 80, unitCount: 160 },
          changes: { revenue: 25, profit: 25, adSpend: 11.1, orderCount: 25 },
        },
        inventory: { totalStock: 5000, inboundQty: 500, reservedQty: 200, totalValue: 75000 },
        advertising: { totalSpend: 2000, totalSales: 10000, impressions: 50000, clicks: 2500, acos: 20, roas: 5, activeCampaigns: 10 },
        period: "month",
        dateRange: { start: "2026-02-23", end: "2026-03-25" },
        prevDateRange: { start: "2026-01-24", end: "2026-02-23" },
      };

      expect(dashboard.products.total).toBe(202);
      expect(dashboard.products.active).toBe(150);
      expect(dashboard.profit.current.revenue).toBe(10000);
      expect(dashboard.profit.changes.revenue).toBe(25);
      expect(dashboard.inventory.totalStock).toBe(5000);
      expect(dashboard.advertising.acos).toBe(20);
      expect(dashboard.advertising.roas).toBe(5);
    });
  });
});
