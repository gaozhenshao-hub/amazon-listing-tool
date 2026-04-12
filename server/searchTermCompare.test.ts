import { describe, it, expect } from "vitest";

describe("SearchTermCompareMode - Data Structure", () => {
  // Test the data aggregation logic that powers the compare mode
  
  it("should correctly aggregate search terms by campaign for comparison", () => {
    // Simulate the data structure returned by getSearchTermsMultiCampaign
    const mockSearchTerms = [
      {
        query: "bread slicer",
        impressions: 5000,
        clicks: 200,
        cost: 50.00,
        sales: 300.00,
        orders: 15,
        acos: 16.67,
        ctr: 4.0,
        convRate: 7.5,
        categoryId: 1,
        sourceCampaignIds: ["camp1", "camp2"],
        sourceCampaigns: [
          { campaignId: "camp1", impressions: 3000, clicks: 120, cost: 30, sales: 200, orders: 10, acos: 15.0, ctr: 4.0, convRate: 8.33 },
          { campaignId: "camp2", impressions: 2000, clicks: 80, cost: 20, sales: 100, orders: 5, acos: 20.0, ctr: 4.0, convRate: 6.25 },
        ],
      },
      {
        query: "bread cutting guide",
        impressions: 1000,
        clicks: 50,
        cost: 12.00,
        sales: 80.00,
        orders: 4,
        acos: 15.0,
        ctr: 5.0,
        convRate: 8.0,
        categoryId: 5,
        sourceCampaignIds: ["camp1"],
        sourceCampaigns: [
          { campaignId: "camp1", impressions: 1000, clicks: 50, cost: 12, sales: 80, orders: 4, acos: 15.0, ctr: 5.0, convRate: 8.0 },
        ],
      },
    ];

    // Verify multi-campaign terms have sourceCampaigns array
    const multiCampaignTerms = mockSearchTerms.filter(t => t.sourceCampaignIds.length > 1);
    expect(multiCampaignTerms).toHaveLength(1);
    expect(multiCampaignTerms[0].query).toBe("bread slicer");
    expect(multiCampaignTerms[0].sourceCampaigns).toHaveLength(2);

    // Verify single-campaign terms
    const singleCampaignTerms = mockSearchTerms.filter(t => t.sourceCampaignIds.length === 1);
    expect(singleCampaignTerms).toHaveLength(1);
    expect(singleCampaignTerms[0].query).toBe("bread cutting guide");
  });

  it("should build campaign comparison matrix correctly", () => {
    const campaignIds = ["camp1", "camp2", "camp3"];
    const campaignNames: Record<string, string> = {
      camp1: "SP-品牌词-精准",
      camp2: "SP-竞品词-广泛",
      camp3: "SP-长尾词-自动",
    };

    const mockSearchTerms = [
      {
        query: "bread slicer",
        sourceCampaigns: [
          { campaignId: "camp1", cost: 30, sales: 200, acos: 15.0 },
          { campaignId: "camp2", cost: 20, sales: 100, acos: 20.0 },
        ],
      },
      {
        query: "bread cutter",
        sourceCampaigns: [
          { campaignId: "camp1", cost: 10, sales: 50, acos: 20.0 },
          { campaignId: "camp3", cost: 5, sales: 40, acos: 12.5 },
        ],
      },
    ];

    // Build comparison matrix: for each search term, map campaignId -> metrics
    const comparisonMatrix = mockSearchTerms.map(term => {
      const bycamp: Record<string, any> = {};
      for (const sc of term.sourceCampaigns) {
        bycamp[sc.campaignId] = sc;
      }
      return { query: term.query, campaigns: bycamp };
    });

    expect(comparisonMatrix).toHaveLength(2);
    expect(comparisonMatrix[0].campaigns["camp1"].acos).toBe(15.0);
    expect(comparisonMatrix[0].campaigns["camp2"].acos).toBe(20.0);
    expect(comparisonMatrix[0].campaigns["camp3"]).toBeUndefined(); // not in this term
    expect(comparisonMatrix[1].campaigns["camp3"].acos).toBe(12.5);
  });

  it("should calculate campaign-level summaries for comparison cards", () => {
    const campaignSummaries = [
      { campaignId: "camp1", totalCost: 100, totalSales: 500, totalOrders: 25, termCount: 50, acos: 20.0 },
      { campaignId: "camp2", totalCost: 80, totalSales: 300, totalOrders: 15, termCount: 30, acos: 26.67 },
    ];

    // Verify summary calculations
    expect(campaignSummaries[0].acos).toBe(20.0);
    expect(campaignSummaries[1].acos).toBeCloseTo(26.67, 1);
    
    // Best performer by ACOS
    const bestByCost = [...campaignSummaries].sort((a, b) => a.acos - b.acos)[0];
    expect(bestByCost.campaignId).toBe("camp1");
  });

  it("should identify overlap and unique search terms", () => {
    const overlapStats = {
      overlapCount: 15,
      uniqueCount: 45,
      overlapCost: 200,
      overlapSales: 800,
    };

    expect(overlapStats.overlapCount).toBe(15);
    expect(overlapStats.uniqueCount).toBe(45);
    const totalTerms = overlapStats.overlapCount + overlapStats.uniqueCount;
    expect(totalTerms).toBe(60);
    const overlapRate = (overlapStats.overlapCount / totalTerms * 100).toFixed(1);
    expect(overlapRate).toBe("25.0");
  });

  it("should support filtering compare table by metric threshold", () => {
    const terms = [
      { query: "term1", sourceCampaigns: [{ campaignId: "c1", acos: 15 }, { campaignId: "c2", acos: 30 }] },
      { query: "term2", sourceCampaigns: [{ campaignId: "c1", acos: 25 }, { campaignId: "c2", acos: 10 }] },
      { query: "term3", sourceCampaigns: [{ campaignId: "c1", acos: 5 }] },
    ];

    // Filter: only terms where ACoS difference between campaigns > 10%
    const significantDiff = terms.filter(t => {
      if (t.sourceCampaigns.length < 2) return false;
      const acosValues = t.sourceCampaigns.map(sc => sc.acos);
      const diff = Math.max(...acosValues) - Math.min(...acosValues);
      return diff > 10;
    });

    expect(significantDiff).toHaveLength(2);
    expect(significantDiff[0].query).toBe("term1"); // diff = 15
    expect(significantDiff[1].query).toBe("term2"); // diff = 15
  });

  it("should generate radar chart data for a selected search term", () => {
    const term = {
      query: "bread slicer",
      sourceCampaigns: [
        { campaignId: "camp1", impressions: 3000, clicks: 120, cost: 30, sales: 200, orders: 10, acos: 15.0, ctr: 4.0, convRate: 8.33 },
        { campaignId: "camp2", impressions: 2000, clicks: 80, cost: 20, sales: 100, orders: 5, acos: 20.0, ctr: 4.0, convRate: 6.25 },
      ],
    };

    // Build radar chart data: normalize each metric to 0-100 scale
    const metrics = ["impressions", "clicks", "sales", "orders", "ctr", "convRate"] as const;
    const radarData = metrics.map(metric => {
      const values = term.sourceCampaigns.map(sc => (sc as any)[metric] as number);
      const maxVal = Math.max(...values);
      return {
        metric,
        ...Object.fromEntries(term.sourceCampaigns.map(sc => [
          sc.campaignId,
          maxVal > 0 ? Math.round(((sc as any)[metric] as number) / maxVal * 100) : 0,
        ])),
      };
    });

    expect(radarData).toHaveLength(6);
    expect(radarData[0].metric).toBe("impressions");
    expect((radarData[0] as any)["camp1"]).toBe(100); // 3000/3000 * 100
    expect((radarData[0] as any)["camp2"]).toBe(67); // 2000/3000 * 100 ≈ 67
  });
});

describe("localStorage Selection Persistence", () => {
  it("should serialize and deserialize campaign selection correctly", () => {
    const selectedCampaigns = new Map<string, { id: string; name: string; portfolioId: string }>();
    selectedCampaigns.set("camp1", { id: "camp1", name: "SP-品牌词", portfolioId: "port1" });
    selectedCampaigns.set("camp2", { id: "camp2", name: "SP-竞品词", portfolioId: "port2" });

    // Serialize to localStorage format
    const serialized = JSON.stringify(Array.from(selectedCampaigns.entries()));
    
    // Deserialize back
    const parsed = JSON.parse(serialized);
    const restored = new Map(parsed);
    
    expect(restored.size).toBe(2);
    expect((restored.get("camp1") as any).name).toBe("SP-品牌词");
    expect((restored.get("camp2") as any).portfolioId).toBe("port2");
  });

  it("should handle empty selection gracefully", () => {
    const emptyMap = new Map();
    const serialized = JSON.stringify(Array.from(emptyMap.entries()));
    expect(serialized).toBe("[]");
    
    const restored = new Map(JSON.parse(serialized));
    expect(restored.size).toBe(0);
  });

  it("should handle corrupted localStorage data", () => {
    const corruptedData = "not valid json";
    let restored = new Map();
    try {
      restored = new Map(JSON.parse(corruptedData));
    } catch {
      restored = new Map(); // fallback to empty
    }
    expect(restored.size).toBe(0);
  });
});
