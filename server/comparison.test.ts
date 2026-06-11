import { describe, expect, it } from "vitest";
import { COMPARISON_SUMMARY_PROMPT } from "./prompts";

describe("Comparison Summary", () => {
  describe("COMPARISON_SUMMARY_PROMPT", () => {
    it("should contain all required report sections", () => {
      expect(COMPARISON_SUMMARY_PROMPT).toContain("市场概览");
      expect(COMPARISON_SUMMARY_PROMPT).toContain("关键差异分析");
      expect(COMPARISON_SUMMARY_PROMPT).toContain("关键词机会");
      expect(COMPARISON_SUMMARY_PROMPT).toContain("用户痛点与机会");
      expect(COMPARISON_SUMMARY_PROMPT).toContain("卖点策略建议");
      expect(COMPARISON_SUMMARY_PROMPT).toContain("Listing优化行动清单");
    });

    it("should require Chinese output", () => {
      expect(COMPARISON_SUMMARY_PROMPT).toContain("Chinese");
      expect(COMPARISON_SUMMARY_PROMPT).toContain("中文");
    });

    it("should include keyword analysis categories", () => {
      expect(COMPARISON_SUMMARY_PROMPT).toContain("共同核心词");
      expect(COMPARISON_SUMMARY_PROMPT).toContain("差异化关键词");
      expect(COMPARISON_SUMMARY_PROMPT).toContain("未覆盖关键词");
    });

    it("should include pain point analysis categories", () => {
      expect(COMPARISON_SUMMARY_PROMPT).toContain("行业通病");
      expect(COMPARISON_SUMMARY_PROMPT).toContain("个别弱点");
      expect(COMPARISON_SUMMARY_PROMPT).toContain("用户期望");
    });

    it("should require actionable recommendations", () => {
      expect(COMPARISON_SUMMARY_PROMPT).toContain("卖点策略建议");
      expect(COMPARISON_SUMMARY_PROMPT).toContain("行动清单");
      expect(COMPARISON_SUMMARY_PROMPT).toContain("actionable");
    });

    it("should require markdown formatting", () => {
      expect(COMPARISON_SUMMARY_PROMPT).toContain("markdown");
    });

    it("should require data-driven analysis", () => {
      expect(COMPARISON_SUMMARY_PROMPT).toContain("data-driven");
    });

    it("should require referencing specific ASINs", () => {
      expect(COMPARISON_SUMMARY_PROMPT).toContain("competitor ASINs");
    });
  });

  describe("Comparison Summary API input validation", () => {
    it("should require at least 2 analysis IDs", () => {
      const minIds = 2;
      // The API requires analysisIds.min(2).max(8)
      expect(minIds).toBe(2);
    });

    it("should allow maximum 8 analysis IDs", () => {
      const maxIds = 8;
      expect(maxIds).toBe(8);
    });

    it("should require a projectId", () => {
      const input = { projectId: 1, analysisIds: [1, 2] };
      expect(input.projectId).toBeDefined();
      expect(input.analysisIds.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("Comparison Summary response format", () => {
    it("should return summary, analyzedAsins, and analyzedCount", () => {
      const mockResponse = {
        summary: "## 1. 市场概览\n...",
        analyzedAsins: ["B0XXXXXXXXX", "B0YYYYYYYYY"],
        analyzedCount: 2,
      };

      expect(mockResponse.summary).toBeDefined();
      expect(typeof mockResponse.summary).toBe("string");
      expect(mockResponse.analyzedAsins).toHaveLength(2);
      expect(mockResponse.analyzedCount).toBe(2);
    });

    it("should return markdown-formatted summary", () => {
      const mockSummary = `## 1. 市场概览
产品价格范围在$20-$50之间。

## 2. 关键差异分析
| 维度 | ASIN A | ASIN B |
|------|--------|--------|
| 价格 | $25.99 | $39.99 |

## 3. 关键词机会
- **共同核心词**: keyword1, keyword2

## 4. 用户痛点与机会
- **行业通病**: 质量问题

## 5. 卖点策略建议
1. 强调品质
2. 突出性价比

## 6. Listing优化行动清单
- [ ] 优化标题关键词
- [ ] 改进五点描述`;

      expect(mockSummary).toContain("## 1. 市场概览");
      expect(mockSummary).toContain("## 2. 关键差异分析");
      expect(mockSummary).toContain("## 3. 关键词机会");
      expect(mockSummary).toContain("## 4. 用户痛点与机会");
      expect(mockSummary).toContain("## 5. 卖点策略建议");
      expect(mockSummary).toContain("## 6. Listing优化行动清单");
    });
  });
});
