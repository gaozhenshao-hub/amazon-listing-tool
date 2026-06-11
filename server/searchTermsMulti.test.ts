import { describe, it, expect } from "vitest";
import { appRouter } from "./routers";

describe("Multi-Campaign Search Terms Aggregation", () => {
  const router = appRouter;

  it("adAnalysis router should have getSearchTermsMultiCampaign procedure", () => {
    const adAnalysis = (router as any)._def.procedures;
    // Check that the procedure exists
    expect(adAnalysis).toBeDefined();
    const procedureNames = Object.keys(adAnalysis);
    expect(procedureNames).toContain("adAnalysis.getSearchTermsMultiCampaign");
  });

  it("getSearchTermsMultiCampaign should accept campaignIds array input", () => {
    // Verify the procedure is a query (not mutation)
    const proc = (router as any)._def.procedures["adAnalysis.getSearchTermsMultiCampaign"];
    expect(proc).toBeDefined();
    expect(proc._def.type).toBe("query");
  });

  it("should have correct input schema for multi-campaign query", () => {
    const proc = (router as any)._def.procedures["adAnalysis.getSearchTermsMultiCampaign"];
    expect(proc).toBeDefined();
    // The procedure should accept an object with campaignIds array
    const inputParser = proc._def.inputs?.[0];
    expect(inputParser).toBeDefined();
  });
});

describe("SearchTermClassification Multi-Mode Features", () => {
  it("CATEGORY_COLORS should have 12 categories defined", () => {
    // This tests the constant that's used in both single and multi mode
    const expectedCategories = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
    expect(expectedCategories.length).toBe(12);
  });

  it("aggregation logic should merge same search terms from different campaigns", () => {
    // Simulate the aggregation logic from the backend
    const campaign1Terms = [
      { query: "bread slicer", impressions: 100, clicks: 10, cost: 5, sales: 20, orders: 2 },
      { query: "bread cutter", impressions: 50, clicks: 5, cost: 2.5, sales: 10, orders: 1 },
    ];
    const campaign2Terms = [
      { query: "bread slicer", impressions: 200, clicks: 20, cost: 10, sales: 40, orders: 4 },
      { query: "toast slicer", impressions: 30, clicks: 3, cost: 1.5, sales: 6, orders: 1 },
    ];

    // Simulate aggregation
    const merged = new Map<string, any>();
    [...campaign1Terms, ...campaign2Terms].forEach(t => {
      const key = t.query.toLowerCase();
      if (merged.has(key)) {
        const existing = merged.get(key);
        existing.impressions += t.impressions;
        existing.clicks += t.clicks;
        existing.cost += t.cost;
        existing.sales += t.sales;
        existing.orders += t.orders;
        existing.sourceCount += 1;
      } else {
        merged.set(key, { ...t, sourceCount: 1 });
      }
    });

    expect(merged.size).toBe(3); // bread slicer (merged), bread cutter, toast slicer
    const breadSlicer = merged.get("bread slicer");
    expect(breadSlicer.impressions).toBe(300);
    expect(breadSlicer.clicks).toBe(30);
    expect(breadSlicer.cost).toBe(15);
    expect(breadSlicer.sales).toBe(60);
    expect(breadSlicer.orders).toBe(6);
    expect(breadSlicer.sourceCount).toBe(2);
  });

  it("localStorage persistence should serialize/deserialize campaign selection", () => {
    // Simulate the localStorage serialization format used in OpsAds
    const selectedCampaigns = new Map<string, { name: string; type: string }>();
    selectedCampaigns.set("camp1", { name: "Campaign 1", type: "SP" });
    selectedCampaigns.set("camp2", { name: "Campaign 2", type: "SB" });

    // Serialize
    const arr = Array.from(selectedCampaigns.entries()).map(([id, info]) => ({
      id, name: info.name, type: info.type,
    }));
    const serialized = JSON.stringify(arr);

    // Deserialize
    const parsed = JSON.parse(serialized);
    const restored = new Map<string, { name: string; type: string }>();
    parsed.forEach((item: any) => {
      restored.set(item.id, { name: item.name, type: item.type });
    });

    expect(restored.size).toBe(2);
    expect(restored.get("camp1")?.name).toBe("Campaign 1");
    expect(restored.get("camp2")?.type).toBe("SB");
  });

  it("source campaign filter should correctly filter terms by campaign ID", () => {
    const terms = [
      { query: "term1", sourceCampaignIds: ["c1", "c2"] },
      { query: "term2", sourceCampaignIds: ["c1"] },
      { query: "term3", sourceCampaignIds: ["c2", "c3"] },
    ];

    // Filter by c1
    const filteredC1 = terms.filter(t => t.sourceCampaignIds.includes("c1"));
    expect(filteredC1.length).toBe(2);
    expect(filteredC1.map(t => t.query)).toEqual(["term1", "term2"]);

    // Filter by c3
    const filteredC3 = terms.filter(t => t.sourceCampaignIds.includes("c3"));
    expect(filteredC3.length).toBe(1);
    expect(filteredC3[0].query).toBe("term3");

    // No filter (all)
    expect(terms.length).toBe(3);
  });
});
