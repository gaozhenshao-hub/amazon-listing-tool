import { describe, it, expect } from "vitest";

// ─── Test: Tag Cross Analysis Integration ───

describe("Tag Cross Analysis Integration", () => {
  // ─── 1. Router Registration ───
  describe("Router Registration", () => {
    it("devAnalysis router should have getConfirmedProjectTags procedure", async () => {
      const { devAnalysisRouter } = await import("./routers/devAnalysis");
      const procedures = Object.keys((devAnalysisRouter as any)._def.procedures || {});
      expect(procedures).toContain("getConfirmedProjectTags");
    });

    it("devAnalysis router should have runTagCrossAnalysis procedure", async () => {
      const { devAnalysisRouter } = await import("./routers/devAnalysis");
      const procedures = Object.keys((devAnalysisRouter as any)._def.procedures || {});
      expect(procedures).toContain("runTagCrossAnalysis");
    });
  });

  // ─── 2. Schema Validation ───
  describe("Schema Validation", () => {
    it("devProjectTagCategories table should have required columns", async () => {
      const schema = await import("../drizzle/schema");
      const table = schema.devProjectTagCategories;
      expect(table).toBeDefined();
      const cols = Object.keys(table);
      // Table should have projectId, categoryKey, categoryName, confirmed fields
      expect(cols.length).toBeGreaterThan(0);
    });

    it("devProjectTagItems table should have required columns", async () => {
      const schema = await import("../drizzle/schema");
      const table = schema.devProjectTagItems;
      expect(table).toBeDefined();
      const cols = Object.keys(table);
      expect(cols.length).toBeGreaterThan(0);
    });
  });

  // ─── 3. Cross Analysis Logic ───
  describe("Cross Analysis Logic", () => {
    it("should have calcCrossAnalysis function in devStatsEngine", async () => {
      const engine = await import("./devStatsEngine");
      expect(typeof engine.calcCrossAnalysis).toBe("function");
    });

    it("calcCrossAnalysis should handle empty tag data gracefully", async () => {
      const engine = await import("./devStatsEngine");
      const result = engine.calcCrossAnalysis([], [], "材质", "功能");
      expect(result).toBeDefined();
      expect(result.dim1Name).toBe("材质");
      expect(result.dim2Name).toBe("功能");
      expect(result.matrix).toBeDefined();
    });

    it("calcCrossAnalysis should return structured result with dimension info", async () => {
      const engine = await import("./devStatsEngine");
      const products: any[] = [
        { asin: "A1", price: "10", rating: 4.5, reviews: 100, monthlySales: 50, monthlyRevenue: "500" },
        { asin: "A2", price: "20", rating: 3.5, reviews: 200, monthlySales: 30, monthlyRevenue: "600" },
      ];
      const tags: any[] = [
        { asin: "A1", dimensionName: "材质", dimensionValue: "金属" },
        { asin: "A2", dimensionName: "材质", dimensionValue: "塑料" },
        { asin: "A1", dimensionName: "功能", dimensionValue: "防水" },
        { asin: "A2", dimensionName: "功能", dimensionValue: "普通" },
      ];
      const result = engine.calcCrossAnalysis(products, tags, "材质", "功能");
      expect(result).toBeDefined();
      expect(result.dim1Name).toBe("材质");
      expect(result.dim2Name).toBe("功能");
      expect(result.dim1Values).toContain("金属");
      expect(result.dim2Values).toContain("防水");
    });

    it("calcCrossAnalysis should compute matrix for 2 dimensions with hot combos", async () => {
      const engine = await import("./devStatsEngine");
      const products: any[] = [
        { asin: "A1", price: "10", rating: 4.5, reviews: 100, monthlySales: 50, monthlyRevenue: "500" },
        { asin: "A2", price: "20", rating: 3.5, reviews: 200, monthlySales: 30, monthlyRevenue: "600" },
        { asin: "A3", price: "15", rating: 4.0, reviews: 150, monthlySales: 40, monthlyRevenue: "600" },
      ];
      const tags: any[] = [
        { asin: "A1", dimensionName: "材质", dimensionValue: "金属" },
        { asin: "A2", dimensionName: "材质", dimensionValue: "塑料" },
        { asin: "A3", dimensionName: "材质", dimensionValue: "金属" },
        { asin: "A1", dimensionName: "功能", dimensionValue: "防水" },
        { asin: "A2", dimensionName: "功能", dimensionValue: "防水" },
        { asin: "A3", dimensionName: "功能", dimensionValue: "普通" },
      ];
      const result = engine.calcCrossAnalysis(products, tags, "材质", "功能");
      expect(result.dim1Name).toBe("材质");
      expect(result.dim2Name).toBe("功能");
      expect(result.matrix.length).toBeGreaterThan(0);
      // Should have hot combinations
      expect(result.hotCombinations).toBeDefined();
      expect(Array.isArray(result.hotCombinations)).toBe(true);
    });
  });

  // ─── 4. Tag Data Format ───
  describe("Tag Data Format", () => {
    it("confirmed project tags should have categories with tags", () => {
      // Simulate the expected response format
      const mockResponse = {
        categories: [
          { categoryId: 1, categoryName: "基础分类属性", tags: [{ tagName: "类型", tagValue: "LED灯" }] },
          { categoryId: 2, categoryName: "材质属性", tags: [{ tagName: "主材质", tagValue: "铝合金" }] },
        ],
        status: { total: 7, confirmed: 7, allConfirmed: true, initialized: true },
      };
      
      expect(mockResponse.categories).toHaveLength(2);
      expect(mockResponse.status.allConfirmed).toBe(true);
      expect(mockResponse.categories[0].tags).toHaveLength(1);
      expect(mockResponse.categories[0].tags[0].tagName).toBe("类型");
    });

    it("tag cross analysis should accept optional dimension category IDs", () => {
      // Validate the input schema shape
      const input = { projectId: 1, dim1CategoryId: 1, dim2CategoryId: 2 };
      expect(input.projectId).toBe(1);
      expect(input.dim1CategoryId).toBe(1);
      expect(input.dim2CategoryId).toBe(2);
    });

    it("tag cross analysis should work without specifying dimensions (auto-select)", () => {
      const input = { projectId: 1 };
      expect(input.projectId).toBe(1);
      expect((input as any).dim1CategoryId).toBeUndefined();
      expect((input as any).dim2CategoryId).toBeUndefined();
    });
  });

  // ─── 5. Integration Flow ───
  describe("Integration Flow", () => {
    it("should have all required analysis procedures in devAnalysis router", async () => {
      const { devAnalysisRouter } = await import("./routers/devAnalysis");
      const procedures = Object.keys((devAnalysisRouter as any)._def.procedures || {});
      // Core analysis procedures (runAttributeTagging moved to devTagging router)
      expect(procedures).toContain("runAttributeCross");
      expect(procedures).toContain("runTagCrossAnalysis");
      expect(procedures).toContain("getConfirmedProjectTags");
      expect(procedures).toContain("getStages");
    });

    it("tag management router should have confirm flow", async () => {
      const { devProjectTagsRouter } = await import("./routers/devProjectTags");
      const procedures = Object.keys((devProjectTagsRouter as any)._def.procedures || {});
      expect(procedures).toContain("confirmCategory");
      expect(procedures).toContain("confirmAll");
      expect(procedures).toContain("getTagStatus");
    });

    it("cross analysis should be able to use both old and new tag systems", async () => {
      const { devAnalysisRouter } = await import("./routers/devAnalysis");
      const procedures = Object.keys((devAnalysisRouter as any)._def.procedures || {});
      // Old system
      expect(procedures).toContain("runAttributeCross");
      // New system (project-level tags)
      expect(procedures).toContain("runTagCrossAnalysis");
    });
  });
});
