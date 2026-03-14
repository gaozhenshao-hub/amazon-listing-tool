import { describe, it, expect } from "vitest";

describe("Keyword Import for Selling Points", () => {
  // Mock keyword data matching the schema
  const mockKeywords = [
    { id: 1, keyword: "waterproof phone case", translationCn: "防水手机壳", relevance: "high", trafficLevel: "high", competition: "medium", monthlySearchVolume: 12000, strategyCategory: "core_main", listingPlacement: "title_front", isNegative: 0 },
    { id: 2, keyword: "eco-friendly case", translationCn: "环保手机壳", relevance: "medium", trafficLevel: "medium", competition: "low", monthlySearchVolume: 5000, strategyCategory: "sub_core", listingPlacement: "bullet_first", isNegative: 0 },
    { id: 3, keyword: "shockproof protection", translationCn: "防震保护", relevance: "high", trafficLevel: "high", competition: "high", monthlySearchVolume: 18000, strategyCategory: "core_main", listingPlacement: "bullet_body", isNegative: 0 },
    { id: 4, keyword: "slim design phone case", translationCn: "超薄设计手机壳", relevance: "medium", trafficLevel: "low", competition: "low", monthlySearchVolume: 2000, strategyCategory: "precise_longtail", listingPlacement: "search_term", isNegative: 0 },
    { id: 5, keyword: "competitor brand case", translationCn: "竞品品牌壳", relevance: "low", trafficLevel: "low", competition: "high", monthlySearchVolume: 800, strategyCategory: "brand_offensive", listingPlacement: "not_use", isNegative: 0 },
    { id: 6, keyword: "bad keyword", translationCn: "否定词", relevance: "none", trafficLevel: "low", competition: "low", monthlySearchVolume: 100, strategyCategory: "negative", listingPlacement: "not_use", isNegative: 1 },
    { id: 7, keyword: "outdoor adventure case", translationCn: "户外探险手机壳", relevance: "high", trafficLevel: "medium", competition: "medium", monthlySearchVolume: 7000, strategyCategory: "scene_intent", listingPlacement: "bullet_body", isNegative: 0 },
  ];

  describe("Keyword filtering", () => {
    it("should exclude negative keywords", () => {
      const filtered = mockKeywords.filter(kw => kw.isNegative !== 1);
      expect(filtered).toHaveLength(6);
      expect(filtered.every(kw => kw.isNegative === 0)).toBe(true);
    });

    it("should filter by search term (keyword)", () => {
      const search = "waterproof";
      const filtered = mockKeywords.filter(kw => {
        if (kw.isNegative === 1) return false;
        return kw.keyword.toLowerCase().includes(search.toLowerCase());
      });
      expect(filtered).toHaveLength(1);
      expect(filtered[0].keyword).toBe("waterproof phone case");
    });

    it("should filter by search term (Chinese translation)", () => {
      const search = "防震";
      const filtered = mockKeywords.filter(kw => {
        if (kw.isNegative === 1) return false;
        return kw.translationCn?.toLowerCase().includes(search.toLowerCase());
      });
      expect(filtered).toHaveLength(1);
      expect(filtered[0].keyword).toBe("shockproof protection");
    });

    it("should filter by strategy category", () => {
      const strategy = "core_main";
      const filtered = mockKeywords.filter(kw => {
        if (kw.isNegative === 1) return false;
        return kw.strategyCategory === strategy;
      });
      expect(filtered).toHaveLength(2);
      expect(filtered.map(kw => kw.keyword)).toContain("waterproof phone case");
      expect(filtered.map(kw => kw.keyword)).toContain("shockproof protection");
    });

    it("should filter by listing placement", () => {
      const placement = "bullet_body";
      const filtered = mockKeywords.filter(kw => {
        if (kw.isNegative === 1) return false;
        return kw.listingPlacement === placement;
      });
      expect(filtered).toHaveLength(2);
    });

    it("should combine search and strategy filter", () => {
      const search = "case";
      const strategy = "core_main";
      const filtered = mockKeywords.filter(kw => {
        if (kw.isNegative === 1) return false;
        if (!kw.keyword.toLowerCase().includes(search.toLowerCase())) return false;
        if (kw.strategyCategory !== strategy) return false;
        return true;
      });
      expect(filtered).toHaveLength(1);
      expect(filtered[0].keyword).toBe("waterproof phone case");
    });

    it("should return all non-negative keywords when no filters applied", () => {
      const filtered = mockKeywords.filter(kw => kw.isNegative !== 1);
      expect(filtered).toHaveLength(6);
    });
  });

  describe("Keyword selection", () => {
    it("should toggle keyword selection", () => {
      const selected = new Set<number>();
      // Add
      selected.add(1);
      expect(selected.has(1)).toBe(true);
      expect(selected.size).toBe(1);
      // Add another
      selected.add(3);
      expect(selected.size).toBe(2);
      // Remove
      selected.delete(1);
      expect(selected.has(1)).toBe(false);
      expect(selected.size).toBe(1);
    });

    it("should select all filtered keywords", () => {
      const filtered = mockKeywords.filter(kw => kw.isNegative !== 1);
      const selected = new Set<number>(filtered.map(kw => kw.id));
      expect(selected.size).toBe(6);
      expect(selected.has(6)).toBe(false); // negative keyword excluded
    });

    it("should deselect all when all are selected", () => {
      const filtered = mockKeywords.filter(kw => kw.isNegative !== 1);
      const allIds = filtered.map(kw => kw.id);
      const selected = new Set<number>(allIds);
      const allSelected = allIds.every(id => selected.has(id));
      expect(allSelected).toBe(true);
      // Deselect all
      allIds.forEach(id => selected.delete(id));
      expect(selected.size).toBe(0);
    });
  });

  describe("Keyword import to AI input", () => {
    it("should combine selected keywords into comma-separated string", () => {
      const selected = [mockKeywords[0], mockKeywords[2]];
      const keywordText = selected.map(kw => kw.keyword).join(", ");
      expect(keywordText).toBe("waterproof phone case, shockproof protection");
    });

    it("should handle single keyword selection", () => {
      const selected = [mockKeywords[0]];
      const keywordText = selected.map(kw => kw.keyword).join(", ");
      expect(keywordText).toBe("waterproof phone case");
    });

    it("should handle multiple keywords for AI expansion", () => {
      const selected = [mockKeywords[0], mockKeywords[1], mockKeywords[2]];
      const keywordText = selected.map(kw => kw.keyword).join(", ");
      expect(keywordText).toContain("waterproof phone case");
      expect(keywordText).toContain("eco-friendly case");
      expect(keywordText).toContain("shockproof protection");
      // The combined text should be under 200 chars (backend limit)
      expect(keywordText.length).toBeLessThanOrEqual(200);
    });

    it("should preserve original English keywords without translation", () => {
      const selected = [mockKeywords[0]];
      const keywordText = selected.map(kw => kw.keyword).join(", ");
      // Should NOT contain Chinese
      expect(keywordText).not.toContain("防水");
      expect(keywordText).toBe("waterproof phone case");
    });
  });

  describe("Keyword sorting by monthly search volume", () => {
    const nonNegative = mockKeywords.filter(kw => kw.isNegative !== 1);

    it("should sort by monthly search volume descending", () => {
      const sorted = [...nonNegative].sort((a, b) => (b.monthlySearchVolume ?? 0) - (a.monthlySearchVolume ?? 0));
      expect(sorted[0].keyword).toBe("shockproof protection"); // 18000
      expect(sorted[1].keyword).toBe("waterproof phone case"); // 12000
      expect(sorted[2].keyword).toBe("outdoor adventure case"); // 7000
      expect(sorted[3].keyword).toBe("eco-friendly case"); // 5000
      expect(sorted[4].keyword).toBe("slim design phone case"); // 2000
      expect(sorted[5].keyword).toBe("competitor brand case"); // 800
    });

    it("should sort by monthly search volume ascending", () => {
      const sorted = [...nonNegative].sort((a, b) => (a.monthlySearchVolume ?? 0) - (b.monthlySearchVolume ?? 0));
      expect(sorted[0].keyword).toBe("competitor brand case"); // 800
      expect(sorted[1].keyword).toBe("slim design phone case"); // 2000
      expect(sorted[2].keyword).toBe("eco-friendly case"); // 5000
      expect(sorted[sorted.length - 1].keyword).toBe("shockproof protection"); // 18000
    });

    it("should return original order when sort is none", () => {
      const sortOrder = "none";
      const result = [...nonNegative];
      if (sortOrder === "asc") {
        result.sort((a, b) => (a.monthlySearchVolume ?? 0) - (b.monthlySearchVolume ?? 0));
      } else if (sortOrder === "desc") {
        result.sort((a, b) => (b.monthlySearchVolume ?? 0) - (a.monthlySearchVolume ?? 0));
      }
      // Original order preserved
      expect(result[0].keyword).toBe("waterproof phone case");
      expect(result[1].keyword).toBe("eco-friendly case");
    });

    it("should handle null/undefined monthlySearchVolume as 0", () => {
      const withNull = [
        { ...mockKeywords[0], monthlySearchVolume: null as any },
        { ...mockKeywords[2], monthlySearchVolume: 18000 },
        { ...mockKeywords[4], monthlySearchVolume: undefined as any },
      ];
      const sorted = [...withNull].sort((a, b) => (b.monthlySearchVolume ?? 0) - (a.monthlySearchVolume ?? 0));
      expect(sorted[0].monthlySearchVolume).toBe(18000);
      // null and undefined both treated as 0
      expect(sorted[1].monthlySearchVolume ?? 0).toBe(0);
      expect(sorted[2].monthlySearchVolume ?? 0).toBe(0);
    });

    it("should cycle sort order: none -> desc -> asc -> none", () => {
      const cycle = (current: string) => {
        if (current === "none") return "desc";
        if (current === "desc") return "asc";
        return "none";
      };
      expect(cycle("none")).toBe("desc");
      expect(cycle("desc")).toBe("asc");
      expect(cycle("asc")).toBe("none");
    });

    it("should sort filtered results correctly", () => {
      // Filter by strategy then sort
      const filtered = nonNegative.filter(kw => kw.strategyCategory === "core_main");
      const sorted = [...filtered].sort((a, b) => (a.monthlySearchVolume ?? 0) - (b.monthlySearchVolume ?? 0));
      expect(sorted).toHaveLength(2);
      expect(sorted[0].keyword).toBe("waterproof phone case"); // 12000
      expect(sorted[1].keyword).toBe("shockproof protection"); // 18000
    });
  });

  describe("Strategy category label mapping", () => {
    it("should map all strategy categories to Chinese labels", () => {
      const strategyLabels: Record<string, string> = {
        core_main: "核心主词",
        sub_core: "次核心",
        precise_longtail: "精准长尾",
        scene_intent: "场景意图",
        longtail_main: "长尾主词",
        observe_test: "观察测试",
        brand_offensive: "品牌进攻",
      };
      expect(Object.keys(strategyLabels)).toHaveLength(7);
      expect(strategyLabels["core_main"]).toBe("核心主词");
      expect(strategyLabels["scene_intent"]).toBe("场景意图");
    });

    it("should map all listing placements to Chinese labels", () => {
      const placementLabels: Record<string, string> = {
        title_front: "标题前段",
        title_mid: "标题中后",
        title_end: "标题末尾",
        bullet_first: "五点首句",
        bullet_body: "五点融入",
        aplus: "A+文案",
        search_term: "Search Term",
        not_use: "不使用",
      };
      expect(Object.keys(placementLabels)).toHaveLength(8);
      expect(placementLabels["bullet_first"]).toBe("五点首句");
    });
  });
});
