import fs from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ATTRIBUTE_ANALYSIS_PROMPT,
  BRAND_COMPETITION_PROMPT,
  DECISION_DASHBOARD_PROMPT,
  MARKET_OVERVIEW_PROMPT,
  PRICE_ANALYSIS_PROMPT,
  REVIEW_KANO_PROMPT,
  TAG_CROSS_ANALYSIS_PROMPT,
} from "./devAnalysisPrompts";
import {
  getProductAnalysisStageConfig,
  productAnalysisJobStages,
} from "./domains/product_development/analysis/analysisStageJobService";
import {
  buildProductAnalysisContextPackage,
  PRODUCT_ANALYSIS_CONTEXT_BUDGET_CHARS,
} from "./domains/product_development/analysis/stageContextBuilder";
import { repoPath } from "./testPaths";

function source(path: string) {
  return fs.readFileSync(repoPath(path), "utf8");
}

describe("product-development analysis stage jobs", () => {
  it("maps all seven migrated stages to released Emperor database Skills", () => {
    expect(productAnalysisJobStages).toEqual([
      "market_overview",
      "attribute_cross",
      "price_analysis",
      "brand_competition",
      "review_kano",
      "tag_cross",
      "decision_dashboard",
    ]);
    for (const stage of productAnalysisJobStages) {
      expect(getProductAnalysisStageConfig(stage).skillSlug).toMatch(/^dev\.analysis\./);
    }

    const migration = source("drizzle/0126_product_analysis_stage_jobs.sql");
    for (const prompt of [
      MARKET_OVERVIEW_PROMPT,
      ATTRIBUTE_ANALYSIS_PROMPT,
      PRICE_ANALYSIS_PROMPT,
      BRAND_COMPETITION_PROMPT,
      REVIEW_KANO_PROMPT,
      TAG_CROSS_ANALYSIS_PROMPT,
      DECISION_DASHBOARD_PROMPT,
    ]) {
      expect(migration).toContain(prompt);
    }
    expect(new Set(migration.match(/dev\.analysis\.[a-z_]+/g))).toEqual(new Set([
      "dev.analysis.market_overview",
      "dev.analysis.attribute_cross",
      "dev.analysis.price_analysis",
      "dev.analysis.brand_competition",
      "dev.analysis.review_kano",
      "dev.analysis.tag_cross",
      "dev.analysis.decision_dashboard",
      "dev.analysis.information_summary",
      "dev.analysis.stage",
    ]));
    expect(migration).toContain("'jobKind', 'dev.analysis.stage'");
    expect(migration).toContain("`execution_mode`");
  });

  it("queues each active route and never invokes the model outside Emperor Skill", () => {
    const router = source("server/domains/product_development/router.ts");
    const orchestration = source("server/domains/product_development/service.ts");
    const service = source("server/domains/product_development/analysis/analysisStageJobService.ts");
    const worker = source("server/_core/aiWorker.ts");
    expect(orchestration).toContain("return queueProductAnalysisStage(");
    expect(orchestration).toContain("cancelProductAnalysisStage");
    for (const handler of ["runMarketOverview", "runAttributeCross", "runPriceAnalysis", "runBrandCompetition", "runReviewKano", "runDecisionDashboard", "runTagCrossAnalysis"]) {
      expect(router).toContain(`service.${handler}`);
    }
    expect(service).toContain('kind: PRODUCT_ANALYSIS_JOB_KIND');
    expect(service).toContain("runEmperorSkill<Record<string, unknown>>");
    expect(service).toContain('migrationSource: "drizzle/0126_product_analysis_stage_jobs.sql"');
    expect(service).toContain("maxAttempts: 3");
    expect(service).toContain("updateAiJobProgress");
    expect(service).toContain("StaleDevAnalysisRunError");
    expect(service).not.toContain("invokeLLM");
    expect(worker).toContain('import "../domains/product_development/analysis/analysisStageJobService"');
  });

  it("compresses oversized evidence into a provenance-carrying bounded package", () => {
    const evidence = {
      rows: Array.from({ length: 1_000 }, (_, index) => ({
        index,
        description: `row-${index}-` + "x".repeat(2_000),
      })),
    };
    const context = buildProductAnalysisContextPackage({
      stageType: "review_kano",
      project: { id: 7, name: "测试品类", targetMarket: "US", keywords: "keyword" },
      evidence,
      provenance: [{ source: "dev_reviews", recordCount: 1_000 }],
    });
    expect(context.serialized.length).toBeLessThanOrEqual(PRODUCT_ANALYSIS_CONTEXT_BUDGET_CHARS);
    expect(context.package.compression.truncated).toBe(true);
    expect(context.package.compression.originalChars).toBeGreaterThan(context.package.compression.finalChars);
    expect(context.package.provenance).toEqual([{ source: "dev_reviews", recordCount: 1_000 }]);
  });

  it("keeps background progress, cancel, retry and page-resume controls visible", () => {
    const flow = source("client/src/pages/dev/DevAnalysisFlow.tsx");
    const result = source("client/src/pages/dev/analysis/StageResultDisplay.tsx");
    expect(flow).toContain("refetchInterval");
    expect(flow).toContain("cancelStage.useMutation");
    expect(flow).toContain("取消后台分析");
    expect(flow).toContain("已提交后台分析");
    expect(result).toContain("可以切换或关闭此页面");
    expect(result).toContain("stageData.runError");
    expect(result).toContain("stageData.runProgress");
  });
});
