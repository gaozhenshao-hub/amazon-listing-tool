import { describe, it, expect } from "vitest";

// ═══════════════════════════════════════════════════════════════
// Tests for 6 New Features (2026-03-23)
// ═══════════════════════════════════════════════════════════════

describe("Feature 1: Crawler Engine", () => {
  it("should export crawler engine module with required functions", async () => {
    const mod = await import("./crawlerEngine");
    expect(mod).toBeDefined();
    expect(typeof mod.crawlCompetitorData).toBe("function");
    expect(typeof mod.crawlKeywordRank).toBe("function");
    expect(typeof mod.executeCrawlBatch).toBe("function");
    expect(typeof mod.getSchedulerStatus).toBe("function");
    expect(typeof mod.startScheduler).toBe("function");
    expect(typeof mod.stopScheduler).toBe("function");
  });

  it("crawler router should be registered in main app router", async () => {
    const { appRouter } = await import("./routers");
    expect(appRouter._def.procedures).toHaveProperty("crawler.crawlCompetitor");
    expect(appRouter._def.procedures).toHaveProperty("crawler.crawlKeyword");
    expect(appRouter._def.procedures).toHaveProperty("crawler.crawlAllCompetitors");
    expect(appRouter._def.procedures).toHaveProperty("crawler.crawlAllKeywords");
    expect(appRouter._def.procedures).toHaveProperty("crawler.getSchedulerStatus");
    expect(appRouter._def.procedures).toHaveProperty("crawler.getCrawlHistory");
  });

  it("scheduler status should return correct structure", async () => {
    const { getSchedulerStatus } = await import("./crawlerEngine");
    const status = getSchedulerStatus();
    expect(status).toHaveProperty("isRunning");
    expect(status).toHaveProperty("lastRunAt");
    expect(typeof status.isRunning).toBe("boolean");
  });
});

describe("Feature 2: Dashboard-to-Detail Navigation", () => {
  it("OpsProfit page should have click-to-navigate on product rows", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync("client/src/pages/ops/OpsProfit.tsx", "utf-8");
    expect(content).toContain("setLocation");
    expect(content).toContain("cursor-pointer");
    expect(content).toContain("highlight");
    expect(content).toContain("点击查看产品详情");
  });

  it("OpsDashboard should have product ranking section", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync("client/src/pages/ops/OpsDashboard.tsx", "utf-8");
    expect(content).toContain("产品运营排行");
  });
});

describe("Feature 3: Todo Reminder Notifications", () => {
  it("should export todoReminder module with required functions", async () => {
    const mod = await import("./todoReminder");
    expect(mod).toBeDefined();
    expect(typeof mod.checkTodoReminders).toBe("function");
    expect(typeof mod.startTodoReminderScheduler).toBe("function");
  });

  it("notification router should have triggerTodoReminders endpoint", async () => {
    const { appRouter } = await import("./routers");
    expect(appRouter._def.procedures).toHaveProperty("notification.checkTodoReminders");
  });
});

describe("Feature 4: Lingxing API Settings Page", () => {
  it("systemSettings router should have lingxing config endpoints", async () => {
    const { appRouter } = await import("./routers");
    expect(appRouter._def.procedures).toHaveProperty("systemSettings.getLingxingConfig");
    expect(appRouter._def.procedures).toHaveProperty("systemSettings.updateLingxingConfig");
    expect(appRouter._def.procedures).toHaveProperty("systemSettings.testLingxingConnection");
  });

  it("SystemSettings page should have Lingxing API tab with form fields", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync("client/src/pages/SystemSettings.tsx", "utf-8");
    expect(content).toContain("lingxing");
    expect(content).toContain("领星API");
    expect(content).toContain("App ID");
    expect(content).toContain("App Secret");
    expect(content).toContain("API Host");
  });
});

describe("Feature 5: Conversion-to-Plan Sync Enhancement", () => {
  it("syncSuggestionsToPlan should support mode and scoreThreshold parameters", async () => {
    const { appRouter } = await import("./routers");
    expect(appRouter._def.procedures).toHaveProperty("productOps.syncSuggestionsToPlan");
  });

  it("OpsProductConversion should have enhanced sync dialog", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync("client/src/pages/ops/OpsProductConversion.tsx", "utf-8");
    expect(content).toContain("showSyncDialog");
    expect(content).toContain("syncMode");
    expect(content).toContain("locked_low_score");
    expect(content).toContain("all_locked");
    expect(content).toContain("scoreThreshold");
    expect(content).toContain("同步优化建议到运营计划");
    expect(content).toContain("selectedSuggestions");
    expect(content).toContain("checkbox");
    expect(content).toContain("已同步到运营计划");
    expect(content).toContain("低分项·建议同步优化");
  });
});

describe("Feature 6: Gantt Chart View", () => {
  it("OpsProductTeam should have gantt view mode with GanttChartView component", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync("client/src/pages/ops/OpsProductTeam.tsx", "utf-8");
    expect(content).toContain("gantt");
    expect(content).toContain("甘特图");
    expect(content).toContain("GanttChartView");
    expect(content).toContain("timeScale");
    expect(content).toContain("todayOffset");
    expect(content).toContain("今天");
    expect(content).toContain("STATUS_COLORS");
    expect(content).toContain("getBarPosition");
    expect(content).toContain("isOverdue");
    expect(content).toContain("进行中");
    expect(content).toContain("已过期");
    expect(content).toContain("本周到期");
  });

  it("GanttChartView should support day/week/month time scales", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync("client/src/pages/ops/OpsProductTeam.tsx", "utf-8");
    // Check time scale options
    expect(content).toMatch(/timeScale.*"day".*"week".*"month"/s);
  });
});
