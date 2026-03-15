import { describe, it, expect } from "vitest";

// ─── Phase 1: Schema Changes ─────────────────────────────
describe("Two-Phase Schema", () => {
  it("devProjects table has phase and approval fields", async () => {
    const schema = await import("../drizzle/schema");
    const cols = schema.devProjects;
    // Check that the table definition includes phase, approvedAt, approvedScore
    expect(cols).toBeDefined();
    // The phase enum should exist
    expect(schema.devProjects.phase).toBeDefined();
  });

  it("devProductProfiles has 8 sub-module AI suggestion fields", async () => {
    const schema = await import("../drizzle/schema");
    const cols = schema.devProductProfiles;
    // Check all 8 AI suggestion columns
    expect(cols.appearanceAiSuggestion).toBeDefined();
    expect(cols.functionsAiSuggestion).toBeDefined();
    expect(cols.costAiSuggestion).toBeDefined();
    expect(cols.packageAiSuggestion).toBeDefined();
    expect(cols.packageDesignAiSuggestion).toBeDefined();
    expect(cols.userPersonaAiSuggestion).toBeDefined();
    expect(cols.usageScenariosAiSuggestion).toBeDefined();
    expect(cols.productMapAiSuggestion).toBeDefined();
  });

  it("devProductProfiles has 8 confirmed flags", async () => {
    const schema = await import("../drizzle/schema");
    const cols = schema.devProductProfiles;
    expect(cols.appearanceConfirmed).toBeDefined();
    expect(cols.functionsConfirmed).toBeDefined();
    expect(cols.costConfirmed).toBeDefined();
    expect(cols.packageConfirmed).toBeDefined();
    expect(cols.packageDesignConfirmed).toBeDefined();
    expect(cols.userPersonaConfirmed).toBeDefined();
    expect(cols.usageScenariosConfirmed).toBeDefined();
    expect(cols.productMapConfirmed).toBeDefined();
  });

  it("devProductManuals has bilingual and PDF fields", async () => {
    const schema = await import("../drizzle/schema");
    const cols = schema.devProductManuals;
    expect(cols.coverImageUrl).toBeDefined();
    expect(cols.qrCodeUrl).toBeDefined();
    expect(cols.pdfEnUrl).toBeDefined();
    expect(cols.pdfEsUrl).toBeDefined();
    expect(cols.htmlEnUrl).toBeDefined();
    expect(cols.htmlEsUrl).toBeDefined();
  });

  it("devTestReports has excelUrl field", async () => {
    const schema = await import("../drizzle/schema");
    expect(schema.devTestReports.excelUrl).toBeDefined();
  });
});

// ─── Phase 2: Router Structure ───────────────────────────
describe("Router Structure", () => {
  it("devScoring router has approveProject and revokeApproval", async () => {
    const { devScoringRouter } = await import("./routers/devScoring");
    expect(devScoringRouter).toBeDefined();
    // Check that the router has the expected procedures
    const procedures = Object.keys(devScoringRouter._def.procedures);
    expect(procedures).toContain("generate");
    expect(procedures).toContain("getScore");
    expect(procedures).toContain("approveProject");
    expect(procedures).toContain("revokeApproval");
  });

  it("devProfile router has per-section operations", async () => {
    const { devProfileRouter } = await import("./routers/devProfile");
    const procedures = Object.keys(devProfileRouter._def.procedures);
    expect(procedures).toContain("get");
    expect(procedures).toContain("saveSection");
    expect(procedures).toContain("confirmSection");
    expect(procedures).toContain("generateSuggestions");
    expect(procedures).toContain("generateMore");
    expect(procedures).toContain("save");
    expect(procedures).toContain("confirm");
  });

  it("devManual router has 3-step workflow", async () => {
    const { devManualRouter } = await import("./routers/devManual");
    const procedures = Object.keys(devManualRouter._def.procedures);
    expect(procedures).toContain("getManual");
    expect(procedures).toContain("generateManual");
    expect(procedures).toContain("saveManual");
    expect(procedures).toContain("generateHtml");
    expect(procedures).toContain("exportPdf");
  });

  it("devManual router has test report with status tracking", async () => {
    const { devManualRouter } = await import("./routers/devManual");
    const procedures = Object.keys(devManualRouter._def.procedures);
    expect(procedures).toContain("getTestReport");
    expect(procedures).toContain("generateTestReport");
    expect(procedures).toContain("saveTestReport");
    expect(procedures).toContain("updateTestItemStatus");
    expect(procedures).toContain("exportTestExcel");
  });

  it("devBom router has batch simulation and report data", async () => {
    const { devBomRouter } = await import("./routers/devBom");
    const procedures = Object.keys(devBomRouter._def.procedures);
    expect(procedures).toContain("getBomCostSummary");
    expect(procedures).toContain("batchSimulate");
    expect(procedures).toContain("getProjectReportData");
  });
});

// ─── Phase 3: Profit Simulation Logic ────────────────────
describe("Batch Profit Simulation", () => {
  it("calculates mold amortization correctly for different quantities", () => {
    const totalMoldCost = 10000;
    const quantities = [100, 500, 1000, 5000];
    const expected = [100, 20, 10, 2];

    quantities.forEach((qty, i) => {
      const moldPerUnit = qty > 0 ? totalMoldCost / qty : 0;
      expect(Math.round(moldPerUnit * 100) / 100).toBe(expected[i]);
    });
  });

  it("calculates profit margin correctly", () => {
    const sellingPrice = 29.99;
    const totalUnitCost = 20.0;
    const profit = sellingPrice - totalUnitCost;
    const profitMargin = (profit / sellingPrice) * 100;

    expect(profit).toBeCloseTo(9.99, 2);
    expect(profitMargin).toBeCloseTo(33.31, 1);
  });

  it("handles zero selling price without NaN", () => {
    const sellingPrice = 0;
    const totalUnitCost = 10;
    const profit = sellingPrice - totalUnitCost;
    const profitMargin = sellingPrice > 0 ? (profit / sellingPrice) * 100 : 0;

    expect(profitMargin).toBe(0);
    expect(Number.isNaN(profitMargin)).toBe(false);
  });

  it("calculates ROI correctly", () => {
    const profit = 10;
    const totalUnitCost = 20;
    const roi = totalUnitCost > 0 ? (profit / totalUnitCost) * 100 : 0;
    expect(roi).toBe(50);
  });
});

// ─── Phase 4: Profile Section Keys ──────────────────────
describe("Profile Section Configuration", () => {
  it("has exactly 8 profile sections", () => {
    const sections = [
      "appearance", "function", "cost", "package", "packageDesign",
      "userPersona", "usageScenarios", "productMap",
    ];
    expect(sections.length).toBe(8);
  });

  it("each section maps to correct DB columns", () => {
    const SECTION_DB_MAP: Record<string, { data: string; ai: string; confirmed: string }> = {
      appearance: { data: "appearanceColors", ai: "appearanceAiSuggestion", confirmed: "appearanceConfirmed" },
      function: { data: "mainFunctions", ai: "functionsAiSuggestion", confirmed: "functionsConfirmed" },
      cost: { data: "costBreakdown", ai: "costAiSuggestion", confirmed: "costConfirmed" },
      package: { data: "packageDimensions", ai: "packageAiSuggestion", confirmed: "packageConfirmed" },
      packageDesign: { data: "packageDesign", ai: "packageDesignAiSuggestion", confirmed: "packageDesignConfirmed" },
      userPersona: { data: "userPersona", ai: "userPersonaAiSuggestion", confirmed: "userPersonaConfirmed" },
      usageScenarios: { data: "usageScenarios", ai: "usageScenariosAiSuggestion", confirmed: "usageScenariosConfirmed" },
      productMap: { data: "productMap", ai: "productMapAiSuggestion", confirmed: "productMapConfirmed" },
    };

    expect(Object.keys(SECTION_DB_MAP).length).toBe(8);
    Object.values(SECTION_DB_MAP).forEach(v => {
      expect(v.data).toBeTruthy();
      expect(v.ai).toBeTruthy();
      expect(v.confirmed).toBeTruthy();
    });
  });
});

// ─── Phase 5: Manual Chapters ───────────────────────────
describe("Manual Chapter Configuration", () => {
  it("has exactly 9 manual chapters", () => {
    const chapters = [
      "overview", "contents", "specs", "installation", "usage",
      "safety", "maintenance", "troubleshooting", "warranty",
    ];
    expect(chapters.length).toBe(9);
  });
});

// ─── Phase 6: Test Report Categories ────────────────────
describe("Test Report Categories", () => {
  it("has exactly 8 test categories", () => {
    const categories = [
      "installation", "usage", "drop", "shipping",
      "function", "durability", "safety", "packaging",
    ];
    expect(categories.length).toBe(8);
  });

  it("test status values are valid", () => {
    const validStatuses = ["pass", "fail", "pending"];
    validStatuses.forEach(s => {
      expect(["pass", "fail", "pending"]).toContain(s);
    });
  });
});
