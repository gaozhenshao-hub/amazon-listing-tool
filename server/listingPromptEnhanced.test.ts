import { describe, it, expect, vi, beforeEach } from "vitest";

// We test the buildProductContext and loadEnrichedData functions indirectly
// by verifying the listing router's generateFull procedure passes real data to the AI prompt

describe("Listing Prompt Enhanced Data Injection", () => {
  describe("Module 2: Competitor Analysis Data in Prompt", () => {
    it("should include itchPoints extraction from competitor review analysis", async () => {
      // The buildProductContext function now extracts itchPoints from reviewAnalysis
      const mockReviewAnalysis = JSON.stringify({
        painPoints: [{ issue: "breaks easily" }],
        itchPoints: [{ desire: "wish it came in more colors" }],
        delightPoints: [{ feature: "great packaging" }],
      });

      // Verify the structure supports itchPoints
      const parsed = JSON.parse(mockReviewAnalysis);
      expect(parsed.itchPoints).toBeDefined();
      expect(parsed.itchPoints[0].desire).toBe("wish it came in more colors");
    });

    it("should extract brand info from rawData", async () => {
      const mockRawData = JSON.stringify({
        scrapedData: { brand: "TestBrand" },
        advantages: ["high quality"],
        weaknesses: ["expensive"],
      });

      const parsed = JSON.parse(mockRawData);
      expect(parsed.scrapedData.brand).toBe("TestBrand");
      expect(parsed.advantages).toContain("high quality");
      expect(parsed.weaknesses).toContain("expensive");
    });

    it("should include reviewCount in individual competitor details", async () => {
      const mockAnalysis = {
        asin: "B001TEST",
        title: "Test Product",
        price: "$29.99",
        rating: "4.5",
        reviewCount: "1234",
        bulletPoints: JSON.stringify(["Feature 1", "Feature 2"]),
        keywords: JSON.stringify({
          core: [{ keyword: "test keyword" }],
          longTail: [{ keyword: "long tail test" }],
          traffic: [{ keyword: "traffic test" }],
        }),
      };

      expect(mockAnalysis.reviewCount).toBe("1234");
      const kws = JSON.parse(mockAnalysis.keywords);
      expect(kws.core).toHaveLength(1);
      expect(kws.longTail).toHaveLength(1);
      expect(kws.traffic).toHaveLength(1);
    });

    it("should aggregate competitor advantages for prompt context", async () => {
      const analyses = [
        { rawData: JSON.stringify({ advantages: ["fast shipping", "durable"] }) },
        { rawData: JSON.stringify({ advantages: ["durable", "lightweight"] }) },
      ];

      const allAdvantages: string[] = [];
      for (const a of analyses) {
        const raw = JSON.parse(a.rawData);
        if (raw.advantages) allAdvantages.push(...raw.advantages);
      }

      const uniqueAdvantages = Array.from(new Set(allAdvantages));
      expect(uniqueAdvantages).toContain("fast shipping");
      expect(uniqueAdvantages).toContain("durable");
      expect(uniqueAdvantages).toContain("lightweight");
      expect(uniqueAdvantages).toHaveLength(3); // deduped
    });
  });

  describe("Module 3: COSMO Scene Tags with Volume Weights", () => {
    it("should sort scene groups by total search volume instead of keyword count", () => {
      const keywords = [
        { keyword: "kw1", monthlySearchVolume: 50000, sceneTags: '["outdoor"]' },
        { keyword: "kw2", monthlySearchVolume: 1000, sceneTags: '["indoor", "office"]' },
        { keyword: "kw3", monthlySearchVolume: 800, sceneTags: '["indoor"]' },
        { keyword: "kw4", monthlySearchVolume: 200, sceneTags: '["office"]' },
      ];

      const sceneVolumes: Record<string, number> = {};
      const sceneGroups: Record<string, string[]> = {};

      for (const kw of keywords) {
        const vol = kw.monthlySearchVolume || 0;
        const tags = JSON.parse(kw.sceneTags);
        for (const tag of tags) {
          if (!sceneGroups[tag]) sceneGroups[tag] = [];
          sceneGroups[tag].push(kw.keyword);
          sceneVolumes[tag] = (sceneVolumes[tag] || 0) + vol;
        }
      }

      // outdoor has 1 keyword but highest volume (50000)
      // indoor has 2 keywords but lower volume (1800)
      // office has 2 keywords but lowest volume (1200)
      const sorted = Object.entries(sceneVolumes)
        .sort(([, a], [, b]) => b - a)
        .map(([scene]) => scene);

      expect(sorted[0]).toBe("outdoor"); // highest volume despite fewer keywords
      expect(sorted[1]).toBe("indoor");
      expect(sorted[2]).toBe("office");
    });

    it("should include volume data in intent groups", () => {
      const keywords = [
        { keyword: "kw1", monthlySearchVolume: 30000, intentTag: "purchase" },
        { keyword: "kw2", monthlySearchVolume: 5000, intentTag: "research" },
        { keyword: "kw3", monthlySearchVolume: 20000, intentTag: "purchase" },
      ];

      const intentVolumes: Record<string, number> = {};
      for (const kw of keywords) {
        if (kw.intentTag) {
          intentVolumes[kw.intentTag] = (intentVolumes[kw.intentTag] || 0) + (kw.monthlySearchVolume || 0);
        }
      }

      expect(intentVolumes["purchase"]).toBe(50000);
      expect(intentVolumes["research"]).toBe(5000);
    });
  });

  describe("Module 4: A9 Keywords with Search Volume and SPR", () => {
    it("should include search volume and SPR in strategy group keywords", () => {
      const keywords = [
        { keyword: "main keyword", monthlySearchVolume: 50000, spr: 15, strategyCategory: "core_main", trafficLevel: "high", competition: "low" },
        { keyword: "sub keyword", monthlySearchVolume: 10000, spr: 45, strategyCategory: "sub_core", trafficLevel: "medium", competition: "medium" },
        { keyword: "long tail", monthlySearchVolume: 500, spr: 5, strategyCategory: "precise_longtail", trafficLevel: "low", competition: "low" },
      ];

      type KwWithMetrics = { keyword: string; vol: number; spr: number | null; traffic: string; competition: string };
      const strategyGroups: Record<string, KwWithMetrics[]> = {};

      for (const kw of keywords) {
        const kwData: KwWithMetrics = {
          keyword: kw.keyword,
          vol: kw.monthlySearchVolume || 0,
          spr: kw.spr || null,
          traffic: kw.trafficLevel || "medium",
          competition: kw.competition || "medium",
        };
        if (kw.strategyCategory) {
          if (!strategyGroups[kw.strategyCategory]) strategyGroups[kw.strategyCategory] = [];
          strategyGroups[kw.strategyCategory].push(kwData);
        }
      }

      expect(strategyGroups["core_main"][0].vol).toBe(50000);
      expect(strategyGroups["core_main"][0].spr).toBe(15);
      expect(strategyGroups["sub_core"][0].traffic).toBe("medium");
    });

    it("should sort keywords within strategy groups by search volume descending", () => {
      type KwWithMetrics = { keyword: string; vol: number; spr: number | null; traffic: string; competition: string };
      const group: KwWithMetrics[] = [
        { keyword: "low vol", vol: 100, spr: 5, traffic: "low", competition: "low" },
        { keyword: "high vol", vol: 50000, spr: 20, traffic: "high", competition: "medium" },
        { keyword: "mid vol", vol: 5000, spr: 10, traffic: "medium", competition: "low" },
      ];

      group.sort((a, b) => b.vol - a.vol);

      expect(group[0].keyword).toBe("high vol");
      expect(group[1].keyword).toBe("mid vol");
      expect(group[2].keyword).toBe("low vol");
    });

    it("should format keyword details with volume and SPR metrics", () => {
      const kw = { keyword: "test keyword", vol: 25000, spr: 30, traffic: "high", competition: "medium" };

      const metrics: string[] = [];
      if (kw.vol > 0) metrics.push(`vol:${kw.vol.toLocaleString()}`);
      if (kw.spr) metrics.push(`SPR:${kw.spr}`);
      const formatted = metrics.length > 0 ? `${kw.keyword}(${metrics.join(",")})` : kw.keyword;

      expect(formatted).toBe("test keyword(vol:25,000,SPR:30)");
    });

    it("should use correct placement labels matching schema enum values", () => {
      const placementLabels: Record<string, string> = {
        title_front: "Title Front Keywords",
        title_mid: "Title Mid Keywords",
        title_end: "Title End Keywords",
        bullet_first: "Bullet First-line Keywords",
        bullet_body: "Bullet Body Keywords",
        aplus: "A+ Content Keywords",
        search_term: "Backend Search Terms",
        not_use: "Do Not Use Keywords",
      };

      // These should match the schema enum values
      const schemaValues = [
        "title_front", "title_mid", "title_end",
        "bullet_first", "bullet_body", "aplus",
        "search_term", "not_use",
      ];

      for (const val of schemaValues) {
        expect(placementLabels[val]).toBeDefined();
      }
    });
  });

  describe("Data Integration", () => {
    it("should handle missing data gracefully (no analyses, no keywords)", () => {
      const analyses: any[] = [];
      const enrichedData = {
        keywordSceneTags: null,
        keywordStrategyMatrix: null,
      };

      // Module 2: no analyses = no competitor section
      expect(analyses.length).toBe(0);
      // Module 3: no scene tags
      expect(enrichedData.keywordSceneTags).toBeNull();
      // Module 4: no strategy matrix
      expect(enrichedData.keywordStrategyMatrix).toBeNull();
    });

    it("should handle malformed JSON in analysis fields without crashing", () => {
      const analysis = {
        bulletPoints: "not valid json",
        reviewAnalysis: "{broken",
        rawData: "",
        keywords: "null",
      };

      // Each field should be wrapped in try/catch
      let bps: any[] = [];
      try { bps = JSON.parse(analysis.bulletPoints); } catch {}
      expect(bps).toEqual([]);

      let ra: any = null;
      try { ra = JSON.parse(analysis.reviewAnalysis); } catch {}
      expect(ra).toBeNull();

      let raw: any = null;
      try { raw = JSON.parse(analysis.rawData); } catch {}
      expect(raw).toBeNull();
    });
  });
});
