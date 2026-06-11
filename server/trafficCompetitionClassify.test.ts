import { describe, it, expect, vi } from "vitest";

// Mock db module
vi.mock("./db", () => ({
  getProjectById: vi.fn().mockResolvedValue({ id: 1, name: "Test Product", brand: "TestBrand", category: "Electronics" }),
  getKeywordsByProject: vi.fn().mockResolvedValue([
    { id: 1, keyword: "wireless charger", monthlySearchVolume: 50000, spr: 120, isNegative: 0, trafficLevel: "medium", competition: "medium" },
    { id: 2, keyword: "fast wireless charger", monthlySearchVolume: 15000, spr: 60, isNegative: 0, trafficLevel: "medium", competition: "medium" },
    { id: 3, keyword: "qi charger pad", monthlySearchVolume: 3000, spr: 15, isNegative: 0, trafficLevel: "medium", competition: "medium" },
    { id: 4, keyword: "wireless charging stand", monthlySearchVolume: 800, spr: 8, isNegative: 0, trafficLevel: "medium", competition: "medium" },
    { id: 5, keyword: "no data keyword", monthlySearchVolume: null, spr: null, isNegative: 0, trafficLevel: "medium", competition: "medium" },
  ]),
  updateKeyword: vi.fn().mockResolvedValue({}),
  createKeyword: vi.fn(),
  bulkCreateKeywords: vi.fn(),
  getKeywordById: vi.fn(),
  bulkUpdateKeywords: vi.fn(),
  deleteKeyword: vi.fn(),
  deleteKeywordsByProject: vi.fn(),
  getKeywordStats: vi.fn(),
  createNegativeKeyword: vi.fn(),
  bulkCreateNegativeKeywords: vi.fn(),
  getNegativeKeywordsByProject: vi.fn(),
  deleteNegativeKeyword: vi.fn(),
  deleteNegativeKeywordsByProject: vi.fn(),
}));

// Mock LLM
vi.mock("./_core/llm", () => ({
  invokeLLM: vi.fn().mockResolvedValue({
    choices: [{
      message: {
        content: JSON.stringify({
          analysis: {
            totalKeywords: 5,
            searchVolumeRange: { min: 800, max: 50000, median: 3000 },
            sprRange: { min: 8, max: 120, median: 15 },
            trafficThresholds: { highMin: 10000, mediumMin: 2000 },
            competitionThresholds: { lowMax: 20, mediumMax: 80 },
          },
          results: [
            { keyword: "wireless charger", trafficLevel: "high", competition: "high" },
            { keyword: "fast wireless charger", trafficLevel: "high", competition: "medium" },
            { keyword: "qi charger pad", trafficLevel: "medium", competition: "low" },
            { keyword: "wireless charging stand", trafficLevel: "low", competition: "low" },
            { keyword: "no data keyword", trafficLevel: "medium", competition: "medium" },
          ],
        }),
      },
    }],
  }),
}));

// Import the prompt to test
import { KEYWORD_TRAFFIC_COMPETITION_CLASSIFY_PROMPT } from "./keywordPrompts";

describe("AI Traffic & Competition Classification", () => {
  describe("Prompt design", () => {
    it("should instruct AI to analyze overall data distribution instead of fixed thresholds", () => {
      expect(KEYWORD_TRAFFIC_COMPETITION_CLASSIFY_PROMPT).toContain("Do NOT use fixed thresholds");
      expect(KEYWORD_TRAFFIC_COMPETITION_CLASSIFY_PROMPT).toContain("OVERALL DATA DISTRIBUTION");
    });

    it("should classify traffic level based on monthly search volume", () => {
      expect(KEYWORD_TRAFFIC_COMPETITION_CLASSIFY_PROMPT).toContain("monthly search volume");
      expect(KEYWORD_TRAFFIC_COMPETITION_CLASSIFY_PROMPT).toContain("trafficLevel");
    });

    it("should classify competition level based on SPR", () => {
      expect(KEYWORD_TRAFFIC_COMPETITION_CLASSIFY_PROMPT).toContain("SPR");
      expect(KEYWORD_TRAFFIC_COMPETITION_CLASSIFY_PROMPT).toContain("competition");
    });

    it("should request thresholds in the response", () => {
      expect(KEYWORD_TRAFFIC_COMPETITION_CLASSIFY_PROMPT).toContain("trafficThresholds");
      expect(KEYWORD_TRAFFIC_COMPETITION_CLASSIFY_PROMPT).toContain("competitionThresholds");
    });

    it("should include the no-translate keyword rule", () => {
      expect(KEYWORD_TRAFFIC_COMPETITION_CLASSIFY_PROMPT).toContain("Do NOT translate");
      expect(KEYWORD_TRAFFIC_COMPETITION_CLASSIFY_PROMPT).toContain("exact original English keyword");
    });

    it("should use percentile-based classification guidance", () => {
      expect(KEYWORD_TRAFFIC_COMPETITION_CLASSIFY_PROMPT).toContain("percentile");
      expect(KEYWORD_TRAFFIC_COMPETITION_CLASSIFY_PROMPT).toContain("median");
    });

    it("should handle keywords with no data gracefully", () => {
      expect(KEYWORD_TRAFFIC_COMPETITION_CLASSIFY_PROMPT).toContain("no search volume data");
      expect(KEYWORD_TRAFFIC_COMPETITION_CLASSIFY_PROMPT).toContain("no SPR data");
    });
  });

  describe("Import flow - no fixed thresholds", () => {
    it("should not use hardcoded threshold values in keyword router import", async () => {
      // Read the keyword router files and check that fixed thresholds are removed
      const fs = await import("fs");
      const crudContent = fs.readFileSync("./server/routers/keywordCrud.ts", "utf-8");
      const aiContent = fs.readFileSync("./server/routers/keywordAi.ts", "utf-8");
      const routerContent = crudContent + aiContent;

      // The old fixed thresholds should be removed from both files
      expect(routerContent).not.toContain("monthlySearchVolume >= 10000) trafficLevel = \"high\"");
      expect(routerContent).not.toContain("monthlySearchVolume >= 1000) trafficLevel = \"medium\"");
      expect(routerContent).not.toContain("spr < 30) competition = \"low\"");
      expect(routerContent).not.toContain("spr < 100) competition = \"medium\"");
    });

    it("should have AI classification procedure in the router", async () => {
      const fs = await import("fs");
      const routerContent = fs.readFileSync("./server/routers/keywordAi.ts", "utf-8");

      expect(routerContent).toContain("aiClassifyTrafficCompetition: protectedProcedure");
      expect(routerContent).toContain("KEYWORD_TRAFFIC_COMPETITION_CLASSIFY_PROMPT");
    });

    it("should include AI classification in the full pipeline", async () => {
      const fs = await import("fs");
      const routerContent = fs.readFileSync("./server/routers/keywordAi.ts", "utf-8");

      // Pipeline should include traffic/competition classification as step 0
      expect(routerContent).toContain("Step 0: AI Traffic & Competition Classification");
      expect(routerContent).toContain("trafficCompetition: { classified: tcClassified, thresholds: tcThresholds }");
    });
  });

  describe("Frontend integration", () => {
    it("should have AI classification step in the pipeline UI", async () => {
      const fs = await import("fs");
      const pageContent = fs.readFileSync("./client/src/pages/KeywordPage.tsx", "utf-8");

      expect(pageContent).toContain("aiClassifyTrafficCompetition");
      expect(pageContent).toContain("流量/竞争度智能分类");
      expect(pageContent).toContain("BarChart3");
    });

    it("should show classification thresholds in success toast", async () => {
      const fs = await import("fs");
      const pageContent = fs.readFileSync("./client/src/pages/KeywordPage.tsx", "utf-8");

      expect(pageContent).toContain("trafficThresholds");
      expect(pageContent).toContain("competitionThresholds");
    });

    it("should include AI classification in the full pipeline description", async () => {
      const fs = await import("fs");
      const pageContent = fs.readFileSync("./client/src/pages/KeywordPage.tsx", "utf-8");

      expect(pageContent).toContain("流量/竞争度智能分类 →");
    });
  });
});
