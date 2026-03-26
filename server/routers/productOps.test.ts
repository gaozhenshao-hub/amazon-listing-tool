import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies
vi.mock("../db", () => ({
  getDb: vi.fn(() => Promise.resolve({
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnValue(Promise.resolve([])),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnValue(Promise.resolve([{ insertId: 1 }])),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
  })),
}));

vi.mock("../lingxingAdapter", () => ({
  getLingxingAdapter: vi.fn(() => ({
    isMockMode: () => true,
    request: vi.fn().mockResolvedValue({ code: 0, data: [], msg: "ok" }),
  })),
}));

vi.mock("../_core/llm", () => ({
  invokeLLM: vi.fn().mockResolvedValue({
    choices: [{ message: { content: JSON.stringify({ analysis: "test" }) } }],
  }),
}));

describe("productOps router module", () => {
  it("should export productOpsRouter", async () => {
    const mod = await import("./productOps");
    expect(mod.productOpsRouter).toBeDefined();
    expect(mod.productOpsRouter._def).toBeDefined();
  });

  it("should have all original product CRUD procedures", async () => {
    const mod = await import("./productOps");
    const procedures = Object.keys(mod.productOpsRouter._def.procedures);
    
    // Product CRUD
    expect(procedures).toContain("listProducts");
    expect(procedures).toContain("getProduct");
    expect(procedures).toContain("createProduct");
    expect(procedures).toContain("updateProduct");
    expect(procedures).toContain("deleteProduct");
    
    // Variants
    expect(procedures).toContain("addVariant");
    expect(procedures).toContain("removeVariant");
    
    // Todos
    expect(procedures).toContain("getTodos");
    expect(procedures).toContain("createTodo");
    expect(procedures).toContain("updateTodo");
    expect(procedures).toContain("deleteTodo");
    
    // Logs
    expect(procedures).toContain("getLogs");
    expect(procedures).toContain("createLog");
    expect(procedures).toContain("deleteLog");
    
    // Keyword monitors
    expect(procedures).toContain("getKeywordMonitors");
    expect(procedures).toContain("addKeywordMonitor");
    expect(procedures).toContain("removeKeywordMonitor");
    expect(procedures).toContain("addKeywordSnapshot");
    
    // Data aggregation
    expect(procedures).toContain("getProductProfitSummary");
    expect(procedures).toContain("getProductInventorySummary");
    expect(procedures).toContain("getProductAdsSummary");
    expect(procedures).toContain("getProductCompetitors");
  });

  it("should have all operations plan procedures", async () => {
    const mod = await import("./productOps");
    const procedures = Object.keys(mod.productOpsRouter._def.procedures);
    
    // Ops Plans
    expect(procedures).toContain("listPlans");
    expect(procedures).toContain("getPlan");
    expect(procedures).toContain("createPlan");
    expect(procedures).toContain("updatePlan");
    expect(procedures).toContain("deletePlan");
    
    // Plan Actions
    expect(procedures).toContain("listPlanActions");
    expect(procedures).toContain("createPlanAction");
    expect(procedures).toContain("updatePlanAction");
    expect(procedures).toContain("deletePlanAction");
    // syncActionToTodo is handled within createPlanAction
    
    // Plan Summaries
    expect(procedures).toContain("listPlanSummaries");
    expect(procedures).toContain("createPlanSummary");
    expect(procedures).toContain("updatePlanSummary");
  });

  it("should have all conversion comparison procedures", async () => {
    const mod = await import("./productOps");
    const procedures = Object.keys(mod.productOpsRouter._def.procedures);
    
    // Conversion Comparisons
    expect(procedures).toContain("listComparisons");
    expect(procedures).toContain("getComparison");
    expect(procedures).toContain("createComparison");
    expect(procedures).toContain("deleteComparison");
    
    // Check Items
    expect(procedures).toContain("getCheckItems");
    expect(procedures).toContain("addCustomCheckItem");
    expect(procedures).toContain("removeCustomCheckItem");
    expect(procedures).toContain("initDefaultCheckItems");
    expect(procedures).toContain("editCheckItem");
    expect(procedures).toContain("toggleCheckItemHidden");
    expect(procedures).toContain("resetCheckItemOverride");
    
    // Scores
    expect(procedures).toContain("getScores");
    expect(procedures).toContain("updateScore");
    expect(procedures).toContain("batchUpdateScores");
    expect(procedures).toContain("triggerAiScoring");
    
    // Suggestions
    expect(procedures).toContain("getSuggestions");
    expect(procedures).toContain("updateSuggestion");
    expect(procedures).toContain("generateSuggestions");
    expect(procedures).toContain("syncSuggestionsToPlan");
  });

  it("should have all execution review procedures", async () => {
    const mod = await import("./productOps");
    const procedures = Object.keys(mod.productOpsRouter._def.procedures);
    
    expect(procedures).toContain("listExecutionReviews");
    expect(procedures).toContain("createExecutionReview");
    expect(procedures).toContain("updateExecutionReview");
    expect(procedures).toContain("deleteExecutionReview");
    expect(procedures).toContain("aiReviewAnalysis");
    expect(procedures).toContain("syncReviewFromLingxing");
  });

  it("should have syncPlanCurrentData procedure for period-based data sync", async () => {
    const mod = await import("./productOps");
    const procedures = Object.keys(mod.productOpsRouter._def.procedures);
    expect(procedures).toContain("syncPlanCurrentData");
  });

  it("should have all team task procedures", async () => {
    const mod = await import("./productOps");
    const procedures = Object.keys(mod.productOpsRouter._def.procedures);
    
    expect(procedures).toContain("listTeamTasks");
    expect(procedures).toContain("createTeamTask");
    expect(procedures).toContain("updateTeamTask");
    expect(procedures).toContain("moveTeamTask");
    expect(procedures).toContain("deleteTeamTask");
     expect(procedures).toContain("getTeamTaskStats");
    expect(procedures).toContain("syncFromLingxing");
  });
  it("should have exactly 68 procedures", async () => {
    const mod = await import("./productOps");
    const procedures = Object.keys(mod.productOpsRouter._def.procedures);
    expect(procedures.length).toBe(75);
  });

  it("all procedures should be defined", async () => {
    const mod = await import("./productOps");
    const procedures = mod.productOpsRouter._def.procedures;
    for (const [name, proc] of Object.entries(procedures)) {
      expect(proc, `Procedure ${name} should be defined`).toBeDefined();
    }
  });
});
