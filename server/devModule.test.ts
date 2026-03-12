import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import fs from "fs";
import path from "path";

// ============================================================
// Module 1: Product Development AI Analysis - Router Structure
// ============================================================

describe("Module 1 - devProject router", () => {
  it("should have all required procedures", () => {
    const router = appRouter._def.procedures;
    expect(router).toHaveProperty("devProject.list");
    expect(router).toHaveProperty("devProject.getById");
    expect(router).toHaveProperty("devProject.create");
    expect(router).toHaveProperty("devProject.update");
    expect(router).toHaveProperty("devProject.delete");
    expect(router).toHaveProperty("devProject.stats");
    expect(router).toHaveProperty("devProject.uploadFile");
  });
});

describe("Module 1 - devTagging router", () => {
  it("should have all required procedures", () => {
    const router = appRouter._def.procedures;
    expect(router).toHaveProperty("devTagging.startTagging");
    expect(router).toHaveProperty("devTagging.getTaggedProducts");
    expect(router).toHaveProperty("devTagging.getTagDimensions");
    expect(router).toHaveProperty("devTagging.addTagDimension");
    expect(router).toHaveProperty("devTagging.deleteTagDimension");
  });
});

describe("Module 1 - devAnalysis router", () => {
  it("should have all required procedures", () => {
    const router = appRouter._def.procedures;
    expect(router).toHaveProperty("devAnalysis.generateReport");
    expect(router).toHaveProperty("devAnalysis.getReports");
    expect(router).toHaveProperty("devAnalysis.getReport");
    expect(router).toHaveProperty("devAnalysis.updateReport");
    expect(router).toHaveProperty("devAnalysis.reviewStats");
    expect(router).toHaveProperty("devAnalysis.contentStats");
    expect(router).toHaveProperty("devAnalysis.wordCloud");
    expect(router).toHaveProperty("devAnalysis.fetchAIAnalysis");
    expect(router).toHaveProperty("devAnalysis.getExternalData");
  });
});

describe("Module 1 - devScoring router", () => {
  it("should have all required procedures", () => {
    const router = appRouter._def.procedures;
    expect(router).toHaveProperty("devScoring.generate");
    expect(router).toHaveProperty("devScoring.getScore");
  });
});

describe("Module 1 - devProfile router", () => {
  it("should have all required procedures", () => {
    const router = appRouter._def.procedures;
    expect(router).toHaveProperty("devProfile.get");
    expect(router).toHaveProperty("devProfile.save");
    expect(router).toHaveProperty("devProfile.confirm");
    expect(router).toHaveProperty("devProfile.generateSuggestions");
    expect(router).toHaveProperty("devProfile.generateMore");
  });
});

describe("Module 1 - devBom router", () => {
  it("should have all required procedures", () => {
    const router = appRouter._def.procedures;
    expect(router).toHaveProperty("devBom.list");
    expect(router).toHaveProperty("devBom.add");
    expect(router).toHaveProperty("devBom.update");
    expect(router).toHaveProperty("devBom.delete");
    expect(router).toHaveProperty("devBom.aiSuggest");
    expect(router).toHaveProperty("devBom.calculateProfit");
    expect(router).toHaveProperty("devBom.getProfitAnalysis");
    expect(router).toHaveProperty("devBom.listSuppliers");
    expect(router).toHaveProperty("devBom.addSupplier");
    expect(router).toHaveProperty("devBom.updateSupplier");
    expect(router).toHaveProperty("devBom.deleteSupplier");
  });
});

describe("Module 1 - devManual router", () => {
  it("should have all required procedures", () => {
    const router = appRouter._def.procedures;
    expect(router).toHaveProperty("devManual.getManual");
    expect(router).toHaveProperty("devManual.generateManual");
    expect(router).toHaveProperty("devManual.saveManual");
    expect(router).toHaveProperty("devManual.getTestReport");
    expect(router).toHaveProperty("devManual.generateTestReport");
    expect(router).toHaveProperty("devManual.saveTestReport");
  });
});

// ============================================================
// Module 1: File Structure Verification
// ============================================================

describe("Module 1 - File structure", () => {
  const basePath = path.resolve(__dirname, "..");

  it("should have all required router files", () => {
    const routerFiles = [
      "server/routers/devProject.ts",
      "server/routers/devTagging.ts",
      "server/routers/devAnalysis.ts",
      "server/routers/devScoring.ts",
      "server/routers/devProfile.ts",
      "server/routers/devBom.ts",
      "server/routers/devManual.ts",
    ];
    for (const file of routerFiles) {
      expect(fs.existsSync(path.join(basePath, file)), `${file} should exist`).toBe(true);
    }
  });

  it("should have devDb.ts database helpers", () => {
    expect(fs.existsSync(path.join(basePath, "server/devDb.ts"))).toBe(true);
  });

  it("should have all dev_ tables in schema", () => {
    const schema = fs.readFileSync(path.join(basePath, "drizzle/schema.ts"), "utf-8");
    const requiredTables = [
      "devProjects", "devUploadedFiles", "devProducts", "devReviews",
      "devTagDimensions", "devExternalData", "devAnalysisReports",
      "devProjectScores", "devProductProfiles",
      "devBomItems", "devProfitCalculations", "devGlobalSuppliers",
      "devProductManuals", "devTestReports", "devSuppliers",
      "devMoldCosts", "devTimePlans", "devBomSummary",
    ];
    for (const table of requiredTables) {
      expect(schema).toContain(table);
    }
  });

  it("should have all dev frontend pages", () => {
    const pages = [
      "client/src/pages/dev/DevDashboard.tsx",
      "client/src/pages/dev/DevProjects.tsx",
      "client/src/pages/dev/DevNewProject.tsx",
      "client/src/pages/dev/DevProjectDetail.tsx",
    ];
    for (const page of pages) {
      expect(fs.existsSync(path.join(basePath, page)), `${page} should exist`).toBe(true);
    }
  });
});

// ============================================================
// Module 1: AI Prompt Verification
// ============================================================

describe("Module 1 - AI prompts in routers", () => {
  it("devTagging should contain AI tagging prompt", () => {
    const code = fs.readFileSync(path.resolve(__dirname, "routers/devTagging.ts"), "utf-8");
    expect(code).toContain("invokeLLM");
    expect(code).toContain("标签");
  });

  it("devAnalysis should contain AI analysis prompt", () => {
    const code = fs.readFileSync(path.resolve(__dirname, "routers/devAnalysis.ts"), "utf-8");
    expect(code).toContain("invokeLLM");
    expect(code).toContain("分析");
  });

  it("devScoring should contain multi-dimension scoring logic", () => {
    const code = fs.readFileSync(path.resolve(__dirname, "routers/devScoring.ts"), "utf-8");
    expect(code).toContain("invokeLLM");
    expect(code).toMatch(/市场|竞争|利润|供应链|合规|创新/);
  });

  it("devProfile should contain product profile AI generation", () => {
    const code = fs.readFileSync(path.resolve(__dirname, "routers/devProfile.ts"), "utf-8");
    expect(code).toContain("invokeLLM");
    expect(code).toContain("产品画像");
  });

  it("devManual should contain manual and test report AI generation", () => {
    const code = fs.readFileSync(path.resolve(__dirname, "routers/devManual.ts"), "utf-8");
    expect(code).toContain("invokeLLM");
    expect(code).toContain("说明书");
    expect(code).toContain("测试报告");
  });
});

// ============================================================
// Module 1: Router Registration
// ============================================================

describe("Module 1 - Router registration", () => {
  it("all module 1 routers should be registered in appRouter", () => {
    const routersCode = fs.readFileSync(path.resolve(__dirname, "routers.ts"), "utf-8");
    expect(routersCode).toContain("devProject");
    expect(routersCode).toContain("devTagging");
    expect(routersCode).toContain("devAnalysis");
    expect(routersCode).toContain("devScoring");
    expect(routersCode).toContain("devProfile");
    expect(routersCode).toContain("devBom");
    expect(routersCode).toContain("devManual");
  });
});
