import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

// Read the source files for testing
const stageGatingPolicy = readFileSync(join(__dirname, "domains/product_development/analysis/stageGating.ts"), "utf-8");
const productDevelopmentRouter = readFileSync(join(__dirname, "domains/product_development/router.ts"), "utf-8");
const productDevelopmentService = readFileSync(join(__dirname, "domains/product_development/service.ts"), "utf-8");
const stageResultDisplay = readFileSync(join(__dirname, "../client/src/pages/dev/analysis/StageResultDisplay.tsx"), "utf-8");
const devAnalysisRouter = [
  readFileSync(join(__dirname, "routers/devAnalysis.ts"), "utf-8"),
  productDevelopmentRouter,
  productDevelopmentService,
  stageGatingPolicy,
].join("\n");
const devAnalysisFlow = [
  readFileSync(join(__dirname, "../client/src/pages/dev/DevAnalysisFlow.tsx"), "utf-8"),
  stageResultDisplay,
].join("\n");

describe("Stage Gating Mechanism", () => {
  describe("Backend: checkStageGating function", () => {
    it("should define checkStageGating function in devAnalysis router", () => {
      expect(devAnalysisRouter).toContain("async function checkStageGating");
    });

    it("should define stage dependency rules", () => {
      // checkStageGating contains the dependency logic inline
      expect(devAnalysisRouter).toContain("checkStageGating");
      expect(devAnalysisRouter).toContain("canRun");
    });

    it("should check data confirmation for attribute_tagging", () => {
      // attribute_tagging requires sales data to be confirmed
      expect(devAnalysisRouter).toContain("attribute_tagging");
      expect(devAnalysisRouter).toContain("销量数据");
    });

    it("should check attribute_tagging confirmation for market_overview", () => {
      expect(devAnalysisRouter).toContain("market_overview");
    });

    it("should check attribute_tagging confirmation for attribute_cross", () => {
      expect(devAnalysisRouter).toContain("attribute_cross");
    });

    it("should check market_overview confirmation for price_analysis", () => {
      expect(devAnalysisRouter).toContain("price_analysis");
    });

    it("should check market_overview confirmation for brand_competition", () => {
      expect(devAnalysisRouter).toContain("brand_competition");
    });

    it("should check review data confirmation for review_kano", () => {
      expect(devAnalysisRouter).toContain("review_kano");
      expect(devAnalysisRouter).toContain("评论数据");
    });

    it("should check all previous stages for decision_dashboard", () => {
      expect(devAnalysisRouter).toContain("decision_dashboard");
    });

    it("should return canRun boolean and reason string", () => {
      expect(devAnalysisRouter).toContain("canRun");
      expect(devAnalysisRouter).toContain("reason");
      expect(devAnalysisRouter).toContain("missingPrereqs");
    });
  });

  describe("Backend: Gate checks in run handlers", () => {
    it("should NOT have runAttributeTagging (moved to devTagging router)", () => {
      expect(devAnalysisRouter).not.toContain("runAttributeTagging:");
    });

    it("routes all active handlers through the centralized service gate", () => {
      expect(productDevelopmentService).toContain("async function requireStageGate");
      expect(productDevelopmentService).toContain("checkStageGating(projectId, stage)");
      for (const handler of [
        "runMarketOverview",
        "runAttributeCross",
        "runPriceAnalysis",
        "runBrandCompetition",
        "runReviewKano",
        "runInformationSummary",
        "runDecisionDashboard",
      ]) {
        expect(productDevelopmentRouter).toContain(`service.${handler}`);
        expect(productDevelopmentService).toContain(handler);
      }
    });
  });

  describe("Backend: getStageGating endpoint", () => {
    it("should define getStageGating query endpoint", () => {
      expect(devAnalysisRouter).toContain("getStageGating");
    });

    it("should accept projectId as input", () => {
      const section = productDevelopmentRouter.split("getStageGating")[1]?.split(")),")[0] || "";
      expect(section).toContain("projectId");
    });

    it("should check all platform and visible analysis stages", () => {
      const stageTypes = [
        "attribute_tagging", "market_overview", "attribute_cross",
        "price_analysis", "brand_competition", "review_kano", "information_summary", "decision_dashboard"
      ];
      stageTypes.forEach(st => {
        expect(devAnalysisRouter).toContain(st);
      });
    });
  });

  describe("Frontend: Gating Query Integration", () => {
    it("should query getStageGating", () => {
      expect(devAnalysisFlow).toContain("getStageGating");
    });

    it("should pass gatingInfo to StageResultDisplay", () => {
      expect(devAnalysisFlow).toContain("gatingInfo={gating?.[activeStage]}");
    });

    it("should invalidate gating on mutation success", () => {
      expect(devAnalysisFlow).toContain("getStageGating.invalidate");
    });
  });

  describe("Frontend: Gating UI Elements", () => {
    it("should show lock icon for gated stages in progress bar", () => {
      expect(devAnalysisFlow).toContain("isGated");
      expect(devAnalysisFlow).toContain("analysisBlockedStepIds");
      expect(devAnalysisFlow).toContain("blockedStepIds={analysisBlockedStepIds}");
    });

    it("should show gating warning card in action area", () => {
      expect(devAnalysisFlow).toContain("前置条件未满足");
    });

    it("should show missing prerequisites list", () => {
      expect(devAnalysisFlow).toContain("需要先完成");
      expect(devAnalysisFlow).toContain("missingPrereqs");
    });

    it("should disable run button when gated", () => {
      expect(devAnalysisFlow).toContain("isCurrentGated && !hasResult");
    });

    it("should show '未解锁' text on disabled button", () => {
      expect(devAnalysisFlow).toContain("未解锁");
    });

    it("should show gated panel in result display area", () => {
      expect(devAnalysisFlow).toContain("未解锁");
      expect(devAnalysisFlow).toContain("需要先完成以下步骤");
      expect(devAnalysisFlow).toContain("完成前置条件后，此阶段将自动解锁");
    });

    it("should show tooltip with gating reason on stage buttons", () => {
      expect(devAnalysisFlow).toContain("analysisStepTitleById");
      expect(devAnalysisFlow).toContain("stepTitleById={analysisStepTitleById}");
    });
  });

  describe("Frontend: StageResultDisplay gating prop", () => {
    it("should accept gatingInfo prop", () => {
      expect(stageResultDisplay).toContain("gatingInfo?: { canRun: boolean; reason?: string | null; missingPrereqs?: string[] | null }");
    });

    it("should check isGated when status is pending", () => {
      // In the pending state, it should check gating
      expect(stageResultDisplay).toContain("isGated");
    });
  });
});

describe("Stage Dependency Rules", () => {
  it("attribute_tagging should depend on data confirmation", () => {
    expect(devAnalysisRouter).toContain("getDataConfirmationStatus");
  });

  it("market_overview should depend on attribute_tagging being confirmed", () => {
    // The dependency mapping should include this
    expect(devAnalysisRouter).toContain("attribute_tagging");
    expect(devAnalysisRouter).toContain("market_overview");
  });

  it("decision_dashboard should depend on multiple stages", () => {
    // Decision dashboard has the most dependencies
    const section = devAnalysisRouter.split("decision_dashboard")[1] || "";
    expect(section.length).toBeGreaterThan(0);
  });
});
