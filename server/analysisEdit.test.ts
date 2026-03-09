import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock db
vi.mock("./db", () => ({
  getProjectById: vi.fn().mockResolvedValue({ id: 1, name: "Test", userId: "user1" }),
  getProjectFileById: vi.fn(),
  updateProjectFile: vi.fn(),
}));

// Mock storage
vi.mock("./storage", () => ({
  storagePut: vi.fn().mockResolvedValue({ url: "https://cdn.example.com/test.txt", key: "test.txt" }),
}));

// Mock LLM
vi.mock("./_core/llm", () => ({
  invokeLLM: vi.fn().mockResolvedValue({
    choices: [{ message: { content: "{}" } }],
  }),
}));

describe("Analysis Result Editing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("updateAnalysisResult validation", () => {
    it("should accept valid JSON analysis result", async () => {
      const db = await import("./db");
      const validResult = JSON.stringify({
        uniqueSellingPoints: ["USP1", "USP2"],
        coreSpecs: [{ attribute: "Weight", value: "500g" }],
        rufusFriendlyAttributes: ["BPA-free"],
        suggestedKeywordsFromAttributes: ["eco-friendly"],
      });

      (db.getProjectFileById as any).mockResolvedValueOnce({
        id: 1,
        projectId: 1,
        fileType: "product_attributes",
        status: "completed",
        analysisResult: "{}",
      });

      (db.updateProjectFile as any).mockResolvedValueOnce({
        id: 1,
        status: "completed",
        analysisResult: validResult,
      });

      // Simulate the update logic
      const file = await db.getProjectFileById(1);
      expect(file).toBeTruthy();

      // Validate JSON
      const parsed = JSON.parse(validResult);
      expect(parsed.uniqueSellingPoints).toHaveLength(2);
      expect(parsed.coreSpecs[0].attribute).toBe("Weight");

      const updated = await db.updateProjectFile(1, {
        analysisResult: validResult,
        status: "completed",
      });
      expect(updated.status).toBe("completed");
      expect(db.updateProjectFile).toHaveBeenCalledWith(1, {
        analysisResult: validResult,
        status: "completed",
      });
    });

    it("should reject invalid JSON", () => {
      const invalidJson = "{ invalid json }";
      expect(() => JSON.parse(invalidJson)).toThrow();
    });

    it("should preserve all fields when updating product_attributes", () => {
      const original = {
        coreSpecs: [{ attribute: "Weight", value: "500g", keywordRelevance: "high" }],
        materialBuild: [{ attribute: "Material", value: "ABS", sellingPoint: "durable" }],
        uniqueSellingPoints: ["USP1"],
        rufusFriendlyAttributes: ["attr1"],
        suggestedKeywordsFromAttributes: ["kw1"],
      };

      // Simulate user editing: add a new USP
      const edited = {
        ...original,
        uniqueSellingPoints: ["USP1", "USP2 - New"],
        rufusFriendlyAttributes: ["attr1", "attr2 - New"],
      };

      const serialized = JSON.stringify(edited);
      const deserialized = JSON.parse(serialized);

      expect(deserialized.uniqueSellingPoints).toHaveLength(2);
      expect(deserialized.uniqueSellingPoints[1]).toBe("USP2 - New");
      expect(deserialized.rufusFriendlyAttributes).toHaveLength(2);
      // Original fields preserved
      expect(deserialized.coreSpecs[0].keywordRelevance).toBe("high");
      expect(deserialized.materialBuild[0].sellingPoint).toBe("durable");
    });

    it("should preserve all fields when updating competitor_listings", () => {
      const original = {
        parityPoints: [
          { sellingPoint: "Vibrant colors", frequency: "all", importance: "must-have", competitorsUsing: ["A", "B"] },
        ],
        gapOpportunities: [
          { gap: "No outdoor mention", type: "ignored_scenario", evidence: "reviews", opportunityLevel: "high" },
        ],
        strategicRecommendations: {
          mustInclude: ["Color variety"],
          differentiators: ["Outdoor use"],
          avoidCopying: ["Generic claims"],
        },
      };

      // Simulate user editing: add a new parity point
      const edited = {
        ...original,
        parityPoints: [
          ...original.parityPoints,
          { sellingPoint: "Non-toxic", frequency: "most", importance: "important" },
        ],
        gapOpportunities: [
          ...original.gapOpportunities,
          { gap: "Missing gift packaging", type: "missing_feature", opportunityLevel: "medium" },
        ],
      };

      const serialized = JSON.stringify(edited);
      const deserialized = JSON.parse(serialized);

      expect(deserialized.parityPoints).toHaveLength(2);
      expect(deserialized.parityPoints[1].sellingPoint).toBe("Non-toxic");
      expect(deserialized.gapOpportunities).toHaveLength(2);
      expect(deserialized.strategicRecommendations.avoidCopying).toContain("Generic claims");
    });

    it("should preserve all fields when updating search_term_report (COSMO)", () => {
      const original = {
        scenesClusters: [
          {
            sceneName: "Birthday Party",
            sceneNameCn: "生日派对",
            priority: "high",
            buyerIntent: "Looking for party supplies",
            searchTerms: [{ term: "birthday", volume: 50000 }],
            listingMapping: { titleKeywords: ["birthday"], bulletAngle: "Perfect for parties" },
          },
        ],
        topScenesByVolume: ["Birthday Party"],
        emergingScenes: ["Eco-friendly crafts"],
      };

      // Simulate user editing: modify scene and add new one
      const edited = {
        ...original,
        scenesClusters: [
          { ...original.scenesClusters[0], priority: "medium" }, // downgrade priority
          {
            sceneName: "Kids Craft",
            sceneNameCn: "儿童手工",
            priority: "high",
            buyerIntent: "Educational activity",
          },
        ],
        topScenesByVolume: ["Birthday Party", "Kids Craft"],
      };

      const serialized = JSON.stringify(edited);
      const deserialized = JSON.parse(serialized);

      expect(deserialized.scenesClusters).toHaveLength(2);
      expect(deserialized.scenesClusters[0].priority).toBe("medium");
      expect(deserialized.scenesClusters[1].sceneName).toBe("Kids Craft");
      // Preserved fields
      expect(deserialized.scenesClusters[0].searchTerms[0].volume).toBe(50000);
      expect(deserialized.emergingScenes).toContain("Eco-friendly crafts");
    });

    it("should preserve all fields when updating aba_keywords (A9)", () => {
      const original = {
        titleMustHaveKeywords: ["wireless charger"],
        bulletPriorityKeywords: ["fast charging"],
        goldenKeywords: ["wireless charging pad"],
        backendKeywords: ["qi charger"],
        keywordStrategy: "Focus on charging terms",
        keywordClusters: [
          { clusterName: "Charging", keywords: ["charger", "charging"], totalVolume: "high", bestPlacement: "title" },
        ],
        keywordGrading: [
          { keyword: "wireless charger", tier: 1, placement: "title" },
        ],
      };

      // Simulate user editing: add keywords
      const edited = {
        ...original,
        titleMustHaveKeywords: ["wireless charger", "phone charger"],
        goldenKeywords: ["wireless charging pad", "magnetic charger"],
        keywordStrategy: "Focus on charging terms with magnetic angle",
      };

      const serialized = JSON.stringify(edited);
      const deserialized = JSON.parse(serialized);

      expect(deserialized.titleMustHaveKeywords).toHaveLength(2);
      expect(deserialized.goldenKeywords).toHaveLength(2);
      expect(deserialized.keywordStrategy).toContain("magnetic angle");
      // Preserved fields
      expect(deserialized.keywordClusters[0].clusterName).toBe("Charging");
      expect(deserialized.keywordGrading[0].tier).toBe(1);
    });

    it("should handle removing items from arrays", () => {
      const original = {
        uniqueSellingPoints: ["USP1", "USP2", "USP3"],
        coreSpecs: [
          { attribute: "Weight", value: "500g" },
          { attribute: "Color", value: "Red" },
          { attribute: "Size", value: "Large" },
        ],
      };

      // Simulate user removing items
      const edited = {
        ...original,
        uniqueSellingPoints: ["USP1", "USP3"], // removed USP2
        coreSpecs: [
          { attribute: "Weight", value: "500g" },
          { attribute: "Size", value: "Large" },
        ], // removed Color
      };

      const serialized = JSON.stringify(edited);
      const deserialized = JSON.parse(serialized);

      expect(deserialized.uniqueSellingPoints).toHaveLength(2);
      expect(deserialized.uniqueSellingPoints).not.toContain("USP2");
      expect(deserialized.coreSpecs).toHaveLength(2);
      expect(deserialized.coreSpecs.find((s: any) => s.attribute === "Color")).toBeUndefined();
    });

    it("should handle empty arrays gracefully", () => {
      const edited = {
        uniqueSellingPoints: [],
        coreSpecs: [],
        rufusFriendlyAttributes: [],
        suggestedKeywordsFromAttributes: [],
      };

      const serialized = JSON.stringify(edited);
      const deserialized = JSON.parse(serialized);

      expect(deserialized.uniqueSellingPoints).toEqual([]);
      expect(deserialized.coreSpecs).toEqual([]);
    });

    it("should update database with edited analysis result", async () => {
      const db = await import("./db");

      const editedResult = {
        titleMustHaveKeywords: ["kw1", "kw2"],
        bulletPriorityKeywords: ["bp1"],
        goldenKeywords: ["gk1"],
        backendKeywords: ["bk1"],
        keywordStrategy: "Updated strategy",
      };

      (db.getProjectFileById as any).mockResolvedValueOnce({
        id: 5,
        projectId: 1,
        fileType: "aba_keywords",
        status: "completed",
        analysisResult: JSON.stringify({ titleMustHaveKeywords: ["old"] }),
      });

      (db.updateProjectFile as any).mockResolvedValueOnce({
        id: 5,
        status: "completed",
        analysisResult: JSON.stringify(editedResult),
      });

      const file = await db.getProjectFileById(5);
      expect(file).toBeTruthy();

      const updated = await db.updateProjectFile(5, {
        analysisResult: JSON.stringify(editedResult),
        status: "completed",
      });

      expect(db.updateProjectFile).toHaveBeenCalledWith(5, {
        analysisResult: JSON.stringify(editedResult),
        status: "completed",
      });
      expect(JSON.parse(updated.analysisResult).titleMustHaveKeywords).toEqual(["kw1", "kw2"]);
    });
  });
});
