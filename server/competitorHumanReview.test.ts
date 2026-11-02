import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { repoPath } from "./testPaths";
import {
  COMPARISON_SUMMARY_PROMPT,
  COMPETITOR_ANALYSIS_PROMPT,
  REVIEW_ANALYSIS_PROMPT,
} from "./prompts";
import {
  comparisonSelectionKey,
  formatComparisonSummary,
  formatCompetitorAnalysisSummary,
  normalizeSellingPointRows,
} from "./domains/listing/competitorHumanReview";

function readSqlPrompt(sql: string, variable: string): string {
  const match = sql.match(new RegExp(`SET @${variable} = '([\\s\\S]*?)';\\n`));
  if (!match) throw new Error(`Missing SQL prompt variable: ${variable}`);
  return match[1].replace(/''/g, "'").replace(/\\n/g, "\n");
}

describe("competitor human review", () => {
  it("creates a stable comparison key regardless of selection order", () => {
    expect(comparisonSelectionKey([9, 2, 9, 5])).toBe("2-5-9");
  });

  it("formats a structured single-competitor summary", () => {
    const summary = formatCompetitorAnalysisSummary({
      summary: {
        overview: "中高端耐用型产品",
        coreSellingPoints: ["耐压", "防漏"],
        strengths: ["数据表达清晰"],
        weaknesses: ["安装说明不足"],
        listingLessons: ["用测试数据证明耐压能力"],
      },
    });

    expect(summary).toContain("## 定位概览");
    expect(summary).toContain("- 耐压");
    expect(summary).toContain("## Listing 借鉴建议");
  });

  it("maps AI semantic selling-point rows back to trusted analysis IDs", () => {
    const analyses = [
      { id: 11, asin: "B000000001", bulletPoints: JSON.stringify(["Durable body"]) },
      { id: 22, asin: "B000000002", bulletPoints: JSON.stringify(["Heavy duty shell"]) },
    ];
    const rows = normalizeSellingPointRows({
      sellingPointRows: [{
        theme: "耐用结构",
        competitorPoints: [
          { asin: "b000000001", bulletIndex: 0, text: "AI rewrote this bullet" },
          { asin: "B000000002", bulletIndex: 0, text: "Heavy duty shell" },
          { asin: "UNKNOWN", bulletIndex: 0, text: "Invented point" },
        ],
        aiRecommendation: "保留量化材料证据",
      }],
    }, analyses);

    expect(rows).toHaveLength(1);
    expect(rows[0].theme).toBe("耐用结构");
    expect(rows[0].competitorPoints.map(point => point.analysisId)).toEqual([11, 22]);
    expect(rows[0].competitorPoints[0].text).toBe("Durable body");
    expect(rows[0].competitorPoints.some(point => point.text === "Invented point")).toBe(false);
    expect(rows[0].humanNote).toBe("");
    expect(rows[0].selected).toBe(false);
  });

  it("builds a readable comparison report from structured JSON", () => {
    const summary = formatComparisonSummary({
      marketOverview: "价格集中在 100-200 美元",
      keyDifferences: ["ASIN A 强调耐压，ASIN B 强调易安装"],
      keywordOpportunities: {
        shared: ["air line kit"],
        differentiated: ["leak proof"],
        uncovered: ["garage compressed air"],
      },
      customerOpportunities: ["降低安装门槛"],
      sellingPointStrategy: ["先讲防漏证据"],
      actionItems: ["补充压力测试数据"],
    });

    expect(summary).toContain("## 关键词机会");
    expect(summary).toContain("共同核心词：air line kit");
    expect(summary).toContain("## Listing 优化行动清单");
  });

  it("keeps competitor AI execution on Emperor Skills", () => {
    const routerSource = fs.readFileSync(repoPath("server/routers/analysis.ts"), "utf8");
    const agentSource = fs.readFileSync(
      repoPath("server/domains/ai_os/services/agentRunner/templateGovernance.ts"),
      "utf8",
    );

    expect(routerSource).toContain("runEmperorSkill");
    expect(routerSource).not.toContain("invokeLLM");
    for (const slug of [
      "listing.competitor.analyze",
      "analysis.competitor.multi",
      "analysis.review.extract",
    ]) {
      expect(routerSource).toContain(slug);
      expect(agentSource).toContain(slug);
    }
  });

  it("keeps Emperor database prompts aligned with the legacy audit baseline", () => {
    const migration = fs.readFileSync(
      repoPath("drizzle/0119_listing_competitor_emperor_skills.sql"),
      "utf8",
    );

    expect(readSqlPrompt(migration, "competitor_analysis_prompt")).toBe(COMPETITOR_ANALYSIS_PROMPT);
    expect(readSqlPrompt(migration, "review_analysis_prompt")).toBe(REVIEW_ANALYSIS_PROMPT);
    expect(readSqlPrompt(migration, "competitor_comparison_prompt")).toBe(COMPARISON_SUMMARY_PROMPT);
  });
});
