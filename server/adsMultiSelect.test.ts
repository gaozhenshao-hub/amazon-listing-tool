import { describe, it, expect } from "vitest";

/**
 * Tests for the Ads Multi-Select feature.
 * This tests the data structures and logic used by the multi-select UI.
 */

describe("Ads Multi-Select Feature", () => {
  // Test the selection logic that aggregates campaign stats
  describe("Campaign Selection Aggregation", () => {
    interface Campaign {
      campaign_id: string;
      campaign_name: string;
      portfolio_id: string;
      impressions: number;
      clicks: number;
      spend: number;
      sales: number;
      orders: number;
      acos: number;
      roas: number;
      ctr: number;
      cpc: number;
    }

    function aggregateSelectedCampaigns(campaigns: Campaign[]) {
      const totalSpend = campaigns.reduce((sum, c) => sum + c.spend, 0);
      const totalSales = campaigns.reduce((sum, c) => sum + c.sales, 0);
      const totalOrders = campaigns.reduce((sum, c) => sum + c.orders, 0);
      const totalImpressions = campaigns.reduce((sum, c) => sum + c.impressions, 0);
      const totalClicks = campaigns.reduce((sum, c) => sum + c.clicks, 0);
      const acos = totalSales > 0 ? (totalSpend / totalSales) * 100 : 0;
      const roas = totalSpend > 0 ? totalSales / totalSpend : 0;
      const ctr = totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0;
      return { totalSpend, totalSales, totalOrders, totalImpressions, totalClicks, acos, roas, ctr };
    }

    const mockCampaigns: Campaign[] = [
      {
        campaign_id: "1", campaign_name: "Campaign A", portfolio_id: "p1",
        impressions: 1000, clicks: 50, spend: 100, sales: 500, orders: 10,
        acos: 20, roas: 5, ctr: 5, cpc: 2
      },
      {
        campaign_id: "2", campaign_name: "Campaign B", portfolio_id: "p1",
        impressions: 2000, clicks: 80, spend: 200, sales: 800, orders: 15,
        acos: 25, roas: 4, ctr: 4, cpc: 2.5
      },
      {
        campaign_id: "3", campaign_name: "Campaign C", portfolio_id: "p2",
        impressions: 500, clicks: 20, spend: 50, sales: 0, orders: 0,
        acos: 0, roas: 0, ctr: 4, cpc: 2.5
      },
    ];

    it("should aggregate stats for single selected campaign", () => {
      const result = aggregateSelectedCampaigns([mockCampaigns[0]]);
      expect(result.totalSpend).toBe(100);
      expect(result.totalSales).toBe(500);
      expect(result.totalOrders).toBe(10);
      expect(result.acos).toBeCloseTo(20, 1);
      expect(result.roas).toBe(5);
    });

    it("should aggregate stats for multiple selected campaigns", () => {
      const result = aggregateSelectedCampaigns([mockCampaigns[0], mockCampaigns[1]]);
      expect(result.totalSpend).toBe(300);
      expect(result.totalSales).toBe(1300);
      expect(result.totalOrders).toBe(25);
      expect(result.acos).toBeCloseTo(23.08, 1);
      expect(result.roas).toBeCloseTo(4.33, 1);
      expect(result.totalImpressions).toBe(3000);
      expect(result.totalClicks).toBe(130);
      expect(result.ctr).toBeCloseTo(4.33, 1);
    });

    it("should handle zero sales correctly (no division by zero)", () => {
      const result = aggregateSelectedCampaigns([mockCampaigns[2]]);
      expect(result.totalSpend).toBe(50);
      expect(result.totalSales).toBe(0);
      expect(result.acos).toBe(0);
      expect(result.roas).toBe(0);
    });

    it("should handle empty selection", () => {
      const result = aggregateSelectedCampaigns([]);
      expect(result.totalSpend).toBe(0);
      expect(result.totalSales).toBe(0);
      expect(result.totalOrders).toBe(0);
      expect(result.acos).toBe(0);
      expect(result.roas).toBe(0);
    });
  });

  // Test portfolio-level selection logic
  describe("Portfolio Selection Logic", () => {
    interface Campaign {
      campaign_id: string;
      portfolio_id: string;
    }

    function selectPortfolioCampaigns(
      allCampaigns: Campaign[],
      portfolioId: string,
      currentSelected: Set<string>
    ): Set<string> {
      const portfolioCampaigns = allCampaigns.filter(c => c.portfolio_id === portfolioId);
      const allSelected = portfolioCampaigns.every(c => currentSelected.has(c.campaign_id));
      const newSelected = new Set(currentSelected);
      if (allSelected) {
        // Deselect all in this portfolio
        portfolioCampaigns.forEach(c => newSelected.delete(c.campaign_id));
      } else {
        // Select all in this portfolio
        portfolioCampaigns.forEach(c => newSelected.add(c.campaign_id));
      }
      return newSelected;
    }

    const campaigns: Campaign[] = [
      { campaign_id: "1", portfolio_id: "p1" },
      { campaign_id: "2", portfolio_id: "p1" },
      { campaign_id: "3", portfolio_id: "p1" },
      { campaign_id: "4", portfolio_id: "p2" },
      { campaign_id: "5", portfolio_id: "p2" },
    ];

    it("should select all campaigns in a portfolio when none are selected", () => {
      const result = selectPortfolioCampaigns(campaigns, "p1", new Set());
      expect(result.size).toBe(3);
      expect(result.has("1")).toBe(true);
      expect(result.has("2")).toBe(true);
      expect(result.has("3")).toBe(true);
    });

    it("should deselect all campaigns in a portfolio when all are selected", () => {
      const result = selectPortfolioCampaigns(campaigns, "p1", new Set(["1", "2", "3"]));
      expect(result.size).toBe(0);
    });

    it("should select remaining campaigns when some are already selected", () => {
      const result = selectPortfolioCampaigns(campaigns, "p1", new Set(["1"]));
      expect(result.size).toBe(3);
      expect(result.has("1")).toBe(true);
      expect(result.has("2")).toBe(true);
      expect(result.has("3")).toBe(true);
    });

    it("should not affect campaigns in other portfolios", () => {
      const result = selectPortfolioCampaigns(campaigns, "p1", new Set(["4", "5"]));
      expect(result.size).toBe(5);
      expect(result.has("4")).toBe(true);
      expect(result.has("5")).toBe(true);
    });
  });

  // Test the select-all logic
  describe("Select All Logic", () => {
    function selectAll(
      allCampaignIds: string[],
      currentSelected: Set<string>
    ): Set<string> {
      const allSelected = allCampaignIds.every(id => currentSelected.has(id));
      if (allSelected) {
        return new Set<string>();
      }
      return new Set(allCampaignIds);
    }

    it("should select all when none are selected", () => {
      const result = selectAll(["1", "2", "3"], new Set());
      expect(result.size).toBe(3);
    });

    it("should deselect all when all are selected", () => {
      const result = selectAll(["1", "2", "3"], new Set(["1", "2", "3"]));
      expect(result.size).toBe(0);
    });

    it("should select all when some are selected", () => {
      const result = selectAll(["1", "2", "3"], new Set(["1"]));
      expect(result.size).toBe(3);
    });
  });

  // Test campaign type filtering
  describe("Campaign Type Filtering", () => {
    interface Campaign {
      campaign_id: string;
      campaign_type: string;
      state: string;
    }

    function filterCampaigns(
      campaigns: Campaign[],
      typeFilter: string,
      stateFilter: string
    ): Campaign[] {
      return campaigns.filter(c => {
        const typeMatch = typeFilter === "all" || c.campaign_type === typeFilter;
        const stateMatch = stateFilter === "all" || c.state === stateFilter;
        return typeMatch && stateMatch;
      });
    }

    const campaigns: Campaign[] = [
      { campaign_id: "1", campaign_type: "sponsoredProducts", state: "enabled" },
      { campaign_id: "2", campaign_type: "sponsoredProducts", state: "paused" },
      { campaign_id: "3", campaign_type: "sponsoredBrands", state: "enabled" },
      { campaign_id: "4", campaign_type: "sponsoredDisplay", state: "archived" },
    ];

    it("should return all campaigns with no filters", () => {
      expect(filterCampaigns(campaigns, "all", "all").length).toBe(4);
    });

    it("should filter by campaign type", () => {
      expect(filterCampaigns(campaigns, "sponsoredProducts", "all").length).toBe(2);
      expect(filterCampaigns(campaigns, "sponsoredBrands", "all").length).toBe(1);
    });

    it("should filter by state", () => {
      expect(filterCampaigns(campaigns, "all", "enabled").length).toBe(2);
      expect(filterCampaigns(campaigns, "all", "paused").length).toBe(1);
    });

    it("should combine type and state filters", () => {
      expect(filterCampaigns(campaigns, "sponsoredProducts", "enabled").length).toBe(1);
    });
  });
});
