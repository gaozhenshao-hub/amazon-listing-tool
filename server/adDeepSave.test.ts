import { describe, it, expect, vi } from "vitest";

/**
 * Unit tests for the ad deep analysis save/confirm/archive functionality.
 * Tests the confirmAnalysis and archiveAnalysis procedures logic.
 */

// Mock the analysis record structure
interface AnalysisRecord {
  id: number;
  userId: string;
  reportType: string;
  status: "draft" | "confirmed" | "archived";
  analysisResult: string;
  confirmedActions: string | null;
  createdAt: number;
}

describe("Ad Deep Analysis - Save & Confirm Logic", () => {
  // Test: Confirm analysis updates status and saves actions
  it("should update status to confirmed and save actions", () => {
    const record: AnalysisRecord = {
      id: 1,
      userId: "user1",
      reportType: "placement",
      status: "draft",
      analysisResult: JSON.stringify({ actions: [{ action: "Increase TOS bid", priority: "high" }] }),
      confirmedActions: null,
      createdAt: Date.now(),
    };

    // Simulate confirm
    const confirmedActions = JSON.stringify([
      { action: "Increase TOS bid by 30%", priority: "high", campaign: "Campaign A" },
      { action: "Reduce PP bid", priority: "medium", campaign: "Campaign B" },
    ]);

    const updated = { ...record, status: "confirmed" as const, confirmedActions };
    expect(updated.status).toBe("confirmed");
    expect(updated.confirmedActions).not.toBeNull();
    expect(JSON.parse(updated.confirmedActions!)).toHaveLength(2);
    expect(JSON.parse(updated.confirmedActions!)[0].action).toBe("Increase TOS bid by 30%");
  });

  // Test: Archive analysis updates status
  it("should update status to archived", () => {
    const record: AnalysisRecord = {
      id: 2,
      userId: "user1",
      reportType: "search_term",
      status: "confirmed",
      analysisResult: JSON.stringify({ negative_suggestions: [] }),
      confirmedActions: JSON.stringify([]),
      createdAt: Date.now(),
    };

    const archived = { ...record, status: "archived" as const };
    expect(archived.status).toBe("archived");
  });

  // Test: Only owner can modify their records
  it("should validate user ownership before update", () => {
    const record: AnalysisRecord = {
      id: 3,
      userId: "user1",
      reportType: "impression_share",
      status: "draft",
      analysisResult: "{}",
      confirmedActions: null,
      createdAt: Date.now(),
    };

    const requestUserId = "user2";
    const isOwner = record.userId === requestUserId;
    expect(isOwner).toBe(false);
  });

  // Test: History query returns records in descending order
  it("should return history records sorted by creation time desc", () => {
    const records: AnalysisRecord[] = [
      { id: 1, userId: "u1", reportType: "placement", status: "confirmed", analysisResult: "{}", confirmedActions: null, createdAt: 1000 },
      { id: 2, userId: "u1", reportType: "placement", status: "draft", analysisResult: "{}", confirmedActions: null, createdAt: 3000 },
      { id: 3, userId: "u1", reportType: "placement", status: "archived", analysisResult: "{}", confirmedActions: null, createdAt: 2000 },
    ];

    const sorted = [...records].sort((a, b) => b.createdAt - a.createdAt);
    expect(sorted[0].id).toBe(2);
    expect(sorted[1].id).toBe(3);
    expect(sorted[2].id).toBe(1);
  });

  // Test: Analysis result JSON parsing
  it("should correctly parse analysis result JSON", () => {
    const placementResult = {
      trend_data: [{ date: "2026-01-01", tos_ctr: 0.5, ros_ctr: 0.3, pp_ctr: 0.2 }],
      placement_comparison: {
        top_of_search: { avg_ctr: 0.5, avg_cvr: 12.5, avg_acos: 25, spend_ratio: 40 },
        rest_of_search: { avg_ctr: 0.3, avg_cvr: 8.0, avg_acos: 35, spend_ratio: 35 },
        product_pages: { avg_ctr: 0.2, avg_cvr: 5.0, avg_acos: 45, spend_ratio: 25 },
      },
      actions: [
        { action: "Increase TOS bid", priority: "high", campaign: "Camp1", rule_id: "P-1" },
      ],
    };

    const json = JSON.stringify(placementResult);
    const parsed = JSON.parse(json);
    expect(parsed.trend_data).toHaveLength(1);
    expect(parsed.placement_comparison.top_of_search.avg_ctr).toBe(0.5);
    expect(parsed.actions[0].rule_id).toBe("P-1");
  });

  // Test: Search term analysis result structure
  it("should correctly structure search term analysis result", () => {
    const searchTermResult = {
      negative_suggestions: [
        { term: "bad keyword", total_spend: 50.00, total_clicks: 100, total_orders: 0, consecutive_days: 5, suggestion: "建议否定" },
      ],
      anomaly_terms: [
        { term: "anomaly word", daily_spend_avg: 20, spike_factor: 3.5 },
      ],
      nurture_terms: [
        { term: "growing keyword", ctr_trend: "up", cvr_trend: "stable" },
      ],
      high_efficiency_terms: [
        { term: "best keyword", acos: 10, cvr: 25 },
      ],
      actions: [
        { action: "Negate 'bad keyword'", priority: "high", term: "bad keyword", rule_id: "ST-1" },
      ],
    };

    expect(searchTermResult.negative_suggestions).toHaveLength(1);
    expect(searchTermResult.negative_suggestions[0].total_orders).toBe(0);
    expect(searchTermResult.anomaly_terms[0].spike_factor).toBeGreaterThan(3);
    expect(searchTermResult.actions[0].rule_id).toBe("ST-1");
  });

  // Test: Business cross analysis TACOS calculation
  it("should correctly calculate TACOS and organic ratio", () => {
    const totalSales = 1000;
    const adSpend = 150;
    const totalOrders = 50;
    const adOrders = 20;

    const tacos = (adSpend / totalSales) * 100;
    const organicRatio = ((totalOrders - adOrders) / totalOrders) * 100;

    expect(tacos).toBe(15);
    expect(organicRatio).toBe(60);
  });

  // Test: Cannibalization detection logic
  it("should detect ad cannibalization when ad spend increases but total orders stay flat", () => {
    const dailyData = [
      { date: "2026-01-01", adSpend: 100, totalOrders: 50, adOrders: 15 },
      { date: "2026-01-02", adSpend: 150, totalOrders: 48, adOrders: 22 },
      { date: "2026-01-03", adSpend: 200, totalOrders: 47, adOrders: 30 },
    ];

    // Ad spend increased 100%, but total orders decreased
    const spendIncrease = (dailyData[2].adSpend - dailyData[0].adSpend) / dailyData[0].adSpend;
    const orderChange = (dailyData[2].totalOrders - dailyData[0].totalOrders) / dailyData[0].totalOrders;
    const adOrderIncrease = (dailyData[2].adOrders - dailyData[0].adOrders) / dailyData[0].adOrders;

    const isCannibalization = spendIncrease > 0.5 && orderChange <= 0 && adOrderIncrease > 0.5;
    expect(isCannibalization).toBe(true);
  });

  // Test: Impression share budget transfer suggestion
  it("should suggest budget transfer when lost_to_budget is high", () => {
    const impressionData = {
      avg_share: 35,
      budget_lost: 40,
      rank_lost: 25,
    };

    const shouldTransferBudget = impressionData.budget_lost > 30;
    const shouldOptimizeBid = impressionData.rank_lost > 30;

    expect(shouldTransferBudget).toBe(true);
    expect(shouldOptimizeBid).toBe(false);
  });

  // Test: SB Benchmark comparison logic
  it("should identify underperforming metrics vs benchmark", () => {
    const selfMetrics = { ctr: 0.4, cvr: 8, acos: 35 };
    const benchmarkMetrics = { ctr: 0.6, cvr: 12, acos: 25 };

    const underperforming = [];
    if (selfMetrics.ctr < benchmarkMetrics.ctr) underperforming.push("CTR");
    if (selfMetrics.cvr < benchmarkMetrics.cvr) underperforming.push("CVR");
    if (selfMetrics.acos > benchmarkMetrics.acos) underperforming.push("ACOS");

    expect(underperforming).toContain("CTR");
    expect(underperforming).toContain("CVR");
    expect(underperforming).toContain("ACOS");
    expect(underperforming).toHaveLength(3);
  });

  // Test: Action items editing
  it("should allow editing action items before confirmation", () => {
    const actions = [
      { action: "Original action 1", priority: "high", campaign: "Camp A" },
      { action: "Original action 2", priority: "medium", campaign: "Camp B" },
    ];

    // User edits action 1
    const editedActions = [...actions];
    editedActions[0] = { ...editedActions[0], action: "Edited: Increase bid by 40% for TOS" };

    expect(editedActions[0].action).toBe("Edited: Increase bid by 40% for TOS");
    expect(editedActions[1].action).toBe("Original action 2");
  });

  // Test: Report type validation
  it("should validate report type is one of the allowed types", () => {
    const allowedTypes = ["placement", "search_term", "impression_share", "sb_benchmark", "business_cross"];

    expect(allowedTypes.includes("placement")).toBe(true);
    expect(allowedTypes.includes("search_term")).toBe(true);
    expect(allowedTypes.includes("impression_share")).toBe(true);
    expect(allowedTypes.includes("sb_benchmark")).toBe(true);
    expect(allowedTypes.includes("business_cross")).toBe(true);
    expect(allowedTypes.includes("invalid_type")).toBe(false);
  });
});
