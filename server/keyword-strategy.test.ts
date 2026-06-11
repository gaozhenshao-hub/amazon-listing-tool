import { describe, it, expect } from "vitest";

/**
 * Tests for keyword strategy category classification logic
 * The computeStrategyCategory function uses a 3D matrix (traffic × relevance × competition)
 * to assign one of 7+ strategy categories to each keyword
 */

// Replicate the frontend computeStrategyCategory logic for testing
function computeStrategyCategory(kw: any): string {
  if (kw.strategyCategory) return kw.strategyCategory;
  const t = kw.trafficLevel || "low";
  const r = kw.relevance || "low";
  const c = kw.competition || "low";
  if (r === "none" || r === "low") {
    if (t === "high") return "observe_test";
    return "negative";
  }
  if (r === "high" && t === "high" && c === "high") return "core_main";
  if (r === "high" && t === "high" && c === "medium") return "core_main";
  if (r === "high" && t === "medium" && (c === "medium" || c === "high")) return "sub_core";
  if (r === "high" && (t === "low" || t === "medium") && c === "low") return "precise_longtail";
  if (r === "high" && t === "low" && c === "medium") return "precise_longtail";
  if (r === "medium" && t === "high") return "observe_test";
  if (r === "medium" && t === "medium" && c === "low") return "longtail_main";
  if (r === "medium" && t === "medium" && c === "medium") return "longtail_main";
  if (r === "medium" && t === "low") return "precise_longtail";
  if (kw.sceneTags && kw.sceneTags !== "[]" && kw.sceneTags !== "null") return "scene_intent";
  return "longtail_main";
}

describe("Keyword Strategy Category Classification", () => {
  describe("AI-assigned strategy takes priority", () => {
    it("should return AI-assigned strategyCategory when present", () => {
      expect(computeStrategyCategory({
        strategyCategory: "core_main",
        trafficLevel: "low",
        relevance: "low",
        competition: "low",
      })).toBe("core_main");
    });

    it("should return brand_offensive when AI assigned", () => {
      expect(computeStrategyCategory({
        strategyCategory: "brand_offensive",
        trafficLevel: "medium",
        relevance: "medium",
        competition: "high",
      })).toBe("brand_offensive");
    });
  });

  describe("Core Main (高流量 + 高相关 + 高竞争)", () => {
    it("should classify high/high/high as core_main", () => {
      expect(computeStrategyCategory({
        trafficLevel: "high", relevance: "high", competition: "high",
      })).toBe("core_main");
    });

    it("should classify high/high/medium as core_main", () => {
      expect(computeStrategyCategory({
        trafficLevel: "high", relevance: "high", competition: "medium",
      })).toBe("core_main");
    });
  });

  describe("Sub Core (中流量 + 高相关 + 中竞争)", () => {
    it("should classify medium/high/medium as sub_core", () => {
      expect(computeStrategyCategory({
        trafficLevel: "medium", relevance: "high", competition: "medium",
      })).toBe("sub_core");
    });

    it("should classify medium/high/high as sub_core", () => {
      expect(computeStrategyCategory({
        trafficLevel: "medium", relevance: "high", competition: "high",
      })).toBe("sub_core");
    });
  });

  describe("Precise Longtail (低流量 + 高相关 + 低竞争)", () => {
    it("should classify low/high/low as precise_longtail", () => {
      expect(computeStrategyCategory({
        trafficLevel: "low", relevance: "high", competition: "low",
      })).toBe("precise_longtail");
    });

    it("should classify medium/high/low as precise_longtail", () => {
      expect(computeStrategyCategory({
        trafficLevel: "medium", relevance: "high", competition: "low",
      })).toBe("precise_longtail");
    });

    it("should classify low/high/medium as precise_longtail", () => {
      expect(computeStrategyCategory({
        trafficLevel: "low", relevance: "high", competition: "medium",
      })).toBe("precise_longtail");
    });

    it("should classify low/medium/any as precise_longtail", () => {
      expect(computeStrategyCategory({
        trafficLevel: "low", relevance: "medium", competition: "low",
      })).toBe("precise_longtail");
    });
  });

  describe("Longtail Main (中流量 + 中相关 + 低竞争)", () => {
    it("should classify medium/medium/low as longtail_main", () => {
      expect(computeStrategyCategory({
        trafficLevel: "medium", relevance: "medium", competition: "low",
      })).toBe("longtail_main");
    });

    it("should classify medium/medium/medium as longtail_main", () => {
      expect(computeStrategyCategory({
        trafficLevel: "medium", relevance: "medium", competition: "medium",
      })).toBe("longtail_main");
    });
  });

  describe("Observe Test (高流量 + 中/低相关)", () => {
    it("should classify high/medium/any as observe_test", () => {
      expect(computeStrategyCategory({
        trafficLevel: "high", relevance: "medium", competition: "high",
      })).toBe("observe_test");
    });

    it("should classify high/low/any as observe_test", () => {
      expect(computeStrategyCategory({
        trafficLevel: "high", relevance: "low", competition: "low",
      })).toBe("observe_test");
    });
  });

  describe("Negative (低相关)", () => {
    it("should classify low/none/any as negative", () => {
      expect(computeStrategyCategory({
        trafficLevel: "low", relevance: "none", competition: "low",
      })).toBe("negative");
    });

    it("should classify low/low/any as negative", () => {
      expect(computeStrategyCategory({
        trafficLevel: "low", relevance: "low", competition: "high",
      })).toBe("negative");
    });

    it("should classify medium/low/any as negative", () => {
      expect(computeStrategyCategory({
        trafficLevel: "medium", relevance: "low", competition: "medium",
      })).toBe("negative");
    });
  });

  describe("Scene Intent (with sceneTags)", () => {
    it("should classify as scene_intent when sceneTags present and no other match", () => {
      expect(computeStrategyCategory({
        trafficLevel: "medium", relevance: "medium", competition: "high",
        sceneTags: '["运动","户外"]',
      })).toBe("scene_intent");
    });

    it("should NOT classify as scene_intent when sceneTags is empty array", () => {
      expect(computeStrategyCategory({
        trafficLevel: "medium", relevance: "medium", competition: "high",
        sceneTags: "[]",
      })).not.toBe("scene_intent");
    });
  });

  describe("Default fallback", () => {
    it("should default to longtail_main when no clear match", () => {
      expect(computeStrategyCategory({
        trafficLevel: "medium", relevance: "medium", competition: "high",
      })).toBe("longtail_main");
    });

    it("should handle missing fields gracefully", () => {
      const result = computeStrategyCategory({});
      expect(result).toBe("negative"); // low relevance defaults to negative
    });
  });

  describe("Strategy label mapping", () => {
    const STRATEGY_SHORT: Record<string, string> = {
      core_main: "核心",
      sub_core: "次核心",
      precise_longtail: "精准长尾",
      scene_intent: "场景",
      longtail_main: "长尾",
      observe_test: "观察",
      negative: "否定",
      brand_offensive: "品牌进攻",
    };

    it("should have labels for all 8 strategy categories", () => {
      expect(Object.keys(STRATEGY_SHORT)).toHaveLength(8);
    });

    it("all strategy categories should have non-empty labels", () => {
      for (const [key, label] of Object.entries(STRATEGY_SHORT)) {
        expect(label.length).toBeGreaterThan(0);
      }
    });
  });

  describe("3D Matrix coverage", () => {
    const levels = ["high", "medium", "low"];
    it("should classify all 27 combinations without throwing", () => {
      let count = 0;
      for (const t of levels) {
        for (const r of levels) {
          for (const c of levels) {
            const result = computeStrategyCategory({
              trafficLevel: t, relevance: r, competition: c,
            });
            expect(typeof result).toBe("string");
            expect(result.length).toBeGreaterThan(0);
            count++;
          }
        }
      }
      expect(count).toBe(27);
    });

    it("should return valid strategy categories for all combinations", () => {
      const validCategories = new Set([
        "core_main", "sub_core", "precise_longtail", "scene_intent",
        "longtail_main", "observe_test", "negative", "brand_offensive",
      ]);
      for (const t of levels) {
        for (const r of levels) {
          for (const c of levels) {
            const result = computeStrategyCategory({
              trafficLevel: t, relevance: r, competition: c,
            });
            expect(validCategories.has(result)).toBe(true);
          }
        }
      }
    });
  });
});
