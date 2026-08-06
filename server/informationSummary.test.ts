import fs from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildInformationSummaryAiContext,
  buildInformationSummarySeed,
  mergeInformationSummaryAi,
  recalculateEconomics,
  validateInformationSummaryForConfirmation,
} from "./domains/product_development/analysis/informationSummary";
import { DECISION_DASHBOARD_PROMPT, INFORMATION_SUMMARY_PROMPT } from "./devAnalysisPrompts";
import { compactDevAnalysisContent } from "./domains/ai_os/services/businessArtifactRegistry";
import { estimatePayloadBytes } from "./domains/ai_os/services/artifactLifecycle";
import { repoPath } from "./testPaths";

function confirmed(stageType: string, ai: Record<string, unknown>) {
  return {
    stageType,
    status: "confirmed",
    rawResult: JSON.stringify({ ai }),
    editedResult: null,
    confirmedAt: new Date("2026-08-01T00:00:00.000Z"),
  };
}

function seed() {
  return buildInformationSummarySeed({
    project: { name: "空气套件", targetMarket: "US", keywords: JSON.stringify(["air line kit"]), createdAt: "2026-07-01" },
    ownerName: "Gavin",
    products: [
      { id: 1, asin: "A1", title: "Alpha", price: "99", rating: "4.5", reviewCount: "100", monthlySales: 800, tags: JSON.stringify(["耐压", "易安装"]) },
      { id: 2, asin: "A2", title: "Beta", price: "129", rating: "4.6", reviewCount: "120", monthlySales: 600, tags: JSON.stringify(["耐压", "防漏"]) },
      { id: 3, asin: "A3", title: "Gamma", price: "159", rating: "4.7", reviewCount: "200", monthlySales: 500, tags: JSON.stringify(["防漏", "耐腐蚀"]) },
    ],
    stages: [
      confirmed("market_overview", { growthTrend: "稳定增长", seasonality: "Q4略高", summary: "市场稳定" }),
      confirmed("attribute_cross", { differentiationOpportunities: [{ direction: "更易安装" }], redOceanWarnings: ["低价竞争"] }),
      confirmed("price_analysis", { bestPriceRange: { min: 119, max: 149 } }),
      confirmed("brand_competition", { summary: "品牌集中度中等" }),
      confirmed("review_kano", { kanoAnalysis: { painPoints: [{ theme: "漏气" }], wowPoints: [{ theme: "安装方便" }] } }),
    ],
  });
}

describe("decision information summary", () => {
  it("extracts confirmed evidence and automatic competitor fields", () => {
    const value = seed();
    expect(value.competitors).toHaveLength(3);
    expect(value.marketEvidence.salesTrend).toBe("稳定增长");
    expect(value.marketEvidence.brandAnalysis).toBe("品牌集中度中等");
    expect(value.economics.targetPrice).toBe(119);
    expect(value.provenance.sources.every((source) => source.status === "confirmed")).toBe(true);
  });

  it("keeps Emperor benchmark recommendations separate from human confirmation", () => {
    const value = mergeInformationSummaryAi(seed(), {
      benchmarkRecommendations: [{ asin: "A2", reason: "评分和销量均有代表性" }],
    });
    expect(value.competitors[1].aiRecommendedBenchmark).toBe(true);
    expect(value.competitors[1].isBenchmark).toBe(false);
    expect(value.completeness.requiredMissing).toContain("至少1个对标竞品");
  });

  it("requires human benchmark selection and required evidence before locking", () => {
    const value = seed();
    expect(() => validateInformationSummaryForConfirmation(value)).toThrow("至少1个对标竞品");
    value.competitors[0].isBenchmark = true;
    value.competitors[0].benchmarkReason = "头部销量且卖点表达完整";
    expect(validateInformationSummaryForConfirmation(value).completeness.score).toBe(100);
  });

  it("recalculates the preliminary economics model", () => {
    const value = seed();
    value.economics.targetPrice = 100;
    value.economics.estimatedProductCost = 30;
    value.economics.firstMileCost = 5;
    value.economics.fbaFee = 10;
    value.economics.referralFeeRate = 0.15;
    value.economics.adSalesRatio = 0.1;
    value.economics.returnRate = 0.05;
    const calculated = recalculateEconomics(value);
    expect(calculated.economics.grossProfit).toBe(40);
    expect(calculated.economics.netProfit).toBe(25);
    expect(calculated.economics.netMargin).toBe(0.25);
  });

  it("keeps the confirmed decision Artifact within the inline payload budget", () => {
    const value = seed();
    value.competitors[0].isBenchmark = true;
    value.competitors[0].benchmarkReason = "A".repeat(2_000);
    value.competitors.forEach((competitor) => { competitor.manualNote = "N".repeat(2_000); });
    value.productOpportunity.positiveSignals = Array.from({ length: 30 }, () => "S".repeat(1_000));
    const projection = compactDevAnalysisContent("information_summary", value);
    expect(estimatePayloadBytes(projection)).toBeLessThanOrEqual(12_000);
    expect(validateInformationSummaryForConfirmation(projection).competitors).toHaveLength(3);
  });

  it("compacts a large competitor set for Emperor without dropping final evidence", () => {
    const value = buildInformationSummarySeed({
      project: { name: "空气套件", targetMarket: "US", keywords: "air line kit" },
      ownerName: "Gavin",
      products: Array.from({ length: 177 }, (_, index) => ({
        id: index + 1,
        asin: `ASIN${String(index + 1).padStart(6, "0")}`,
        title: `Competitor ${index + 1} ${"feature ".repeat(20)}`,
        price: String(99 + index),
        rating: String(4 + (index % 10) / 10),
        reviewCount: String(100 + index * 5),
        monthlySales: 2_000 - index,
        tags: JSON.stringify(["耐压", "防漏", "易安装"]),
      })),
      stages: [
        confirmed("market_overview", { growthTrend: "稳定增长", seasonality: "Q4略高" }),
        confirmed("attribute_cross", { differentiationOpportunities: [{ direction: "更易安装" }] }),
        confirmed("price_analysis", { bestPriceRange: { min: 119, max: 149 } }),
        confirmed("brand_competition", { summary: "品牌集中度中等" }),
        confirmed("review_kano", { kanoAnalysis: { painPoints: [{ theme: "漏气" }] } }),
      ],
    });
    const context = buildInformationSummaryAiContext(value);
    expect(value.competitors).toHaveLength(177);
    expect(context.competitorEvidence.totalCount).toBe(177);
    expect(context.competitorEvidence.includedCount).toBe(24);
    expect(context.competitorEvidence.omittedCount).toBe(153);
    expect(JSON.stringify(context).length).toBeLessThan(35_000);
  });

  it("publishes matching database prompts and explicit Emperor skill slugs", () => {
    const migration = fs.readFileSync(repoPath("drizzle/0121_dev_information_summary_emperor_skills.sql"), "utf8");
    const stageMigration = fs.readFileSync(repoPath("drizzle/0126_product_analysis_stage_jobs.sql"), "utf8");
    const service = fs.readFileSync(repoPath("server/domains/product_development/analysis/informationSummaryService.ts"), "utf8");
    const stageService = fs.readFileSync(repoPath("server/domains/product_development/analysis/analysisStageJobService.ts"), "utf8");
    expect(migration).toContain(INFORMATION_SUMMARY_PROMPT);
    expect(stageMigration).toContain(DECISION_DASHBOARD_PROMPT);
    expect(service).toContain('skillSlug: "dev.analysis.information_summary"');
    expect(stageService).toContain('skillSlug: "dev.analysis.decision_dashboard"');
    expect(stageService).toContain("resolveCurrentDevAnalysisArtifact");
  });

  it("runs information summary through the recoverable AI Job worker", () => {
    const service = fs.readFileSync(repoPath("server/domains/product_development/analysis/informationSummaryService.ts"), "utf8");
    const worker = fs.readFileSync(repoPath("server/_core/aiWorker.ts"), "utf8");
    const migration = fs.readFileSync(repoPath("drizzle/0123_dev_information_summary_jobs.sql"), "utf8");
    expect(service).toContain('id: "productDevelopment.informationSummary"');
    expect(service).toContain('kind: "dev.analysis.informationSummary"');
    expect(service).toContain("maxModelAttempts: 1");
    expect(worker).toContain('import "../domains/product_development/analysis/informationSummaryService"');
    expect(migration).toContain("此前的信息汇总任务已中断");
    expect(migration).toContain("`runProgress`");
  });

  it("wires the human review stage before decision without removing existing controls", () => {
    const definitions = fs.readFileSync(repoPath("client/src/pages/dev/analysis/stageDefinitions.ts"), "utf8");
    const editor = fs.readFileSync(repoPath("client/src/pages/dev/analysis/InformationSummaryEditor.tsx"), "utf8");
    const flow = fs.readFileSync(repoPath("client/src/pages/dev/DevAnalysisFlow.tsx"), "utf8");
    const service = fs.readFileSync(repoPath("server/domains/product_development/service.ts"), "utf8");
    const consistency = fs.readFileSync(
      repoPath("server/domains/product_development/analysis/stageConsistency.ts"),
      "utf8",
    );
    expect(definitions.indexOf('key: "information_summary"')).toBeLessThan(definitions.indexOf('key: "decision_dashboard"'));
    expect(editor).toContain("对标竞品选择");
    expect(editor).toContain("专利与合规");
    expect(editor).toContain("供应商初步报价");
    expect(flow).toContain("确认锁定");
    expect(flow).toContain("解锁重新分析");
    expect(service).toContain("confirmDevAnalysisStageConsistently");
    expect(consistency).toContain('return ["information_summary", "decision_dashboard"]');
  });
});
